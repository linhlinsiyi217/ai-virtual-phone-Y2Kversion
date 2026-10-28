// lib/study-room/backup.ts — 书房自己的备份与恢复。
//
// 只包含书房的数据：书架书目、正文、进度、书签、笔记与批注（含角色批注）、
// 书架排序偏好、外观与预设。不碰宿主账号、角色卡、聊天记录等其他数据。
// 恢复时默认「合并」：同 id 的书覆盖，其他书保留；也可以选择「清空后恢复」。

import {
  addBook,
  loadAllAnnotations,
  loadAllBookmarks,
  loadAllNotes,
  loadAllProgress,
  loadBooks,
  loadChapters,
  saveAnnotation,
  saveBookmark,
  saveChapters,
  saveNote,
  saveProgress,
  updateBook,
} from "@/lib/reading-storage";
import type {
  Book,
  BookChapter,
  ReadingAnnotation,
  ReadingBookmark,
  ReadingNote,
  ReadingProgress,
} from "@/lib/reading-types";
import { loadShelfPrefs, saveShelfPrefs, type ShelfPrefs } from "./shelf-prefs";
import {
  loadAppearance,
  loadPresets,
  sanitizeState,
  saveAppearance,
  savePresets,
  type AppearancePreset,
  type AppearanceState,
} from "./appearance";

export const STUDYROOM_BACKUP_APP = "float-0217-studyroom";
export const STUDYROOM_BACKUP_VERSION = 1;

export type StudyRoomBackup = {
  app: typeof STUDYROOM_BACKUP_APP;
  version: number;
  exportedAt: string;
  books: Book[];
  chapters: BookChapter[];
  progress: ReadingProgress[];
  bookmarks: ReadingBookmark[];
  notes: ReadingNote[];
  annotations: ReadingAnnotation[];
  shelfPrefs: ShelfPrefs;
  appearance: AppearanceState;
  presets: AppearancePreset[];
};

export type StudyRoomBackupSummary = {
  books: number;
  chapters: number;
  notes: number;
  annotations: number;
  bookmarks: number;
  hasAppearance: boolean;
};

/** 打包当前书房的全部数据（正文来自书房保存的章节，不依赖原始文件）。 */
export async function buildStudyRoomBackup(): Promise<{ backup: StudyRoomBackup; summary: StudyRoomBackupSummary }> {
  const books = loadBooks();
  const [progress, bookmarks, notes, annotations] = await Promise.all([
    loadAllProgress().catch(() => []),
    loadAllBookmarks().catch(() => []),
    loadAllNotes().catch(() => []),
    loadAllAnnotations().catch(() => []),
  ]);
  const chapters: BookChapter[] = [];
  for (const book of books) {
    const list = await loadChapters(book.id).catch(() => []);
    chapters.push(...list);
  }
  const backup: StudyRoomBackup = {
    app: STUDYROOM_BACKUP_APP,
    version: STUDYROOM_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    books,
    chapters,
    progress,
    bookmarks,
    notes,
    annotations,
    shelfPrefs: loadShelfPrefs(),
    appearance: loadAppearance(),
    presets: loadPresets(),
  };
  return {
    backup,
    summary: {
      books: books.length,
      chapters: chapters.length,
      notes: notes.length,
      annotations: annotations.length,
      bookmarks: bookmarks.length,
      hasAppearance: Boolean(backup.appearance.background.url) || Object.keys(backup.appearance.css).length > 0,
    },
  };
}

export function studyRoomBackupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `书房备份-${stamp}.json`;
}

/** 读一份备份文件；不是书房备份就明确拒绝，不做猜测性导入。 */
export function parseStudyRoomBackup(raw: unknown): StudyRoomBackup {
  if (!raw || typeof raw !== "object") throw new Error("文件内容不是书房备份");
  const value = raw as Partial<StudyRoomBackup>;
  if (value.app !== STUDYROOM_BACKUP_APP) throw new Error("这不是本机书房的备份文件");
  if (!Array.isArray(value.books)) throw new Error("备份里没有书目数据");
  return {
    app: STUDYROOM_BACKUP_APP,
    version: typeof value.version === "number" ? value.version : 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    books: value.books ?? [],
    chapters: Array.isArray(value.chapters) ? value.chapters : [],
    progress: Array.isArray(value.progress) ? value.progress : [],
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks : [],
    notes: Array.isArray(value.notes) ? value.notes : [],
    annotations: Array.isArray(value.annotations) ? value.annotations : [],
    shelfPrefs: value.shelfPrefs && typeof value.shelfPrefs === "object" ? value.shelfPrefs : { sort: "import", manualOrder: [] },
    appearance: sanitizeState(value.appearance),
    presets: Array.isArray(value.presets) ? value.presets : [],
  };
}

export type RestoreResult = {
  books: number;
  chapters: number;
  notes: number;
  annotations: number;
  bookmarks: number;
  appearance: boolean;
};

/**
 * 恢复备份。mode="merge" 时按 id 覆盖同名书、保留其他书；
 * mode="replace" 时先清掉当前书架再写入（界面会二次确认）。
 */
export async function restoreStudyRoomBackup(
  backup: StudyRoomBackup,
  mode: "merge" | "replace" = "merge",
): Promise<RestoreResult> {
  if (mode === "replace") {
    const { deleteBook } = await import("@/lib/reading-storage");
    for (const book of loadBooks()) {
      await deleteBook(book.id).catch(() => undefined);
    }
  }

  const existing = new Set(loadBooks().map((book) => book.id));
  for (const book of backup.books) {
    if (existing.has(book.id)) await updateBook(book);
    else await addBook(book);
  }
  saveShelfPrefs(backup.shelfPrefs);

  const byBook = new Map<string, BookChapter[]>();
  for (const chapter of backup.chapters) {
    const list = byBook.get(chapter.bookId) ?? [];
    list.push(chapter);
    byBook.set(chapter.bookId, list);
  }
  for (const [bookId, list] of byBook) {
    await saveChapters(bookId, list.sort((a, b) => a.index - b.index));
  }

  for (const note of backup.notes) await saveNote(note);
  for (const annotation of backup.annotations) await saveAnnotation(annotation);
  for (const bookmark of backup.bookmarks) await saveBookmark(bookmark);
  for (const progress of backup.progress) await saveProgress(progress);

  // 外观：备份里的外观与当前不同才覆盖（避免旧备份把现在调好的外观盖掉）
  const hasAppearance = JSON.stringify(backup.appearance) !== JSON.stringify(loadAppearance());
  if (hasAppearance) saveAppearance(backup.appearance);
  if (backup.presets.length > 0) {
    const merged = [...loadPresets()];
    for (const preset of backup.presets) {
      if (!merged.some((item) => item.id === preset.id)) merged.push(preset);
    }
    savePresets(merged);
  }

  return {
    books: backup.books.length,
    chapters: backup.chapters.length,
    notes: backup.notes.length,
    annotations: backup.annotations.length,
    bookmarks: backup.bookmarks.length,
    appearance: hasAppearance,
  };
}
