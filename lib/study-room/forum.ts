// lib/study-room/forum.ts — 书友圈（开放读书论坛）与内置 NPC 人设。
//
// 两件事：
//  1. NPC 人设先生成、再持久化，然后才按人设生成论坛内容（顺序不能反）；
//  2. 论坛内容按需生成：一次请求只为一个话题产出几条发言，可停止、带冷却、结果全部缓存，
//     不会每次打开页面就让所有 NPC 去请求 API。
//
// 论坛是开放的：不受用户阅读进度限制，可以聊书架以外的书，也允许剧透；
// 只做不辱骂、不破坏的基本管理，并提供「不感兴趣」与「屏蔽」。

import { isNativeAnthropicApi, isNativeGoogleApi, simpleLLMCall } from "@/lib/api-helpers";
import type { ApiConfig } from "@/lib/settings-types";
import { createCharacter, loadCharacters, saveCharacters } from "@/lib/character-storage";
import { addChatContact, createOrGetSession, loadChatContacts } from "@/lib/chat-storage";
import { saveMemoryEntry } from "@/lib/memory-storage";
import type { MemoryEntry } from "@/lib/memory-types";
import { avatarDataUrl } from "./npc-avatar";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { loadApiConfigs, loadBindingConfig, loadWorldBooks, resolveBinding } from "@/lib/settings-storage";
import { avatarFromKey, type NpcAvatar } from "./npc-avatar";
import {
  adaptMessagesForProvider,
  buildForumPostMessages,
  completeJsonObjects,
  FORUM_FEED_TIMEOUT_MS,
  forumDeadline,
  forumFeedMaxTokens,
  forumRequestMeta,
  forumRuleFields,
  logForumRequest,
  type ForumProviderKind,
  type ForumRequestMessage,
} from "./forum-prompt";

const FORUM_KEY = "ai_phone_studyroom_forum_v1";
registerKvMigration(FORUM_KEY);

export type NpcSource = "generated" | "manual" | "character";

export type ForumNpc = {
  id: string;
  nickname: string;
  avatar: NpcAvatar;
  /** 复用角色卡时直接用角色原本的头像；没有就用 avatar 里生成的图形 */
  avatarUrl?: string;
  /** 职业 / 领域：不限文学，什么领域都可以 */
  occupation: string;
  background: string;
  personality: string;
  interests: string[];
  readingTaste: string;
  speechStyle: string;
  /** 与其他书友/用户的关系 */
  relations: string;
  /** 年龄感：只写「二十几岁」这类模糊描述，不写具体生日 */
  age?: string;
  /** 地区：笼统的地域描述，不写具体住址 */
  region?: string;
  /** 公开书架上的几本书（人设的一部分，不是真实用户数据） */
  shelfTitles?: string[];
  /** 关注了哪些书友（npc id） */
  following?: string[];
  /** 被哪些书友关注（npc id 或 "user"） */
  followers?: string[];
  source: NpcSource;
  /** source="character" 时指向宿主角色卡，复用同一个身份 */
  characterId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ForumAuthorKind = "npc" | "user";

export type ForumComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorKind: ForumAuthorKind;
  body: string;
  /** 回复某条评论时带上 */
  replyToId?: string;
  /** 含剧透：默认遮住，逐条点开 */
  spoiler?: boolean;
  createdAt: string;
};

export type ForumPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorKind: ForumAuthorKind;
  kind: "post" | "review" | "recommend" | "creation";
  title?: string;
  body: string;
  /** 关联的书：可以不在用户书架上 */
  bookTitle?: string;
  bookId?: string;
  spoiler: boolean;
  /** 帖子里带的图片（data URL，本地压缩后保存） */
  images?: string[];
  /** 话题与标签 */
  topics?: string[];
  likedBy: string[];
  /** 收藏过这条帖子的用户/书友 id */
  collectedBy?: string[];
  comments: ForumComment[];
  /** 由 AI 生成的内容会标出来 */
  generated: boolean;
  /** 话题键：同一话题的生成冷却用 */
  topicKey?: string;
  createdAt: string;
};

/** 收到的互动通知 */
export type ForumNotification = {
  id: string;
  kind: "comment" | "reply" | "like" | "mention" | "follow" | "friend";
  fromId: string;
  fromName: string;
  postId?: string;
  text?: string;
  createdAt: string;
  read: boolean;
};

