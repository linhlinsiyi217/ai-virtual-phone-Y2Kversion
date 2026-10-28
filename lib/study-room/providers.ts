// lib/study-room/providers.ts — 服务端书源提供者（仅服务器运行）。
// 通过站点自己的路由调用，避免浏览器 CORS 与密钥泄露；不包含任何私有密钥。
//
// 每个来源都明确三件事：参与检索的条件、面向它的检索词、以及结果的真实类型。
// 单个来源失败不影响其他来源，失败按来源维度回报（含可读的名称与原因）。

import type { BookKind, BookSearchResult, FailureKind, SearchFailure, SourceReport, SourceSearchParams } from "./book-source";
import { hasCJK, normalizeForMatch, classifyKind, classifyCategory, titleMatchScore } from "./book-source";
import { aliasAuthorsFor, authorsMatch, latinAliasesFor, zhAliasesFor } from "./aliases";

// 维基、Gutenberg 等公共接口要求 User-Agent 带可联系的网址，否则容易被限流或拒绝
const UA = "LinH-Float-StudyRoom/1.0 (https://float-0217.vercel.app; book search)";
const PROVIDER_TIMEOUT_MS = 8000;

type SearchContext = {
  /** 规范化后的用户查询（去标点、简体） */
  query: string;
  /** 面向英文/日文来源的别名检索词；没有则为 null */
  latin: string | null;
  /** 别名检索的作者约束（如 Jane Eyre → Brontë）；用户原词检索不受约束 */
  latinAuthors: string[] | null;
  /** 面向中文来源的别名检索词 */
  zh: string[];
  kind: BookKind | "all";
  limit: number;
};

/** 用别名词查到的结果，作者对不上就丢掉（「Call to Arms」不能刷出别人的同名书）。 */
function keepAliasHits(items: BookSearchResult[], ctx: SearchContext, viaAlias: boolean): BookSearchResult[] {
  if (!viaAlias || !ctx.latinAuthors) return items;
  return items.filter((item) => authorsMatch(item.authors, ctx.latinAuthors!));
}

type Provider = {
  id: string;
  label: string;
  /** 该来源在什么情况下值得参与检索（避免拿中文词去查只收英文的库） */
  supports: (ctx: SearchContext) => boolean;
  /** 返回结果；via 标注本次实际走的通道（如主接口失败后用了备用目录） */
  search: (ctx: SearchContext, signal: AbortSignal) => Promise<BookSearchResult[] | { items: BookSearchResult[]; via?: string }>;
};

/** 网络类错误重试一次（连接被拒/瞬时失败），HTTP 状态错误不重试。 */
async function fetchText(url: string, signal: AbortSignal, init?: RequestInit, accept = "application/json"): Promise<string> {
  const attempt = async () => {
    const response = await fetch(url, {
      ...init,
      signal,
      headers: { "User-Agent": UA, Accept: accept, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) throw new HttpError(response.status);
    return response.text();
  };
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof HttpError || signal.aborted) throw error;
    return attempt();
  }
}

