// lib/study-room/creative.ts — 书桌里的手写与 AI 创作。
//
// 写作可以完全手打，也可以让 AI 写：用宿主已配置的 API（写作模型或已有角色卡），
// 不在这里写任何密钥。生成支持取消、失败重试，草稿始终留在本地，
// 只有用户明确「加入书架」才会变成一本书。

import { simpleLLMCall } from "@/lib/api-helpers";
import { loadCharacters } from "@/lib/character-storage";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { addBook, loadBooks, saveChapters } from "@/lib/reading-storage";
import type { Book, BookChapter } from "@/lib/reading-types";
import type { ApiConfig } from "@/lib/settings-types";
import { formatCharacterRelationsForPrompt } from "@/lib/character-world-storage";
import { loadApiConfigs, loadBindingConfig, loadWorldBooks, resolveBinding } from "@/lib/settings-storage";
import { STUDYROOM_WRITING_SCOPE, composeWritingWorldbook } from "@/lib/study-room/writing-worldbook";

const DRAFTS_KEY = "ai_phone_studyroom_creative_drafts_v1";
registerKvMigration(DRAFTS_KEY);

export type CreativeChapter = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 章末结构化记忆：下一章只加载需要的那部分，防长篇失忆 */
  memory?: ChapterMemory;
  /** 连贯检查结果：对照大纲与前几章记忆挑出的问题（只给建议，不改稿） */
  review?: ChapterReview;
};

export type ChapterReview = {
  /** 一行一条「问题 → 建议」；没问题时为空数组 */
  issues: string[];
  createdAt: string;
};

/** 章末结构化记忆（按 TXT 要求：摘要/人物状态/关系变化/地点时间/伏笔/未解决冲突/必须保持设定） */
export type ChapterMemory = {
  summary: string;
  characters: string;
  relations: string;
  whenWhere: string;
  threads: string;
  openConflicts: string;
  mustKeep: string;
  createdAt: string;
};

/** 作品形态：长篇 / 短篇 / 剧本 / 散文 / 合集 / 自定义 */
export type WorkKind = "novel" | "short" | "script" | "essay" | "collection" | "custom";

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  novel: "长篇小说",
  short: "短篇",
  script: "剧本",
  essay: "散文",
  collection: "合集",
  custom: "自定义",
};

/** 写作身份：写作助手（模型）或用一张已有角色卡来写。 */
export type CreativeWriter = {
  mode: "assistant" | "character";
  /** mode="assistant" 时选定使用的 API 配置；留空表示用宿主默认 */
  apiConfigId?: string;
  /** mode="character" 时使用哪张角色卡 */
  characterId?: string;
  /** 这部作品单独选的世界书；不填 = 跟随角色在「共创」里的绑定 */
  worldBookIds?: string[];
};