/** 草稿箱里的一条草稿（只是还没发布的内容，不是帖子） */
export type ForumDraft = {
  id: string;
  kind: ForumPost["kind"];
  title?: string;
  body: string;
  bookTitle?: string;
  images?: string[];
  topics?: string[];
  spoiler: boolean;
  updatedAt: string;
};

/** 计划中的书友评论：错时出现，避免发布瞬间刷出一堆 */
export type PendingReply = {
  id: string;
  postId: string;
  npcId: string;
  dueAt: string;
  /** 回复某一条评论（用户点了「请书友回复这条」，或书友被用户回复后接话） */
  replyToId?: string;
};

/** 论坛生成规则：分五组，默认开箱可用，普通用户不需要改。 */
export type ForumRules = {
  /** 首页动态：自动帖子类型 / 数量 / 话题与内容边界 */
  feedTypes: string;
  feedCount: number;
  feedScope: string;
  /** 论坛搜索结果：只返回与查询高度相关的帖子、书友、书籍与话题 */
  searchScope: string;
  /** 评论与回复：长度、语气、关系感、是否继续追问 */
  commentLength: string;
  commentTone: string;
  commentRelation: string;
  commentFollowUp: boolean;
  /** 书友是否自动回复我的帖子与评论；关掉后只在我手动请人回应时才回 */
  autoReply: boolean;
  /** 每次请书友回应时最多几位（1–5） */
  replyCount: number;
  /** NPC 日常活动：发帖、点赞、关注、送礼、加好友的节奏 */
  dailyPosts: number;
  dailyLikes: number;
  dailyFollows: number;
  dailyGifts: number;
  dailyFriends: number;
  /** 热门话题：近期书籍、作者、类型与阅读话题 */
  hotTopics: string;
};

export const DEFAULT_FORUM_RULES: ForumRules = {
  feedTypes: "书评、推荐、讨论都可以；以读完/在读的书为主，也可以聊听说的书",
  feedCount: 3,
  feedScope: "不写辱骂、骚扰与现实中的群体攻击；允许剧透，但含剧透的发言要标出来",
  searchScope: "只返回与查询关键词高度相关的帖子、书友、书籍与话题，不要塞无关内容",
  commentLength: "一到三句话，有话则长、无话则短",
  commentTone: "像真人打字：允许赞同、追问、补充与温和反驳，不要一片夸奖",
  commentRelation: "按与楼主的关系调整亲疏：熟人更随意，陌生人更客气",
  commentFollowUp: true,
  autoReply: true,
  replyCount: 2,
  dailyPosts: 2,
  dailyLikes: 6,
  dailyFollows: 1,
  dailyGifts: 1,
  dailyFriends: 1,
  hotTopics: "近期大家在聊：经典重读、科幻短篇、历史非虚构、漫画改编",
};

export type ForumState = {
  name: string;
  npcs: ForumNpc[];
  posts: ForumPost[];
  /** 屏蔽的书友：他们的内容不再出现在信息流里 */
  mutedNpcIds: string[];
  /** 不感兴趣：被收起的帖子 */
  hiddenPostIds: string[];
  /** 生成冷却记录（话题键 → 时间） */
  generatedAt: Record<string, string>;
  /** 用户关注了哪些书友 */
  following: string[];
  /** 特别关注（星标）：必须先关注；取消关注时一起取消 */
  starred: string[];
  /** 收到的互动通知（评论、回复、点赞、提及、好友申请、关注） */
  notifications: ForumNotification[];
  /** 草稿箱 */
  drafts: ForumDraft[];
  /** 计划中的书友评论（错时出现，刷新后继续） */
  pendingReplies: PendingReply[];
  /** 首次进入是否已经初始化过书友与初始内容 */
  seeded: boolean;
  /** 论坛生成规则（可编辑，默认开箱可用） */
  rules: ForumRules;
};

export const DEFAULT_FORUM: ForumState = {
  name: "书友圈",
  npcs: [],
  posts: [],
  mutedNpcIds: [],
  hiddenPostIds: [],
  generatedAt: {},
  following: [],
  starred: [],
  notifications: [],
  drafts: [],
  pendingReplies: [],
  seeded: false,
  rules: DEFAULT_FORUM_RULES,
};

/** 同一话题多久内不重复生成（用户仍可以手动重来）。 */
export const TOPIC_COOLDOWN_MS = 10 * 60 * 1000;