async function fetchJson(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const text = await fetchText(url, signal, init);
  try {
    return JSON.parse(text);
  } catch {
    throw new ParseError();
  }
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

class ParseError extends Error {
  constructor() {
    super("来源返回的内容无法解析");
  }
}

/** 缺少密钥/配置导致的失败（例如 Google Books 公共额度用完且没有配置密钥）。 */
class ConfigError extends Error {}

/** 把异常归类成前端能区分的失败：超时、限流、HTTP 错误、配置缺失、解析失败、连不上。 */
function classifyFailure(error: unknown): { kind: FailureKind; reason: string; status?: number } {
  if (error instanceof ConfigError) return { kind: "config", reason: error.message };
  if (error instanceof ParseError) return { kind: "parse", reason: error.message };
  if (error instanceof HttpError) {
    if (error.status === 429) return { kind: "rate_limit", reason: "请求过多被限流", status: 429 };
    if (error.status === 401 || error.status === 403) return { kind: "http", reason: `来源拒绝访问（${error.status}）`, status: error.status };
    return { kind: "http", reason: `接口返回 ${error.status}`, status: error.status };
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return { kind: "timeout", reason: "响应超时" };
  return { kind: "network", reason: "网络不可达" };
}

function cjkLength(text: string): number {
  return normalizeForMatch(text).length;
}

// ── Open Library（书目元数据；中文书也能查到版本信息）──

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  language?: string[];
  subject?: string[];
};

async function openLibraryTerm(term: string, limit: number, signal: AbortSignal, author?: string): Promise<BookSearchResult[]> {
  const isLatin = !hasCJK(term);
  // 中文短词（如「简爱」两个字）用 q= 会被 Open Library 判为「查询过短」，改用 title=
  const useTitle = !isLatin && cjkLength(term) < 3;
  // 别名检索带上作者：title + author 精确得多
  const param = author
    ? `title=${encodeURIComponent(term)}&author=${encodeURIComponent(author)}`
    : useTitle ? `title=${encodeURIComponent(term)}` : `q=${encodeURIComponent(term)}`;
  const fields = "key,title,author_name,first_publish_year,cover_i,language,subject";
  const url = `https://openlibrary.org/search.json?${param}&limit=${limit}&fields=${fields}`;
  const data = (await fetchJson(url, signal)) as { docs?: OpenLibraryDoc[] };
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs
    .filter((doc) => doc.key && doc.title)
    .map<BookSearchResult>((doc) => {
      const kind = classifyKind(doc.subject?.join(" ")) ?? "novel";
      return {
        id: `openlibrary:${doc.key}`,
        sourceId: "openlibrary",
        sourceLabel: "Open Library",
        title: doc.title as string,
        authors: doc.author_name ?? [],
        cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
        year: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
        language: doc.language?.[0],
        kind,
        category: classifyCategory(doc.subject?.join(" "), "novel"),
        readability: "import",
        externalUrl: `https://openlibrary.org${doc.key}`,
        workKey: doc.title ? `ol:${normalizeForMatch(doc.title)}` : undefined,
      };
    });
}

const openLibrary: Provider = {
  id: "openlibrary",
  label: "Open Library",
  supports: (ctx) => ctx.kind !== "comic",
  async search(ctx, signal) {
    const [own, alias] = await Promise.all([
      openLibraryTerm(ctx.query, ctx.limit, signal),
      ctx.latin ? openLibraryTerm(ctx.latin, ctx.limit, signal, ctx.latinAuthors?.[0]) : Promise.resolve([]),
    ]);
    return [...own, ...keepAliasHits(alias, ctx, true)];
  },
};

// ── Google Books（中英文书目；部分可预览）──

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    language?: string;
    description?: string;
    categories?: string[];
    imageLinks?: { thumbnail?: string };
  };
  accessInfo?: { viewability?: string; previewLink?: string; webReaderLink?: string };
};