export type CreativeDraft = {
  id: string;
  title: string;
  /** 署名：可以是笔名，也可以留空 */
  author?: string;
  /** 书籍简介（发布到书架时用） */
  synopsis?: string;
  tags: string[];
  templateId?: string;
  genre?: string;
  style?: string;
  world?: string;
  /** 人物设定：自由文本，一人一段 */
  cast?: string;
  /** 全书大纲：可自己写，也可以让 AI 先给一版 */
  outline?: string;
  /** 每章目标字数，给 AI 的参考 */
  targetWords?: number;
  /** 计划写几章（只作参考，不强制） */
  plannedChapters?: number;
  serialization: "serial" | "finished";
  cover?: string;
  extra?: string;
  writer: CreativeWriter;
  /** 作品形态（决定模板与写作建议，不强制） */
  kind?: WorkKind;
  /** 写作模式：AI 协作或纯手写（手写时不会自动调用模型） */
  writeMode?: "ai" | "hand";
  /** 选中的文风：内置文风只存 id 与强度，完整规则在服务端 */
  styleId?: string;
  styleStrength?: "light" | "standard" | "dense";
  /** 用户自建文风 id（规则存本机） */
  userStyleId?: string;
  chapters: CreativeChapter[];
  /** 已发布到书架时的书籍 id */
  publishedBookId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreativeTemplate = {
  id: string;
  name: string;
  desc: string;
  /** 这个模板对应的作品形态 */
  kind: WorkKind;
  fields: Partial<Pick<CreativeDraft, "genre" | "style" | "world" | "cast" | "targetWords" | "tags" | "serialization" | "kind">>;
};

/** 参考模板：只是把常见的写法填进设定里，任何字段都可以改，也可以全不填。 */
export const CREATIVE_TEMPLATES: CreativeTemplate[] = [
  { id: "blank", name: "空白开始", desc: "什么模板都不用，想到哪写到哪", kind: "custom", fields: { kind: "custom" } },
  {
    id: "longform",
    name: "长篇小说",
    desc: "多章推进，人物与伏笔可以慢慢铺",
    kind: "novel",
    fields: { kind: "novel", targetWords: 2500, serialization: "serial" },
  },
  {
    id: "shortstory",
    name: "短篇",
    desc: "一次写完，收在一个点上",
    kind: "short",
    fields: { kind: "short", targetWords: 3000, serialization: "finished" },
  },
  {
    id: "script",
    name: "剧本",
    desc: "以场次与对白推进",
    kind: "script",
    fields: { kind: "script", style: "以对白与动作提示为主，少旁白", targetWords: 2200, serialization: "serial" },
  },
  {
    id: "essay",
    name: "散文",
    desc: "以观察与思绪为主，不追求情节",
    kind: "essay",
    fields: { kind: "essay", style: "第一人称，细节具体，克制抒情", targetWords: 1500, serialization: "finished" },
  },
  {
    id: "collection",
    name: "合集",
    desc: "若干独立篇目放在一起",
    kind: "collection",
    fields: { kind: "collection", targetWords: 2000, serialization: "serial" },
  },
  {
    id: "urban",
    kind: "novel",
    name: "都市日常",
    desc: "现代都市、生活流、节奏舒缓",
    fields: {
      genre: "都市日常",
      style: "口语化、细节多、少抒情",
      targetWords: 2000,
      tags: ["都市", "日常"],
      serialization: "serial",
    },
  },
  {
    id: "mystery",
    kind: "novel",
    name: "悬疑推理",
    desc: "案件推进、线索与反转",
    fields: {
      genre: "悬疑推理",
      style: "克制的第三人称，短句，多用环境与动作推动",
      targetWords: 2500,
      tags: ["悬疑", "推理"],
      serialization: "serial",
    },
  },
  {
    id: "fantasy",
    kind: "novel",
    name: "奇幻冒险",
    desc: "架空世界观、旅途与成长",
    fields: {
      genre: "奇幻冒险",
      style: "画面感强，设定通过情节自然带出",
      targetWords: 2500,
      tags: ["奇幻", "冒险"],
      serialization: "serial",
    },
  },
  {
    id: "romance",
    kind: "novel",
    name: "言情",
    desc: "人物关系与情绪推进",
    fields: {
      genre: "言情",
      style: "细腻的心理描写，对话占比高",
      targetWords: 2000,
      tags: ["言情"],
      serialization: "serial",
    },
  },
  {
    id: "scifi",
    kind: "novel",
    name: "科幻",
    desc: "近未来设定、技术与人的关系",
    fields: {
      genre: "科幻",
      style: "冷静的叙述节奏，概念在情节中展开",
      targetWords: 2500,
      tags: ["科幻"],
      serialization: "serial",
    },
  },
];

export function loadDrafts(): CreativeDraft[] {
  try {
    const raw = kvGet(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CreativeDraft => Boolean(item) && typeof item === "object" && typeof (item as CreativeDraft).id === "string");
  } catch {
    return [];
  }
}

export function saveDrafts(list: CreativeDraft[]): void {
  kvSet(DRAFTS_KEY, JSON.stringify(list));
}

export function upsertDraft(list: CreativeDraft[], draft: CreativeDraft): CreativeDraft[] {
  const next = list.some((item) => item.id === draft.id)
    ? list.map((item) => (item.id === draft.id ? draft : item))
    : [...list, draft];
  saveDrafts(next);
  return next;
}

export function removeDraft(list: CreativeDraft[], id: string): CreativeDraft[] {
  const next = list.filter((item) => item.id !== id);
  saveDrafts(next);
  return next;
}

export function createDraft(templateId = "blank"): CreativeDraft {
  const template = CREATIVE_TEMPLATES.find((item) => item.id === templateId) ?? CREATIVE_TEMPLATES[0];
  const now = new Date().toISOString();
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    tags: template.fields.tags ? [...template.fields.tags] : [],
    templateId: template.id,
    kind: template.kind,
    writeMode: "ai",
    genre: template.fields.genre,
    style: template.fields.style,
    world: template.fields.world,
    cast: template.fields.cast,
    targetWords: template.fields.targetWords ?? 2000,
    serialization: template.fields.serialization ?? "serial",
    writer: { mode: "assistant" },
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function wordCount(text: string): number {
  // 中文按字数、英文按词数粗算，够用来提示进度
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]+/g) ?? []).length;
  return cjk + latin;
}