export function loadForum(): ForumState {
  try {
    const raw = kvGet(FORUM_KEY);
    if (!raw) return { ...DEFAULT_FORUM };
    const parsed = JSON.parse(raw) as Partial<ForumState>;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : DEFAULT_FORUM.name,
      npcs: Array.isArray(parsed.npcs) ? parsed.npcs.filter((npc) => npc && typeof npc.id === "string") : [],
      posts: Array.isArray(parsed.posts) ? parsed.posts.filter((post) => post && typeof post.id === "string") : [],
      mutedNpcIds: Array.isArray(parsed.mutedNpcIds) ? parsed.mutedNpcIds : [],
      hiddenPostIds: Array.isArray(parsed.hiddenPostIds) ? parsed.hiddenPostIds : [],
      generatedAt: parsed.generatedAt && typeof parsed.generatedAt === "object" ? parsed.generatedAt : {},
      following: Array.isArray(parsed.following) ? parsed.following : [],
      starred: Array.isArray(parsed.starred) ? parsed.starred : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      pendingReplies: Array.isArray(parsed.pendingReplies) ? parsed.pendingReplies : [],
      seeded: parsed.seeded === true,
      rules: { ...DEFAULT_FORUM_RULES, ...(parsed.rules && typeof parsed.rules === "object" ? parsed.rules : {}) },
    };
  } catch {
    return { ...DEFAULT_FORUM };
  }
}

export function saveForum(state: ForumState): void {
  kvSet(FORUM_KEY, JSON.stringify(state));
}

export function upsertNpc(state: ForumState, npc: ForumNpc): ForumState {
  const next = state.npcs.some((item) => item.id === npc.id)
    ? state.npcs.map((item) => (item.id === npc.id ? npc : item))
    : [...state.npcs, npc];
  return { ...state, npcs: next };
}

export function removeNpc(state: ForumState, npcId: string): ForumState {
  return {
    ...state,
    npcs: state.npcs.filter((item) => item.id !== npcId),
    // 帖子留着（内容是别人看过的），但作者会被标记为已离开
    mutedNpcIds: state.mutedNpcIds.filter((id) => id !== npcId),
  };
}

// ── NPC 人设：随机 / 按条件生成 ──

const OCCUPATIONS = [
  "中学历史老师", "地铁司机", "独立书店店员", "兽医", "插画师", "后端工程师", "社区医生",
  "面包店老板", "园林设计师", "古籍修复师", "纪录片剪辑师", "中学物理老师", "咖啡馆主理人",
  "夜班护士", "木工", "图书编辑", "观鸟向导", "乐器修理师", "茶艺师", "城市规划师",
  "潜水教练", "面包烘焙师", "手工皮具匠", "气象观测员", "话剧演员", "登山向导", "监狱图书馆管理员",
];

const PERSONALITIES = [
  "话不多但一开口很准", "热情外放，爱拉人一起做事", "谨慎，喜欢先把资料查清楚", "毒舌但心软",
  "慢热，熟了之后话很多", "较真，讨论时会追着定义问", "温和，倾向先理解对方的处境", "幽默，常用自嘲化解尴尬",
  "固执，认定的事很难改", "敏感，注意得到别人忽略的细节",
];

const INTERESTS = [
  "旧地图", "胶片摄影", "城市徒步", "观鸟", "手冲咖啡", "爬山", "做饭", "二手唱片",
  "拼装模型", "天文观测", "园艺", "游泳", "木工", "看话剧", "写手账", "修理旧收音机",
];

const READING_TASTES = [
  "只看非虚构，尤其是历史与博物", "偏爱长篇，喜欢慢慢读人物关系", "喜欢短篇与散文，一次一篇",
  "爱看推理，最在意逻辑是否闭环", "喜欢科幻，尤其是硬设定", "读诗，也读植物志",
  "看纪实与口述史", "爱看老译本，会比对不同版本", "爱看漫画与图像小说", "什么都看，跟着心情走",
];

const SPEECH_STYLES = [
  "短句，少用感叹号", "爱用比喻，句子里常带画面", "说话像列条目，先结论后理由",
  "常引用书里的原话", "喜欢用问句把话题接下去", "语气随意，常带口头语", "书面感强，用词偏正式",
];