async function googleBooksTerm(term: string, limit: number, signal: AbortSignal, author?: string): Promise<BookSearchResult[]> {
  // 没有密钥时走公共额度，Vercel 出口 IP 共享额度经常 429；配置 GOOGLE_BOOKS_API_KEY 后使用自己的额度
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  const q = author ? `intitle:${term} inauthor:${author}` : term;
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(limit, 40)}&printType=books` +
    (key ? `&key=${encodeURIComponent(key)}` : "");
  let data: { items?: GoogleVolume[] };
  try {
    data = (await fetchJson(url, signal)) as { items?: GoogleVolume[] };
  } catch (error) {
    if (!key && error instanceof HttpError && error.status === 429) {
      throw new ConfigError("公共额度已用完（未配置 Google Books 密钥）");
    }
    throw error;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .filter((item) => item.id && item.volumeInfo?.title)
    .map<BookSearchResult>((item) => {
      const info = item.volumeInfo!;
      const access = item.accessInfo ?? {};
      const viewable = access.viewability === "ALL_PAGES" || access.viewability === "PARTIAL";
      const thumb = info.imageLinks?.thumbnail?.replace(/^http:/, "https:");
      return {
        id: `googlebooks:${item.id}`,
        sourceId: "googlebooks",
        sourceLabel: "Google Books",
        title: info.title as string,
        authors: info.authors ?? [],
        cover: thumb,
        year: info.publishedDate?.slice(0, 4),
        language: info.language,
        kind: classifyKind(info.categories?.join(" ")) ?? "novel",
        category: classifyCategory(info.categories?.join(" "), "novel"),
        readability: viewable ? "preview" : "import",
        externalUrl: access.webReaderLink || access.previewLink || `https://books.google.com/books?id=${item.id}`,
        description: info.description?.slice(0, 180),
        workKey: info.title ? `gb:${normalizeForMatch(info.title)}` : undefined,
      };
    });
}

const googleBooks: Provider = {
  id: "googlebooks",
  label: "Google Books",
  supports: () => true,
  async search(ctx, signal) {
    // 中文书名也带一个原名检索：两边的版本都值得看
    const [own, alias] = await Promise.all([
      googleBooksTerm(ctx.query, ctx.limit, signal),
      ctx.latin ? googleBooksTerm(ctx.latin, ctx.limit, signal, ctx.latinAuthors?.[0]) : Promise.resolve([]),
    ]);
    return [...own, ...keepAliasHits(alias, ctx, true)];
  },
};

// ── Project Gutenberg（可下载 txt/epub，导入书房后离线阅读；只收英文公版书）──

type GutendexBook = {
  id?: number;
  title?: string;
  authors?: { name?: string }[];
  languages?: string[];
  subjects?: string[];
  formats?: Record<string, string>;
};

const gutenberg: Provider = {
  id: "gutenberg",
  label: "Project Gutenberg",
  // 该库几乎只有英文作品：中文查询只有命中别名（如「简爱」→ Jane Eyre）时才值得查
  supports: (ctx) => ctx.kind !== "comic" && (!hasCJK(ctx.query) || Boolean(ctx.latin)),
  async search(ctx, signal) {
    const term = ctx.latin ?? ctx.query;
    const viaAlias = Boolean(ctx.latin);
    // Gutendex 是第三方公共实例，从 Vercel 访问实测返回 403、有时又很慢；
    // 只给它一半时间，失败或超时都改查 Gutenberg 官方 OPDS 目录
    try {
      const gutendexSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.round(PROVIDER_TIMEOUT_MS * 0.55))]);
      return { items: keepAliasHits(await gutendexSearch(term, ctx, gutendexSignal), ctx, viaAlias), via: "Gutendex" };
    } catch (error) {
      if (signal.aborted) throw error;
      const items = await gutenbergOpdsSearch(term, ctx, signal);
      return { items: keepAliasHits(items, ctx, viaAlias), via: "gutenberg.org 官方目录（Gutendex 不可用时的备用）" };
    }
  },
};

/** Gutenberg 官方 OPDS 检索（Atom XML）。加 l.en 只取英文本，语言标注才可靠。 */
async function gutenbergOpdsSearch(term: string, ctx: SearchContext, signal: AbortSignal): Promise<BookSearchResult[]> {
  const url = `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(`${term} l.en`)}`;
  const xml = await fetchText(url, signal, undefined, "application/atom+xml");
  if (!xml.includes("<feed")) throw new ParseError();
  const decode = (v: string) =>
    v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const out: BookSearchResult[] = [];
  for (const chunk of xml.split("<entry>").slice(1)) {
    const id = /<id>https?:\/\/www\.gutenberg\.org\/ebooks\/(\d+)\.opds<\/id>/.exec(chunk)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(chunk)?.[1];
    if (!id || !title) continue;
    const content = decode(/<content[^>]*>([^<]*)<\/content>/.exec(chunk)?.[1] ?? "");
    // content 是作者名；没有作者时站点会写下载次数，不能当作者
    const authors = content && !/downloads?$/i.test(content) ? [content] : [];
    out.push({
      id: `gutenberg:${id}`,
      sourceId: "gutenberg",
      sourceLabel: "Project Gutenberg",
      title: decode(title),
      authors,
      cover: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
      language: "en",
      kind: "novel",
      category: "classic",
      readability: "readable",
      externalUrl: `https://www.gutenberg.org/ebooks/${id}`,
      description: "英文原版（Project Gutenberg 公有领域电子书）",
      importFile: { url: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, format: "txt" },
      workKey: `gut:${normalizeForMatch(decode(title))}`,
    });
    if (out.length >= ctx.limit) break;
  }
  return out;
}

