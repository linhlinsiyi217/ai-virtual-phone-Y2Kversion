"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Compass, RotateCw, Heart, BookOpen, Eye, Upload, ChevronDown, WifiOff, ServerCrash, SlidersHorizontal, Hourglass } from "lucide-react";

import {
  CATEGORY_LABEL,
  KIND_LABEL,
  READABILITY_LABEL,
  editionLanguageLabel,
  hasCJK,
  languageLabel,
  normalizeLanguage,
  type BookCategory,
  type BookKind,
  type BookSearchResult,
  type Readability,
  type SearchFailure,
} from "@/lib/study-room/book-source";
import { builtinToResult, listBuiltinBooks, searchBuiltinLibrary } from "@/lib/study-room/builtin-library";
import { groupVersions, type ResultGroup } from "@/lib/study-room/search-rank";
import { addToWishlist, loadWishlist, removeFromWishlist } from "@/lib/study-room/wishlist";
import type { Book } from "@/lib/reading-types";
import { StudyRoomSourceDetail } from "./study-room-source-detail";
import { HelpTip } from "./help-tip";

type KindFilter = BookKind | "all";

/** 搜哪里：决定去问哪些来源，换了会重新搜。 */
const KIND_CHIPS: Array<{ key: KindFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "novel", label: "小说" },
  { key: "comic", label: "漫画" },
  { key: "material", label: "资料" },
];

/** 分类按读者的习惯合并成几组，只显示这次结果里真有的组。 */
const CATEGORY_GROUPS: Array<{ key: string; label: string; cats: BookCategory[] }> = [
  { key: "literature", label: "文学", cats: ["novel", "classic", "poetry", "drama"] },
  { key: "comic", label: "漫画", cats: ["comic"] },
  { key: "humanities", label: "人文社科", cats: ["history", "philosophy", "psychology", "social", "biography"] },
  { key: "science", label: "科普", cats: ["science"] },
  { key: "reference", label: "工具资料", cats: ["reference"] },
];

const READ_ORDER: Readability[] = ["readable", "preview", "import"];

/** 书城搜索最长等多久；超过就算「没有响应」，不再干等 */
const SEARCH_TIMEOUT_MS = 25_000;

type Failure =
  /** 设备离线 */
  | { kind: "offline" }
  /** 发出去了但一直没有回音 */
  | { kind: "timeout" }
  /** 连书城服务都没连上（请求被拦、服务出错） */
  | { kind: "network" }
  /** 连上了，但所有书源都没响应 */
  | { kind: "sources"; failed: SearchFailure[] };

type StudyRoomStoreProps = {
  /** 导入或打开书架里的书 */
  onRead: (book: Book) => void;
  /** 从阅读器「搜索选中的文字」跳进来时带的关键词 */
  initialQuery?: string;
};

