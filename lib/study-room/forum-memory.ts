// lib/study-room/forum-memory.ts — G15「书房点评—角色记忆」记忆投影。
// 角色关联的书友在书友圈成功回帖后，把这次讨论写进该角色的记忆事件
// （短期组装器会带进聊天上下文，角色聊天时能想起自己参与过这次点评讨论）。
// 存储模式与 interview-magazine-memory.ts 一致：每角色一个 kv key。

import { kvGet, kvSet, registerDynamicPrefix } from "@/lib/kv-db";
import { formatChatTimestamp } from "@/lib/llm-prompt-assembler";
import { USER_NAME_MACRO } from "@/lib/user-macro";

const STUDYROOM_FORUM_EVENT_PREFIX = "ai_phone_studyroom_forum_events_";
const MAX_FORUM_PROJECTION_EVENTS = 80;

registerDynamicPrefix(STUDYROOM_FORUM_EVENT_PREFIX);

export type StudyRoomForumProjectionEntry = {
  id: string;
  postId: string;
  npcId: string;
  timestamp: string;
  content: string;
};

type RecordStudyRoomForumEventInput = {
  characterId: string;
  /** PendingReply id：同一次回应只记一条（幂等） */
  replyId: string;
  postId: string;
  /** 帖子类型决定文案（书评/帖子/推荐/创作） */
  postKind: "post" | "review" | "recommend" | "creation";
  postTitle: string;
  npcId: string;
  npcName: string;
  replyText: string;
  timestamp?: string;
};

const POST_KIND_LABEL: Record<RecordStudyRoomForumEventInput["postKind"], string> = {
  post: "帖子",
  review: "书评",
  recommend: "推荐",
  creation: "作品",
};

function storageKey(characterId: string): string {
  return `${STUDYROOM_FORUM_EVENT_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): StudyRoomForumProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StudyRoomForumProjectionEntry =>
        Boolean(entry)
        && typeof (entry as Partial<StudyRoomForumProjectionEntry>).id === "string"
        && typeof (entry as Partial<StudyRoomForumProjectionEntry>).postId === "string"
        && typeof (entry as Partial<StudyRoomForumProjectionEntry>).timestamp === "string"
        && typeof (entry as Partial<StudyRoomForumProjectionEntry>).content === "string"
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEventsByKey(key: string, events: StudyRoomForumProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_FORUM_PROJECTION_EVENTS);
  kvSet(key, JSON.stringify(compacted));
}

/**
 * 记一次书友圈回帖到角色记忆。只在回帖真正落库成功后调用（生成失败不记）。
 * content 里的用户名用宏占位，由组装端按当前用户身份渲染。
 */
export function recordStudyRoomForumEvent(input: RecordStudyRoomForumEventInput): StudyRoomForumProjectionEntry | null {
  const characterId = cleanText(input.characterId, 160);
  if (!characterId || !input.postId || !input.replyId) return null;

  const npcName = cleanText(input.npcName, 80) || "书友";
  const kindLabel = POST_KIND_LABEL[input.postKind] || "帖子";
  const title = cleanText(input.postTitle, 80);
  const reply = cleanText(input.replyText, 200);
  if (!reply) return null;

  const timestamp = input.timestamp || new Date().toISOString();
  const titlePart = title ? `的${kindLabel}《${title}》` : `的${kindLabel}`;
  const content = `[书友圈 ${formatChatTimestamp(timestamp)}] 我以书友「${npcName}」的身份在书房书友圈回复了${USER_NAME_MACRO}${titlePart}：${reply}`;

  const entry: StudyRoomForumProjectionEntry = {
    id: `sr_forum_reply_${cleanText(input.replyId, 120)}`,
    postId: cleanText(input.postId, 120),
    npcId: cleanText(input.npcId, 120),
    timestamp,
    content,
  };

  const key = storageKey(characterId);
  const current = loadEventsByKey(key);
  saveEventsByKey(key, [entry, ...current.filter((item) => item.id !== entry.id)]);

  return entry;
}

export function loadStudyRoomForumProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string }
): StudyRoomForumProjectionEntry[] {
  const entries = loadEventsByKey(storageKey(characterId));
  if (!options?.afterTimestamp) return entries;
  return entries.filter((entry) => entry.timestamp > options.afterTimestamp!);
}
