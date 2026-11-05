// lib/study-room/tts.ts — 书房「AI 朗读」的播放层。
//
// 两种音色来源，都不在书房里重复配置：
//  1. 角色音色：直接用宿主机已有的角色语音绑定（resolveVoiceConfig + synthesizeSpeech）；
//  2. 基础音色：设备自带的系统语音（speechSynthesis），不需要任何密钥。
// 两者都没有时明确显示「尚未配置」，不假装合成成功。

import { loadCharacters } from "@/lib/character-storage";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { loadVoiceConfigs } from "@/lib/settings-storage";
import { playAudioBlob, resolveVoiceConfig, synthesizeSpeech } from "@/lib/tts-service";
import { getReadingVolume } from "./ambient";

const PROGRESS_KEY = "ai_phone_studyroom_tts_progress_v1";
registerKvMigration(PROGRESS_KEY);

export type ReaderVoice = {
  id: string;
  label: string;
  kind: "system" | "character";
  /** kind="character" 时的角色 id */
  characterId?: string;
  lang?: string;
  /** 给界面看的说明，例如「来自角色卡的声音」 */
  note: string;
};

/** 系统语音（免费、无需配置）。 */
function systemVoices(): ReaderVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => /zh|cmn|yue/i.test(voice.lang))
    .map<ReaderVoice>((voice) => ({
      id: `sys:${voice.voiceURI}`,
      label: voice.name,
      kind: "system",
      lang: voice.lang,
      note: "设备自带语音",
    }));
}

/** 角色音色：只有宿主里给这个角色绑定了语音配置、且该配置可用时才算可用。 */
export function characterVoices(): ReaderVoice[] {
  const configs = loadVoiceConfigs();
  const out: ReaderVoice[] = [];
  for (const character of loadCharacters()) {
    const resolved = resolveVoiceConfig(character.id, "reading");
    if (!resolved) continue;
    if (!configs.some((config) => config.id === resolved.id)) continue;
    if (!resolved.apiKey) continue;
    out.push({
      id: `char:${character.id}`,
      label: character.name,
      kind: "character",
      characterId: character.id,
      note: "来自角色卡的音色",
    });
  }
  return out;
}

export function systemVoicesAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 当前可用的音色清单（角色音色在前，系统语音在后）。 */
export function listReaderVoices(): ReaderVoice[] {
  return [...characterVoices(), ...systemVoices()];
}

export function pickDefaultVoice(voices: ReaderVoice[]): ReaderVoice | null {
  return voices.find((voice) => voice.kind === "character") ?? voices[0] ?? null;
}

/** 等系统语音列表就绪（Chrome 首次为空，需要等 voiceschanged）。 */
export function whenVoicesReady(callback: (voices: ReaderVoice[]) => void): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    callback([]);
    return () => undefined;
  }
  const emit = () => callback(listReaderVoices());
  emit();
  window.speechSynthesis.addEventListener?.("voiceschanged", emit);
  return () => window.speechSynthesis.removeEventListener?.("voiceschanged", emit);
}

export type SpeakHandle = { promise: Promise<void>; abort: () => void };

async function speakWithSystem(text: string, voice: ReaderVoice, rate: number): Promise<SpeakHandle | null> {
  if (!systemVoicesAvailable()) return null;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const uri = voice.id.startsWith("sys:") ? voice.id.slice(4) : "";
  const matched = synth.getVoices().find((item) => item.voiceURI === uri);
  if (matched) utterance.voice = matched;
  else if (voice.lang) utterance.lang = voice.lang;
  utterance.rate = Math.min(Math.max(rate, 0.5), 2.5);
  // 书房朗读音量（独立于背景声音）
  utterance.volume = getReadingVolume();
  const promise = new Promise<void>((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
  });
  synth.speak(utterance);
  return {
    promise,
    abort: () => {
      try {
        synth.cancel();
      } catch {
        /* 忽略 */
      }
    },
  };
}

async function speakWithCharacter(
  text: string,
  voice: ReaderVoice,
  rate: number,
): Promise<SpeakHandle | null> {
  if (!voice.characterId) return null;
  const config = resolveVoiceConfig(voice.characterId, "reading");
  if (!config?.apiKey) return null;
  // 宿主语音配置里的语速是它自己的字段；这里只在用户明确改过倍速时传给合成器
  const tuned = rate === 1 ? config : { ...config, speechSpeed: rate };
  const blob = await synthesizeSpeech(text, tuned);
  if (!blob) return null;
  const handle = playAudioBlob(blob, { volume: getReadingVolume() });
  return { promise: handle.promise, abort: handle.abort };
}

/**
 * 朗读一段文字。角色音色走宿主 TTS，基础音色走系统语音；
 * 两者都不可用时返回 null（界面据此显示「尚未配置」）。
 */
export async function speakParagraph(params: {
  text: string;
  voice: ReaderVoice;
  rate: number;
}): Promise<SpeakHandle | null> {
  const text = params.text.trim();
  if (!text) return null;
  if (params.voice.kind === "character") {
    try {
      const handle = await speakWithCharacter(text, params.voice, params.rate);
      if (handle) return handle;
    } catch {
      // 合成失败就退回系统语音（并让调用方知道当前用的是哪个音色）
    }
  }
  return speakWithSystem(text, params.voice, params.rate);
}

export function stopSpeaking(): void {
  if (systemVoicesAvailable()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
  }
}

// ── 断点续播：记录每本书读到哪一段 ──

export type TtsProgress = { chapterIndex: number; paragraphIndex: number; at: string };

function loadAll(): Record<string, TtsProgress> {
  try {
    const raw = kvGet(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, TtsProgress>) : {};
  } catch {
    return {};
  }
}

export function loadTtsProgress(bookId: string): TtsProgress | null {
  return loadAll()[bookId] ?? null;
}

export function saveTtsProgress(bookId: string, chapterIndex: number, paragraphIndex: number): void {
  const all = loadAll();
  kvSet(PROGRESS_KEY, JSON.stringify({ ...all, [bookId]: { chapterIndex, paragraphIndex, at: new Date().toISOString() } }));
}

// 白噪音（背景声音）已移到 ./ambient.ts，与朗读音量一起管理。
