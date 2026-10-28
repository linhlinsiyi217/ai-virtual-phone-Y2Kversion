// lib/study-room/share-to-chat.ts — 把书房里的书或帖子分享到小手机的聊天。
//
// 不另造聊天系统：接收人来自现有聊天联系人，消息走 pushChatMessage，
// 卡片复用聊天里已有的「应用卡片」（app_card）。卡片不带网址：
// mediaData.studyRoomShare 存结构化内容（类型、真实 ID、允许分享的简介/片段/正文），
// 角色上下文由 share-card.ts 按它生成；卡片点开时由聊天气泡发 open-app，书房按 ID 回到对应的书或帖子。

import {
  createOrGetSession,
  hydrateChatStorage,
  loadChatContacts,
  pushChatMessage,
} from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { loadChapters, loadProgress } from "@/lib/reading-storage";
import type { Book, BookChapter } from "@/lib/reading-types";
import { KIND_TEXT, type ForumPost } from "./forum";
import {
  SHARE_SPOILER_SUMMARY,
  STUDYROOM_APP_ID,
  STUDYROOM_SHARE_VERSION,
  type StudyRoomShareBookData,
  type StudyRoomSharePayload,
  type StudyRoomShareTarget,
} from "./share-card";

export {
  SHARE_SPOILER_SUMMARY,
  STUDYROOM_APP_ID,
  readStudyRoomTarget,
  type StudyRoomShareTarget,
} from "./share-card";

/** 分享时附带的片段上限（字）：够角色聊，不把整章塞进每轮对话 */
const EXCERPT_MAX = 1200;
const OPENING_MAX = 600;
const POST_BODY_MAX = 1500;
const CHAPTER_TITLE_LIMIT = 40;

export type StudyRoomShareItem = {
  target: StudyRoomShareTarget;
  /** 卡片顶部的小标签：书籍 / 书友圈帖子 */
  label: string;
  title: string;
  subtitle?: string;
  summary: string;
  image?: string;
  /** 帖子含剧透：预览里给出「附上剧透正文」开关，默认不附 */
  spoiler?: boolean;
  /** 生成结构化内容用的原始数据（不直接写进聊天） */
  source: { kind: "book"; book: Book } | { kind: "post"; post: ForumPost };
};

