// lib/study-room/dm.ts — 书房私信：书友圈里点「私信」后打开的书房内部会话。
//
// 与宿主聊天应用的关系：
//  · 只复用公共 API 配置（resolveForumApiConfig）和书友/角色身份资料；
//  · 会话 ID、消息存储和上下文全部归属于书房，键名前缀 ai_phone_studyroom_dm_v1，
//    不使用另一个聊天应用的 sessionId，也不把两边的历史混在一起；
//  · 不读取、不修改宿主聊天应用的消息。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

const DM_KEY = "ai_phone_studyroom_dm_v1";
registerKvMigration(DM_KEY);

/** 一条私信消息。id 在书房内唯一，不引用宿主聊天的消息 id。 */
export type DmMessage = {
  id: string;
  threadId: string;
  role: "user" | "npc";
  content: string;
  createdAt: string;
  /** 发送失败时保留在列表里，界面显示重试；不用假消息占位 */
  failed?: boolean;
  /** 失败原因（真实原因，不笼统写「失败」） */
  error?: string;
};

/** 与某个书友的一条私信会话。threadId 由书友 id 推出，稳定不变。 */
export type DmThread = {
  id: string;
  /** 书友 id（ForumNpc.id）；用 id 关联，昵称改了也还是同一会话 */
  npcId: string;
  /** 最近一条消息的时间，列表排序用 */
  updatedAt: string;
  /** 未读数：进详情后清零 */
  unread: number;
  /** 起草中还没发出去的内容，返回列表也不丢 */
  draft?: string;
};

export type DmState = {
  threads: DmThread[];
  messages: DmMessage[];
};

export const EMPTY_DM: DmState = { threads: [], messages: [] };

/** 会话 ID 由书友 id 推出：同一个书友永远同一个会话，不随昵称变化。 */
export function threadIdFor(npcId: string): string {
  return `srdm_${npcId}`;
}