/** 公开书架候选：人设里「书友喜欢的书」，不是真实用户数据 */
const SHELF_TITLES: string[][] = [
  ["红楼梦", "呐喊", "人间词话"],
  ["局外人", "审判", "卡夫卡短篇集"],
  ["百年孤独", "霍乱时期的爱情", "没有人给他写信的上校"],
  ["三体", "球状闪电", "银河帝国：基地"],
  ["万历十五年", "叫魂", "中国历代政治得失"],
  ["福尔摩斯探案集", "东方快车谋杀案", "无人生还"],
  ["瓦尔登湖", "沙乡年鉴", "寂静的春天"],
  ["小王子", "夜航", "人的大地"],
  ["海贼王", "灌篮高手", "钢之炼金术师"],
  ["傲慢与偏见", "简·爱", "呼啸山庄"],
];

const AGES = ["二十出头", "二十几岁", "三十上下", "三十多岁", "四十出头", "五十来岁", "快退休的年纪"];
const REGIONS = ["北方小城", "南方沿海", "西南山区", "西北边陲", "中部省会", "沿海大城市", "岛上"];

const RELATIONS = [
  "和几位书友在同一个读书群认识", "常年在论坛潜水，最近才开始发言", "和某位书友常就同一本书争论",
  "刚搬来这座城市，靠论坛认识人", "是论坛早期的常客", "只对少数几个话题感兴趣",
];

