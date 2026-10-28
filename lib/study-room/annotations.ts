// lib/study-room/annotations.ts — 批注（含表情批注）的公共约定与展示整理。
//
// 两类批注分开存储、统一展示：
//  - ReadingNote：用户自己写的书摘 / 批注，可编辑、可删除；
//  - ReadingAnnotation：AI 角色写的批注，只读，但可以跳回原文。
// 定位始终是「章 + 段 + 原文片段」，不用页码；字号、行距、分页变化都不会丢位置。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { Book, ReadingAnnotation, ReadingNote } from "@/lib/reading-types";

const SEEN_ANNOTATIONS_KEY = "ai_phone_studyroom_seen_annotations_v1";
registerKvMigration(SEEN_ANNOTATIONS_KEY);

/**
 * 表情批注可选的表情。界面按钮仍用 SVG 图标，这里只是批注内容本身允许的表情。
 * 支持只加表情，也支持表情＋文字。
 */
export const NOTE_EMOJIS = [
  "😀", "😍", "🤔", "😮", "🥹", "😂",
  "😢", "😡", "👍", "👏", "🙏", "❤️",
  "🔥", "✨", "💡", "📌", "⚠️", "🎯",
  "🌙", "☕", "🌱", "⚡", "📖", "🕯️",
];

/** 这本书当前版本的标识：换了文件、加了章或重新导入都会被看出来。 */
export function bookVersionOf(book: Book): string {
  return `${book.format}:${book.totalChapters}:${book.createdAt}`;
}

/** 新建一条用户批注（表情和文字至少有一个）。 */
export function buildNote(params: {
  book: Book;
  chapterIndex: number;
  paragraphIndex: number;
  quote: string;
  emoji?: string;
  content?: string;
}): ReadingNote {
  const now = new Date().toISOString();
  const emoji = params.emoji?.trim() || undefined;
  const content = params.content?.trim() || undefined;
  return {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    bookId: params.book.id,
    chapterIndex: params.chapterIndex,
    paragraphIndex: params.paragraphIndex,
    kind: content ? "note" : "excerpt",
    quote: params.quote,
    emoji,
    content,
    authorKind: "user",
    authorName: "我",
    bookVersion: bookVersionOf(params.book),
    createdAt: now,
    updatedAt: now,
  };
}

export type ParagraphMark = {
  id: string;
  /** 用户批注或角色批注 */
  source: "user" | "character";
  emoji?: string;
  text?: string;
  /** 展示用的作者名：自己 / 角色名 */
  author: string;
  note?: ReadingNote;
  annotation?: ReadingAnnotation;
};

/** 把一章里的用户批注与角色批注按段落归拢，供正文行下方的标记使用。 */
export function marksByParagraph(
  notes: ReadingNote[],
  annotations: ReadingAnnotation[],
): Map<number, ParagraphMark[]> {
  const map = new Map<number, ParagraphMark[]>();
  const push = (paragraphIndex: number, mark: ParagraphMark) => {
    const list = map.get(paragraphIndex) ?? [];
    list.push(mark);
    map.set(paragraphIndex, list);
  };
  for (const note of notes) {
    push(note.paragraphIndex, {
      id: note.id,
      source: "user",
      emoji: note.emoji,
      text: note.content,
      author: note.authorName ?? "我",
      note,
    });
  }
  for (const annotation of annotations) {
    push(annotation.paragraphIndex, {
      id: annotation.id,
      source: "character",
      emoji: annotation.emoji,
      text: annotation.content,
      author: annotation.characterName,
      annotation,
    });
  }
  return map;
}

/** 已经看过的角色批注 id（按书分组），用于「本章有 N 条新批注」的提醒。 */
function loadSeenAnnotations(): Record<string, string[]> {
  try {
    const raw = kvGet(SEEN_ANNOTATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function unseenAnnotations(bookId: string, annotations: ReadingAnnotation[]): ReadingAnnotation[] {
  const seen = new Set(loadSeenAnnotations()[bookId] ?? []);
  return annotations.filter((item) => !seen.has(item.id));
}

export function markAnnotationsSeen(bookId: string, annotationIds: string[]): void {
  if (annotationIds.length === 0) return;
  const all = loadSeenAnnotations();
  const merged = Array.from(new Set([...(all[bookId] ?? []), ...annotationIds]));
  kvSet(SEEN_ANNOTATIONS_KEY, JSON.stringify({ ...all, [bookId]: merged }));
}

/** 标记条上的短文字：太长就截断，完整内容点开看。 */
export function shortText(text: string | undefined, max = 18): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
