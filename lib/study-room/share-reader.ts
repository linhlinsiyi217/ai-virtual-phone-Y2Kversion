// lib/study-room/share-reader.ts — 角色按需读取聊天里分享过的书房内容（内部工具「读取书房分享」）。
//
// 只读真实存储：书从书房书库按 bookId 取章节，帖子从书友圈按 postId 取。
// 权限（规则在 share-access.ts，与本地资料库共用）：只能读当前聊天里确实分享过的书/帖子；
// 剧透帖只有分享时用户勾选了「附上剧透正文」才给正文。
// 长书按章、按段读取，一次不超过 PART_SIZE 字，不把整本书塞进上下文。

import { hydrateReadingStorage, loadBooks, loadChapters, loadProgress } from "@/lib/reading-storage";
import { loadForum } from "./forum";
import { findShareInSession } from "./share-access";

const PART_SIZE = 2500;
const POST_MAX = 6000;
const DIRECTORY_LIMIT = 200;

export type ShareReadResult = { ok: true; text: string } | { ok: false; error: string };

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

export async function readStudyRoomShare(args: Record<string, unknown>, sessionId?: string): Promise<ShareReadResult> {
  const rawType = String(args.type ?? args.kind ?? "").trim();
  const type = rawType === "book" || rawType === "书" || rawType === "书籍" ? "book"
    : rawType === "post" || rawType === "帖子" ? "post" : null;
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!type || !id) return { ok: false, error: "参数不完整：需要 type（book 或 post）和卡片里给出的 id" };

  const share = findShareInSession(sessionId, type, id);
  if (!share.found) return { ok: false, error: "这个书房内容没有在当前聊天里分享过，读不到。只能读对方分享给你的书或帖子。" };

  return type === "book" ? readBook(id, args) : readPost(id, share.spoilerAllowed);
}

async function readBook(bookId: string, args: Record<string, unknown>): Promise<ShareReadResult> {
  await hydrateReadingStorage().catch(() => undefined);
  const book = loadBooks().find((item) => item.id === bookId);
  if (!book) return { ok: false, error: "这本书已经不在对方的书架上了，读不到正文。" };
  const chapters = await loadChapters(bookId).catch(() => []);
  if (chapters.length === 0 || !chapters.some((chapter) => chapter.paragraphs.some((p) => p.trim()))) {
    return { ok: false, error: `《${book.title}》在书房里只有书目信息，没有导入正文，读不到原文。` };
  }
  const progress = await loadProgress(bookId).catch(() => null);
  const readPosition = progress ? chapters.findIndex((chapter) => chapter.index === progress.chapterIndex) : -1;
  const readNumber = readPosition >= 0 ? readPosition + 1 : progress ? progress.chapterIndex + 1 : 0;

  const chapterNo = positiveInt(args.chapter ?? args.章节);
  if (!chapterNo) {
    const list = chapters.slice(0, DIRECTORY_LIMIT).map((chapter, i) => `${i + 1}. ${chapter.title || `第 ${i + 1} 章`}`);
    return {
      ok: true,
      text: [
        `《${book.title}》目录，共 ${chapters.length} 章${chapters.length > DIRECTORY_LIMIT ? `（只列前 ${DIRECTORY_LIMIT} 章）` : ""}：`,
        ...list,
        readNumber ? `对方读到第 ${readNumber} 章。` : "对方还没开始读。",
        "要读某一章，带上 chapter（章节序号）；长章节用 part 分段读。",
      ].join("\n"),
    };
  }
  const chapter = chapters[chapterNo - 1];
  if (!chapter) return { ok: false, error: `没有第 ${chapterNo} 章，这本书共 ${chapters.length} 章。` };
  const full = chapter.paragraphs.map((p) => p.trim()).filter(Boolean).join("\n");
  const parts = Math.max(1, Math.ceil(full.length / PART_SIZE));
  const part = Math.min(positiveInt(args.part) ?? 1, parts);
  const text = full.slice((part - 1) * PART_SIZE, part * PART_SIZE);
  return {
    ok: true,
    text: [
      `《${book.title}》第 ${chapterNo} 章「${chapter.title || `第 ${chapterNo} 章`}」${parts > 1 ? `（第 ${part}/${parts} 段）` : ""}：`,
      text,
      parts > part ? `本章还有后续，读下一段用 part=${part + 1}。` : "",
      readNumber && chapterNo > readNumber ? `注意：对方只读到第 ${readNumber} 章，这一章的情节对 TA 来说是剧透，聊的时候别直接说出来。` : "",
    ].filter(Boolean).join("\n"),
  };
}

function readPost(postId: string, spoilerAllowed: boolean): ShareReadResult {
  const post = loadForum().posts.find((item) => item.id === postId);
  if (!post) return { ok: false, error: "这条帖子已经被删除，读不到了。" };
  if (post.spoiler && !spoilerAllowed) {
    return { ok: false, error: "这条帖子含剧透，对方分享时没有允许你看正文。不要猜测内容，可以问对方要不要讲给你听。" };
  }
  const body = post.body.trim();
  const comments = post.comments
    .filter((comment) => !comment.spoiler || spoilerAllowed)
    .slice(0, 20)
    .map((comment) => `${comment.authorName}：${comment.body.replace(/\s+/g, " ").trim()}`);
  return {
    ok: true,
    text: [
      `书友圈帖子${post.title ? `「${post.title}」` : ""}，作者 ${post.authorName}${post.bookTitle ? `，关于《${post.bookTitle}》` : ""}：`,
      body.length > POST_MAX ? `${body.slice(0, POST_MAX)}…（后面省略）` : body,
      comments.length > 0 ? `评论（${comments.length}/${post.comments.length} 条）：\n${comments.join("\n")}` : "",
    ].filter(Boolean).join("\n"),
  };
}