function pick<T>(list: T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NICK_PREFIX = ["南", "小", "老", "阿", "林", "苏", "周", "何", "陆", "程", "夏", "沈", "安", "顾", "叶"];
const NICK_SUFFIX = ["桥", "屿", "灯", "野", "川", "庭", "坡", "亭", "禾", "桐", "砚", "午", "青", "白", "让"];

export function makeNpcId(): string {
  return `npc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export type NpcGenerateOptions = {
  /** 方向限定：职业/领域关键词，留空表示不限 */
  domain?: string;
  /** 性格倾向关键词，留空表示不限 */
  personalityHint?: string;
  /** 用固定种子生成（同一 seed 结果一致，便于复现） */
  seed?: number;
};

/** 按条件（或不限条件）生成一个人设：先有设定，再谈发言。 */
export function generateNpc(options: NpcGenerateOptions = {}): ForumNpc {
  const random = typeof options.seed === "number" ? mulberry(options.seed) : Math.random;
  const id = options.seed !== undefined ? `npc_seed_${options.seed}` : makeNpcId();

  const match = (list: string[], hint?: string) => {
    if (!hint?.trim()) return list;
    const filtered = list.filter((item) => item.includes(hint.trim()));
    return filtered.length > 0 ? filtered : list;
  };

  const occupation = pick(match(OCCUPATIONS, options.domain), random);
  const personality = pick(match(PERSONALITIES, options.personalityHint), random);
  const interests = Array.from(new Set([pick(INTERESTS, random), pick(INTERESTS, random)]));
  const now = new Date().toISOString();

  return {
    id,
    nickname: pick(NICK_PREFIX, random) + pick(NICK_SUFFIX, random) + (random() > 0.6 ? String(Math.floor(random() * 90) + 10) : ""),
    avatar: avatarFromKey(id),
    occupation,
    background: `${occupation}，做这行 ${Math.floor(random() * 12) + 3} 年了。${pick(RELATIONS, random)}。`,
    personality,
    interests,
    readingTaste: pick(READING_TASTES, random),
    speechStyle: pick(SPEECH_STYLES, random),
    relations: pick(RELATIONS, random),
    age: pick(AGES, random),
    region: pick(REGIONS, random),
    shelfTitles: SHELF_TITLES[Math.floor(random() * SHELF_TITLES.length)] ?? [],
    following: [],
    followers: [],
    source: "generated",
    createdAt: now,
    updatedAt: now,
  };
}

/** 手工新建一个人设（AI 不可用时也能建）。 */
export function blankNpc(): ForumNpc {
  const id = makeNpcId();
  const now = new Date().toISOString();
  return {
    id,
    nickname: "新书友",
    avatar: avatarFromKey(id),
    occupation: "",
    background: "",
    personality: "",
    interests: [],
    readingTaste: "",
    speechStyle: "",
    relations: "",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

/** 把已有角色卡接进论坛：复用同一个 id 与身份，不复制第二份。 */
export function npcFromCharacter(characterId: string, state: ForumState): ForumNpc | null {
  const character = loadCharacters().find((item) => item.id === characterId);
  if (!character) return null;
  const existing = state.npcs.find((npc) => npc.characterId === characterId);
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    id: `npc_char_${characterId}`,
    nickname: character.name,
    avatar: avatarFromKey(characterId),
    avatarUrl: character.avatar ?? undefined,
    occupation: "角色卡成员",
    background: character.persona?.slice(0, 200) || "来自已有的角色卡。",
    personality: character.personality?.slice(0, 120) || "",
    interests: [],
    readingTaste: "",
    speechStyle: "",
    relations: "来自角色卡，和你在别处也认识。",
    source: "character",
    characterId,
    createdAt: now,
    updatedAt: now,
  };
}

// ── 用已配置的 API 生成人设（可选能力，配置缺失时明确说明）──

export function resolveForumApiConfig() {
  const configs = loadApiConfigs();
  const defaultId = loadBindingConfig().globalDefaults.apiConfigId;
  return configs.find((c) => c.id === defaultId) ?? configs[0] ?? null;
}

/** 校验模型给出的人设：缺字段用兜底值，完全不合法就抛错。 */
export function normalizeAiNpc(raw: unknown, fallbackId: string): ForumNpc {
  if (!raw || typeof raw !== "object") throw new Error("模型没有返回可用的 JSON");
  const value = raw as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  const nickname = text("nickname") || text("name");
  if (!nickname) throw new Error("模型返回的人设缺少昵称");
  const now = new Date().toISOString();
  const interests = Array.isArray(value.interests)
    ? (value.interests as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : text("interests").split(/[、,，\s]+/).filter(Boolean);
  return {
    id: fallbackId,
    nickname: nickname.slice(0, 24),
    avatar: avatarFromKey(fallbackId),
    occupation: text("occupation").slice(0, 40),
    background: text("background").slice(0, 300),
    personality: text("personality").slice(0, 200),
    interests: interests.slice(0, 6),
    readingTaste: text("readingTaste").slice(0, 200),
    speechStyle: text("speechStyle").slice(0, 200),
    relations: text("relations").slice(0, 200),
    source: "generated",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildNpcPrompt(options: NpcGenerateOptions): string {
  return [
    "请创建一个中文读书论坛里的普通书友（NPC）人设。",
    options.domain ? `领域倾向：${options.domain}` : "领域不限，可以是各行各业，不必都是文学作者。",
    options.personalityHint ? `性格倾向：${options.personalityHint}` : "",
    "",
    "只输出 JSON 对象，字段：nickname、occupation、background、personality、interests（字符串数组）、readingTaste、speechStyle、relations。",
    "要求：像真人，有具体生活细节；不要提自己是 AI 或模型；昵称要像网名，不要用「书友A」这类占位。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型返回的内容里没有 JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function generateNpcWithAi(options: NpcGenerateOptions, signal?: AbortSignal): Promise<ForumNpc> {
  const apiConfig = resolveForumApiConfig();
  if (!apiConfig) throw new Error("还没有配置 API：先在设置里绑定模型，或改用「随机生成 / 手动新建」");
  const result = await simpleLLMCall(apiConfig, [{ role: "user", content: buildNpcPrompt(options) }], {
    temperature: 0.95,
    max_tokens: 700,
    signal,
    label: "studyroom-npc",
  });
  if (result.error) throw new Error(result.error);
  if (!result.content) throw new Error("模型没有返回内容");
  return normalizeAiNpc(parseJsonObject(result.content), makeNpcId());
}

// ── 论坛内容：按话题按需生成 ──

export type ForumTopic = {
  key: string;
  label: string;
  bookTitle?: string;
  bookId?: string;
  /** 想聊什么（用户可写一句） */
  prompt?: string;
};

export function topicCooldownRemaining(state: ForumState, topicKey: string): number {
  const at = state.generatedAt[topicKey];
  if (!at) return 0;
  const elapsed = Date.now() - new Date(at).getTime();
  return Math.max(0, TOPIC_COOLDOWN_MS - elapsed);
}

/** 参与者：优先挑阅读偏好/兴趣与话题沾边的人，避免永远只有几个熟面孔。 */
export function pickParticipants(state: ForumState, topic: ForumTopic, count = 3): ForumNpc[] {
  const available = state.npcs.filter((npc) => !state.mutedNpcIds.includes(npc.id));
  if (available.length <= count) return available;
  const keyword = `${topic.label} ${topic.bookTitle ?? ""} ${topic.prompt ?? ""}`;
  const scored = available.map((npc) => {
    const haystack = `${npc.readingTaste} ${npc.interests.join(" ")} ${npc.occupation} ${npc.personality}`;
    let score = Math.random();
    for (const chunk of keyword.split(/\s+/)) {
      if (chunk && haystack.includes(chunk)) score += 2;
    }
    return { npc, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((item) => item.npc);
}

/** 用户本人在书友圈里的 id。评论/回复里用它区分「楼主是用户本人」。 */
export const USER_ID = "user";

/** 当前配置属于哪种协议。判断沿用公共 API 层已有的规则（isNative*Api），不另写一套。 */
export function forumProviderKind(config: ApiConfig): ForumProviderKind {
  if (isNativeAnthropicApi(config)) return "anthropic";
  if (isNativeGoogleApi(config)) return "gemini";
  return "openai-compatible";
}

/** 论坛请求的最后一步：按供应商做显式角色转换（见 adaptMessagesForProvider），一个字都不丢。 */
export function forumMessagesFor(config: ApiConfig, messages: ForumRequestMessage[]): ForumRequestMessage[] {
  return adaptMessagesForProvider(messages, forumProviderKind(config));
}

/**
 * 角色卡书友的隐藏背景：沿用小手机里给这个角色绑定的世界书（书房应用的绑定，没有就继承角色/全局默认），
 * 只取常驻条目，限制长度；不在界面上显示，只作为生成时的背景。
 *
 * 放在 forum.ts 的原因：首页发帖（forum.ts）和评论（forum-social.ts）两条入口都要用它，
 * 而 forum.ts 不能反过来 import forum-social（会成环）。
 */
export function npcHiddenContext(npc: ForumNpc): string {
  if (!npc.characterId) return "";
  try {
    const character = loadCharacters().find((item) => item.id === npc.characterId);
    const slot = resolveBinding(loadBindingConfig(), npc.characterId, "studyroom");
    const books = loadWorldBooks().filter((book) => (slot.worldBookIds ?? []).includes(book.id));
    const lore = books
      .flatMap((book) => book.entries.filter((entry) => !entry.disable && entry.constant).map((entry) => entry.content.trim()))
      .filter(Boolean)
      .join("\n")
      .slice(0, 1200);
    return [
      character?.persona ? `你的人设（只作背景，别照念）：${character.persona.slice(0, 600)}` : "",
      lore ? `世界设定（只作背景）：\n${lore}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

/** 一批书友的隐藏背景，按 npc.id 索引；同一位只算一次。 */
export function collectHiddenContexts(participants: ForumNpc[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const npc of participants) {
    const text = npcHiddenContext(npc);
    if (text) map[npc.id] = text;
  }
  return map;
}

export type GeneratedPost = {
  author: string;
  kind: ForumPost["kind"];
  title?: string;
  body: string;
  bookTitle?: string;
  spoiler: boolean;
};

/**
 * 解析模型输出：优先 JSON；模型不听话时退回「昵称：内容」的行解析，尽量不丢内容。
 * JSON 被截断时只收**写完整**的那几项（completeJsonObjects），半截的最后一项不算一条帖子。
 */
export function parseForumOutput(raw: string, participants: ForumNpc[]): GeneratedPost[] {
  const names = new Set(participants.map((npc) => npc.nickname));
  const trimmed = raw.trim();
  const fromJson = (trimmed.includes("[") ? completeJsonObjects(trimmed) : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const author = typeof value.author === "string" ? value.author.trim() : "";
      const body = typeof value.body === "string" ? value.body.trim() : "";
      if (!body) return null;
      // 作者昵称必须真的是这一批书友里的某一位：认不出来就丢掉这条，
      // 不冒名安到第一位书友头上（那会生成一条不是任何人的帖子）。
      if (!names.has(author)) return null;
      const kind = value.kind === "review" || value.kind === "recommend" ? value.kind : "post";
      return {
        author,
        kind,
        title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 40) : undefined,
        body: body.slice(0, 1200),
        bookTitle: typeof value.bookTitle === "string" && value.bookTitle.trim() ? value.bookTitle.trim().slice(0, 60) : undefined,
        spoiler: value.spoiler === true,
      } as GeneratedPost;
    })
    .filter((item): item is GeneratedPost => item !== null);
  if (fromJson.length > 0) return fromJson;

  // 没解析出可用的一项：落到行解析
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const fromLines: GeneratedPost[] = [];
  for (const line of lines) {
    const match = /^[-*\d.、\s]*([^：:]{1,20})[：:]\s*(.+)$/.exec(line);
    if (!match) continue;
    const name = match[1].replace(/^[-*\d.、\s]+/, "").trim();
    if (!names.has(name)) continue;
    fromLines.push({ author: name, kind: "post", body: match[2].trim().slice(0, 1200), spoiler: false });
  }
  return fromLines;
}

