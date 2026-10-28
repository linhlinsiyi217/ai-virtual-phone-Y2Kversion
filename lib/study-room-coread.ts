// lib/study-room-coread.ts — 书房共读会话：按「书 + 角色」隔离的独立会话。
// 复用 chat-storage 的会话与消息存储，以及 reading-engine 的共读调用链；
// 不新造角色档案，不改动用户全局 API 配置。

import { loadChatSessions, saveChatSessions, type ChatSession } from "./chat-storage";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

/** 共读会话登记表：sessionId → 所属书与角色。会话 id 里带书 id 有歧义，单独记一份。 */
export type CoreadRef = {
  sessionId: string;
  bookId: string;
  characterId: string;
  updatedAt: string;
};

const COREAD_REGISTRY_KEY = "ai_phone_studyroom_coread_sessions_v1";
registerKvMigration(COREAD_REGISTRY_KEY);

export function loadCoreadRefs(): CoreadRef[] {
  try {
    const raw = kvGet(COREAD_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CoreadRef[]) : [];
  } catch {
    return [];
  }
}

function rememberCoreadRef(ref: CoreadRef): void {
  const refs = loadCoreadRefs().filter((r) => r.sessionId !== ref.sessionId);
  kvSet(COREAD_REGISTRY_KEY, JSON.stringify([ref, ...refs]));
}

/** 某本书或某角色被删除时，清掉对应的共读登记。 */
export function forgetCoreadRefs(predicate: (ref: CoreadRef) => boolean): void {
  const kept = loadCoreadRefs().filter((r) => !predicate(r));
  kvSet(COREAD_REGISTRY_KEY, JSON.stringify(kept));
}

/** 每本书、每个角色一个稳定会话 id，避免不同书的共读记忆串在一起。 */
export function coreadSessionId(bookId: string, characterId: string): string {
  return `coread_${bookId}_${characterId}`;
}

/** 取得（必要时创建）某本书与某角色的共读会话。 */
export function getCoreadSession(bookId: string, characterId: string): ChatSession {
  const id = coreadSessionId(bookId, characterId);
  rememberCoreadRef({ sessionId: id, bookId, characterId, updatedAt: new Date().toISOString() });

  const sessions = loadChatSessions();
  const existing = sessions.find((s) => s.id === id);
  if (existing) return existing;

  const session: ChatSession = {
    id,
    contactId: characterId,
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
    isPinned: false,
    bilingualTranslationEnabled: true,
    collapseBilingualTranslation: true,
  };
  saveChatSessions([session, ...sessions]);
  return session;
}

/**
 * 组装送给 AI 的正文范围：只包含已读到的段落，避免剧透。
 * 选中文字单独附在后面，作为本轮讨论的明确焦点。
 */
export { buildReadRange } from "./study-room/read-range";
