// lib/study-room/share-access.ts — 聊天里读取书房内容的统一授权规则。
//
// 所有读取入口共用这里：内部工具「读取书房分享」（share-reader.ts）和本地资料库的通用读取工具（local-data-fs.ts）。
//  - 书的正文（章节、原始文件）只能通过「读取书房分享」读当前聊天里分享过的书，资料库直接拒绝；
//  - 含剧透的帖子、评论、草稿：只有当前聊天里分享该帖时用户勾选了「附上剧透正文」才可见，否则遮住。

import { loadChatMessages } from "@/lib/chat-storage";
import type { LocalDataGuard } from "@/lib/local-data-fs";
import { readStudyRoomSharePayload, studyRoomTargetOfMessage, STUDYROOM_APP_ID, STUDYROOM_READ_TOOL_NAME } from "./share-card";

export const FORUM_STORAGE_KEY = "ai_phone_studyroom_forum_v1";
/** 聊天记录迁到 IndexedDB 之前的旧存储位置（可能还留在部分设备上） */
const LEGACY_CHAT_MESSAGES_KEY = "ai_phone_chat_messages_v1";
export const SPOILER_REDACTED = "［含剧透，用户没有允许读取，内容已遮住］";

export type ShareRecord = { found: boolean; spoilerAllowed: boolean };

/** 这个对象是否在当前聊天里分享过，以及分享时是否允许读剧透正文 */
export function findShareInSession(sessionId: string | undefined, kind: "book" | "post", id: string): ShareRecord {
  if (!sessionId) return { found: false, spoilerAllowed: false };
  let found = false;
  let spoilerAllowed = false;
  for (const message of loadChatMessages(sessionId)) {
    if (message.mediaType !== "app_card" || message.mediaData?.appId !== STUDYROOM_APP_ID) continue;
    const target = studyRoomTargetOfMessage(message.mediaData);
    if (!target || target.kind !== kind) continue;
    if ((target.kind === "book" ? target.bookId : target.postId) !== id) continue;
    found = true;
    if (readStudyRoomSharePayload(message.mediaData)?.spoilerAllowed === true) spoilerAllowed = true;
  }
  return { found, spoilerAllowed };
}

/** 当前聊天里用户允许读剧透正文的帖子 id */
export function spoilerAllowedPostIds(sessionId: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!sessionId) return ids;
  for (const message of loadChatMessages(sessionId)) {
    if (message.mediaType !== "app_card" || message.mediaData?.appId !== STUDYROOM_APP_ID) continue;
    const payload = readStudyRoomSharePayload(message.mediaData);
    if (payload?.kind === "post" && payload.spoilerAllowed === true) ids.add(payload.id);
  }
  return ids;
}

const BOOK_TEXT_MESSAGE = `书房书籍正文受分享规则保护，本地资料库不能直接读取。只能用「${STUDYROOM_READ_TOOL_NAME}」读对方在当前聊天里分享过的书；没读到就不要假装读过`;

/** 存书正文的位置：reading-db 的章节与原始文件，以及单独的原始文件库 */
function isBookTextStore(dbName: string, storeName: string): boolean {
  if (dbName === "reading-raw-files") return true;
  return dbName === "reading-db" && (storeName === "chapters" || storeName === "rawFiles");
}

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function redactComments(comments: unknown, allowAll: boolean): unknown {
  if (!Array.isArray(comments)) return comments;
  return comments.map((comment) => {
    if (!isRecord(comment) || allowAll || comment.spoiler !== true) return comment;
    return { ...comment, body: SPOILER_REDACTED };
  });
}

/** 书友圈存储：未授权的剧透帖只留作者、书名等外壳，正文、标题、图片、评论都遮住；剧透评论和剧透草稿同样遮住 */
export function redactForumState(state: unknown, allowedPostIds: Set<string>): unknown {
  if (!isRecord(state)) return state;
  const out: Rec = { ...state };
  if (Array.isArray(state.posts)) {
    out.posts = state.posts.map((post) => {
      if (!isRecord(post)) return post;
      const allowed = typeof post.id === "string" && allowedPostIds.has(post.id);
      if (post.spoiler === true && !allowed) {
        const comments = Array.isArray(post.comments) ? post.comments : [];
        return {
          ...post,
          title: undefined,
          body: SPOILER_REDACTED,
          images: undefined,
          comments: comments.map((comment) => (isRecord(comment) ? { ...comment, body: SPOILER_REDACTED } : comment)),
        };
      }
      return { ...post, comments: redactComments(post.comments, allowed) };
    });
  }
  if (Array.isArray(state.drafts)) {
    out.drafts = state.drafts.map((draft) =>
      isRecord(draft) && draft.spoiler === true ? { ...draft, title: undefined, body: SPOILER_REDACTED, images: undefined } : draft,
    );
  }
  return out;
}

/**
 * 聊天消息里的书房卡片：剧透正文的授权只对分享它的那个聊天有效。
 * 别的聊天里的角色通过资料库翻到这条消息时，去掉帖子正文与评论，只留「含剧透」外壳。
 */
export function redactChatMessageShare(message: unknown, sessionId: string | undefined): unknown {
  if (!isRecord(message) || !isRecord(message.mediaData)) return message;
  const payload = readStudyRoomSharePayload(message.mediaData);
  if (!payload || payload.kind !== "post" || !payload.spoiler) return message;
  if (sessionId && message.sessionId === sessionId) return message;
  return {
    ...message,
    mediaData: {
      ...message.mediaData,
      studyRoomShare: {
        ...payload,
        title: "",
        spoilerAllowed: false,
        post: payload.post ? { ...payload.post, body: undefined, bodyTruncated: undefined, comments: undefined } : undefined,
      },
    },
  };
}

/** 给本地资料库用的守卫：按当前聊天会话的分享授权过滤书房数据 */
export function studyRoomLocalDataGuard(sessionId: string | undefined): LocalDataGuard {
  let allowed: Set<string> | null = null;
  return {
    blockedStore: (dbName, storeName) => (isBookTextStore(dbName, storeName) ? BOOK_TEXT_MESSAGE : null),
    filterValue: (dbName, storeName, value) =>
      dbName === "AiPhoneChatDB" && storeName === "messages" ? redactChatMessageShare(value, sessionId) : value,
    filterRaw: (key, raw) => {
      if (key === LEGACY_CHAT_MESSAGES_KEY) {
        try {
          const list: unknown = JSON.parse(raw);
          return Array.isArray(list) ? JSON.stringify(list.map((message) => redactChatMessageShare(message, sessionId))) : raw;
        } catch {
          return raw;
        }
      }
      if (key !== FORUM_STORAGE_KEY) return raw;
      allowed ??= spoilerAllowedPostIds(sessionId);
      try {
        return JSON.stringify(redactForumState(JSON.parse(raw), allowed));
      } catch {
        // 解析不了就整份不给，宁可读不到也不漏剧透
        return JSON.stringify({ note: SPOILER_REDACTED });
      }
    },
  };
}