export function StudyRoomStore({ onRead, initialQuery }: StudyRoomStoreProps) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [group, setGroup] = useState<string>("all");
  const [readability, setReadability] = useState<Readability | "all">("all");
  const [source, setSource] = useState<string>("all");
  const [language, setLanguage] = useState<string>("all");
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [failedSources, setFailedSources] = useState<SearchFailure[]>([]);
  const [aliasNote, setAliasNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ item: BookSearchResult; versions: BookSearchResult[] } | null>(null);
  const [showMaterial, setShowMaterial] = useState(false);
  const [wished, setWished] = useState<Set<string>>(() => new Set(loadWishlist().map((item) => item.id)));

  // 新搜索取消旧请求，旧结果不能覆盖新结果
  const abortRef = useRef<AbortController | null>(null);

  const flash = (message: string, ms = 2400) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), ms);
  };

  const clearFilters = () => {
    setGroup("all");
    setReadability("all");
    setSource("all");
    setLanguage("all");
  };

  const runSearch = async (overrideQuery?: string, overrideKind?: KindFilter) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    const k = overrideKind ?? kind;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 内置书库在本地匹配，不依赖联网：联网来源全挂了也能给出这些书
    const builtin = k === "all" || k === "novel" ? searchBuiltinLibrary(q) : [];
    // 联网失败但内置书库有结果：照常列出内置书，失败原因放在提示行，而不是整页报错
    const fallBackToBuiltin = (reason: string) => {
      setResults(builtin);
      setFailedSources([{ id: "network", label: "联网书源", reason, kind: "network" }]);
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLastQuery(q);
      if (builtin.length > 0) {
        setFailure(null);
        fallBackToBuiltin("手机当前离线");
        return;
      }
      setResults([]);
      setFailure({ kind: "offline" });
      return;
    }
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEARCH_TIMEOUT_MS);

    setLoading(true);
    setFailure(null);
    setFailedSources([]);
    setAliasNote(null);
    setNotice(null);
    setLastQuery(q);
    clearFilters();
    try {
      const res = await fetch(`/api/study-room/search?q=${encodeURIComponent(q)}&kind=${k}`, {
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as
        | { results?: BookSearchResult[]; failed?: SearchFailure[]; alias?: string }
        | null;
      if (controller.signal.aborted) return;
      if (!data) throw new TypeError("bad response");
      const list = [...builtin, ...(data.results ?? [])];
      const failed = data.failed ?? [];
      setResults(list);
      setFailedSources(failed);
      setAliasNote(data.alias ?? null);
      // 一个结果都没有、且有来源失败：这是「书源没响应」，不是「没有这本书」
      if (list.length === 0 && (failed.length > 0 || !res.ok)) {
        setFailure({ kind: "sources", failed: failed.length > 0 ? failed : [{ id: "all", label: "全部来源", reason: `接口返回 ${res.status}` }] });
      }
    } catch (err) {
      if (timedOut && abortRef.current === controller) {
        if (builtin.length > 0) return fallBackToBuiltin(`等了 ${SEARCH_TIMEOUT_MS / 1000} 秒没有响应`);
        setResults([]);
        setFailure({ kind: "timeout" });
        return;
      }
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (builtin.length > 0) return fallBackToBuiltin("没连上书城服务");
      setResults([]);
      setFailure({ kind: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network" });
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === controller) setLoading(false);
    }
  };

  // 从阅读器带着关键词跳进来：自动填词并搜索一次
  useEffect(() => {
    const value = initialQuery?.trim();
    if (!value) return;
    setQuery(value);
    void runSearch(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const changeKind = (next: KindFilter) => {
    if (next === kind) return;
    setKind(next);
    // 已经搜过就按新范围重搜，免得结果和选中的范围对不上
    if (lastQuery) void runSearch(lastQuery, next);
  };

  const toggleWish = (item: BookSearchResult) => {
    const next = new Set(wished);
    if (next.has(item.id)) {
      removeFromWishlist(item.id);
      next.delete(item.id);
      flash("已从想读里移除");
    } else {
      addToWishlist(item);
      next.add(item.id);
      flash("已记在想读，可在「我的 → 想读的书」查看");
    }
    setWished(next);
  };

  const all = useMemo(() => results ?? [], [results]);
  const builtinBooks = useMemo(() => listBuiltinBooks(), []);

  // 筛选项只列这次结果里真有的，并带上数量
  const groupCounts = useMemo(
    () =>
      CATEGORY_GROUPS.map((g) => ({ ...g, count: all.filter((item) => item.category && g.cats.includes(item.category)).length })).filter(
        (g) => g.count > 0,
      ),
    [all],
  );
  const readCounts = useMemo(
    () => READ_ORDER.map((key) => ({ key, count: all.filter((item) => item.readability === key).length })).filter((r) => r.count > 0),
    [all],
  );
  const sources = useMemo(() => Array.from(new Set(all.map((item) => item.sourceLabel))), [all]);
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const item of all) {
      const code = normalizeLanguage(item.language);
      if (code) set.add(code);
    }
    return Array.from(set).slice(0, 6);
  }, [all]);

  const filtered = useMemo(() => {
    const cats = CATEGORY_GROUPS.find((g) => g.key === group)?.cats;
    return all.filter((item) => {
      if (cats && !(item.category && cats.includes(item.category))) return false;
      if (readability !== "all" && item.readability !== readability) return false;
      if (source !== "all" && item.sourceLabel !== source) return false;
      if (language !== "all" && normalizeLanguage(item.language) !== language) return false;
      return true;
    });
  }, [all, group, readability, source, language]);

  const filterActive = group !== "all" || readability !== "all" || source !== "all" || language !== "all";
  const showFilters = groupCounts.length > 1 || readCounts.length > 1 || sources.length > 1 || languages.length > 1;

  // 能读的在前，仅资料的收在下方「资料」区
  const mainGroups = useMemo(() => groupVersions(filtered.filter((item) => item.readability !== "material")), [filtered]);
  const materialGroups = useMemo(() => groupVersions(filtered.filter((item) => item.readability === "material")), [filtered]);

  const cardActions = (item: BookSearchResult) => (
    <>
      {item.readability === "readable" && (
        <button type="button" className="sr-res-btn sr-res-btn--primary" onClick={() => setDetail({ item, versions: [] })}>
          <BookOpen size={15} strokeWidth={1.8} />
          开始阅读
        </button>
      )}
      {item.readability === "preview" && (
        <button type="button" className="sr-res-btn sr-res-btn--primary" onClick={() => setDetail({ item, versions: [] })}>
          <Eye size={15} strokeWidth={1.8} />
          预览
        </button>
      )}
      {item.readability === "import" && (
        <button type="button" className="sr-res-btn" onClick={() => setDetail({ item, versions: [] })}>
          <Upload size={15} strokeWidth={1.8} />
          导入文件
        </button>
      )}
      <button
        type="button"
        className="sr-res-btn"
        data-active={wished.has(item.id) ? "true" : undefined}
        aria-pressed={wished.has(item.id)}
        onClick={() => toggleWish(item)}
      >
        <Heart size={15} strokeWidth={1.8} fill={wished.has(item.id) ? "currentColor" : "none"} />
        {wished.has(item.id) ? "已想读" : "想读"}
      </button>
    </>
  );

  const renderGroup = (entry: ResultGroup) => {
    const book = entry.leader;
    return (
      <div key={entry.key} className="sr-res-card">
        <div className="sr-res-cover" style={book.cover ? { backgroundImage: `url("${book.cover}")` } : undefined}>
          {!book.cover && book.title.slice(0, 1)}
        </div>
        <div className="sr-res-main">
          <button type="button" className="sr-res-title sr-res-title--link" onClick={() => setDetail({ item: book, versions: entry.versions })}>
            {book.title}
          </button>
          <div className="sr-res-meta">
            {book.authors.length > 0 ? book.authors.join(" / ") : "佚名"}
            {book.year ? ` · ${book.year}` : ""}
          </div>
          {book.description && <div className="sr-res-desc">{book.description}</div>}
          <div className="sr-res-tags">
            <span className={`sr-res-read sr-res-read--${book.readability}`}>{READABILITY_LABEL[book.readability]}</span>
            <span className="sr-res-source">{book.sourceLabel}</span>
            <span className="sr-res-kind">{book.category ? CATEGORY_LABEL[book.category] : KIND_LABEL[book.kind]}</span>
            {book.language && <span className="sr-res-kind">{editionLanguageLabel(book.language)}</span>}
            {entry.versions.length > 0 && (
              <button type="button" className="sr-res-more" onClick={() => setDetail({ item: book, versions: entry.versions })}>
                另 {entry.versions.length} 个版本
              </button>
            )}
          </div>
        </div>
        <div className="sr-res-actions">{cardActions(book)}</div>
      </div>
    );
  };

  const chip = (key: string, label: string, active: boolean, onClick: () => void, count?: number) => (
    <button key={key} type="button" className="sr-chip" data-active={active ? "true" : undefined} aria-pressed={active} onClick={onClick}>
      {label}
      {count !== undefined && <span className="sr-chip-count">{count}</span>}
    </button>
  );

  const hasResults = mainGroups.length > 0 || materialGroups.length > 0;
  const partialFailure = !failure && failedSources.length > 0 && all.length > 0;

  return (
    <div>
      <form
        className="sr-search"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <Search size={18} strokeWidth={1.6} color="var(--c-icon)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="书名、作者、译名都可以"
          aria-label="搜索书籍"
          enterKeyHint="search"
        />
        <button type="submit" className="sr-search-go" disabled={!query.trim()}>
          {loading ? <Loader2 size={16} className="sr-spin" /> : "搜索"}
        </button>
      </form>

      <div className="sr-chip-row" role="group" aria-label="搜索范围">
        {KIND_CHIPS.map((item) => chip(item.key, item.label, kind === item.key, () => changeKind(item.key)))}
      </div>

      {!loading && showFilters && (
        <details className="sr-filters" open={filterActive || undefined}>
          <summary>
            <SlidersHorizontal size={14} strokeWidth={1.7} />
            筛选结果
            {filterActive && <span className="sr-filters-on">已筛选 {filtered.length} / {all.length}</span>}
            <span className="sr-filters-help" onClick={(event) => event.preventDefault()}>
              <HelpTip id="store-filters" label="分类说明">
                文学 = 小说、名著、诗歌、戏剧；人文社科 = 历史、哲学、心理、社会、传记；
                漫画、科普、工具资料各自一组。只列出这次结果里有的分类，数字是条数。
              </HelpTip>
            </span>
          </summary>
          {groupCounts.length > 1 && (
            <div className="sr-filter-row">
              <span className="sr-filter-label">分类</span>
              <div className="sr-chip-row">
                {chip("all", "全部", group === "all", () => setGroup("all"))}
                {groupCounts.map((g) => chip(g.key, g.label, group === g.key, () => setGroup(g.key), g.count))}
              </div>
            </div>
          )}
          {readCounts.length > 1 && (
            <div className="sr-filter-row">
              <span className="sr-filter-label">能否阅读</span>
              <div className="sr-chip-row">
                {chip("all", "全部", readability === "all", () => setReadability("all"))}
                {readCounts.map((r) => chip(r.key, READABILITY_LABEL[r.key], readability === r.key, () => setReadability(r.key), r.count))}
              </div>
            </div>
          )}
          {sources.length > 1 && (
            <div className="sr-filter-row">
              <span className="sr-filter-label">来源</span>
              <div className="sr-chip-row">
                {chip("all", "全部", source === "all", () => setSource("all"))}
                {sources.map((item) => chip(item, item, source === item, () => setSource(item)))}
              </div>
            </div>
          )}
          {languages.length > 1 && (
            <div className="sr-filter-row">
              <span className="sr-filter-label">语言</span>
              <div className="sr-chip-row">
                {chip("all", "全部", language === "all", () => setLanguage("all"))}
                {languages.map((item) => chip(item, languageLabel(item), language === item, () => setLanguage(item)))}
              </div>
            </div>
          )}
        </details>
      )}

      {notice && (
        <div className="sr-note-card" role="status">
          <div className="sr-note-meta">{notice}</div>
        </div>
      )}

      {!loading && aliasNote && all.length > 0 && (
        <p className="sr-store-hint">已同时按「{aliasNote}」搜索</p>
      )}

      {!loading && partialFailure && (
        <p className="sr-store-hint">
          {failedSources.map((src) => (src.reason ? `${src.label}（${src.reason}）` : src.label)).join("、")}
          这次没有返回结果，下面是其它来源的结果
        </p>
      )}

      {!loading && failure?.kind === "offline" && (
        <div className="sr-store-state" role="alert">
          <WifiOff size={36} strokeWidth={1.2} />
          <strong>当前没有网络</strong>
          <p>手机处于离线状态，连上网络后再搜。</p>
          <button type="button" className="sr-btn" onClick={() => void runSearch(lastQuery)}>
            <RotateCw size={15} strokeWidth={1.8} /> 重新搜索
          </button>
        </div>
      )}

      {!loading && failure?.kind === "timeout" && (
        <div className="sr-store-state" role="alert">
          <Hourglass size={36} strokeWidth={1.2} />
          <strong>书城没有响应</strong>
          <p>等了 {SEARCH_TIMEOUT_MS / 1000} 秒还没有结果，可能是书源太慢，稍后再试。</p>
          <button type="button" className="sr-btn" onClick={() => void runSearch(lastQuery)}>
            <RotateCw size={15} strokeWidth={1.8} /> 重新搜索
          </button>
        </div>
      )}

      {!loading && failure?.kind === "network" && (
        <div className="sr-store-state" role="alert">
          <ServerCrash size={36} strokeWidth={1.2} />
          <strong>搜索失败</strong>
          <p>网络在线，但没连上书城服务，稍后再试。</p>
          <button type="button" className="sr-btn" onClick={() => void runSearch(lastQuery)}>
            <RotateCw size={15} strokeWidth={1.8} /> 重新搜索
          </button>
        </div>
      )}

      {!loading && failure?.kind === "sources" && (
        <div className="sr-store-state" role="alert">
          <ServerCrash size={36} strokeWidth={1.2} />
          <strong>书源暂时没有响应</strong>
          <p>
            {failure.failed.map((src) => `${src.label}：${src.reason ?? "暂时不可用"}`).join("；")}
            。不代表没有这本书，稍后再试。
          </p>
          <button type="button" className="sr-btn" onClick={() => void runSearch(lastQuery)}>
            <RotateCw size={15} strokeWidth={1.8} /> 重新搜索
          </button>
        </div>
      )}

      {loading && (
        <div className="sr-res-list" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="sr-res-card sr-skeleton-card" aria-hidden>
              <div className="sr-res-cover sr-skeleton" />
              <div className="sr-res-main">
                <div className="sr-skeleton sr-skeleton-line" style={{ width: "58%" }} />
                <div className="sr-skeleton sr-skeleton-line" style={{ width: "36%", marginTop: 8 }} />
                <div className="sr-skeleton sr-skeleton-line" style={{ width: "84%", marginTop: 10 }} />
              </div>
            </div>
          ))}
          <p className="sr-note-meta" style={{ textAlign: "center" }}>正在联网搜索…</p>
        </div>
      )}

      {!loading && !failure && results === null && (
        <div className="sr-store-state sr-store-state--idle">
          <Compass size={36} strokeWidth={1.1} />
          <p>中文名、原名或作者都能搜，比如「简爱」或「Jane Eyre」。</p>
        </div>
      )}

      {!loading && !failure && results === null && (
        <section aria-label="内置书库">
          <div className="sr-section-label">
            内置书库 · {builtinBooks.length} 本
            <HelpTip id="store-builtin" label="内置书库说明">
              公有领域中文名著，正文整理自中文维基文库原文（简体），随书房一起提供，不用等联网来源。
              每本都在详情里写明版本与来源链接。
            </HelpTip>
          </div>
          {/* 书封陈列：封面只排真实的书名 / 作者 / 年代（内置书没有扫描封面，不编造封面图） */}
          <ul className="sr-store-covers">
            {builtinBooks.map((book, index) => (
              <li key={book.id}>
                <button
                  type="button"
                  className="sr-store-cover-btn"
                  onClick={() => setDetail({ item: builtinToResult(book), versions: [] })}
                  aria-label={`${book.title}，${book.author}，${book.chapters} 章，约 ${Math.round(book.totalChars / 10000)} 万字`}
                >
                  <span className="sr-store-cover" data-tone={index % 4} aria-hidden>
                    <span className="sr-store-cover-title">{book.title}</span>
                    <span className="sr-store-cover-author">{book.author}</span>
                    <span className="sr-store-cover-era">{book.era}</span>
                  </span>
                  <span className="sr-store-cover-name">{book.title}</span>
                  <span className="sr-store-cover-meta">
                    {book.chapters} 章 · {Math.max(1, Math.round(book.totalChars / 10000))} 万字
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && !failure && results !== null && all.length === 0 && (
        <div className="sr-store-state">
          <Compass size={36} strokeWidth={1.1} />
          <strong>没有找到「{lastQuery}」</strong>
          <p>
            各来源都查过了，没有匹配的书。可以换成作者名或原名再试
            <HelpTip id="store-search" label="搜索小提示" placement="up">
              标点和繁简体不影响（「简爱」「简·爱」「Jane Eyre」都行）。漫画来源以日文原名、英文名为主；
              也可以在书架导入自己的 TXT / EPUB / PDF。
            </HelpTip>
          </p>
          {kind === "comic" && hasCJK(lastQuery) && <p>漫画试试原作名（如 ONE PIECE）。</p>}
        </div>
      )}

      {!loading && !failure && all.length > 0 && !hasResults && (
        <div className="sr-store-state">
          <p>当前筛选下没有结果（共 {all.length} 条）。</p>
          <button type="button" className="sr-btn" onClick={clearFilters}>
            清除筛选
          </button>
        </div>
      )}

      {!loading && !failure && mainGroups.length > 0 && (
        <div className="sr-res-list">
          <div className="sr-res-count">
            {mainGroups.length} 本 · 来自 {Array.from(new Set(mainGroups.map((entry) => entry.leader.sourceLabel))).join(" / ")}
          </div>
          {mainGroups.map(renderGroup)}
        </div>
      )}

      {!loading && !failure && materialGroups.length > 0 && (
        <div className="sr-res-list">
          <button type="button" className="sr-material-toggle" onClick={() => setShowMaterial((value) => !value)} aria-expanded={showMaterial}>
            <ChevronDown size={15} strokeWidth={1.8} style={{ transform: showMaterial ? "rotate(180deg)" : undefined }} />
            仅资料（{materialGroups.length}）
            <span className="sr-note-meta">没有正文，只有书目或公告</span>
          </button>
          {showMaterial && materialGroups.map(renderGroup)}
        </div>
      )}

      {!loading && !failure && hasResults && (
        <p className="sr-store-hint sr-store-hint--center">
          阅读状态按来源实际提供的内容标注
          <HelpTip id="readability" label="阅读状态说明" placement="up">
            全文可读 = 来源提供公版正文，导入后在书房里读；可预览 = 只能看来源给的部分内容；
            需本地导入 = 只有书目信息，要读需要你自己的文件；仅资料 = 公告、判决等没有正文的条目。
          </HelpTip>
        </p>
      )}

      {detail && (
        <StudyRoomSourceDetail
          item={detail.item}
          versions={detail.versions}
          onClose={() => setDetail(null)}
          onRead={(book) => {
            setDetail(null);
            onRead(book);
          }}
          onSwitch={(item) => setDetail({ item, versions: [] })}
        />
      )}
    </div>
  );
}