export function draftWordCount(draft: CreativeDraft): number {
  return draft.chapters.reduce((total, chapter) => total + wordCount(chapter.content), 0);
}

/** 使用哪份 API 配置：写作助手模式优先用指定配置，否则用默认；角色模式用角色自己的绑定。 */
export function resolveWriterConfig(draft: CreativeDraft): { apiConfigId: string | null; writerLabel: string } {
  if (draft.writer.mode === "character" && draft.writer.characterId) {
    const character = loadCharacters().find((c) => c.id === draft.writer.characterId);
    const binding = resolveBinding(loadBindingConfig(), draft.writer.characterId, "cocreate");
    return { apiConfigId: binding.apiConfigId ?? null, writerLabel: character?.name ?? "角色" };
  }
  const configs = loadApiConfigs();
  const chosen = draft.writer.apiConfigId
    ? configs.find((c) => c.id === draft.writer.apiConfigId)
    : undefined;
  return { apiConfigId: chosen?.id ?? null, writerLabel: "写作助手" };
}

function identityInstruction(draft: CreativeDraft, secondPerson: string): string {
  if (draft.writer.mode === "character" && draft.writer.characterId) {
    const character = loadCharacters().find((c) => c.id === draft.writer.characterId);
    const name = character?.name ?? "角色";
    return `你是${name}，现在以「作者」的身份写作。注意区分：书里的角色是虚构人物，不等同于你自己，也不等同于用户的现实身份；不要把设定或情节说成用户现实中发生过的事。`;
  }
  return `你是${secondPerson}。写的都是虚构故事，不要把设定或情节说成用户的真实经历。`;
}

function draftBrief(draft: CreativeDraft): string {
  const lines = [
    `书名：${draft.title || "（未定）"}`,
    draft.author ? `署名：${draft.author}` : "",
    draft.genre ? `题材：${draft.genre}` : "",
    draft.style ? `文风：${draft.style}` : "",
    draft.tags.length > 0 ? `标签：${draft.tags.join("、")}` : "",
    draft.world ? `世界观：${draft.world}` : "",
    draft.cast ? `人物：${draft.cast}` : "",
    draft.outline ? `大纲：${draft.outline}` : "",
    draft.serialization === "finished" ? "形态：完结短篇" : "形态：连载",
    draft.targetWords ? `每章目标字数：约 ${draft.targetWords} 字` : "",
    draft.plannedChapters ? `计划篇幅：约 ${draft.plannedChapters} 章` : "",
    draft.extra ? `补充要求：${draft.extra}` : "",
  ].filter(Boolean);
  const hidden = characterContext(draft);
  return hidden ? `${lines.join("\n")}\n\n${hidden}` : lines.join("\n");
}

