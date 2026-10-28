// lib/reading-storage.ts — Dexie IndexedDB persistence for Reading feature.

import Dexie from "dexie";
import type { Book, BookChapter, ReadingProgress, ReadingAnnotation, ReadingBookmark, ReadingNote } from "./reading-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { DEFAULT_READING_BILINGUAL_PROMPT } from "./bilingual-prompt-defaults";

// ── Database ──

class ReadingDB extends Dexie {
    books!: Dexie.Table<Book, string>;
    chapters!: Dexie.Table<BookChapter, string>;
    progress!: Dexie.Table<ReadingProgress, string>;
    annotations!: Dexie.Table<ReadingAnnotation, string>;
    rawFiles!: Dexie.Table<{ bookId: string; data: Blob }, string>;
    bookmarks!: Dexie.Table<ReadingBookmark, string>;
    notes!: Dexie.Table<ReadingNote, string>;

    constructor() {
        super("reading-db");
        this.version(1).stores({
            books: "id",
            chapters: "id, bookId, [bookId+index]",
            progress: "bookId",
            annotations: "id, [bookId+chapterIndex]",
        });
        this.version(2).stores({
            books: "id, createdAt",
            chapters: "id, bookId, [bookId+index]",
            progress: "bookId",
            annotations: "id, [bookId+chapterIndex]",
        });
        this.version(3).stores({
            books: "id, createdAt",
            chapters: "id, bookId, [bookId+index]",
            progress: "bookId",
            annotations: "id, [bookId+chapterIndex]",
            rawFiles: "bookId",
        });
        this.version(4).stores({
            books: "id, createdAt",
            chapters: "id, bookId, [bookId+index]",
            progress: "bookId",
            annotations: "id, [bookId+chapterIndex]",
            rawFiles: "bookId",
            bookmarks: "id, bookId",
            notes: "id, bookId, [bookId+chapterIndex]",
        });
    }
}

const db = new ReadingDB();

// ── In-memory cache ──

let _booksCache: Book[] | null = null;
let _chaptersCache: Map<string, BookChapter[]> = new Map();
let _progressCache: Map<string, ReadingProgress> = new Map();
let _annotationsCache: Map<string, ReadingAnnotation[]> = new Map(); // key: bookId:chapterIndex

const READING_INTERACTION_CONFIG_KEY = "ai_phone_reading_interaction_config_v1";
registerKvMigration(READING_INTERACTION_CONFIG_KEY);
const RAW_FILE_DB_NAME = "reading-raw-files";
const RAW_FILE_STORE_NAME = "files";

/** TXT 导入时的段落划分方式：auto=智能探测（默认）/ blank=空行 / indent=段首缩进 / line=每行一段 */
export type ReadingParagraphMode = "auto" | "blank" | "indent" | "line";

/** 阅读模式：page=翻页 / scroll=连续滚动 */
export type ReadingViewMode = "page" | "scroll";

export type ReadingInteractionConfig = {
    bilingualTranslationEnabled: boolean;
    collapseBilingualTranslation: boolean;
    bilingualTranslationPrompt: string;
    /** 导入 TXT 时如何划分段落（默认自动探测书格式） */
    paragraphMode: ReadingParagraphMode;
    /** TXT 编码解析：auto=自动探测（默认）/ utf-8 / gb18030 / gbk / big5 / utf-16le / utf-16be */
    txtEncoding: "auto" | "utf-8" | "gb18030" | "gbk" | "big5" | "utf-16le" | "utf-16be";
    /** 阅读模式：翻页 / 连续滚动 */
    readingMode: ReadingViewMode;
    /** 自动批注失败时的静默重试次数（0=不重试） */
    annotationRetryCount: number;
    /** TXT 预批注：读到上一批批注阈值时提前生成下一批（TXT 按段落分批）；默认关闭，由用户手动开启 */
    autoAnnotatePrefetch: boolean;
    /** PDF 预批注：同上，但针对 PDF（按页分批）；默认关闭，由用户手动开启 */
    autoAnnotatePrefetchPdf: boolean;
    /** 批注预生成触发时机：读到上一批批注的多少比例时提前生成下一批（0-1，默认 2/3） */
    annotationPrefetchThreshold: number;
    /** 共读讨论悬浮窗展开时是否自动滚动到最新消息（默认开启；用户可随后自由滑动打断） */
    chatAutoScrollOnOpen: boolean;
    /** PDF 渲染：页面缩放率（1=按容器宽度原样，>1 放大；配合「一屏一页」使用） */
    pdfZoom: number;
    /** PDF 渲染：当前页前后各预渲染几页（懒加载粒度；过小会导致滚动到未渲染页反复渲染闪烁） */
    pdfPreloadRadius: number;
    /** PDF 预加载：开启后阅读时提前渲染后续页，滚动更平滑 */
    pdfPreloadEnabled: boolean;
};

