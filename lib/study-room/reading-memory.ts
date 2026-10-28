// lib/study-room/reading-memory.ts — 阶段阅读记忆：按「书 × 角色」记录读到哪、总结了什么。
//
// 三条底线：
//  1. 只把用户已读到的内容送给 AI（用 buildReadRange 截断），不剧透；
//  2. 不是每次翻页都调用 API：按「章节数」或「阅读程度」触发，也可以只有手动；
//  3. 总结写进宿主已有的记忆库（sourceApp=reading），角色聊天时按原有记忆检索就能用上，
//     不新造一套独立记忆系统。

import { simpleLLMCall } from "@/lib/api-helpers";
import { loadCharacters } from "@/lib/character-storage";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { deleteMemoryEntry, saveMemoryEntry } from "@/lib/memory-storage";
import type { MemoryEntry } from "@/lib/memory-types";
import type { Book, BookChapter } from "@/lib/reading-types";
import { resolveAuxiliaryApiConfig } from "@/lib/settings-storage";
import { bookVersionOf } from "./annotations";
import { buildReadRange } from "./read-range";

const SUMMARIES_KEY = "ai_phone_studyroom_stage_summaries_v1";
const CONFIG_KEY = "ai_phone_studyroom_stage_config_v1";
registerKvMigration(SUMMARIES_KEY);
registerKvMigration(CONFIG_KEY);

export type StageTriggerMode = "chapters" | "progress" | "manual";

export type StageConfig = {
  /** 触发方式：按章节数、按阅读程度，或只在手动点击时生成 */
  mode: StageTriggerMode;
  /** mode="chapters"：每读多少章生成一次 */
  chapterStep: number;
  /** mode="progress"：阅读程度每前进多少个百分点生成一次 */
  progressStep: number;
  /** 参与记录的角色；为空表示当前所有角色 */
  characterIds: string[];
};

export const DEFAULT_STAGE_CONFIG: StageConfig = {
  mode: "chapters",
  chapterStep: 30,
  progressStep: 25,
  characterIds: [],
};

export type StageSummary = {
  id: string;
  bookId: string;
  bookTitle: string;
  /** 记录时这本书的版本标识（换文件/重导入后会不同） */
  bookVersion: string;
  characterId: string;
  characterName: string;
  /** 覆盖的章节区间（从 0 开始） */
  fromChapter: number;
  toChapter: number;
  /** 精简总结：给聊天用的短记录 */
  summary: string;
  /** 详细记录：回顾用的长记录 */
  detail?: string;
  createdAt: string;
  /** 宿主记忆库里的对应条目 id（删除时一并清掉） */
  memoryId?: string;
};

export function loadStageConfig(): StageConfig {
  try {
    const raw = kvGet(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_STAGE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<StageConfig>;
    return {
      mode: parsed.mode === "progress" || parsed.mode === "manual" ? parsed.mode : "chapters",
      chapterStep: clampInt(parsed.chapterStep, 1, 500, DEFAULT_STAGE_CONFIG.chapterStep),
      progressStep: clampInt(parsed.progressStep, 5, 100, DEFAULT_STAGE_CONFIG.progressStep),
      characterIds: Array.isArray(parsed.characterIds) ? parsed.characterIds.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { ...DEFAULT_STAGE_CONFIG };
  }
}

export function saveStageConfig(config: StageConfig): void {
  kvSet(CONFIG_KEY, JSON.stringify(config));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.round(num), min), max);
}

export function loadStageSummaries(): StageSummary[] {
  try {
    const raw = kvGet(SUMMARIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StageSummary => Boolean(item) && typeof item === "object" && typeof (item as StageSummary).id === "string");
  } catch {
    return [];
  }
}

function saveStageSummaries(list: StageSummary[]): void {
  kvSet(SUMMARIES_KEY, JSON.stringify(list));
}

/** 这本书 + 这个角色已经总结到的章节（没有则 -1）。 */
export function lastSummarizedChapter(summaries: StageSummary[], bookId: string, characterId: string): number {
  return summaries
    .filter((item) => item.bookId === bookId && item.characterId === characterId)
    .reduce((max, item) => Math.max(max, item.toChapter), -1);
}

