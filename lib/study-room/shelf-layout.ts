// lib/study-room/shelf-layout.ts — 实体书架排布（纯函数，便于验证）。
//
// 依据设计稿（BOOKROOM V2）：
//  - 书本按真实体积分级：标准书脊 / 薄册 / 大开本；宽度与高度都由这本书自己决定；
//  - 从左到右逐本占位，本层放不下才换层；组间偶有 3–6pt 留白，不排成机械的宽窄交替；
//  - 藏书多时每层视觉占用尽量在 72%–92%；藏书少时集中在左侧成「聚落」，右侧裸露层板 + 书立 + 纸签；
//  - 每层最多一个书立（纯装饰，不承载功能）；纸签只在藏书少的状态出现；
//  - 只有每层最后一本、右侧确有空间时才向右微倾，且不会压到邻书。

import type { Book } from "@/lib/reading-types";

export type ShelfSort = "import" | "manual" | "recent";

/** 书在层板上呈现的形态：标准书脊 / 薄册 / 大开本 */
export type BookVariant = "standard" | "booklet" | "artbook";

export type ShelfBookBox = {
  kind: "book";
  book: Book;
  variant: BookVariant;
  /** 书脊厚度（占位宽度，未乘缩放） */
  spine: number;
  /** 书高（未乘缩放） */
  height: number;
  /** 左右微转角度（只影响视觉，不改变占位） */
  tilt: number;
  /** 倾斜角（度，正值向右倒）；0 表示直立 */
  lean: number;
  /** 无真实封面时的底色（由封面边缘取色或生成封面决定） */
  tone: string;
  ink: string;
  /** 组间留白：这一本左侧额外空出的缝（模拟刚抽走一本的痕迹） */
  gapBefore: number;
};

/** 轻量书立：只做视觉收尾，不承载任何功能 */
export type ShelfBookend = {
  kind: "bookend";
  width: number;
  height: number;
};

/** 小纸签：藏书少时说明这一段是「有意识摆放」的 */
export type ShelfTag = {
  kind: "tag";
  width: number;
  height: number;
  text: string;
  offsetY: number;
};

export type ShelfItem = ShelfBookBox | ShelfBookend | ShelfTag;

export const BOOK_GAP = 3;
export const ROW_PADDING_LEFT = 16;
export const ROW_PADDING_RIGHT = 16;
export const MIN_ROWS = 2;
/** 藏书少于此数量时用「聚落」陈列 */
export const SPARSE_THRESHOLD = 8;
/** 藏书多时每层的目标占用区间 */
export const RICH_OCCUPANCY = { min: 0.72, max: 0.92 };
/** 视觉基准高度：大开本会比它高，薄册略矮 */
export const BASE_BOOK_HEIGHT = 176;
const LEAN_DEG = 5;

const VARIANT_SIZE: Record<BookVariant, { min: number; max: number; hDelta: number }> = {
  booklet: { min: 9, max: 12, hDelta: -14 },
  standard: { min: 15, max: 24, hDelta: 0 },
  artbook: { min: 26, max: 32, hDelta: 26 },
};