export const DEFAULT_READING_INTERACTION_CONFIG: ReadingInteractionConfig = {
    bilingualTranslationEnabled: true,
    collapseBilingualTranslation: true,
    bilingualTranslationPrompt: DEFAULT_READING_BILINGUAL_PROMPT,
    paragraphMode: "auto",
    txtEncoding: "auto",
    readingMode: "page",
    annotationRetryCount: 3,
    autoAnnotatePrefetch: false,
    autoAnnotatePrefetchPdf: false,
    annotationPrefetchThreshold: 2 / 3,
    chatAutoScrollOnOpen: true,
    pdfZoom: 1,
    pdfPreloadRadius: 3,
    pdfPreloadEnabled: true,
};

export async function hydrateReadingStorage(): Promise<void> {
    _booksCache = await db.books.toArray();
    _booksCache.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** 卸载书房前断开 Dexie 连接，否则 indexedDB.deleteDatabase 会被阻塞。 */
export function closeReadingStorage(): void {
    try {
        db.close();
    } catch {
        // 已经关掉或从未打开都无所谓
    }
    _booksCache = [];
    _chaptersCache = new Map();
    _progressCache = new Map();
    _annotationsCache = new Map();
}

// ── Books ──

export function loadBooks(): Book[] {
    return _booksCache || [];
}

export async function addBook(book: Book): Promise<void> {
    await db.books.put(book);
    _booksCache = null;
    _booksCache = await db.books.orderBy("createdAt").reverse().toArray();
}

export async function updateBook(book: Book): Promise<void> {
    await db.books.put(book);
    _booksCache = null;
    _booksCache = await db.books.orderBy("createdAt").reverse().toArray();
}

export async function deleteBook(bookId: string): Promise<void> {
    await db.books.delete(bookId);
    await db.chapters.where("bookId").equals(bookId).delete();
    await db.progress.delete(bookId);
    await db.annotations.where("[bookId+chapterIndex]").between([bookId, Dexie.minKey], [bookId, Dexie.maxKey]).delete();
    await db.bookmarks.where("bookId").equals(bookId).delete();
    await db.notes.where("bookId").equals(bookId).delete();
    await deleteRawFile(bookId).catch(() => {});
    _booksCache = null;
    _booksCache = await db.books.orderBy("createdAt").reverse().toArray();
    _chaptersCache.delete(bookId);
    _progressCache.delete(bookId);
    // Clear annotation cache for this book
    for (const key of _annotationsCache.keys()) {
        if (key.startsWith(bookId + ":")) _annotationsCache.delete(key);
    }
}

// ── Chapters ──

export async function saveChapters(bookId: string, chapters: BookChapter[]): Promise<void> {
    await db.chapters.bulkPut(chapters);
    const existing = _chaptersCache.get(bookId) ?? await db.chapters.where("bookId").equals(bookId).toArray();
    const merged = new Map(existing.map((chapter) => [chapter.id, chapter]));
    for (const chapter of chapters) {
        merged.set(chapter.id, chapter);
    }
    const next = [...merged.values()].sort((a, b) => a.index - b.index);
    _chaptersCache.set(bookId, next);
}

export async function loadChapters(bookId: string): Promise<BookChapter[]> {
    if (_chaptersCache.has(bookId)) return _chaptersCache.get(bookId)!;
    const chapters = await db.chapters.where("bookId").equals(bookId).sortBy("index");
    _chaptersCache.set(bookId, chapters);
    return chapters;
}

// ── Progress ──

export async function loadProgress(bookId: string): Promise<ReadingProgress | null> {
    if (_progressCache.has(bookId)) return _progressCache.get(bookId)!;
    const p = await db.progress.get(bookId);
    if (p) _progressCache.set(bookId, p);
    return p || null;
}

/** 全部书的进度（书架「最近阅读」排序与书详情使用）。 */
export async function loadAllProgress(): Promise<ReadingProgress[]> {
    const all = await db.progress.toArray();
    for (const p of all) _progressCache.set(p.bookId, p);
    return all;
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
    await db.progress.put(progress);
    _progressCache.set(progress.bookId, progress);
}

// ── Annotations ──

function annotationKey(bookId: string, chapterIndex: number): string {
    return `${bookId}:${chapterIndex}`;
}

export async function loadAnnotations(bookId: string, chapterIndex: number): Promise<ReadingAnnotation[]> {
    const key = annotationKey(bookId, chapterIndex);
    if (_annotationsCache.has(key)) return _annotationsCache.get(key)!;
    const annots = await db.annotations.where("[bookId+chapterIndex]").equals([bookId, chapterIndex]).toArray();
    _annotationsCache.set(key, annots);
    return annots;
}

export async function saveAnnotation(annotation: ReadingAnnotation): Promise<void> {
    await db.annotations.put(annotation);
    const key = annotationKey(annotation.bookId, annotation.chapterIndex);
    const cached = _annotationsCache.get(key) || [];
    const existingIndex = cached.findIndex((item) => item.id === annotation.id);
    if (existingIndex >= 0) cached[existingIndex] = annotation;
    else cached.push(annotation);
    _annotationsCache.set(key, cached);
}

export async function saveAnnotations(annotations: ReadingAnnotation[]): Promise<void> {
    if (annotations.length === 0) return;
    await db.annotations.bulkPut(annotations);
    // Refresh cache for affected chapters
    const affected = new Set(annotations.map(a => annotationKey(a.bookId, a.chapterIndex)));
    for (const key of affected) {
        const [bookId, chapterIdx] = key.split(":");
        _annotationsCache.set(key, await db.annotations.where("[bookId+chapterIndex]").equals([bookId, Number(chapterIdx)]).toArray());
    }
}

/** 汇总全部书的批注与书摘（书房「笔记区」用，按时间倒序）。 */
export async function loadAllAnnotations(): Promise<ReadingAnnotation[]> {
    const all = await db.annotations.toArray();
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
    const existing = await db.annotations.get(annotationId);
    if (!existing) return;

    await db.annotations.delete(annotationId);
    const key = annotationKey(existing.bookId, existing.chapterIndex);
    const cached = _annotationsCache.get(key);
    if (cached) {
        _annotationsCache.set(key, cached.filter((annotation) => annotation.id !== annotationId));
    }
}

// ── Bookmarks（位置书签） ──

export async function loadBookmarks(bookId: string): Promise<ReadingBookmark[]> {
    return db.bookmarks.where("bookId").equals(bookId).toArray();
}

export async function loadAllBookmarks(): Promise<ReadingBookmark[]> {
    const all = await db.bookmarks.toArray();
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function saveBookmark(bookmark: ReadingBookmark): Promise<void> {
    await db.bookmarks.put(bookmark);
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
    await db.bookmarks.delete(bookmarkId);
}

// ── Notes（用户书摘 / 批注） ──

export async function loadNotes(bookId: string): Promise<ReadingNote[]> {
    return db.notes.where("bookId").equals(bookId).toArray();
}

export async function loadChapterNotes(bookId: string, chapterIndex: number): Promise<ReadingNote[]> {
    return db.notes.where("[bookId+chapterIndex]").equals([bookId, chapterIndex]).toArray();
}

export async function loadAllNotes(): Promise<ReadingNote[]> {
    const all = await db.notes.toArray();
    return all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveNote(note: ReadingNote): Promise<void> {
    await db.notes.put(note);
}

export async function deleteNote(noteId: string): Promise<void> {
    await db.notes.delete(noteId);
}

// ── Reading Interaction Config ──

export function loadReadingInteractionConfig(): ReadingInteractionConfig {
    if (typeof window === "undefined") return DEFAULT_READING_INTERACTION_CONFIG;
    try {
        const raw = kvGet(READING_INTERACTION_CONFIG_KEY);
        if (!raw) return DEFAULT_READING_INTERACTION_CONFIG;
        return {
            ...DEFAULT_READING_INTERACTION_CONFIG,
            ...JSON.parse(raw),
        };
    } catch {
        return DEFAULT_READING_INTERACTION_CONFIG;
    }
}

export function saveReadingInteractionConfig(config: ReadingInteractionConfig): void {
    if (typeof window === "undefined") return;
    kvSet(READING_INTERACTION_CONFIG_KEY, JSON.stringify(config));
}

// ── Raw Files (for PDF native rendering) ──

function openRawFileDatabaseAt(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
            request = version ? indexedDB.open(RAW_FILE_DB_NAME, version) : indexedDB.open(RAW_FILE_DB_NAME);
        } catch (err) {
            reject(err);
            return;
        }

        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(RAW_FILE_STORE_NAME)) {
                request.result.createObjectStore(RAW_FILE_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(request.error);
    });
}

async function openRawFileDatabase(): Promise<IDBDatabase> {
    let idb: IDBDatabase;
    try {
        idb = await openRawFileDatabaseAt(1);
    } catch (err) {
        if (err instanceof DOMException && err.name === "VersionError") {
            idb = await openRawFileDatabaseAt(undefined);
        } else {
            throw err;
        }
    }

    if (!idb.objectStoreNames.contains(RAW_FILE_STORE_NAME)) {
        const nextVersion = idb.version + 1;
        idb.close();
        idb = await openRawFileDatabaseAt(nextVersion);
    }

    return idb;
}

export async function saveRawFile(bookId: string, data: ArrayBuffer | Blob): Promise<void> {
    const idb = await openRawFileDatabase();
    await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(RAW_FILE_STORE_NAME, "readwrite");
        tx.objectStore(RAW_FILE_STORE_NAME).put(data instanceof Blob ? data : new Blob([data]), bookId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    idb.close();
}

export async function deleteRawFile(bookId: string): Promise<void> {
    const idb = await openRawFileDatabase();
    await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(RAW_FILE_STORE_NAME, "readwrite");
        tx.objectStore(RAW_FILE_STORE_NAME).delete(bookId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    idb.close();
}

/** 逐条列出原始文件的 bookId 与大小（blob.size 只读元数据，不载入内容）。 */
export async function listRawFileSummaries(): Promise<Array<{ bookId: string; bytes: number }>> {
    try {
        const idb = await openRawFileDatabase();
        const out: Array<{ bookId: string; bytes: number }> = [];
        await new Promise<void>((resolve, reject) => {
            const tx = idb.transaction(RAW_FILE_STORE_NAME, "readonly");
            const req = tx.objectStore(RAW_FILE_STORE_NAME).openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return resolve();
                const blob = cursor.value as Blob | undefined;
                out.push({ bookId: String(cursor.primaryKey), bytes: blob?.size ?? 0 });
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });
        idb.close();
        return out;
    } catch {
        return [];
    }
}

export async function loadRawFile(bookId: string): Promise<ArrayBuffer | null> {
    const blob = await loadRawFileBlob(bookId);
    if (!blob) return null;
    return blob.arrayBuffer();
}

export async function loadRawFileBlob(bookId: string): Promise<Blob | null> {
    try {
        const idb = await openRawFileDatabase();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const tx = idb.transaction(RAW_FILE_STORE_NAME, "readonly");
            const req = tx.objectStore(RAW_FILE_STORE_NAME).get(bookId);
            req.onsuccess = () => resolve(req.result as Blob || null);
            req.onerror = () => reject(req.error);
        });
        idb.close();
        return blob;
    } catch {
        return null;
    }
}