export async function generateForumPosts(
  state: ForumState,
  topic: ForumTopic,
  participants: ForumNpc[],
  signal?: AbortSignal,
  options?: {
    /** 参与者的隐藏背景（角色人设 + 常驻世界书），不传就按角色卡现算 */
    backgrounds?: Record<string, string>;
    /** 用户当前生效的规则；不传就用 state.rules 的默认值 */
    rules?: ForumRules;
    /** 已有帖子标题，用来避免同批撞车 */
    recentTitles?: string[];
  },
): Promise<ForumPost[]> {
  if (participants.length === 0) throw new Error("书友圈里还没有人：先生成几位书友");
  const apiConfig = resolveForumApiConfig();
  if (!apiConfig) throw new Error("还没有配置 API：先在设置里绑定模型");

  const rules = options?.rules ?? state.rules;
  const backgrounds = options?.backgrounds ?? collectHiddenContexts(participants);
  const recentTitles = options?.recentTitles ?? state.posts.slice(0, 12).map((post) => post.title ?? "").filter(Boolean);

  const messages = forumMessagesFor(
    apiConfig,
    buildForumPostMessages({ topic, participants, rules, backgrounds, recentTitles }),
  );
  const startedAt = Date.now();
  const count = typeof rules.feedCount === "number" && rules.feedCount > 0 ? rules.feedCount : participants.length;
  // 用户的「停止」+ 总时长上限合成一个 signal；超时与手动停止分开提示
  const deadline = forumDeadline(signal, FORUM_FEED_TIMEOUT_MS);
  let result: Awaited<ReturnType<typeof simpleLLMCall>>;
  try {
    result = await simpleLLMCall(apiConfig, messages, {
      temperature: 0.9,
      // 按条数放大的输出上限：条数多时不至于写一半被截断、整批作废
      max_tokens: forumFeedMaxTokens(count),
      signal: deadline.signal,
      label: "studyroom-forum",
    });
  } catch (error) {
    if (deadline.timedOut()) throw new Error(`等了 ${Math.round(FORUM_FEED_TIMEOUT_MS / 1000)} 秒还没写完，已停止。可以重试，或把「每次生成几条」调少一点`);
    throw error;
  } finally {
    deadline.done();
  }
  // 调试只记元数据（版本/来源/体积/耗时），不记提示词正文，也不记密钥。
  logForumRequest(
    forumRequestMeta(messages, "home-feed", {
      npcCount: participants.length,
      backgroundCount: Object.keys(backgrounds).length,
      ruleFields: forumRuleFields(rules),
      elapsedMs: Date.now() - startedAt,
    }),
  );
  if (deadline.timedOut()) throw new Error(`等了 ${Math.round(FORUM_FEED_TIMEOUT_MS / 1000)} 秒还没写完，已停止。可以重试，或把「每次生成几条」调少一点`);
  if (result.error) throw new Error(result.error);
  if (!result.content) throw new Error("模型没有返回内容");

  const generated = parseForumOutput(result.content, participants);
  if (generated.length === 0) throw new Error("这次没能生成可用的发言，可以重试");

  return generated.map((item, index) => {
    const npc = participants.find((p) => p.nickname === item.author) ?? participants[0];
    return {
      id: `fp_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`,
      authorId: npc.id,
      authorName: npc.nickname,
      authorKind: "npc" as const,
      kind: item.kind,
      title: item.title,
      body: item.body,
      bookTitle: item.bookTitle ?? topic.bookTitle,
      bookId: topic.bookId,
      spoiler: item.spoiler,
      likedBy: [],
      comments: [],
      generated: true,
      topicKey: topic.key,
      createdAt: new Date().toISOString(),
    };
  });
}

