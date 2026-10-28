// lib/study-room/draw.ts — 「抽一本」两阶段抽卡：先抽分类卡，再从真实来源抽候选书。
//
// 三条底线：
//  1. 只抽真的能读的东西：书架藏书、精选公版书（运行时用真实来源解析）、联网合法书目；
//  2. 用的是小手机统一的虚拟钱包（lib/wallet-storage），不另造一份互不相通的假币；
//  3. 视觉等级只表示本次动画的稀有感，绝不暗示书籍好坏；候选一律标明可读状态。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { loadBooks } from "@/lib/reading-storage";
import { getWalletBalance, loadWalletState, payWithWalletBalance } from "@/lib/wallet-storage";
import type { Book } from "@/lib/reading-types";
import type { BookSearchResult } from "./book-source";

const DRAW_KEY = "ai_phone_studyroom_draw_v1";
registerKvMigration(DRAW_KEY);

export type DrawCategory = {
  id: string;
  label: string;
  /** 抽到之后用来检索的查询词 */
  queries: string[];
  /** 用来匹配书架藏书的标签 / 关键词 */
  tags: string[];
  kind: "novel" | "comic" | "all";
  /** 分类卡背的强调色（只用于卡面，不表示稀有度） */
  accent: string;
};

export const DRAW_CATEGORIES: DrawCategory[] = [
  { id: "mystery", label: "悬疑", queries: ["悬疑 推理", "侦探 小说"], tags: ["悬疑", "推理", "侦探", "犯罪"], kind: "novel", accent: "#5C6B8A" },
  { id: "healing", label: "治愈", queries: ["治愈 生活", "温情 随笔"], tags: ["治愈", "温情", "生活", "日常"], kind: "novel", accent: "#8FA88C" },
  { id: "romance", label: "爱情", queries: ["爱情 小说", "言情"], tags: ["爱情", "言情", "恋爱"], kind: "novel", accent: "#B98A96" },
  { id: "fantasy", label: "奇幻", queries: ["奇幻 小说", "魔幻 冒险"], tags: ["奇幻", "魔幻", "冒险"], kind: "novel", accent: "#8C7BB3" },
  { id: "classic", label: "经典", queries: ["世界名著", "经典 文学"], tags: ["经典", "名著", "文学"], kind: "novel", accent: "#B5A47B" },
  { id: "history", label: "历史", queries: ["历史", "中国历史"], tags: ["历史", "史书", "传记"], kind: "all", accent: "#A08968" },
  { id: "scifi", label: "科幻", queries: ["科幻 小说", "科幻 短篇"], tags: ["科幻", "未来", "太空"], kind: "novel", accent: "#6E93AE" },
  { id: "comic", label: "漫画", queries: ["漫画"], tags: ["漫画", "连环画"], kind: "comic", accent: "#9C8FA8" },
  { id: "short", label: "短篇", queries: ["短篇小说", "短篇集"], tags: ["短篇", "小说集", "散文"], kind: "novel", accent: "#7E9BAE" },
  { id: "nonfiction", label: "非虚构", queries: ["非虚构", "纪实 文学"], tags: ["非虚构", "纪实", "科普", "自然"], kind: "all", accent: "#7FA29A" },
];

export function drawCategory(random = Math.random): DrawCategory {
  return DRAW_CATEGORIES[Math.floor(random() * DRAW_CATEGORIES.length)] ?? DRAW_CATEGORIES[0];
}

export function categoryById(id: string): DrawCategory | null {
  return DRAW_CATEGORIES.find((item) => item.id === id) ?? null;
}

/** 价格（与宿主钱包同一套虚拟币）。 */
export const DRAW_PRICE = { single: 20, five: 88 };

/** 精选公版书：只放公有领域作品；运行时用真实来源（Project Gutenberg / 中文维基文库）解析成可导入的书。 */
export type PublicDomainSeed = {
  title: string;
  author?: string;
  lang: "en" | "zh";
  categories: string[];
  /** 已验证的 Gutenberg 编号，没有就走检索解析 */
  gutenbergId?: number;
};

