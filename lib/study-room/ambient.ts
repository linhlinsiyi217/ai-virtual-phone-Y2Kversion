// lib/study-room/ambient.ts — 书房阅读的「背景声音」（白噪音）与朗读音量。
//
// 白噪音：在本机用 Web Audio 按算法合成，不下载音频文件、不联网、不调用模型，
// 因此没有第三方音频素材，也不涉及素材授权（粉红噪音用 Paul Kellet 的公开滤波系数）。
// 播放范围：在书房里切换页面会继续播放，退出书房（StudyRoomApp 卸载）时停止；锁屏 / 切后台由系统决定，不保证继续。
// 整个书房只有一路背景声音：换一种会先停掉上一种，连点同一种不会叠出第二路。
// 朗读音量与背景音量各存各的；朗读时背景音临时降低（ducking），停下后回到用户设定值。
// 背景音乐（小手机音乐 / 网易云）还没有真实接口，见 reader-music.ts。

import { getReaderMusicController } from "./reader-music";
import { createNoiseBuffer, type NoiseKind } from "@/lib/noise-synth";

export type { NoiseKind };
export { NOISE_LABELS, NOISE_HINTS } from "@/lib/noise-synth";

export type AmbientStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type AmbientState = {
  kind: NoiseKind | null;
  status: AmbientStatus;
  /** 用户设定的背景音量 0..1（朗读降低不会改这个值） */
  volume: number;
  /** 朗读音量 0..1，只作用于书房朗读 */
  readingVolume: number;
  /** 当前是否因为朗读被临时降低 */
  ducked: boolean;
  error: string | null;
};

const STORE_KEY = "studyroom_ambient_v1";
/** 生成噪声本身偏响，按这个系数换算成实际增益 */
const GAIN_SCALE = 0.35;
/** 朗读时背景音降到用户设定值的这个比例（具体比例需求未指定，先取适中值） */
const DUCK_RATIO = 0.35;
/** 音量渐变时间常数（秒） */
const RAMP = 0.12;
/** 拖动音量条时的渐变时间常数：足够短，跟手但不出「咔哒」声 */
const DRAG_RAMP = 0.03;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function loadSaved(): { volume: number; readingVolume: number } {
  if (typeof window === "undefined") return { volume: 0.5, readingVolume: 1 };
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "null") as
      | { volume?: number; readingVolume?: number }
      | null;
    return {
      volume: raw?.volume == null ? 0.5 : clamp01(raw.volume),
      readingVolume: raw?.readingVolume == null ? 1 : clamp01(raw.readingVolume),
    };
  } catch {
    return { volume: 0.5, readingVolume: 1 };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 存储延后一点再写，拖动音量条时不会每一格都写一次本地存储 */
function save(): void {
  if (typeof window === "undefined") return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 250);
}

function saveNow(): void {
  try {
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ volume: state.volume, readingVolume: state.readingVolume }),
    );
  } catch {
    /* 存不下就只在本次生效 */
  }
}

let state: AmbientState = { kind: null, status: "idle", volume: 0.5, readingVolume: 1, ducked: false, error: null };
let loaded = false;
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
/** 正在拖动音量条时的临时音量；松手提交后清空 */
let previewVolume: number | null = null;
/** 每次开始播放递增；旧的异步启动发现编号变了就放弃，避免连点叠出多路 */
let token = 0;

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  state = { ...state, ...loadSaved() };
}