export type ShareContact = {
  characterId: string;
  name: string;
  avatar?: string;
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 卡片图片只放网络地址：本地导入的封面是大体积 data URL，不塞进聊天记录 */
function shareableImage(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  if (!/^https?:\/\//i.test(src) || src.length > 2000) return undefined;
  return src;
}

export function shareItemFromBook(book: Book): StudyRoomShareItem {
  const author = book.author?.trim();
  return {
    target: { kind: "book", bookId: book.id },
    label: "书籍",
    title: `《${book.title}》`,
    subtitle: author ? author : undefined,
    summary: clip(book.description || (author ? `${author} 著` : "书房里的一本书"), 120),
    image: shareableImage(book.cover),
    source: { kind: "book", book },
  };
}

export function shareItemFromPost(post: ForumPost): StudyRoomShareItem {
  const book = post.bookTitle ? `《${post.bookTitle}》` : "";
  if (post.spoiler) {
    // 含剧透：卡片标题与摘要都不带正文，只给书名和提示
    return {
      target: { kind: "post", postId: post.id },
      label: "书友圈帖子",
      title: book ? `${book}的书友圈帖子` : "书友圈帖子",
      subtitle: `${post.authorName} · 含剧透`,
      summary: SHARE_SPOILER_SUMMARY,
      spoiler: true,
      source: { kind: "post", post },
    };
  }
  return {
    target: { kind: "post", postId: post.id },
    label: "书友圈帖子",
    title: clip(post.title || post.body, 40) || "书友圈帖子",
    subtitle: [post.authorName, book].filter(Boolean).join(" · "),
    summary: clip(post.body, 120),
    source: { kind: "post", post },
  };
}

function chapterAt(chapters: BookChapter[], index: number): { chapter: BookChapter; number: number } | null {
  const position = chapters.findIndex((chapter) => chapter.index === index);
  const at = position >= 0 ? position : index;
  const chapter = chapters[at];
  return chapter ? { chapter, number: at + 1 } : null;
}

function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text;
}

async function buildBookData(book: Book): Promise<StudyRoomShareBookData> {
  const [chapters, progress] = await Promise.all([
    loadChapters(book.id).catch(() => [] as BookChapter[]),
    loadProgress(book.id).catch(() => null),
  ]);
  const withText = chapters.filter((chapter) => chapter.paragraphs.some((p) => p.trim()));
  const data: StudyRoomShareBookData = {
    description: book.description ? clip(book.description, 400) : undefined,
    sourceLabel: book.sourceLabel || undefined,
    text: withText.length > 0 ? "loaded" : "none",
    totalChapters: chapters.length,
    chapterTitles: chapters.slice(0, CHAPTER_TITLE_LIMIT).map((chapter, i) => clip(chapter.title || `第 ${i + 1} 章`, 24)),
  };
  if (withText.length === 0) return data;

  const current = progress ? chapterAt(chapters, progress.chapterIndex) : null;
  if (current) {
    data.readTo = { chapter: current.number, title: clip(current.chapter.title || `第 ${current.number} 章`, 24) };
    // 只取读到的段落为止，避免把后面的情节带出去
    const upTo = Math.max(0, Math.min(progress?.paragraphIndex ?? 0, current.chapter.paragraphs.length - 1));
    const text = current.chapter.paragraphs.slice(0, upTo + 1).join("\n").trim();
    if (text) data.excerpt = { chapter: current.number, title: data.readTo.title, text: tail(text, EXCERPT_MAX), from: "progress" };
    return data;
  }
  // 还没开始读：只附开头
  const first = chapters.findIndex((chapter) => chapter.paragraphs.some((p) => p.trim()));
  const chapter = chapters[first];
  const opening = chapter.paragraphs.join("\n").trim();
  data.excerpt = {
    chapter: first + 1,
    title: clip(chapter.title || `第 ${first + 1} 章`, 24),
    text: opening.length > OPENING_MAX ? `${opening.slice(0, OPENING_MAX)}…` : opening,
    from: "opening",
  };
  return data;
}

/** 生成写进聊天消息的结构化内容；剧透帖只有用户勾选了才带正文 */
export async function buildStudyRoomSharePayload(
  item: StudyRoomShareItem,
  options: { includeSpoiler?: boolean } = {},
): Promise<StudyRoomSharePayload> {
  const sharedAt = new Date().toISOString();
  if (item.source.kind === "book") {
    const book = item.source.book;
    return {
      v: STUDYROOM_SHARE_VERSION,
      kind: "book",
      id: book.id,
      title: book.title,
      author: book.author?.trim() || undefined,
      cover: item.image,
      summary: item.summary,
      book: await buildBookData(book),
      sharedAt,
    };
  }
  const post = item.source.post;
  const allowed = !post.spoiler || options.includeSpoiler === true;
  const body = post.body.trim();
  const comments = post.comments
    .filter((comment) => allowed && (!comment.spoiler || options.includeSpoiler === true))
    .slice(0, 3)
    .map((comment) => ({ author: comment.authorName, body: clip(comment.body, 80) }));
  return {
    v: STUDYROOM_SHARE_VERSION,
    kind: "post",
    id: post.id,
    title: post.spoiler && !allowed ? "" : clip(post.title || "", 60),
    author: post.authorName,
    summary: item.summary,
    spoiler: post.spoiler || undefined,
    spoilerAllowed: post.spoiler ? allowed : undefined,
    post: {
      kindLabel: KIND_TEXT[post.kind] ?? "帖子",
      bookTitle: post.bookTitle || undefined,
      body: allowed ? (body.length > POST_BODY_MAX ? `${body.slice(0, POST_BODY_MAX)}…` : body) : undefined,
      bodyTruncated: allowed && body.length > POST_BODY_MAX ? true : undefined,
      commentCount: post.comments.length,
      comments: comments.length > 0 ? comments : undefined,
    },
    sharedAt,
  };
}

/** 现有聊天联系人（单聊），带角色名字与头像；找不到角色的联系人不列出 */
export async function loadShareContacts(): Promise<ShareContact[]> {
  await hydrateChatStorage().catch(() => undefined);
  const characters = new Map(loadCharacters().map((character) => [character.id, character]));
  const seen = new Set<string>();
  const out: ShareContact[] = [];
  for (const contact of loadChatContacts()) {
    if (seen.has(contact.characterId)) continue;
    const character = characters.get(contact.characterId);
    if (!character) continue;
    seen.add(contact.characterId);
    const avatar = character.avatar && character.avatar !== "none" ? character.avatar : undefined;
    out.push({ characterId: character.id, name: contact.nickname?.trim() || character.name, avatar });
  }
  return out;
}

/** 发送一张书房分享卡片到这个联系人已有的聊天（没有会话才新建）；返回会话 id */
export async function sendStudyRoomShare(
  characterId: string,
  item: StudyRoomShareItem,
  options: { includeSpoiler?: boolean } = {},
): Promise<string> {
  const payload = await buildStudyRoomSharePayload(item, options);
  const session = createOrGetSession(characterId);
  pushChatMessage({
    sessionId: session.id,
    role: "user",
    content: `分享了书房${item.label}：${item.title}`,
    mediaType: "app_card",
    mediaData: {
      appId: STUDYROOM_APP_ID,
      appName: "书房",
      appCardTitle: item.title,
      appCardSummary: item.summary,
      appCardBody: item.summary,
      studyRoomShare: payload,
      appCardLayout: {
        appLabel: `书房 · ${item.label}`,
        title: item.title,
        subtitle: item.subtitle,
        body: item.summary,
        image: item.image,
        studyRoomTarget: item.target,
      },
    },
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
  }
  return session.id;
}
