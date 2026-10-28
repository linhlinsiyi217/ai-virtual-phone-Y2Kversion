// lib/study-room/search-rank.ts — 搜索结果的去噪、分类约束与排序（纯函数，便于验证）。
//
// 书城搜索的口径都收在这里：
//  - 只有标题或作者命中关键词的条目才算「搜到了这本书」，正文里碰巧出现关键词的不进列表；
//  - 分类真正约束来源（选「小说」时法律判决、公告等资料类不出现在结果里）；
//  - 排序先看匹配强度，再看可读性（能直接在书房读的排前面）。

import {
  authorMatchScore,
  isLegalDocumentTitle,
  normalizeForMatch,
  titleMatchScore,
  type BookKind,
  type BookSearchResult,
  type SearchFailure,
} from "./book-source";

/**
 * 结果与检索词列表的最佳匹配。terms[0] 是用户原词，后面是别名扩展词；
 * 别名命中的结果（如「简爱」→ Jane Eyre）同样要保留，但排在原词命中之后。
 */
function bestMatch(result: BookSearchResult, terms: string[]): { match: "title" | "author"; score: number } | null {
  if (result.match) {
    const score = result.match === "author" ? 40 : 45;
    return { match: result.match, score };
  }
  let best: { match: "title" | "author"; score: number } | null = null;
  terms.forEach((term, index) => {
    // 直接用用户原词命中的排在别名命中之前
    const priority = index === 0 ? 4 : 0;
    const title = titleMatchScore(result.title, term);
    const author = authorMatchScore(result.authors, term);
    if (title > 0 && (!best || title + priority > best.score)) best = { match: "title", score: title + priority };
    if (author > 0 && (!best || author + priority > best.score)) best = { match: "author", score: author + priority };
  });
  return best;
}

/** 同一 id 只出现一次；不同来源的同名书保留（可读性与跳转不同）。 */
export function dedupeById(results: BookSearchResult[]): BookSearchResult[] {
  const seen = new Set<string>();
  const out: BookSearchResult[] = [];
  for (const item of results) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * 类别约束：
 *  - 小说：剔除被判为资料的条目（法律判决、公告等不再占据小说结果）
 *  - 漫画：只保留漫画来源
 *  - 资料：全部保留
 */
export function filterByKind(results: BookSearchResult[], kind: BookKind | "all"): BookSearchResult[] {
  const typed = results.map(markLegalDocument);
  // 资料类永远排在最后（不是删除）：先看能读的书，再往下才是资料
  if (kind === "novel") return typed.filter((r) => r.kind !== "material");
  if (kind === "comic") return typed.filter((r) => r.kind === "comic");
  if (kind === "all") {
    // 「全部」里：已经搜到真正的书时，标题碰巧含关键词的判决书等文书不再混进来；
    // 只剩文书时照常显示（有人就是要查这份文书），切到「资料」也一直能看到
    const hasBooks = typed.some((r) => r.kind !== "material");
    return hasBooks ? typed.filter((r) => !isLegalDocumentTitle(r.title)) : typed;
  }
  return typed;
}

/** 标题是法律文书的条目：不论来源怎么分类，一律按资料处理，不给阅读入口。 */
function markLegalDocument(result: BookSearchResult): BookSearchResult {
  if (!isLegalDocumentTitle(result.title)) return result;
  return { ...result, kind: "material", readability: "material", importFile: undefined };
}

/** 可读能力权重：能直接读的排最前，仅资料排最后（不删除，只是降级）。 */
const READABILITY_WEIGHT: Record<BookSearchResult["readability"], number> = {
  readable: 30,
  preview: 20,
  import: 8,
  material: 0,
};

function scoreOf(result: BookSearchResult, terms: string[]): number {
  const best = bestMatch(result, terms);
  if (!best) return 0;
  return best.score + READABILITY_WEIGHT[result.readability];
}

/** 同一本书的不同版本（来源/语言/年份不同）合成一组，进入详情再挑。 */
export type ResultGroup = {
  key: string;
  /** 代表条目：可读能力最好、匹配最强的那一条 */
  leader: BookSearchResult;
  /** 其余版本 */
  versions: BookSearchResult[];
};

export function groupVersions(results: BookSearchResult[]): ResultGroup[] {
  const map = new Map<string, BookSearchResult[]>();
  for (const item of results) {
    const key = `${normalizeForMatch(item.title)}|${normalizeForMatch(item.authors[0] ?? "")}`;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([key, list]) => {
    const sorted = [...list].sort((a, b) => READABILITY_WEIGHT[b.readability] - READABILITY_WEIGHT[a.readability]);
    return { key, leader: sorted[0], versions: sorted.slice(1) };
  });
}

/** 去噪 → 分类约束 → 排序 → 去重限量。terms[0] 为用户原词，其后为别名扩展词。 */
export function rankResults(
  results: BookSearchResult[],
  terms: string[],
  kind: BookKind | "all",
  max = 40,
): BookSearchResult[] {
  const ordered = filterByKind(results, kind)
    .map((item, index) => ({ item, index, score: scoreOf(item, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
  return dedupeById(ordered).slice(0, max);
}

/** 同一来源只报一条失败原因。 */
export function dedupeFailures(failed: SearchFailure[]): SearchFailure[] {
  const seen = new Map<string, SearchFailure>();
  for (const item of failed) if (!seen.has(item.id)) seen.set(item.id, item);
  return Array.from(seen.values());
}