/** 是否该生成新的阶段总结：按章节数或阅读程度判断，重复调用不会重复生成。 */
export function shouldSummarize(params: {
  config: StageConfig;
  bookId: string;
  characterId: string;
  currentChapter: number;
  totalChapters: number;
  summaries: StageSummary[];
}): boolean {
  const { config, bookId, characterId, currentChapter, totalChapters, summaries } = params;
  if (config.mode === "manual") return false;
  const last = lastSummarizedChapter(summaries, bookId, characterId);
  if (currentChapter <= last) return false;
  if (config.mode === "progress") {
    if (totalChapters <= 0) return false;
    const step = Math.max(totalChapters * (config.progressStep / 100), 1);
    return currentChapter - last >= step;
  }
  return currentChapter - last >= config.chapterStep;
}

/** 参与记录的角色：配置里选了的，或当前所有角色。 */
export function stageCharacters(config: StageConfig): Array<{ id: string; name: string }> {
  const all = loadCharacters().map((c) => ({ id: c.id, name: c.name }));
  if (config.characterIds.length === 0) return all;
  const allowed = new Set(config.characterIds);
  return all.filter((c) => allowed.has(c.id));
}

/** 单次总结的发送量上限：每章与总量都封顶，避免一次把整本书发出去 */
const MAX_CHARS_PER_CHAPTER = 4000;
const MAX_CHARS_TOTAL = 24000;

/** 一次最多回溯多少章（用户一次跳很远时也不会把几十章一起发出去） */
export const MAX_STAGE_CHAPTERS = 20;

const DEFAULT_STAGE_PROMPT = `你是{{char}}，正和读者一起读《{{book}}》。下面是读者已经读到的第 {{from}}–{{to}} 章正文（只有读者已经读到的部分，之后的情节你并不知道）。

请严格按下面两段格式回答，不要添加别的段落：
【精简】120 字以内，用第三人称说清已经发生的剧情与人物关系变化，供之后的聊天参考。
【详细】400 字以内，记下关键事件、人物、线索与伏笔。

要求：只依据上面给出的正文，不要猜测或编造后面的情节；这是书里的故事，不要当成用户现实里发生的事。`;

function parseStageOutput(text: string): { summary: string; detail?: string } {
  const summaryMatch = /【精简】([\s\S]*?)(?=【详细】|$)/.exec(text);
  const detailMatch = /【详细】([\s\S]*)$/.exec(text);
  const summary = summaryMatch?.[1]?.trim() ?? "";
  const detail = detailMatch?.[1]?.trim();
  if (summary) return { summary, detail: detail || undefined };
  // 模型没按格式回答时，整段当作精简总结，不丢内容
  return { summary: text.trim() };
}

export type StageGenerationInput = {
  book: Book;
  chapters: BookChapter[];
  /** 本次总结覆盖的章节区间（含端点） */
  fromChapter: number;
  toChapter: number;
  /** 每章只送到「已读段落」为止 */
  readParagraphOf: (chapterIndex: number) => number;
  characterId: string;
  prompt?: string;
};