async function gutendexSearch(term: string, ctx: SearchContext, signal: AbortSignal): Promise<BookSearchResult[]> {
  {
    const url = `https://gutendex.com/books/?search=${encodeURIComponent(term)}`;
    const data = (await fetchJson(url, signal)) as { results?: GutendexBook[] };
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter((book) => book.id && book.title)
      .slice(0, ctx.limit)
      .map<BookSearchResult>((book) => {
        const formats = book.formats ?? {};
        const epub = formats["application/epub+zip"];
        const txt = Object.entries(formats).find(([type]) => type.startsWith("text/plain"))?.[1];
        const importFile = epub
          ? { url: epub, format: "epub" as const }
          : txt
            ? { url: txt, format: "txt" as const }
            : undefined;
        return {
          id: `gutenberg:${book.id}`,
          sourceId: "gutenberg",
          sourceLabel: "Project Gutenberg",
          title: book.title as string,
          authors: (book.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
          cover: formats["image/jpeg"],
          language: book.languages?.[0],
          kind: classifyKind(book.subjects?.join(" ")) ?? "novel",
          category: classifyCategory(book.subjects?.join(" "), "classic"),
          readability: importFile ? "readable" : "import",
          externalUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
          description: book.subjects?.slice(0, 3).join(" · "),
          importFile,
          workKey: book.title ? `gut:${normalizeForMatch(book.title)}` : undefined,
        };
      });
  }
}

// ── 中文维基文库（公版中文文本，跳转原站阅读）──
// 只保留「标题里真的有这个词」的页面，避免正文提到关键词的判决书、公告混进书单；
// 作者/主题类查询另走分类检索（如「鲁迅」→ Category:魯迅 下的作品）。

type WikiSearchItem = { title?: string; pageid?: number; snippet?: string };
type WikiPage = { title?: string; categories?: { title?: string }[] };

async function wikiApi(params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ format: "json", origin: "*", ...params });
  return (await fetchJson(`https://zh.wikisource.org/w/api.php?${query.toString()}`, signal)) as Record<string, unknown>;
}