export const PUBLIC_DOMAIN_SEEDS: PublicDomainSeed[] = [
  { title: "Pride and Prejudice", author: "Jane Austen", lang: "en", categories: ["romance", "classic"], gutenbergId: 1342 },
  { title: "Frankenstein", author: "Mary Shelley", lang: "en", categories: ["scifi", "classic"], gutenbergId: 84 },
  { title: "Moby Dick", author: "Herman Melville", lang: "en", categories: ["classic", "history"], gutenbergId: 2701 },
  { title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", lang: "en", categories: ["mystery", "short"], gutenbergId: 1661 },
  { title: "Jane Eyre", author: "Charlotte Brontë", lang: "en", categories: ["romance", "classic"] },
  { title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", lang: "en", categories: ["fantasy", "classic"] },
  { title: "Dracula", author: "Bram Stoker", lang: "en", categories: ["mystery", "classic"] },
  { title: "The Time Machine", author: "H. G. Wells", lang: "en", categories: ["scifi", "short"] },
  { title: "The War of the Worlds", author: "H. G. Wells", lang: "en", categories: ["scifi"] },
  { title: "Great Expectations", author: "Charles Dickens", lang: "en", categories: ["classic"] },
  { title: "The Picture of Dorian Gray", author: "Oscar Wilde", lang: "en", categories: ["classic"] },
  { title: "Walden", author: "Henry David Thoreau", lang: "en", categories: ["nonfiction", "healing"] },
  { title: "Meditations", author: "Marcus Aurelius", lang: "en", categories: ["nonfiction", "history"] },
  { title: "The Art of War", author: "Sun Tzu", lang: "en", categories: ["history", "nonfiction"] },
  { title: "The Wonderful Wizard of Oz", author: "L. Frank Baum", lang: "en", categories: ["fantasy", "healing"] },
  { title: "红楼梦", lang: "zh", categories: ["classic", "romance"] },
  { title: "呐喊", lang: "zh", categories: ["short", "classic"] },
  { title: "朝花夕拾", lang: "zh", categories: ["short", "nonfiction"] },
  { title: "三国演义", lang: "zh", categories: ["history", "classic"] },
  { title: "西游记", lang: "zh", categories: ["fantasy", "classic"] },
  { title: "儒林外史", lang: "zh", categories: ["classic", "history"] },
  { title: "聊斋志异", lang: "zh", categories: ["fantasy", "short"] },
];

export type DrawAvailability = "shelf" | "import" | "preview" | "recommend";

export type DrawCandidate = {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  description?: string;
  availability: DrawAvailability;
  sourceLabel?: string;
  year?: string;
  language?: string;
  /** 书架藏书直接带书本对象 */
  book?: Book;
  /** 存档后的书架藏书 id（存档不带整本书） */
  shelfBookId?: string;
  importFile?: BookSearchResult["importFile"];
  externalUrl?: string;
  raw?: BookSearchResult;
  /** 这次抽到的是不是重复（已在书架或之前抽到过） */
  duplicate?: boolean;
};

export const AVAILABILITY_LABEL: Record<DrawAvailability, string> = {
  shelf: "可直接阅读",
  import: "可导入书房",
  preview: "可预览",
  recommend: "仅推荐",
};

function matchesCategory(book: Book, category: DrawCategory): boolean {
  const haystack = [book.title, book.description ?? "", book.author ?? "", ...(book.tags ?? [])].join(" ").toLowerCase();
  return category.tags.some((tag) => haystack.includes(tag));
}

/** 书架里符合这一类别的藏书。 */
export function shelfCandidates(category: DrawCategory): DrawCandidate[] {
  return loadBooks()
    .filter((book) => matchesCategory(book, category))
    .map<DrawCandidate>((book) => ({
      id: `shelf:${book.id}`,
      title: book.title,
      author: book.author,
      cover: book.cover,
      description: book.description,
      availability: "shelf",
      sourceLabel: "我的书架",
      language: "zh",
      book,
    }));
}

/** 把书城搜索结果转成候选（只留可导入 / 可预览的）。 */
export function toCandidates(results: BookSearchResult[]): DrawCandidate[] {
  const out: DrawCandidate[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const key = `${item.title}|${item.authors[0] ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    if (item.kind === "material") continue;
    if (item.importFile) {
      seen.add(key);
      out.push({
        id: item.id,
        title: item.title,
        author: item.authors[0],
        cover: item.cover,
        description: item.description,
        availability: "import",
        sourceLabel: item.sourceLabel,
        year: item.year,
        language: item.language,
        importFile: item.importFile,
        externalUrl: item.externalUrl,
        raw: item,
      });
      continue;
    }
    if (item.readability === "preview") {
      seen.add(key);
      out.push({
        id: item.id,
        title: item.title,
        author: item.authors[0],
        cover: item.cover,
        description: item.description,
        availability: "preview",
        sourceLabel: item.sourceLabel,
        year: item.year,
        language: item.language,
        externalUrl: item.externalUrl,
        raw: item,
      });
    }
  }
  return out;
}

/** 用书房自己的搜索接口取候选（服务端已去噪、分类、缓存）。 */
async function fetchByQuery(query: string, kind: DrawCategory["kind"], signal?: AbortSignal): Promise<DrawCandidate[]> {
  try {
    const response = await fetch(`/api/study-room/search?q=${encodeURIComponent(query)}&kind=${kind}`, signal ? { signal } : undefined);
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: BookSearchResult[] };
    return toCandidates(data.results ?? []);
  } catch {
    return [];
  }
}

/** 精选公版书按分类解析成候选：优先用已验证的 Gutenberg 编号，否则走真实检索。 */
async function resolveSeed(seed: PublicDomainSeed, category: DrawCategory, signal?: AbortSignal): Promise<DrawCandidate[]> {
  if (seed.lang === "en" && seed.gutenbergId) {
    return [
      {
        id: `gutenberg:${seed.gutenbergId}`,
        title: seed.title,
        author: seed.author,
        availability: "import",
        sourceLabel: "Project Gutenberg",
        language: "en",
        importFile: { url: `https://www.gutenberg.org/cache/epub/${seed.gutenbergId}/pg${seed.gutenbergId}.txt`, format: "txt" },
        externalUrl: `https://www.gutenberg.org/ebooks/${seed.gutenbergId}`,
      },
    ];
  }
  const query = seed.author ? `${seed.title} ${seed.author}` : seed.title;
  return fetchByQuery(query, category.kind === "comic" ? "novel" : category.kind, signal);
}