// ── 帖子的日常操作 ──

export function addPost(state: ForumState, post: ForumPost): ForumState {
  return { ...state, posts: [post, ...state.posts] };
}

export function updatePost(state: ForumState, postId: string, patch: Partial<ForumPost>): ForumState {
  return { ...state, posts: state.posts.map((post) => (post.id === postId ? { ...post, ...patch } : post)) };
}

export function toggleLike(state: ForumState, postId: string, actorId: string): ForumState {
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return state;
  const liked = post.likedBy.includes(actorId);
  return updatePost(state, postId, {
    likedBy: liked ? post.likedBy.filter((id) => id !== actorId) : [...post.likedBy, actorId],
  });
}

export function addComment(state: ForumState, postId: string, comment: ForumComment): ForumState {
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return state;
  return updatePost(state, postId, { comments: [...post.comments, comment] });
}

export function hidePost(state: ForumState, postId: string): ForumState {
  return { ...state, hiddenPostIds: state.hiddenPostIds.includes(postId) ? state.hiddenPostIds : [...state.hiddenPostIds, postId] };
}

export function unhidePost(state: ForumState, postId: string): ForumState {
  return { ...state, hiddenPostIds: state.hiddenPostIds.filter((id) => id !== postId) };
}

export function muteNpc(state: ForumState, npcId: string): ForumState {
  return { ...state, mutedNpcIds: state.mutedNpcIds.includes(npcId) ? state.mutedNpcIds : [...state.mutedNpcIds, npcId] };
}