/** 生成一个阶段总结（只发已读范围，不整本发送）。 */
export async function generateStageSummary(
  input: StageGenerationInput,
): Promise<{ summary: string; detail?: string }> {
  const character = loadCharacters().find((c) => c.id === input.characterId);
  if (!character) throw new Error("角色不存在");
  const apiConfig = resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
  if (!apiConfig) throw new Error("未配置总结用 API（设置 → 绑定配置 → 辅助 API）");

  const from = Math.max(0, Math.min(input.fromChapter, input.toChapter));
  const to = Math.min(input.toChapter, input.chapters.length - 1);
  if (to < from) throw new Error("还没有可总结的章节");

  // 控制单次发送量：每章截断、总量封顶，优先保留最近读的部分
  const pieces: string[] = [];
  let budget = MAX_CHARS_TOTAL;
  for (let index = to; index >= from && budget > 0; index -= 1) {
    const chapter = input.chapters[index];
    if (!chapter) continue;
    const read = input.readParagraphOf(chapter.index);
    const text = buildReadRange(chapter.paragraphs, read).slice(0, MAX_CHARS_PER_CHAPTER);
    const piece = `第 ${chapter.index + 1} 章 ${chapter.title}\n${text}`;
    pieces.unshift(piece);
    budget -= piece.length;
  }
  if (pieces.length === 0) throw new Error("还没有可总结的章节");
  const body = pieces.join("\n\n");

  const prompt = (input.prompt?.trim() || DEFAULT_STAGE_PROMPT)
    .replace(/\{\{char(?:Name)?\}\}/g, character.name)
    .replace(/\{\{book(?:Title)?\}\}/g, input.book.title)
    .replace(/\{\{from\}\}/g, String(from + 1))
    .replace(/\{\{to\}\}/g, String(to + 1));

  const result = await simpleLLMCall(
    apiConfig,
    [{ role: "user", content: `${prompt}\n\n——— 已读正文 ———\n${body}` }],
    { temperature: 0.3, max_tokens: 800 },
  );
  if (result.error || !result.content) throw new Error(result.error || "总结生成失败");
  return parseStageOutput(result.content);
}

/** 保存阶段总结：同书同角色同区间只留一条，同时写进宿主记忆库。 */
export async function saveStageSummary(params: {
  book: Book;
  characterId: string;
  characterName: string;
  fromChapter: number;
  toChapter: number;
  summary: string;
  detail?: string;
}): Promise<StageSummary> {
  const list = loadStageSummaries();
  const existing = list.find(
    (item) =>
      item.bookId === params.book.id &&
      item.characterId === params.characterId &&
      item.fromChapter === params.fromChapter &&
      item.toChapter === params.toChapter,
  );

  const content = `《${params.book.title}》第 ${params.fromChapter + 1}–${params.toChapter + 1} 章的阅读记录：${params.summary}`;
  const memory: MemoryEntry = {
    id: `mem_reading_${params.book.id}_${params.characterId}_${params.fromChapter}_${params.toChapter}`,
    characterId: params.characterId,
    sourceApp: "reading",
    type: "long_term",
    content,
    importance: 0.7,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      bookId: params.book.id,
      bookTitle: params.book.title,
      bookVersion: bookVersionOf(params.book),
      fromChapter: params.fromChapter,
      toChapter: params.toChapter,
      detail: params.detail ?? null,
    },
  };
  // 同 id 覆盖，避免同一阶段在记忆库里堆重复条目
  if (existing?.memoryId) await deleteMemoryEntry(existing.memoryId).catch(() => undefined);
  await saveMemoryEntry(memory).catch(() => undefined);

  const next: StageSummary = {
    id: existing?.id ?? `stage_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    bookId: params.book.id,
    bookTitle: params.book.title,
    bookVersion: bookVersionOf(params.book),
    characterId: params.characterId,
    characterName: params.characterName,
    fromChapter: params.fromChapter,
    toChapter: params.toChapter,
    summary: params.summary,
    detail: params.detail,
    createdAt: new Date().toISOString(),
    memoryId: memory.id,
  };
  const updated = existing ? list.map((item) => (item.id === existing.id ? next : item)) : [...list, next];
  saveStageSummaries(updated);
  return next;
}

/** 删除一条阶段总结，连同记忆库里的对应条目。 */
export async function removeStageSummary(id: string): Promise<void> {
  const list = loadStageSummaries();
  const target = list.find((item) => item.id === id);
  if (target?.memoryId) await deleteMemoryEntry(target.memoryId).catch(() => undefined);
  saveStageSummaries(list.filter((item) => item.id !== id));
}

export function summariesForBook(list: StageSummary[], bookId: string): StageSummary[] {
  return list
    .filter((item) => item.bookId === bookId)
    .sort((a, b) => b.toChapter - a.toChapter);
}