/** 角色写作时用哪些世界书：作品里单独选过就用作品的，否则跟随角色的共创绑定。 */
export function resolveWriterWorldBooks(draft: CreativeDraft): { ids: string[]; followBinding: boolean } {
  if (draft.writer.worldBookIds) return { ids: draft.writer.worldBookIds, followBinding: false };
  if (draft.writer.mode !== "character" || !draft.writer.characterId) return { ids: [], followBinding: true };
  const binding = resolveBinding(loadBindingConfig(), draft.writer.characterId, "cocreate");
  return { ids: binding.worldBookIds ?? [], followBinding: true };
}

function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 角色写作的隐藏设定：人设、世界书、世界卷宗（角色关系）。
 * 只交给模型把握口吻与设定，界面上不展示；专业写作助手模式不带这些。
 */
function characterContext(draft: CreativeDraft): string {
  const isCharacter = draft.writer.mode === "character" && Boolean(draft.writer.characterId);
  // 写作助手模式：只有作品里单独选过世界书时才带世界书，没有人设与卷宗
  if (!isCharacter && !draft.writer.worldBookIds?.length) return "";
  const character = isCharacter ? loadCharacters().find((c) => c.id === draft.writer.characterId) : undefined;
  const parts: string[] = [];
  const persona = [character?.persona, character?.personality].filter((v): v is string => Boolean(v?.trim())).join("\n");
  if (persona) parts.push(`【作者人设（只用来把握你的口吻与视角，不要写进书里）】\n${clip(persona, 1500)}`);

  const { ids } = resolveWriterWorldBooks(draft);
  if (ids.length > 0) {
    const books = loadWorldBooks().filter((book) => ids.includes(book.id));
    const entries = books
      .flatMap((book) => book.entries.filter((entry) => !entry.disable && entry.content.trim()).map((entry) => `- ${clip(entry.content, 400)}`))
      .join("\n");
    if (entries) parts.push(`【世界书设定（可以作为素材，按需取用）】\n${clip(entries, 4000)}`);
  }

  if (!isCharacter || !draft.writer.characterId) return parts.join("\n\n");
  const relations = formatCharacterRelationsForPrompt(draft.writer.characterId);
  if (relations) parts.push(`【世界卷宗：作者所在世界与角色关系（只作背景参考）】\n${clip(relations, 1200)}`);
  return parts.join("\n\n");
}

/** 最近两章的开头/结尾作为衔接参考，避免把整本都发出去。 */
function recentContext(draft: CreativeDraft): string {
  const recent = draft.chapters.slice(-2);
  if (recent.length === 0) return "（还没有已写的章节，这一章是开头。）";
  return recent
    .map((chapter) => {
      const text = chapter.content;
      const tail = text.slice(-600);
      return `【已写：${chapter.title || "未命名"}】\n……${tail}`;
    })
    .join("\n\n");
}

/** 书房写作规范（只给书房写书用）：用设定与前文匹配关键词，按预算挑条目。 */
function writingNorms(draft: CreativeDraft): string {
  return composeWritingWorldbook(STUDYROOM_WRITING_SCOPE, `${draftBrief(draft)}\n${recentContext(draft)}`).block;
}

export function buildOutlinePrompt(draft: CreativeDraft): string {
  return [
    identityInstruction(draft, "写作助手"),
    writingNorms(draft),
    "",
    "请根据下面的设定，给出这本书的大纲：分 5–8 幕，每幕一到两句写清推进；再列 3–5 个主要人物，写清他们是谁、想要什么。",
    "只输出大纲本身，不要客套话。",
    "",
    draftBrief(draft),
  ].join("\n");
}