function makeMessageId(): string {
  return `srdmm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function loadDm(): DmState {
  try {
    const raw = kvGet(DM_KEY);
    if (!raw) return { threads: [], messages: [] };
    const parsed = JSON.parse(raw) as Partial<DmState>;
    const threads = Array.isArray(parsed.threads)
      ? parsed.threads.filter(
          (thread): thread is DmThread =>
            !!thread && typeof thread.id === "string" && typeof thread.npcId === "string",
        )
      : [];
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(
          (message): message is DmMessage =>
            !!message &&
            typeof message.id === "string" &&
            typeof message.threadId === "string" &&
            typeof message.content === "string" &&
            (message.role === "user" || message.role === "npc"),
        )
      : [];
    return { threads, messages };
  } catch {
    return { threads: [], messages: [] };
  }
}

export function saveDm(state: DmState): void {
  kvSet(DM_KEY, JSON.stringify(state));
}

/** 取某个书友的会话；没有就新建一条（不写盘，由调用方决定何时保存）。 */
export function ensureThread(state: DmState, npcId: string): { state: DmState; thread: DmThread } {
  const id = threadIdFor(npcId);
  const existing = state.threads.find((thread) => thread.id === id);
  if (existing) return { state, thread: existing };
  const thread: DmThread = {
    id,
    npcId,
    updatedAt: new Date().toISOString(),
    unread: 0,
  };
  return { state: { ...state, threads: [thread, ...state.threads] }, thread };
}

export function threadMessages(state: DmState, threadId: string): DmMessage[] {
  return state.messages.filter((message) => message.threadId === threadId);
}

/** 某条会话的最后一条消息，用于列表预览。 */
export function lastMessage(state: DmState, threadId: string): DmMessage | null {
  const list = threadMessages(state, threadId);
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * 追加一条消息。同一线程里失败的旧消息在重试成功后被移除
 * （重试复用同一条，不会重复入库）。
 */
export function appendMessage(state: DmState, message: DmMessage): DmState {
  const messages = [...state.messages, message];
  const threads = state.threads.map((thread) =>
    thread.id === message.threadId
      ? { ...thread, updatedAt: message.createdAt, unread: message.role === "npc" ? thread.unread + 1 : thread.unread }
      : thread,
  );
  return { ...state, messages, threads };
}

/** 重试成功后替换掉原来那条失败消息（按 id 原地替换，不新增）。 */
export function replaceMessage(state: DmState, id: string, patch: Partial<DmMessage>): DmState {
  return {
    ...state,
    messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
  };
}

export function removeMessage(state: DmState, id: string): DmState {
  return { ...state, messages: state.messages.filter((message) => message.id !== id) };
}

/** 进详情就读完了。 */
export function markThreadRead(state: DmState, threadId: string): DmState {
  return {
    ...state,
    threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, unread: 0 } : thread)),
  };
}

/** 起草内容跟着会话一起存，切页面、返回列表都不会丢。 */
export function setThreadDraft(state: DmState, threadId: string, draft: string): DmState {
  return {
    ...state,
    threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, draft } : thread)),
  };
}

export function totalUnread(state: DmState): number {
  return state.threads.reduce((sum, thread) => sum + (thread.unread || 0), 0);
}

// ── 请求组装 ──

/** 私信带多少条历史（只取本会话的，不读其他应用） */
export const DM_CONTEXT_LIMIT = 12;

export type DmPromptInput = {
  npcName: string;
  npcProfile: string;
  meName: string;
  /** 本会话历史，从旧到新 */
  history: DmMessage[];
  /** 用户这次发的内容 */
  text: string;
  /** 书友圈「内容边界」等公共规则，仍然生效 */
  boundary?: string;
};

/**
 * 私信使用的消息数组（真正发给模型的那份）。
 * 角色差异、真实上下文都在这里；不套用论坛的 JSON 结构，这是一对一聊天。
 */
export function buildDmMessages(input: DmPromptInput): { role: "system" | "user" | "assistant"; content: string }[] {
  const system = [
    "你在扮演读书论坛「书友圈」里的一位书友，正在和用户一对一私信。",
    "只以这位书友的身份说话，不解释自己是模型，不输出旁白、舞台说明或 JSON。",
    "",
    "【你是谁】",
    input.npcProfile,
    `用户的名字是「${input.meName}」。`,
    "",
    "【怎么说】",
    "像真人打字：长短随情绪，不必每条都热情或都追问；可以有不同意见、可以忙、可以只说一句。",
    "不要每句都用同样的开头，不要复读之前说过的话，不要无缘由地升华或总结。",
    "只根据这段私信里出现过的内容和 TA 自己的设定说话；没聊过的私人经历、约定或剧情不要编成已经发生过的事。",
    input.boundary ? `\n【边界】\n${input.boundary}` : "",
    "",
    "直接回一条消息即可，不要写称呼以外的格式。",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();

  const history = input.history.slice(-DM_CONTEXT_LIMIT);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
  ];
  for (const message of history) {
    if (message.failed) continue;
    messages.push({ role: message.role === "user" ? "user" : "assistant", content: message.content });
  }
  messages.push({ role: "user", content: input.text });
  return messages;
}

/** 书友身份拼成一段可读资料，直接进 system。 */
export function npcProfileText(npc: {
  nickname: string;
  occupation?: string;
  background?: string;
  personality?: string;
  interests?: string[];
  readingTaste?: string;
  speechStyle?: string;
  relations?: string;
}): string {
  const lines = [`昵称：${npc.nickname}`];
  if (npc.occupation) lines.push(`职业/领域：${npc.occupation}`);
  if (npc.background) lines.push(`背景：${npc.background}`);
  if (npc.personality) lines.push(`性格：${npc.personality}`);
  if (npc.interests && npc.interests.length > 0) lines.push(`兴趣：${npc.interests.join("、")}`);
  if (npc.readingTaste) lines.push(`阅读口味：${npc.readingTaste}`);
  if (npc.speechStyle) lines.push(`说话习惯：${npc.speechStyle}`);
  if (npc.relations) lines.push(`关系：${npc.relations}`);
  return lines.join("\n");
}

/**
 * 清理模型回包：去掉整体包裹的引号、开头的「昵称：」和多余空行。
 * 只做这些轻处理，不改写内容、不删连接词。
 */
export function cleanDmReply(raw: string, npcName: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/,"").trim();
  const quoted = /^(["“「])([\s\S]*)(["”」])$/.exec(text);
  if (quoted) text = quoted[2].trim();
  const namePattern = new RegExp(`^${npcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]\\s*`);
  text = text.replace(namePattern, "").trim();
  return text;
}

export { makeMessageId };
