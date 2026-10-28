// lib/study-room/builtin-library.ts — 书房内置书库：检索匹配、读取正文、加入书架。
//
// 正文是用 scripts/study-room/build-library.mjs 从中文维基文库原文整理的（不是模型生成），
// 随应用部署在 public/study-room/library/<id>/：manifest.json 记录来源与许可，
// part-NN.json 每份 20 章。这里不把正文打进 JS，只有用户真的要读时才按卷取下来。

import type { BookChapter } from "@/lib/reading-types";

import { aliasFor } from "./aliases";
import { normalizeForMatch, titleMatchScore, type BookSearchResult } from "./book-source";
import { BUILTIN_LIBRARY } from "./builtin-library.generated";

export type BuiltinBook = (typeof BUILTIN_LIBRARY)[number];

export const BUILTIN_SOURCE_ID = "builtin";
export const BUILTIN_SOURCE_LABEL = "内置书库";

type BuiltinManifest = {
  id: string;
  title: string;
  author: string;
  edition: string;
  source: { name: string; url: string };
  license: string;
  parts: number;
  chapters: string[];
};

const libraryPath = (id: string, file: string) => `/study-room/library/${id}/${file}`;

export function listBuiltinBooks(): BuiltinBook[] {
  return [...BUILTIN_LIBRARY];
}

export function findBuiltinBook(id: string): BuiltinBook | undefined {
  return BUILTIN_LIBRARY.find((book) => book.id === id);
}

/** 内置书 → 书城结果卡片（与联网结果同一种形状，标明「内置书库」）。 */
export function builtinToResult(book: BuiltinBook): BookSearchResult {
  return {
    id: `${BUILTIN_SOURCE_ID}:${book.id}`,
    sourceId: BUILTIN_SOURCE_ID,
    sourceLabel: BUILTIN_SOURCE_LABEL,
    title: book.title,
    authors: [book.author],
    year: book.era,
    language: "zh",
    kind: "novel",
    category: "classic",
    readability: "readable",
    externalUrl: book.sourceUrl,
    description: `${book.edition}。共 ${book.chapters} 章、约 ${Math.round(book.totalChars / 10000)} 万字；正文整理自中文维基文库（公有领域），简体。`,
    importFile: { url: book.id, format: "builtin" },
    workKey: `builtin:${book.id}`,
  };
}

/** 按书名、别名（含繁体）或作者匹配内置书；不联网，搜索失败时也能给出结果。 */
export function searchBuiltinLibrary(query: string): BookSearchResult[] {
  const q = normalizeForMatch(query);
  if (!q) return [];
  // 别名表里的同一作品（石头记 → 红楼梦、Journey to the West → 西游记）
  const aliasTitles = (aliasFor(query)?.entry.zh ?? []).map(normalizeForMatch);
  const scored: Array<{ book: BuiltinBook; score: number }> = [];
  for (const book of BUILTIN_LIBRARY) {
    const titleScore = Math.max(
      titleMatchScore(book.title, query),
      ...book.aliases.map((alias) => titleMatchScore(alias, query)),
    );
    const author = normalizeForMatch(book.author);
    const authorScore = author === q ? 60 : author.includes(q) && q.length >= 2 ? 40 : 0;
    const aliasScore = aliasTitles.includes(normalizeForMatch(book.title)) ? 90 : 0;
    const score = Math.max(titleScore, authorScore, aliasScore);
    if (score > 0) scored.push({ book, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(({ book }) => builtinToResult(book));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`内置书库文件读取失败（${response.status}）`);
  return (await response.json()) as T;
}

/** 取内置书的来源信息与全部章节（按卷文件依次取）。 */
export async function loadBuiltinBook(
  id: string,
  onProgress?: (stage: string) => void,
): Promise<{ manifest: BuiltinManifest; chapters: Array<{ title: string; paragraphs: string[] }> }> {
  const manifest = await fetchJson<BuiltinManifest>(libraryPath(id, "manifest.json"));
  const chapters: Array<{ title: string; paragraphs: string[] }> = [];
  for (let part = 1; part <= manifest.parts; part += 1) {
    onProgress?.(manifest.parts > 1 ? `正在取正文（${part}/${manifest.parts}）…` : "正在取正文…");
    chapters.push(...(await fetchJson<Array<{ title: string; paragraphs: string[] }>>(
      libraryPath(id, `part-${String(part).padStart(2, "0")}.json`),
    )));
  }
  if (chapters.length === 0) throw new Error("内置书库里这本书没有正文");
  return { manifest, chapters };
}

export function toBookChapters(bookId: string, chapters: Array<{ title: string; paragraphs: string[] }>): BookChapter[] {
  return chapters.map((chapter, index) => ({
    id: `${bookId}_ch${index}`,
    bookId,
    index,
    title: chapter.title,
    paragraphs: chapter.paragraphs,
  }));
}