const wikisource: Provider = {
  id: "wikisource",
  label: "中文维基文库",
  supports: (ctx) => hasCJK(ctx.query) || ctx.zh.length > 0,
  async search(ctx, signal) {
    const term = hasCJK(ctx.query) ? ctx.query : ctx.zh[0];
    if (!term) return [];
    // 前缀检索不做简繁转换：维基文库标题多为繁体（吶喊、紅樓夢），别名表里的繁体写法也查一次
    const traditional = ctx.zh.find((z) => hasCJK(z) && z !== term);

    const [prefix, prefixTrad, fulltext] = await Promise.all([
      wikiApi({ action: "query", list: "prefixsearch", pssearch: term, psnamespace: "0", pslimit: String(ctx.limit) }, signal),
      traditional
        ? wikiApi({ action: "query", list: "prefixsearch", pssearch: traditional, psnamespace: "0", pslimit: String(ctx.limit) }, signal)
        : Promise.resolve({} as Record<string, unknown>),
      wikiApi({ action: "query", list: "search", srsearch: term, srnamespace: "0", srlimit: String(ctx.limit) }, signal),
    ]);

    const prefixOf = (data: Record<string, unknown>) =>
      (data.query as { prefixsearch?: WikiSearchItem[] } | undefined)?.prefixsearch ?? [];
    const prefixItems = [...prefixOf(prefixTrad), ...prefixOf(prefix)];
    const searchItems = ((fulltext.query as { search?: WikiSearchItem[] } | undefined)?.search ?? []);

    const byTitle = new Map<string, WikiSearchItem>();
    for (const item of [...prefixItems, ...searchItems]) {
      if (item.title && !byTitle.has(item.title)) byTitle.set(item.title, item);
    }
    if (byTitle.size === 0) return [];

    // 取分类：既用于判定题材，也用于「作者/主题」检索
    const titles = Array.from(byTitle.keys()).slice(0, 20);
    const detail = await wikiApi(
      { action: "query", titles: titles.join("|"), prop: "categories", clshow: "!hidden", cllimit: "max" },
      signal,
    );
    const pages = (detail.query as { pages?: Record<string, WikiPage> } | undefined)?.pages ?? {};
    const categoriesOf = new Map<string, string[]>();
    for (const page of Object.values(pages)) {
      if (!page.title) continue;
      categoriesOf.set(page.title, (page.categories ?? []).map((c) => (c.title ?? "").replace(/^Category:/, "")));
    }

    const termKey = normalizeForMatch(term);
    const out: BookSearchResult[] = [];
    for (const [title, item] of byTitle) {
      // 「吶喊/孔乙己」这类子篇：整部作品已在结果里时不再单列（导入整部时会汇总各篇）
      const parent = title.includes("/") ? title.slice(0, title.lastIndexOf("/")) : null;
      if (parent && byTitle.has(parent)) continue;
      const categories = categoriesOf.get(title) ?? [];
      // 消歧义页只是一串链接，没有正文，不能标成全文可读
      if (/消歧[义義]/.test(title) || categories.some((c) => /消歧[义義]/.test(c))) continue;
      const snippet = (item.snippet ?? "").replace(/<[^>]+>/g, "").slice(0, 120);

      // 标题命中：这本书真的叫这个名字（「简爱」不会命中含「爱简」的判决书）
      const titleHit = titleMatchScore(title, term) > 0 || (traditional ? titleMatchScore(title, traditional) > 0 : false);
      // 分类命中：页面挂在以关键词命名的分类下（作者/主题检索，如 Category:魯迅）
      const categoryHit = categories.some((c) => normalizeForMatch(c) === termKey);
      if (!titleHit && !categoryHit) continue;

      const kind = classifyKind(`${title} ${categories.join(" ")}`) ?? "novel";
      const isMaterial = kind === "material";
      out.push({
        id: `wikisource:${title}`,
        sourceId: "wikisource",
        sourceLabel: "中文维基文库",
        title,
        // 维基文库页面没有结构化作者字段，不做猜测（宁可显示「佚名」）
        authors: [],
        language: "zh",
        kind,
        category: classifyCategory(`${title} ${categories.join(" ")}`, "classic"),
        readability: isMaterial ? "material" : "readable",
        // 公版正文可直接导入书房阅读；资料类不给阅读入口
        importFile: isMaterial ? undefined : { url: `/api/study-room/wikitext?title=${encodeURIComponent(title)}`, format: "txt" as const },
        externalUrl: `https://zh.wikisource.org/wiki/${encodeURIComponent(title)}`,
        description: titleHit ? snippet || categories.slice(0, 3).join(" · ") : `维基文库中收录于「${term}」分类的作品`,
        match: titleHit ? undefined : "author",
      });
    }
    return out;
  },
};

// ── MangaDex（真实漫画书目，支持中文名检索）──

