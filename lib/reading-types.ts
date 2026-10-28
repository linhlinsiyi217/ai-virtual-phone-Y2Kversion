// lib/reading-types.ts — Type definitions for the Reading (阅读) feature.

export type Book = {
    id: string;
    title: string;
    author?: string;
    format: "txt" | "epub" | "pdf";
    totalChapters: number;
    createdAt: string;
    /** 真实封面图地址（在线来源提供时才有）；没有则书架用备用样式 */
    cover?: string;
    /** 用户自己换过封面时，记下换之前的原封面（可能为空字符串表示原来没有），用于「恢复原封面」 */
    originalCover?: string;
    /** 来源提供的简介（EPUB 元数据或书目来源）；没有就不显示，不用正文首段冒充 */
    description?: string;
    /** 来源提供的主题/标签 */
    tags?: string[];
    /** 来源名称与原站链接（联网导入时记录） */
    sourceLabel?: string;
    sourceUrl?: string;
    /** 书房创作的书：记录创作草稿 id，便于回到书桌继续写 */
    draftId?: string;
};

export type BookChapter = {
    id: string;
    bookId: string;
    index: number;
    title: string;
    paragraphs: string[];
    /** PDF only: synthetic page chunk start (1-based) */
    pageStart?: number;
    /** PDF only: synthetic page chunk end (1-based) */
    pageEnd?: number;
    /** PDF only: page number (1-based) for each paragraph */
    paragraphPages?: number[];
    /** PDF only: vertical position (0-1 ratio) within page for each paragraph */
    paragraphYPositions?: number[];
};

export type ReadingProgress = {
    bookId: string;
    chapterIndex: number;
    scrollPosition: number;
    companionCharacterId?: string;
    progressFraction?: number;
    progressCurrent?: number;
    progressTotal?: number;
    progressScope?: "book" | "chapter";
    /** 保存进度时的阅读模式；滚动模式下 scrollPosition 存的是章节内滚动比例(0-1) */
    readingMode?: "page" | "scroll";
    /** 书房阅读器：屏幕顶部所在段落与段内偏移比例，字号/分页变化后仍能回到原段落 */
    paragraphIndex?: number;
    paragraphOffset?: number;
    lastReadAt: string;
};

export type ReadingAnnotation = {
    id: string;
    bookId: string;
    chapterIndex: number;
    paragraphIndex: number;
    characterId: string;
    characterName: string;
    content: string;
    /** 角色也可以只回一个表情 */
    emoji?: string;
    /** 批注针对的原文片段（没有则为整段） */
    quote?: string;
    createdAt: string;
};

/** 阅读位置书签：记住某一章某一段（含章内滚动比例），方便回到原处。 */
export type ReadingBookmark = {
    id: string;
    bookId: string;
    chapterIndex: number;
    paragraphIndex: number;
    /** 保存时的章内滚动比例(0-1) */
    scrollFraction?: number;
    /** 保存时选中的原文片段（没有选中则为空） */
    excerpt?: string;
    label?: string;
    createdAt: string;
};

/**
 * 用户自己的书摘与批注。
 * kind="excerpt" 只保留原文摘录；kind="note" 在摘录之外还有用户写下的想法。
 * 与 ReadingAnnotation（AI 生成、带角色）分开存储，互不覆盖。
 */
export type ReadingNote = {
    id: string;
    bookId: string;
    chapterIndex: number;
    paragraphIndex: number;
    kind: "excerpt" | "note";
    /** 被标记的原文（高亮依据） */
    quote: string;
    /** 用户写下的想法；kind="excerpt" 时为空 */
    content?: string;
    /** 表情批注：可以只加表情，也可以表情＋文字 */
    emoji?: string;
    /** 批注作者：用户本人或某个 AI 角色 */
    authorKind?: "user" | "character";
    authorId?: string;
    authorName?: string;
    /** 标记时这本书的版本标识（格式/章数/导入时间），换版本后可提示定位可能变化 */
    bookVersion?: string;
    /** 自己打的标签，用于分类整理 */
    tags?: string[];
    /** 收藏（重点标记） */
    starred?: boolean;
    /** 行内标记：高亮或下划线（不动正文时留空） */
    mark?: "highlight" | "underline";
    /** 标记配色 key（见 MARK_COLORS） */
    color?: string;
    createdAt: string;
    updatedAt: string;
};