/** 备用书脊配色（没有真实封面、也提炼不出封面色时使用） */
const COVER_TONES: Array<{ tone: string; ink: string }> = [
  { tone: "#33465e", ink: "#eef2f8" },
  { tone: "#5a3f36", ink: "#f4ece6" },
  { tone: "#3d4d41", ink: "#edf2ed" },
  { tone: "#5c3a46", ink: "#f6ecef" },
  { tone: "#413f4e", ink: "#f0f0f5" },
  { tone: "#2f4b4c", ink: "#eaf3f3" },
  { tone: "#5d4a2e", ink: "#f6f0e4" },
  { tone: "#3a4150", ink: "#eef1f6" },
  { tone: "#4c3a55", ink: "#f3ecf6" },
  { tone: "#355168", ink: "#eaf2f8" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** 由章节数把书分成三档形态：薄册 / 标准 / 大开本。 */
export function variantOf(book: Book): BookVariant {
  const chapters = book.totalChapters;
  const hash = hashString(book.id || book.title);
  if (chapters > 0 && chapters <= 6 && hash % 3 !== 0) return "booklet";
  if (chapters >= 40 || book.format === "pdf") return "artbook";
  return "standard";
}

/** 每本书的尺寸只由它自己决定（章节数 + 稳定哈希），不随书量变化。 */
export function measureBook(book: Book): Omit<ShelfBookBox, "lean" | "gapBefore"> {
  const hash = hashString(book.id || book.title);
  const variant = variantOf(book);
  const size = VARIANT_SIZE[variant];
  const span = Math.max(size.max - size.min, 1);
  const spine = Math.round(size.min + (hash % (span + 1)));
  // 同一层里高度参差：同一形态内在 6px 范围内起伏，避免「一条直线」
  const height = BASE_BOOK_HEIGHT + size.hDelta + ((hash >> 5) % 4) * 6;
  const tilt = ((hash >> 3) % 3) - 1;
  const tone = COVER_TONES[hash % COVER_TONES.length];
  return { kind: "book", book, variant, spine, height, tilt, tone: tone.tone, ink: tone.ink };
}

/** 倾斜 θ 度时书顶向右水平位移 = h·sinθ；给它让出的空位。 */
function leanOffset(height: number, deg: number): number {
  return Math.ceil(height * Math.sin((deg * Math.PI) / 180)) + 2;
}

/** 组间留白：每 3–4 本之间偶尔留 3–6pt，模拟真实书架的松散节奏。 */
function gapBefore(index: number, hash: number): number {
  if (index === 0) return 0;
  const step = index % 4;
  if (step === 0) return 3 + (hash % 2);
  if (step === 2 && hash % 5 === 0) return 5 + (hash % 2);
  return 0;
}

function rowWidthOf(row: ShelfItem[], scale: number): number {
  return row.reduce((sum, item) => {
    if (item.kind === "book") return sum + (item.spine + (item.gapBefore || 0) + BOOK_GAP) * scale;
    return sum + (item.width + BOOK_GAP) * scale;
  }, 0);
}

/**
 * 按实际可用宽度从左到右排布。
 * @param rowWidth 一层内可放书的宽度（px，已扣除左右边距）
 * @param scale    书本缩放（外观设置），用于把未缩放尺寸换算成实际占位
 */
export function layoutShelf(books: Book[], rowWidth: number, scale = 1): ShelfItem[][] {
  const usable = Math.max(rowWidth, 60);
  const rows: ShelfItem[][] = [];

  if (books.length > 0 && books.length <= SPARSE_THRESHOLD) {
    // 藏书较少：集中在左侧成聚落，右侧裸露层板 + 书立 + 纸签，只渲染一层
    const cluster: ShelfItem[] = books.map((book, index) => {
      const hash = hashString(book.id || book.title);
      return { ...measureBook(book), lean: 0, gapBefore: gapBefore(index, hash) };
    });
    // 末尾放一个轻量书立，暗示这一段是有意识摆放的边界
    cluster.push({ kind: "bookend", width: 12, height: 62 });
    // 第二批：去掉右侧「全部藏书」米黄纸签——纯装饰、点了没反应，用户会以为是按钮
    rows.push(cluster);
    return rows;
  }

  let current: ShelfItem[] = [];
  let used = 0;
  books.forEach((book, index) => {
    const hash = hashString(book.id || book.title);
    const box: ShelfBookBox = { ...measureBook(book), lean: 0, gapBefore: gapBefore(index, hash) };
    const need = (box.spine + box.gapBefore + BOOK_GAP) * scale;
    if (current.length > 0 && used + need > usable) {
      rows.push(current);
      current = [];
      used = 0;
      box.gapBefore = 0;
    }
    current.push(box);
    used += need;
  });
  if (current.length > 0) rows.push(current);

  rows.forEach((row) => {
    if (row.length < 3) return;
    const width = rowWidthOf(row, scale);
    const last = row[row.length - 1];
    if (last.kind !== "book") return;
    const extra = leanOffset(last.height * scale, LEAN_DEG);
    // 右侧剩余空间足够才倾斜；占用已经很满时保持直立，避免压到邻书
    if (usable - width > extra + 8) last.lean = LEAN_DEG;
  });

  while (rows.length < MIN_ROWS) rows.push([]);
  return rows;
}

/** 一层里书本的视觉占用比例（0–1），用于自检「是不是太稀」 */
export function rowOccupancy(row: ShelfItem[], rowWidth: number, scale = 1): number {
  if (rowWidth <= 0) return 0;
  return rowWidthOf(row, scale) / rowWidth;
}

/** 书架排序：默认导入顺序（先导入的在左），阅读后不会自动重排。 */
export function sortShelfBooks(
  books: Book[],
  sort: ShelfSort,
  options: { manualOrder?: string[]; lastReadAt?: Record<string, string> } = {},
): Book[] {
  const byImport = [...books].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  if (sort === "recent") {
    const read = options.lastReadAt ?? {};
    return byImport
      .map((book, index) => ({ book, index, at: read[book.id] ? new Date(read[book.id]).getTime() : 0 }))
      .sort((a, b) => (b.at - a.at) || (a.index - b.index))
      .map((entry) => entry.book);
  }
  if (sort === "manual" && options.manualOrder && options.manualOrder.length > 0) {
    const position = new Map(options.manualOrder.map((id, index) => [id, index]));
    return byImport
      .map((book, index) => ({ book, key: position.has(book.id) ? position.get(book.id)! : options.manualOrder!.length + index }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.book);
  }
  return byImport;
}

/** 手动排序：把某本书向左/右移动一格，返回新的完整顺序。 */
export function moveInOrder(order: string[], bookId: string, delta: -1 | 1): string[] {
  const index = order.indexOf(bookId);
  if (index < 0) return order;
  const target = index + delta;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** 封面比例：读取源图宽高比，限定在实体书合理范围，读不到时用常见 0.68。 */
export const DEFAULT_COVER_RATIO = 0.68;
export function clampCoverRatio(ratio: number | undefined): number {
  if (!ratio || !Number.isFinite(ratio)) return DEFAULT_COVER_RATIO;
  return Math.min(0.82, Math.max(0.56, ratio));
}

/**
 * 生成封面配色：由书名哈希映射到一组莫兰迪色。
 * 用于没有真实封面的书——生成的是「一本朴素但认真设计过的书封」，不是系统占位图。
 */
const GENERATED_COVERS: Array<{ bg: string; ink: string; accent: string }> = [
  { bg: "#E7E3DA", ink: "#3B3A36", accent: "#9AA88F" },
  { bg: "#DDE4E8", ink: "#2F3A42", accent: "#7E9BAE" },
  { bg: "#EADFDA", ink: "#40332F", accent: "#B08B7E" },
  { bg: "#E3E6DC", ink: "#333A32", accent: "#8FA07C" },
  { bg: "#E6E1E8", ink: "#3A3340", accent: "#9C8FA8" },
  { bg: "#EAE4D6", ink: "#3E392E", accent: "#B5A47B" },
  { bg: "#DBE3E1", ink: "#2E3A38", accent: "#7FA29A" },
  { bg: "#E8E2E2", ink: "#3C3334", accent: "#A8898C" },
];

export function generatedCover(book: Book): { bg: string; ink: string; accent: string } {
  const hash = hashString(book.id || book.title);
  return GENERATED_COVERS[hash % GENERATED_COVERS.length];
}

/**
 * 从封面图边缘取主色作为书脊色：降饱和 + 收到中间明度，
 * 让书脊看起来是封面的低调延伸，而不是随机色。取不到时返回 null（由调用方回退到内置配色）。
 */
export function spineToneFromCover(image: HTMLImageElement): { tone: string; ink: string } | null {
  try {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size, size);
    const band = Math.max(2, Math.round(size * 0.1));
    const regions = [
      ctx.getImageData(0, 0, size, band),
      ctx.getImageData(0, size - band, size, band),
      ctx.getImageData(0, 0, band, size),
      ctx.getImageData(size - band, 0, band, size),
    ];
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (const region of regions) {
      for (let i = 0; i < region.data.length; i += 4) {
        if (region.data[i + 3] < 128) continue;
        r += region.data[i];
        g += region.data[i + 1];
        b += region.data[i + 2];
        count += 1;
      }
    }
    if (count === 0) return null;
    r /= count;
    g /= count;
    b /= count;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const desaturate = 0.35;
    r += (gray - r) * desaturate;
    g += (gray - g) * desaturate;
    b += (gray - b) * desaturate;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const shift = (78 - luma) * 0.35;
    r = Math.max(0, Math.min(255, r + shift));
    g = Math.max(0, Math.min(255, g + shift));
    b = Math.max(0, Math.min(255, b + shift));
    const toHex = (value: number) => Math.round(value).toString(16).padStart(2, "0");
    const tone = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    const ink = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#2f3438" : "#f2f4f6";
    return { tone, ink };
  } catch {
    // 跨域封面会让画布被污染，取不到就回退到内置配色
    return null;
  }
}