type MangaDexManga = {
  id?: string;
  attributes?: {
    title?: Record<string, string>;
    altTitles?: Array<Record<string, string>>;
    year?: number;
    status?: string;
    originalLanguage?: string;
  };
  relationships?: Array<{ type?: string; attributes?: { fileName?: string; name?: string } }>;
};

const mangadex: Provider = {
  id: "mangadex",
  label: "MangaDex",
  supports: (ctx) => ctx.kind === "comic" || ctx.kind === "all",
  async search(ctx, signal) {
    const terms = [ctx.query, ...(ctx.latin ? [ctx.latin] : [])].slice(0, 2);
    const batches = await Promise.all(
      terms.map(async (term) => {
        const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(term)}&limit=${ctx.limit}&includes[]=cover_art&includes[]=author&order[relevance]=desc`;
        const data = (await fetchJson(url, signal)) as { data?: MangaDexManga[] };
        return Array.isArray(data.data) ? data.data : [];
      }),
    );
    const merged = new Map<string, MangaDexManga>();
    for (const item of batches.flat()) {
      if (item.id && !merged.has(item.id)) merged.set(item.id, item);
    }
    return Array.from(merged.values()).map<BookSearchResult>((item) => {
      const attrs = item.attributes ?? {};
      const zhAlt = (attrs.altTitles ?? []).find((t) => t.zh || t["zh-hk"])?.zh
        ?? (attrs.altTitles ?? []).find((t) => t["zh-hk"])?.["zh-hk"];
      const titles = Object.values(attrs.title ?? {}).filter(Boolean) as string[];
      const cover = item.relationships?.find((r) => r.type === "cover_art")?.attributes?.fileName;
      const authors = (item.relationships ?? []).filter((r) => r.type === "author").map((r) => r.attributes?.name ?? "").filter(Boolean);
      return {
        id: `mangadex:${item.id}`,
        sourceId: "mangadex",
        sourceLabel: "MangaDex",
        title: zhAlt || titles[0] || "(未署名)",
        authors,
        cover: cover && item.id ? `https://uploads.mangadex.org/covers/${item.id}/${cover}.256.jpg` : undefined,
        year: attrs.year ? String(attrs.year) : undefined,
        // 原作语言以来源字段为准，不再一律标成中文
        language: attrs.originalLanguage,
        kind: "comic",
        category: "comic",
        // 该站为粉丝翻译转载，不承诺正文可合法获取：只提供书目与原站跳转
        readability: "import",
        externalUrl: `https://mangadex.org/title/${item.id}`,
        description: titles.filter((t) => t !== zhAlt).slice(0, 2).join(" / "),
        workKey: titles[0] ? `manga:${normalizeForMatch(titles[0])}` : undefined,
      };
    });
  },
};

// ── AniList（漫画书目；检索以罗马字/英文为准）──

type AniListMedia = {
  id?: number;
  siteUrl?: string;
  isAdult?: boolean;
  title?: { native?: string; romaji?: string; english?: string };
  coverImage?: { medium?: string };
  staff?: { nodes?: Array<{ name?: { full?: string } }> };
};

const anilist: Provider = {
  id: "anilist",
  label: "AniList",
  // 只按罗马字/英文检索；纯中文查询没命中别名时跳过，别拿中文去打扰它
  supports: (ctx) => (ctx.kind === "comic" || ctx.kind === "all") && (!hasCJK(ctx.query) || Boolean(ctx.latin)),
  async search(ctx, signal) {
    const term = ctx.latin ?? ctx.query;
    const query = `query ($search: String) {
      Page(perPage: ${Math.min(ctx.limit, 20)}) {
        media(search: $search, type: MANGA) {
          id siteUrl isAdult title { native romaji english }
          coverImage { medium }
          staff(perPage: 1) { nodes { name { full } } }
        }
      }
    }`;
    const data = (await fetchJson("https://graphql.anilist.co", signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: term } }),
    })) as { data?: { Page?: { media?: AniListMedia[] } } };
    const media = data.data?.Page?.media ?? [];
    return media
      .filter((m) => m.id && !m.isAdult)
      .map<BookSearchResult>((m) => ({
        id: `anilist:${m.id}`,
        sourceId: "anilist",
        sourceLabel: "AniList",
        title: m.title?.english || m.title?.romaji || m.title?.native || "(未署名)",
        authors: (m.staff?.nodes ?? []).map((n) => n.name?.full ?? "").filter(Boolean),
        cover: m.coverImage?.medium,
        kind: "comic",
        category: "comic",
        readability: "import",
        externalUrl: m.siteUrl ?? `https://anilist.co/manga/${m.id}`,
        description: [m.title?.romaji, m.title?.native].filter((v) => v && v !== m.title?.english).join(" / "),
        workKey: m.title?.romaji ? `anilist:${normalizeForMatch(m.title.romaji)}` : undefined,
      }));
  },
};