export function unmuteNpc(state: ForumState, npcId: string): ForumState {
  return { ...state, mutedNpcIds: state.mutedNpcIds.filter((id) => id !== npcId) };
}

export const KIND_TEXT: Record<ForumPost["kind"], string> = {
  creation: "创作",
  post: "帖子",
  review: "书评",
  recommend: "推荐",
};

// ── 加好友：把书友接进宿主的聊天应用（不新造聊天系统）──

export function findCharacterIdOf(npc: ForumNpc): string | null {
  if (npc.characterId && loadCharacters().some((c) => c.id === npc.characterId)) return npc.characterId;
  return null;
}

export function isNpcFriend(npc: ForumNpc): boolean {
  const characterId = findCharacterIdOf(npc);
  if (!characterId) return false;
  return loadChatContacts().some((contact) => contact.characterId === characterId);
}

/** 把书友的人设写成角色设定文本：聊天里沿用同一份人设。 */
function npcPersona(npc: ForumNpc): string {
  return [
    `你是${npc.nickname}，一位在读书论坛「书友圈」里认识的书友。`,
    npc.occupation ? `职业/领域：${npc.occupation}。` : "",
    npc.background ? `背景：${npc.background}` : "",
    npc.personality ? `性格：${npc.personality}。` : "",
    npc.interests.length > 0 ? `兴趣：${npc.interests.join("、")}。` : "",
    npc.readingTaste ? `阅读偏好：${npc.readingTaste}。` : "",
    npc.speechStyle ? `说话习惯：${npc.speechStyle}。` : "",
    npc.relations ? `与对方的关系：${npc.relations}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 加为好友：复用同一个 id / 人设 / 头像接进聊天应用，并去重。
 * 生成 NPC 不会自动加好友，必须由用户点这一下。
 */
export async function makeFriendFromNpc(
  state: ForumState,
  npc: ForumNpc,
): Promise<{ characterId: string; created: boolean; alreadyFriend: boolean }> {
  let characterId = findCharacterIdOf(npc);
  let created = false;

  if (!characterId) {
    const character = createCharacter({
      name: npc.nickname,
      avatar: avatarDataUrl(npc.avatar),
      persona: npcPersona(npc),
      personality: npc.personality || undefined,
      tags: ["书友圈"],
    });
    saveCharacters([...loadCharacters(), character]);
    characterId = character.id;
    created = true;
  }

  const alreadyFriend = loadChatContacts().some((contact) => contact.characterId === characterId);
  addChatContact(characterId);
  // 会话按角色 id 归档（与聊天应用一致）
  createOrGetSession(characterId);

  // 把书友圈里的交流带进记忆库：聊天时能想起你们聊过什么
  const talked = state.posts
    .filter((post) => post.authorId === npc.id)
    .slice(0, 5)
    .map((post) => post.title ? `《${post.title}》：${post.body.slice(0, 80)}` : post.body.slice(0, 80));
  if (talked.length > 0) {
    const now = new Date().toISOString();
    const memory: MemoryEntry = {
      id: `mem_forum_${npc.id}`,
      characterId,
      sourceApp: "forum",
      type: "long_term",
      content: `你和${npc.nickname}在书友圈里聊过：${talked.join("；")}`,
      importance: 0.5,
      createdAt: now,
      updatedAt: now,
      metadata: { npcId: npc.id, from: "studyroom-forum" },
    };
    await saveMemoryEntry(memory).catch(() => undefined);
  }

  return { characterId, created, alreadyFriend };
}