function emit(next: Partial<AmbientState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function getAmbientState(): AmbientState {
  ensureLoaded();
  return state;
}

export function subscribeAmbient(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function targetGain(): number {
  return (previewVolume ?? state.volume) * GAIN_SCALE * (state.ducked ? DUCK_RATIO : 1);
}

function applyGain(timeConstant = RAMP): void {
  if (!gain || !ctx) return;
  try {
    const value = targetGain();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(value, ctx.currentTime, timeConstant);
  } catch {
    try {
      if (gain) gain.gain.value = targetGain();
    } catch {
      /* 忽略 */
    }
  }
}

function teardown(): void {
  try {
    source?.stop();
  } catch {
    /* 忽略 */
  }
  try {
    source?.disconnect();
    gain?.disconnect();
  } catch {
    /* 忽略 */
  }
  source = null;
  gain = null;
  const old = ctx;
  ctx = null;
  if (old) void old.close().catch(() => undefined);
}

/**
 * 开始播放一种白噪音（必须由用户点击触发，浏览器才允许出声）。
 * 已经在播同一种就什么也不做；在播别的就先停掉再换。
 */
export async function playNoise(kind: NoiseKind): Promise<void> {
  ensureLoaded();
  if (typeof window === "undefined") return;
  if (state.kind === kind && (state.status === "playing" || state.status === "loading")) return;
  if (state.kind === kind && state.status === "paused") {
    await resumeAmbient();
    return;
  }
  teardown();
  const mine = ++token;
  emit({ kind, status: "loading", error: null });
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    emit({ status: "error", error: "这个浏览器不支持生成背景声音。" });
    return;
  }
  try {
    const audio = new Ctor();
    ctx = audio;
    if (audio.state === "suspended") {
      await Promise.race([audio.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 800))]);
    }
    if (mine !== token) return;
    if (audio.state !== "running") {
      teardown();
      emit({ status: "error", error: "浏览器没有允许播放声音，请再点一次播放。" });
      return;
    }
    const node = audio.createBufferSource();
    node.buffer = createNoiseBuffer(audio, kind);
    node.loop = true;
    const level = audio.createGain();
    level.gain.value = targetGain();
    node.connect(level).connect(audio.destination);
    node.start();
    source = node;
    gain = level;
    // 系统打断（来电、切到别的应用）时如实显示为已暂停
    audio.onstatechange = () => {
      if (ctx !== audio) return;
      if (audio.state === "running" && state.status === "paused") emit({ status: "playing" });
      else if (audio.state !== "running" && state.status === "playing") emit({ status: "paused" });
    };
    emit({ status: "playing", error: null });
  } catch {
    if (mine !== token) return;
    teardown();
    emit({ status: "error", error: "背景声音没能播放，请再试一次。" });
  }
}

export async function pauseAmbient(): Promise<void> {
  if (!ctx || state.status !== "playing") return;
  try {
    await ctx.suspend();
    emit({ status: "paused" });
  } catch {
    emit({ status: "error", error: "暂停失败，可以直接点「停止」。" });
  }
}

export async function resumeAmbient(): Promise<void> {
  if (!ctx || state.status !== "paused") return;
  try {
    await ctx.resume();
    if (ctx.state === "running") emit({ status: "playing", error: null });
    else emit({ status: "error", error: "浏览器没有允许继续播放，请再点一次。" });
  } catch {
    emit({ status: "error", error: "继续播放失败，请再点一次。" });
  }
}

export function stopAmbient(): void {
  token += 1;
  teardown();
  emit({ kind: null, status: "idle", error: null });
}

/**
 * 拖动音量条过程中调用：只改正在播放的声音，不通知界面、不写存储，
 * 所以拖动时阅读页不会整页重绘，也不会叠出第二路声音。松手后再调 setAmbientVolume 提交。
 */
export function previewAmbientVolume(volume: number): void {
  ensureLoaded();
  previewVolume = clamp01(volume);
  applyGain(DRAG_RAMP);
}

/** 改背景音量：保存用户设定值；如果正在因朗读降低，会按降低后的比例生效。 */
export function setAmbientVolume(volume: number): void {
  ensureLoaded();
  previewVolume = null;
  const next = clamp01(volume);
  if (next !== state.volume) emit({ volume: next });
  applyGain(DRAG_RAMP);
  save();
}

export function setReadingVolume(volume: number): void {
  ensureLoaded();
  const next = clamp01(volume);
  if (next !== state.readingVolume) emit({ readingVolume: next });
  save();
}

export function getReadingVolume(): number {
  ensureLoaded();
  return state.readingVolume;
}

/**
 * 朗读开始时 duck(true)，停下 / 暂停 / 失败时 duck(false)。
 * 只记一个开关，不累乘：连续调用多少次都只降到同一个值，恢复时回到用户设定的音量。
 */
export function duckAmbient(ducked: boolean): void {
  if (state.ducked === ducked) return;
  emit({ ducked });
  applyGain();
  getReaderMusicController().duck(ducked);
}