/** 抽一批候选：书架优先，其次是精选公版书与联网来源；重复的排在后面并标记出来。 */
export async function drawBooks(category: DrawCategory, count: number, signal?: AbortSignal): Promise<DrawCandidate[]> {
  const state = loadDrawState();
  const shelf = shelfCandidates(category);
  const seeds = PUBLIC_DOMAIN_SEEDS.filter((seed) => seed.categories.includes(category.id)).slice(0, 6);
  const resolved: DrawCandidate[] = [];
  for (const seed of seeds) {
    const items = await resolveSeed(seed, category, signal);
    if (items.length > 0) resolved.push(items[0]);
    if (resolved.length >= 8) break;
  }
  const remote: DrawCandidate[] = [];
  for (const query of category.queries.slice(0, 2)) {
    remote.push(...(await fetchByQuery(query, category.kind, signal)));
    if (remote.length >= 10) break;
  }

  const pool = [...shelf, ...resolved, ...remote];
  const shelfBookIds = new Set(loadBooks().map((book) => book.id));
  const drawnKeys = new Set(state.history.map((entry) => entry.toLowerCase()));
  const seen = new Set<string>();
  const unique: DrawCandidate[] = [];
  for (const item of pool) {
    const key = `${item.title}|${item.author ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const onShelf = item.book ? shelfBookIds.has(item.book.id) : false;
    unique.push({ ...item, duplicate: onShelf || drawnKeys.has(key) });
  }

  // 洗牌，但「没抽到过的」优先；重复的垫底（不隐藏，只是让新书更容易出现）
  const shuffled = [...unique].sort(() => Math.random() - 0.5);
  shuffled.sort((a, b) => Number(a.duplicate ?? false) - Number(b.duplicate ?? false));
  const rank: Record<DrawAvailability, number> = { shelf: 0, import: 1, preview: 2, recommend: 3 };
  const picked = shuffled.slice(0, count);
  picked.sort((a, b) => rank[a.availability] - rank[b.availability]);
  return picked;
}

// ── 钱包、每日免费、抽取记录、保底与重复保护 ──

export type DrawRecord = {
  id: string;
  categoryId: string;
  categoryLabel: string;
  count: number;
  cost: number;
  free: boolean;
  titles: string[];
  rarity: "calm" | "shimmer" | "burst";
  createdAt: string;
};

/**
 * 一次已结算（或正在结算）但还没出结果的抽取。
 * 先写挂单再扣费，扣费带上挂单 id；出结果后才清掉。
 * 这样重复点击、中途关闭、重试都只会接着这一单走，不会再扣一次。
 */
export type PendingDraw = {
  id: string;
  count: 1 | 5;
  cost: number;
  free: boolean;
  /** charging：已写挂单、扣费结果未确认；paid：已扣费（或免费）待出结果 */
  status: "charging" | "paid";
  createdAt: string;
};

/** 收藏的卡片：只是留个纪念，不等于买书，也不会把书加进书架。 */
export type SavedDrawCard = {
  key: string;
  title: string;
  author?: string;
  cover?: string;
  categoryLabel: string;
  savedAt: string;
};

/**
 * 最近一次开奖结果：出结果时就存下，返回 / 刷新后直接展示这一份，不会重新开奖。
 * 书架藏书只存 id（不把整本书塞进存储），读的时候再从书架取。
 */
export type DrawLastResult = {
  categoryId: string;
  candidates: DrawCandidate[];
  createdAt: string;
};

export type DrawState = {
  /** 上次用掉每日免费的日期（YYYY-MM-DD） */
  lastFreeOn: string | null;
  records: DrawRecord[];
  /** 抽到过的书名键，用于重复保护 */
  history: string[];
  /** 连续多少次五连抽没有新书（达到 2 次则下一次单抽免费，作为保底，不改概率） */
  dryStreak: number;
  pending: PendingDraw | null;
  savedCards: SavedDrawCard[];
  lastResult: DrawLastResult | null;
};

export const DEFAULT_DRAW_STATE: DrawState = {
  lastFreeOn: null,
  records: [],
  history: [],
  dryStreak: 0,
  pending: null,
  savedCards: [],
  lastResult: null,
};

/** 连续几次没抽到新书后，下一次单抽免费（保底，不改概率）。 */
export const PITY_STREAK = 2;

/** 单抽一次给几张候选：抽到分类后翻开这几张，由用户挑想读的一本。 */
export const CANDIDATES_PER_DRAW: Record<1 | 5, number> = { 1: 3, 5: 5 };

function parsePending(value: unknown): PendingDraw | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PendingDraw>;
  if (typeof item.id !== "string" || (item.count !== 1 && item.count !== 5)) return null;
  return {
    id: item.id,
    count: item.count,
    cost: typeof item.cost === "number" ? item.cost : 0,
    free: item.free === true,
    status: item.status === "charging" ? "charging" : "paid",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  };
}

function parseLastResult(value: unknown): DrawLastResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<DrawLastResult>;
  if (typeof item.categoryId !== "string" || !Array.isArray(item.candidates) || item.candidates.length === 0) return null;
  return {
    categoryId: item.categoryId,
    candidates: item.candidates.filter((c): c is DrawCandidate => !!c && typeof c === "object" && typeof c.title === "string"),
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  };
}

/** 存结果时去掉整本书对象，只留书架 id。 */
function slimCandidate(item: DrawCandidate): DrawCandidate {
  const { book, ...rest } = item;
  return book ? { ...rest, shelfBookId: book.id } : rest;
}

/** 取回书架藏书：结果里只存了 id，读的时候按 id 从书架找。 */
export function resolveCandidateBook(item: DrawCandidate): Book | undefined {
  if (item.book) return item.book;
  if (!item.shelfBookId) return undefined;
  return loadBooks().find((book) => book.id === item.shelfBookId);
}

/** 钱包里是不是已经有这一单的扣费记录（用挂单 id 关联）。 */
function chargedInWallet(drawId: string): boolean {
  return loadWalletState().transactions.some((item) => item.relatedOrderId === drawId);
}

export function loadDrawState(): DrawState {
  try {
    const raw = kvGet(DRAW_KEY);
    if (!raw) return { ...DEFAULT_DRAW_STATE };
    const parsed = JSON.parse(raw) as Partial<DrawState>;
    let pending = parsePending(parsed.pending);
    // 上次停在「扣费中」：以钱包流水为准，扣过就当已付，没扣就作废这单
    if (pending?.status === "charging") {
      pending = pending.free || chargedInWallet(pending.id) ? { ...pending, status: "paid" } : null;
    }
    return {
      lastFreeOn: typeof parsed.lastFreeOn === "string" ? parsed.lastFreeOn : null,
      records: Array.isArray(parsed.records) ? parsed.records : [],
      history: Array.isArray(parsed.history) ? parsed.history.filter((item): item is string => typeof item === "string") : [],
      dryStreak: typeof parsed.dryStreak === "number" ? parsed.dryStreak : 0,
      pending,
      savedCards: Array.isArray(parsed.savedCards) ? parsed.savedCards : [],
      lastResult: parseLastResult(parsed.lastResult),
    };
  } catch {
    return { ...DEFAULT_DRAW_STATE };
  }
}

export function saveDrawState(state: DrawState): void {
  kvSet(DRAW_KEY, JSON.stringify({ ...state, records: state.records.slice(0, 60), history: state.history.slice(-300) }));
}

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 今天还能不能用免费的一次。 */
export function hasFreeDraw(state: DrawState): boolean {
  return state.lastFreeOn !== todayKey();
}

export function walletBalance(): number {
  return getWalletBalance(loadWalletState());
}

export type DrawPayment = { ok: boolean; cost: number; free: boolean; resumed?: boolean; error?: string };

/** 这一次抽取要花多少（给界面做扣费确认用，不会真的扣）。 */
export function quoteDraw(state: DrawState, count: 1 | 5): { cost: number; free: boolean; reason?: "daily" | "pity" } {
  if (count === 1 && hasFreeDraw(state)) return { cost: 0, free: true, reason: "daily" };
  if (count === 1 && pityFreeAvailable(state)) return { cost: 0, free: true, reason: "pity" };
  return { cost: count === 5 ? DRAW_PRICE.five : DRAW_PRICE.single, free: false };
}

/**
 * 结算一次抽取（幂等）：
 *  - 已有未出结果的挂单 → 直接沿用，不再扣费；
 *  - 否则先写「扣费中」挂单，再带挂单 id 从统一钱包扣费，成功后标记已付；
 *  - 余额不足 → 撤掉挂单，不扣费、不开始抽取。
 */
export function beginDraw(state: DrawState, count: 1 | 5): { state: DrawState; payment: DrawPayment; pending: PendingDraw | null } {
  if (state.pending) {
    const { pending } = state;
    return { state, payment: { ok: true, cost: pending.cost, free: pending.free, resumed: true }, pending };
  }
  const quote = quoteDraw(state, count);
  const pending: PendingDraw = {
    id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    count,
    cost: quote.cost,
    free: quote.free,
    status: quote.free ? "paid" : "charging",
    createdAt: new Date().toISOString(),
  };
  let next: DrawState = {
    ...state,
    pending,
    lastFreeOn: quote.reason === "daily" ? todayKey() : state.lastFreeOn,
    // 用掉保底后计数归零，避免保底一直免费
    dryStreak: quote.reason === "pity" ? 0 : state.dryStreak,
  };
  saveDrawState(next);
  if (quote.free) return { state: next, payment: { ok: true, cost: 0, free: true }, pending };

  const result = payWithWalletBalance({
    amount: quote.cost,
    title: count === 5 ? "书房 · 抽一本（五连）" : "书房 · 抽一本（单抽）",
    detail: "书房抽一本：抽分类免费，抽书时扣费",
    category: "阅读",
    relatedOrderId: pending.id,
  });
  if (!result.ok) {
    next = { ...state };
    saveDrawState(next);
    return {
      state: next,
      payment: { ok: false, cost: quote.cost, free: false, error: result.error ?? "余额不足，无法抽取。" },
      pending: null,
    };
  }
  const paid: PendingDraw = { ...pending, status: "paid" };
  next = { ...next, pending: paid };
  saveDrawState(next);
  return { state: next, payment: { ok: true, cost: quote.cost, free: false }, pending: paid };
}

/** 抽到结果：写记录并结掉挂单。 */
export function finishDraw(
  state: DrawState,
  params: { category: DrawCategory; candidates: DrawCandidate[] },
): DrawState {
  const pending = state.pending;
  if (!pending) return state;
  const lastResult: DrawLastResult = {
    categoryId: params.category.id,
    candidates: params.candidates.map(slimCandidate),
    createdAt: new Date().toISOString(),
  };
  return recordDraw(
    { ...state, pending: null, lastResult },
    { category: params.category, candidates: params.candidates, count: pending.count, cost: pending.cost, free: pending.free },
  );
}

export function cardKey(item: { title: string; author?: string }): string {
  return `${item.title}|${item.author ?? ""}`.toLowerCase();
}

/** 收藏 / 取消收藏一张抽到的卡（只是纪念，不加书架、不算购买）。 */
export function toggleSavedCard(state: DrawState, item: DrawCandidate, categoryLabel: string): DrawState {
  const key = cardKey(item);
  const exists = state.savedCards.some((card) => card.key === key);
  const savedCards = exists
    ? state.savedCards.filter((card) => card.key !== key)
    : [
        { key, title: item.title, author: item.author, cover: item.cover, categoryLabel, savedAt: new Date().toISOString() },
        ...state.savedCards,
      ].slice(0, 120);
  const next = { ...state, savedCards };
  saveDrawState(next);
  return next;
}

/** 记录一次抽取：写入记录、更新重复保护用的历史，并维护「连续没抽到新书」的计数。 */
export function recordDraw(
  state: DrawState,
  params: { category: DrawCategory; candidates: DrawCandidate[]; count: 1 | 5; cost: number; free: boolean },
): DrawState {
  const newOnes = params.candidates.filter((item) => !item.duplicate);
  const rarity: DrawRecord["rarity"] = newOnes.length >= 4 ? "burst" : newOnes.length >= 2 ? "shimmer" : "calm";
  const record: DrawRecord = {
    id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    categoryId: params.category.id,
    categoryLabel: params.category.label,
    count: params.count,
    cost: params.cost,
    free: params.free,
    titles: params.candidates.map((item) => item.title),
    rarity,
    createdAt: new Date().toISOString(),
  };
  const history = [
    ...state.history,
    ...params.candidates.map((item) => `${item.title}|${item.author ?? ""}`.toLowerCase()),
  ];
  const dryStreak = newOnes.length === 0 ? state.dryStreak + 1 : 0;
  const next: DrawState = { ...state, records: [record, ...state.records], history, dryStreak };
  saveDrawState(next);
  return next;
}

/** 保底：连续两次什么都没抽到新书，下一次单抽免费（不改概率，只是不收费）。 */
export function pityFreeAvailable(state: DrawState): boolean {
  return state.dryStreak >= PITY_STREAK;
}

export function clearDrawHistory(): DrawState {
  // 只清记录；未出结果的已付挂单要留着，免得白扣
  const next: DrawState = { ...loadDrawState(), records: [], history: [], dryStreak: 0, lastResult: null };
  saveDrawState(next);
  return next;
}