const ALL: Provider[] = [openLibrary, googleBooks, gutenberg, wikisource, mangadex, anilist];

/**
 * 本次检索实际用到的词：用户原词在前，别名扩展词在后。
 * 返回给上层用于排序——别名命中的结果（如「简爱」→ Jane Eyre）同样算命中。
 */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  for (const term of [query, ...latinAliasesFor(query), ...zhAliasesFor(query)]) {
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

/** 按分类筛出该类别下真正相关的来源。 */
function providersFor(ctx: SearchContext): Provider[] {
  if (ctx.kind === "comic") return [mangadex, anilist];
  if (ctx.kind === "material") return [wikisource, googleBooks, openLibrary];
  if (ctx.kind === "novel") return [openLibrary, googleBooks, gutenberg, wikisource];
  return ALL.filter((provider) => provider.supports(ctx));
}

/**
 * 并行查询所有适用书源。单个来源失败不影响其他来源，
 * 每个来源的错误以 source 维度回报，便于前端提示。
 */
export async function searchAllSources(
  params: SourceSearchParams,
): Promise<{ results: BookSearchResult[]; failed: SearchFailure[]; sources: SourceReport[]; terms: string[] }> {
  const latin = latinAliasesFor(params.query)[0] ?? null;
  const ctx: SearchContext = {
    query: params.query,
    latin,
    latinAuthors: latin ? aliasAuthorsFor(params.query) : null,
    zh: zhAliasesFor(params.query),
    kind: params.kind,
    limit: params.limit,
  };
  const providers = providersFor(ctx);

  // 每个来源各自计时、各自超时，一个慢或失败不拖累其他来源
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const controller = new AbortController();
      const started = Date.now();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      try {
        const outcome = await provider.search(ctx, controller.signal);
        const { items, via } = Array.isArray(outcome) ? { items: outcome, via: undefined } : outcome;
        return { items, via, ms: Date.now() - started };
      } catch (error) {
        throw { error, ms: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const results: BookSearchResult[] = [];
  const failed: SearchFailure[] = [];
  const sources: SourceReport[] = [];
  settled.forEach((entry, index) => {
    const provider = providers[index];
    if (entry.status === "fulfilled") {
      results.push(...entry.value.items);
      sources.push({ id: provider.id, label: provider.label, ms: entry.value.ms, count: entry.value.items.length, ok: true, via: entry.value.via });
    } else {
      const { error, ms } = entry.reason as { error: unknown; ms: number };
      const failure = classifyFailure(error);
      failed.push({ id: provider.id, label: provider.label, ms, ...failure });
      sources.push({ id: provider.id, label: provider.label, ms, count: 0, ok: false });
    }
  });

  // 服务器日志只记来源名、耗时、条数与失败类别，不记录任何密钥或用户信息
  console.info(
    `[study-room/search] "${params.query}" ` +
      sources.map((s) => `${s.id}:${s.ok ? s.count : failed.find((f) => f.id === s.id)?.kind}/${s.ms}ms`).join(" "),
  );

  return { results, failed, sources, terms: searchTerms(params.query) };
}