/** 本章上下文：设定 + 前文片段 + 章末记忆（不含文风与任务指令，交给服务端组词）。 */
export function buildChapterBrief(draft: CreativeDraft, chapterNumber: number): string {
  return [
    `正在写第 ${chapterNumber} 章。`,
    draft.targetWords ? `每章目标字数约 ${draft.targetWords} 字。` : "",
    "",
    "【设定】",
    draftBrief(draft),
    "",
    "【前文（结尾片段）】",
    recentContext(draft),
    recentMemories(draft) ? "\n【前几章的章末记忆（保持一致）】" : "",
    recentMemories(draft),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChapterPrompt(draft: CreativeDraft, chapterNumber: number): string {
  return [
    identityInstruction(draft, "写作助手"),
    writingNorms(draft),
    "",
    `请写第 ${chapterNumber} 章的正文。`,
    "要求：直接开始写正文，第一行用「第N章 标题」格式给出本章标题，之后是正文；不要写解说、不要总结自己的过程。",
    draft.targetWords ? `篇幅控制在 ${draft.targetWords} 字左右。` : "",
    "保持与前文一致的人称、时态与人物口吻。",
    "",
    "【设定】",
    draftBrief(draft),
    "",
    "【前文（结尾片段）】",
    recentContext(draft),
    recentMemories(draft) ? "\n【前几章的章末记忆（保持一致）】" : "",
    recentMemories(draft),
  ]
    .filter(Boolean)
    .join("\n");
}

export type GenerateResult = { title: string; content: string };

/** 把模型输出拆成「标题 + 正文」。没按格式给标题时，用兜底标题。 */
export function parseChapterOutput(raw: string, chapterNumber: number, fallbackTitle?: string): GenerateResult {
  const text = raw.trim();
  const lines = text.split("\n");
  const first = (lines[0] ?? "").trim().replace(/^#+\s*/, "");
  const looksLikeTitle =
    first.length > 0 && first.length <= 40 && /^(第\s*[0-9一二三四五六七八九十百千]+\s*[章节回]|序章|楔子|尾声|终章)/.test(first);
  if (looksLikeTitle) {
    return { title: first, content: lines.slice(1).join("\n").trim() };
  }
  return { title: fallbackTitle?.trim() || `第 ${chapterNumber} 章`, content: text };
}

/** 实际调用哪份 API：作品/角色指定的优先，否则全局默认，再否则第一份。所有写作相关调用共用。 */
export function resolveWriterApiConfig(draft: CreativeDraft): ApiConfig | null {
  const { apiConfigId } = resolveWriterConfig(draft);
  const configs = loadApiConfigs();
  return (
    (apiConfigId ? configs.find((c) => c.id === apiConfigId) : undefined) ??
    configs.find((c) => c.id === loadBindingConfig().globalDefaults.apiConfigId) ??
    configs[0] ??
    null
  );
}

async function callWriter(
  draft: CreativeDraft,
  prompt: string,
  signal?: AbortSignal,
  maxTokens = 3000,
): Promise<string> {
  const config = resolveWriterApiConfig(draft);
  if (!config) throw new Error("还没有可用的 API：请先在设置里配置模型");
  const result = await simpleLLMCall(config, [{ role: "user", content: prompt }], {
    temperature: 0.85,
    max_tokens: maxTokens,
    signal,
    label: "studyroom-creative",
  });
  if (result.error) throw new Error(result.error);
  if (!result.content) throw new Error("模型没有返回内容");
  return result.content;
}

export async function generateOutline(draft: CreativeDraft, signal?: AbortSignal): Promise<string> {
  return (await callWriter(draft, buildOutlinePrompt(draft), signal, 1200)).trim();
}

export async function generateChapter(
  draft: CreativeDraft,
  chapterNumber: number,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const maxTokens = Math.min(Math.max((draft.targetWords ?? 2000) * 2, 800), 8000);
  const raw = await callWriter(draft, buildChapterPrompt(draft, chapterNumber), signal, maxTokens);
  return parseChapterOutput(raw, chapterNumber);
}

/** 章末记忆提示词：让模型按固定字段回一份结构化记忆（只发这一章，不发全书）。 */
export function buildChapterMemoryPrompt(draft: CreativeDraft, chapter: CreativeChapter): string {
  return [
    "请为下面这一章写一份结构化的写作记忆，供后续章节保持一致。只输出 JSON 对象，字段固定：",
    '{"summary":"本章发生了什么（100 字内）","characters":"人物当前状态","relations":"关系变化","whenWhere":"时间与地点","threads":"本章埋下的伏笔","openConflicts":"尚未解决的冲突","mustKeep":"后续必须保持的设定"}',
    "",
    `书名：${draft.title || "（未定）"}`,
    `章节：${chapter.title}` ,
    "正文：",
    chapter.content.slice(0, 4000),
  ].join("\n");
}

/** 解析模型返回的记忆 JSON；字段缺失就用空串，不编造。 */
export function parseChapterMemory(raw: string): ChapterMemory | null {
  try {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const pick = (key: string) => (typeof parsed[key] === "string" ? (parsed[key] as string).trim().slice(0, 600) : "");
    return {
      summary: pick("summary"),
      characters: pick("characters"),
      relations: pick("relations"),
      whenWhere: pick("whenWhere"),
      threads: pick("threads"),
      openConflicts: pick("openConflicts"),
      mustKeep: pick("mustKeep"),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * 连贯检查（借鉴 AI-Novel-Writing-Assistant 的「大纲 → 章节 → 连贯审查」流程思路，代码为本项目自写）：
 * 只发大纲、这一章之前的章末记忆、上一章结尾与本章正文，让模型挑前后矛盾。
 */
export function buildContinuityReviewPrompt(draft: CreativeDraft, chapterId: string): string {
  const index = draft.chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = draft.chapters[index];
  if (!chapter) return "";
  const before = draft.chapters.slice(0, index);
  const memories = recentMemories({ ...draft, chapters: before }, 4);
  const prev = before[before.length - 1];
  return [
    "你是长篇连载的连贯性审查。对照下面的大纲、前文记忆和上一章结尾，检查「本章」有没有：",
    "人物状态或称呼跳变、时间地点冲突、已定设定被改、伏笔被遗忘、偏离大纲走向。",
    "每行一条，格式：问题 → 建议。只列真实存在的问题，最多 6 条；如果没有问题，只输出「无明显问题」。不要重写正文，不要夸奖。",
    "",
    draft.outline ? `【大纲】\n${clip(draft.outline, 1200)}` : "【大纲】（未写）",
    memories ? `\n【前文记忆】\n${memories}` : "",
    prev ? `\n【上一章结尾：${prev.title}】\n……${prev.content.slice(-500)}` : "",
    `\n【本章：${chapter.title}】`,
    chapter.content.slice(0, 5000),
  ]
    .filter(Boolean)
    .join("\n");
}

/** 解析连贯检查结果；「无明显问题」记为空数组。 */
export function parseContinuityReview(raw: string): ChapterReview {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
    .filter(Boolean);
  const clean = lines.length === 1 && /无明显问题|没有明显问题|未发现/.test(lines[0]) ? [] : lines.slice(0, 6);
  return { issues: clean, createdAt: new Date().toISOString() };
}

/** 恢复进度：根据作品现状算出「下一步」，书桌与作品总览共用。 */
export type DraftNextStep = {
  label: string;
  /** 进作品后应该先打开哪一栏 */
  section: "outline" | "write";
};

export function draftNextStep(draft: CreativeDraft): DraftNextStep {
  const ai = draft.writeMode !== "hand";
  const chapters = draft.chapters;
  if (chapters.length === 0) {
    if (ai && !draft.outline?.trim()) return { label: "先定大纲", section: "outline" };
    return { label: "写第 1 章", section: "write" };
  }
  const lastIndex = chapters.length - 1;
  const last = chapters[lastIndex];
  if (!last.content.trim()) return { label: `把第 ${lastIndex + 1} 章写完`, section: "write" };
  if (ai && !last.memory) return { label: `给第 ${lastIndex + 1} 章补记忆`, section: "write" };
  if (ai && chapters.length > 1 && !last.review) return { label: `连贯检查第 ${lastIndex + 1} 章`, section: "write" };
  if (draft.plannedChapters && chapters.length >= draft.plannedChapters) {
    return { label: "已到计划章数，可以校对或发布", section: "write" };
  }
  return { label: `写第 ${chapters.length + 1} 章`, section: "write" };
}

/** 今日写作：只统计真实数据（今天有编辑的项目、字数与完成的章节数）。 */
export function todayWritingStats(drafts: CreativeDraft[]): {
  words: number;
  projects: number;
  chapters: number;
  hasData: boolean;
} {
  const today = new Date().toISOString().slice(0, 10);
  let words = 0;
  let chapters = 0;
  let projects = 0;
  for (const draft of drafts) {
    const editedToday = draft.chapters.filter((chapter) => chapter.updatedAt.slice(0, 10) === today);
    if (draft.updatedAt.slice(0, 10) === today) projects += 1;
    for (const chapter of editedToday) {
      words += wordCount(chapter.content);
      if (chapter.content.trim()) chapters += 1;
    }
  }
  return { words, projects, chapters, hasData: words > 0 || projects > 0 };
}

/** 生成下一章时要带的记忆：最近几章的章末记忆 + 大纲，只带需要的部分。 */
export function recentMemories(draft: CreativeDraft, count = 3): string {
  const withMemory = draft.chapters.filter((chapter) => chapter.memory);
  if (withMemory.length === 0) return "";
  return withMemory
    .slice(-count)
    .map((chapter) => {
      const memory = chapter.memory!;
      return [
        `【${chapter.title}】`,
        memory.summary && `情节：${memory.summary}`,
        memory.characters && `人物：${memory.characters}`,
        memory.relations && `关系：${memory.relations}`,
        memory.whenWhere && `时间地点：${memory.whenWhere}`,
        memory.openConflicts && `未解决：${memory.openConflicts}`,
        memory.mustKeep && `必须保持：${memory.mustKeep}`,
      ]
        .filter(Boolean)
        .join("；");
    })
    .join("\n");
}

export function makeChapter(title: string, content: string): CreativeChapter {
  const now = new Date().toISOString();
  return {
    id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };
}

/** 正文 → 段落数组：按空行切，没空行就按单行切。 */
export function toParagraphs(content: string): string[] {
  const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  return content.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * 把草稿发布到书架：生成书目与章节，之后就能像别的书一样阅读、批注、共读。
 * 同 id 重复发布时按最新内容覆盖，不会在书架上留下两本一样的书。
 */
export async function publishDraft(draft: CreativeDraft): Promise<Book> {
  const chapters = draft.chapters.filter((chapter) => chapter.content.trim());
  if (chapters.length === 0) throw new Error("还没有正文，写点内容再发布");
  const bookId = draft.publishedBookId ?? `book_creative_${draft.id}`;
  // 再次发布是覆盖同一本：保留原来的加入时间与用户自己换过的封面，书架位置不跳
  const existing = loadBooks().find((item) => item.id === bookId);
  const book: Book = {
    id: bookId,
    title: draft.title.trim() || "未命名作品",
    author: draft.author?.trim() || "佚名",
    format: "txt",
    totalChapters: chapters.length,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    cover: existing?.originalCover !== undefined ? existing.cover : draft.cover,
    originalCover: existing?.originalCover,
    description: draft.synopsis?.trim() || undefined,
    tags: draft.tags,
    sourceLabel: "书房创作",
    draftId: draft.id,
  };
  await addBook(book);
  const bookChapters: BookChapter[] = chapters.map((chapter, index) => ({
    id: `${bookId}_${index}`,
    bookId,
    index,
    title: chapter.title || `第 ${index + 1} 章`,
    paragraphs: toParagraphs(chapter.content),
  }));
  await saveChapters(bookId, bookChapters);
  return book;
}
