// app/api/study-room/search/route.ts — 书房书城：统一联网搜书入口。
// 所有外部请求都在服务端发起（避免浏览器 CORS），不包含任何私钥。
//
// 这里负责「把结果收干净」：只保留真正匹配书名/作者的结果，按分类约束来源，
// 排序后返回；单个来源失败只在 failed 里列出，不影响其他来源。

import { NextResponse } from "next/server";

import { searchAllSources } from "@/lib/study-room/providers";
import { normalizeQuery, toSimplified, type BookKind, type BookSearchResult, type SearchFailure, type SourceReport } from "@/lib/study-room/book-source";
import { dedupeFailures, rankResults } from "@/lib/study-room/search-rank";
import { aliasFor } from "@/lib/study-room/aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: Array<BookKind | "all"> = ["all", "novel", "comic", "material"];

type SearchResponse = {
  results: BookSearchResult[];
  failed: SearchFailure[];
  /** 每个来源本次的耗时与条数（排查用；不含密钥） */
  sources?: SourceReport[];
  query: string;
  /** 命中人工维护别名时，实际额外使用的检索词（用于给用户一句说明） */
  alias?: string;
};

/** 结果缓存：同一关键词反复搜索时不再打来源接口（来源大多有频率限制）。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 120;
const cache = new Map<string, { at: number; body: SearchResponse }>();

function cacheGet(key: string): SearchResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.body;
}

function cacheSet(key: string, body: SearchResponse): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), body });
}

async function runSearch(query: string, kind: BookKind | "all"): Promise<SearchResponse> {
  const { results, failed, sources, terms } = await searchAllSources({ query, kind, limit: 20 });
  return {
    results: rankResults(results, terms, kind),
    failed: dedupeFailures(failed),
    sources,
    query,
    alias: aliasFor(query)?.others[0],
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("q") ?? "").trim();
  const kindParam = searchParams.get("kind") ?? "all";
  const kind = (KINDS.includes(kindParam as BookKind | "all") ? kindParam : "all") as BookKind | "all";

  if (!raw) {
    return NextResponse.json({ results: [], failed: [], query: "" } satisfies SearchResponse);
  }

  const query = normalizeQuery(raw) || raw;
  const key = `${kind}:${query}`;
  const cached = cacheGet(key);
  if (cached) return NextResponse.json(cached);

  try {
    let payload = await runSearch(query, kind);

    // 繁简回退：一个结果都没有时用简体再试一次，提高中文命中率。
    if (payload.results.length === 0) {
      const simplified = toSimplified(query);
      if (simplified && simplified !== query) {
        const retry = await runSearch(simplified, kind);
        payload = {
          ...retry,
          query,
          failed: dedupeFailures([...payload.failed, ...retry.failed]),
          sources: [...(payload.sources ?? []), ...(retry.sources ?? [])],
        };
      }
    }

    // 来源都失败、一个结果也没有时不缓存，免得网络恢复后 5 分钟内还看到失败
    if (payload.results.length > 0 || payload.failed.length === 0) cacheSet(key, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[study-room/search]", error);
    return NextResponse.json(
      { results: [], failed: [{ id: "all", label: "全部来源", reason: "搜索服务暂时不可用", kind: "network" }], query },
      { status: 502 },
    );
  }
}
