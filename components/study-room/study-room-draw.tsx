"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BookOpen,
  ChevronLeft,
  Compass,
  Download,
  FastForward,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Wallet,
  X,
} from "lucide-react";

import { importSearchResult, SourceImportError } from "@/lib/study-room/import-result";
import { announceImported } from "@/lib/study-room/events";
import { HelpFoot, HelpTip } from "./help-tip";
import {
  AVAILABILITY_LABEL,
  CANDIDATES_PER_DRAW,
  DRAW_CATEGORIES,
  DRAW_PRICE,
  PITY_STREAK,
  beginDraw,
  cardKey,
  categoryById,
  clearDrawHistory,
  drawBooks,
  drawCategory,
  finishDraw,
  hasFreeDraw,
  loadDrawState,
  pityFreeAvailable,
  quoteDraw,
  resolveCandidateBook,
  saveDrawState,
  toggleSavedCard,
  walletBalance,
  type DrawCandidate,
  type DrawCategory,
  type DrawState,
} from "@/lib/study-room/draw";
import type { Book } from "@/lib/reading-types";
import type { BookSearchResult } from "@/lib/study-room/book-source";
import { StudyRoomSourceDetail } from "./study-room-source-detail";

type StudyRoomDrawProps = {
  onBack: () => void;
  onRead: (book: Book) => void;
  onImported: () => void;
};

/** 第一步抽分类，第二步在分类里抽候选书。 */
type Step = "category" | "books";
/** 舞台节奏：聚能 → 坍缩爆发 → 书卡落下 → 逐张翻开 → 落定 */
type Phase = "idle" | "charge" | "burst" | "backs" | "reveal" | "done";

const SKIP_KEY = "sr_draw_skip_animation";
const PARTICLES = Array.from({ length: 12 }, (_, index) => index);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * 抽一本：随机抽出分类 → 在该分类里抽几张候选书 → 结果面板里挑想读的一本。
 * 用的是小手机统一钱包；抽分类不收费，抽书时才扣费，扣费前先确认。
 * 扣费与结果按挂单幂等保存：重复点、中途关、重试都不会重复扣费；
 * 出结果就存档，返回或刷新后直接看上次结果，不会重新开奖。
 * 动画只表示这次的稀有感，不改变抽到什么；可以跳过，减少动态时只保留翻开这一步。
 */
export function StudyRoomDraw({ onBack, onRead, onImported }: StudyRoomDrawProps) {
  const [step, setStep] = useState<Step>("category");
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<DrawState>(() => loadDrawState());
  const [category, setCategory] = useState<DrawCategory | null>(null);
  const [candidates, setCandidates] = useState<DrawCandidate[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [selected, setSelected] = useState(0);
  const [confirming, setConfirming] = useState<1 | 5 | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookSearchResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [balance, setBalance] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const fastRef = useRef(false);
  const drawingRef = useRef(false);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    try {
      setSkipAnimation(window.localStorage.getItem(SKIP_KEY) === "1");
    } catch {
      /* 读不到偏好就按默认 */
    }
    setBalance(walletBalance());
    if (loadDrawState().pending) {
      setNotice("上次有一次已结算的抽取还没出结果，再抽书会沿用那一次，不会再扣费。");
    }
    return () => {
      runRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const flash = (message: string, ms = 2800) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), ms);
  };

  const toggleSkip = () => {
    setSkipAnimation((value) => {
      try {
        window.localStorage.setItem(SKIP_KEY, value ? "0" : "1");
      } catch {
        /* 存不了就只在本次生效 */
      }
      return !value;
    });
  };

  /** 等一段动画时间；被打断（离开、重新开始）返回 false。跳过 / 快速揭晓时立即返回。 */
  const pause = (ms: number, run: number) =>
    new Promise<boolean>((resolve) => {
      const wait = fastRef.current ? 0 : reduced ? Math.min(ms, 160) : ms;
      if (wait <= 0) {
        resolve(runRef.current === run);
        return;
      }
      window.setTimeout(() => resolve(runRef.current === run), wait);
    });

  /**
   * 播放一轮：结果由 work 决定（动画开始前或同时就定了），动画只负责展示。
   * 跳过 / 全部翻开只是少等，不会重新抽，也不会再扣费。
   */
  const play = async <T,>(work: Promise<T>, onResult: (result: T) => number): Promise<boolean> => {
    const run = ++runRef.current;
    fastRef.current = skipAnimation;
    setRevealed(0);
    setSelected(0);
    setPhase("charge");
    const [result] = await Promise.all([work, pause(1100, run)]);
    if (runRef.current !== run) return false;
    const count = onResult(result);
    if (count <= 0) {
      setPhase("idle");
      return false;
    }
    setPhase("burst");
    if (!(await pause(480, run))) return false;
    setPhase("backs");
    if (!(await pause(420, run))) return false;
    setPhase("reveal");
    for (let index = 1; index <= count; index += 1) {
      setRevealed(index);
      if (!(await pause(index === count ? 560 : 400, run))) return false;
    }
    setPhase("done");
    return true;
  };

  /** 跳过：剩下的卡一次翻开（结果早已确定）。 */
  const revealAll = () => {
    fastRef.current = true;
    setRevealed(step === "category" ? 1 : candidates.length);
  };

  /** 第一步：随机抽分类（免费）。 */
  const drawCategoryCard = async () => {
    if (drawingRef.current) return;
    drawingRef.current = true;
    setStep("category");
    setCandidates([]);
    setShowResult(false);
    try {
      const pick = drawCategory();
      await play(Promise.resolve(pick), (value) => {
        setCategory(value);
        return 1;
      });
    } finally {
      drawingRef.current = false;
    }
  };

  const goToBooks = () => {
    setStep("books");
    setPhase("idle");
    setCandidates([]);
    setShowResult(false);
  };

  /** 点了抽书：要收费就先确认（余额不足也在确认面板里讲清楚）；免费或沿用已付的那一次直接开始。 */
  const requestDraw = (count: 1 | 5) => {
    if (drawingRef.current || confirming) return;
    const current = loadDrawState();
    setBalance(walletBalance());
    if (current.pending || quoteDraw(current, count).free) {
      void runDraw(count);
      return;
    }
    setConfirming(count);
  };

  /** 第二步：结算（幂等）→ 抽候选 → 揭晓 → 结果面板。 */
  const runDraw = async (count: 1 | 5) => {
    if (!category || drawingRef.current) return;
    drawingRef.current = true;
    setConfirming(null);
    setShowResult(false);
    try {
      const { state: settled, payment, pending } = beginDraw(loadDrawState(), count);
      setState(settled);
      setBalance(walletBalance());
      if (!payment.ok || !pending) {
        flash(`${payment.error ?? "余额不足，无法抽取。"}没有扣费，也没有开始抽取。`, 3600);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setCandidates([]);
      setStep("books");
      const work = drawBooks(category, CANDIDATES_PER_DRAW[pending.count], controller.signal).catch(() => [] as DrawCandidate[]);
      let got = false;
      const finished = await play(work, (result) => {
        if (controller.signal.aborted) return 0;
        if (result.length === 0) {
          flash(
            `「${category.label}」这次没抽到能读的书（书架里没有相关的，公开来源也没返回可导入或可预览的版本）。` +
              "已结算的这一次保留着：重试或换一类都不会再扣费。",
            5200,
          );
          return 0;
        }
        setCandidates(result);
        // 结果一出来就入账、存档并结掉挂单：之后返回 / 刷新只会看到这份结果，不会重复扣费或重新开奖
        setState(finishDraw(loadDrawState(), { category, candidates: result }));
        got = true;
        if (payment.resumed) flash("沿用了上次已结算的那一次，没有再扣费");
        else if (payment.free) flash("这次免费，没有扣余额");
        else flash(`已从钱包扣 ${payment.cost}`);
        return result.length;
      });
      if (!got) setPhase("idle");
      if (finished) setShowResult(true);
    } finally {
      drawingRef.current = false;
      setBalance(walletBalance());
    }
  };

  /** 看上次结果：直接摆出已存档的那一份，不扣费、不重新开奖。 */
  const openLastResult = () => {
    const last = state.lastResult;
    const lastCategory = last ? categoryById(last.categoryId) : null;
    if (!last || !lastCategory || drawingRef.current) return;
    runRef.current += 1;
    setCategory(lastCategory);
    setCandidates(last.candidates);
    setStep("books");
    setRevealed(last.candidates.length);
    setSelected(0);
    setPhase("done");
    setShowResult(true);
  };

  const handleImport = async (item: DrawCandidate) => {
    if (!item.importFile || importingId) return;
    setImportingId(item.id);
    try {
      // 抽到的书和书城同一条导入路径：内置书库读本地整理好的正文，已在书架的不再新建
      const result: BookSearchResult = item.raw ?? {
        id: item.id,
        sourceId: "draw",
        sourceLabel: item.sourceLabel ?? "",
        title: item.title,
        authors: item.author ? [item.author] : [],
        cover: item.cover,
        kind: "novel",
        readability: "readable",
        externalUrl: item.externalUrl ?? item.importFile.url,
        importFile: item.importFile,
      };
      const { existed } = await importSearchResult(result);
      if (existed) {
        flash(`《${item.title}》已经在书架上了。`, 3200);
        onImported();
        return;
      }
      flash(`《${item.title}》已加入书架，可以开始读了。`, 3200);
      announceImported(item.title);
      onImported();
    } catch (error) {
      flash(error instanceof SourceImportError ? error.message : "导入失败，请稍后重试；也可以先点「详情」在原站看看。", 3600);
    } finally {
      setImportingId(null);
    }
  };

  const readCandidate = (item: DrawCandidate) => {
    const book = resolveCandidateBook(item);
    if (book) onRead(book);
    else flash("这本书已经不在书架里了，可以重新导入。", 3000);
  };

  const free = hasFreeDraw(state);
  const pity = pityFreeAvailable(state);
  const animating = phase !== "idle" && phase !== "done";
  const newCount = candidates.filter((item) => !item.duplicate).length;
  const rarity = newCount >= 4 ? "burst" : newCount >= 2 ? "shimmer" : "calm";
  const confirmQuote = confirming ? quoteDraw(state, confirming) : null;
  const shortOf = confirmQuote ? Math.max(0, confirmQuote.cost - balance) : 0;
  const singleQuote = quoteDraw(state, 1);
  const singleLabel = state.pending ? "已结算" : singleQuote.free ? "免费" : `${singleQuote.cost} 币`;
  const fiveLabel = state.pending ? "已结算" : `${DRAW_PRICE.five} 币`;
  const cantAffordSingle = !state.pending && !singleQuote.free && balance < singleQuote.cost;
  const cantAffordFive = !state.pending && balance < DRAW_PRICE.five;
  const hasResult = step === "books" && phase === "done" && candidates.length > 0;

  return (
    <section className="sr-app sr-gacha">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button
            type="button"
            className="sr-icon-btn"
            onClick={() => {
              if (step === "books" && !animating) {
                setStep("category");
                setShowResult(false);
                setPhase(category ? "done" : "idle");
              } else onBack();
            }}
            aria-label={step === "books" ? "返回分类" : "返回书房"}
          >
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">抽一本</div>
          </div>
          <button type="button" className="sr-icon-btn" onClick={() => setShowHistory(true)} aria-label="抽取记录" title="抽取记录">
            <History size={20} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <div className="sr-gacha-body">
        {/* ① 顶部：紧凑余额 + 规则入口 */}
        <div className="sr-gacha-top">
          <span className="sr-gacha-wallet">
            <Wallet size={15} strokeWidth={1.7} />
            <span className="sr-gacha-wallet-num">{balance.toFixed(2)}</span>
            <span className="sr-gacha-wallet-unit">币</span>
          </span>
          <span className="sr-gacha-step">
            {step === "category" ? "① 抽分类 · 免费" : `② 在「${category?.label ?? ""}」里抽书`}
          </span>
          <HelpTip id="draw-wallet" label="抽卡规则：怎么收费、概率是多少">
            用的是小手机统一的虚拟钱包（和钱包应用里同一笔余额，不是真钱，也不另造币）。
            抽分类不收费；抽书时才扣费：单抽 {DRAW_PRICE.single} 币（翻开 {CANDIDATES_PER_DRAW[1]} 张候选），
            五连 {DRAW_PRICE.five} 币（翻开 {CANDIDATES_PER_DRAW[5]} 张）。每天第一次单抽免费；连续 {PITY_STREAK} 次没抽到新书，下一次单抽免费。
            扣费前会先确认；余额不足不扣费、不开始。扣费后中途关掉，下次再抽会沿用这一次，不会重复扣；出了结果就存档，返回或刷新不会重新开奖。
            概率：{DRAW_CATEGORIES.length} 个分类各占 1/{DRAW_CATEGORIES.length}；候选书在该分类里随机，没抽到过的优先，
            重复的垫底并标出来。光效只看这次有几本新书，和书的好坏无关，也不影响抽到什么。
          </HelpTip>
          {state.lastResult && !hasResult && !animating && (
            <button type="button" className="sr-gacha-last" onClick={openLastResult}>
              上次结果
            </button>
          )}
        </div>

        <p className="sr-gacha-notice" role="status" aria-live="polite">
          {notice ?? ""}
        </p>

        {/* ② 中间：书形卡牌舞台（纯白底，动效只在这一块） */}
        <div
          className="sr-gacha-stage"
          data-phase={phase}
          data-step={step}
          data-rarity={step === "books" && phase !== "idle" ? rarity : undefined}
          data-reduced={reduced ? "true" : undefined}
        >
          <span className="sr-gacha-floor" aria-hidden />
          <span className="sr-gacha-aura" aria-hidden />
          <span className="sr-gacha-core" aria-hidden />
          <span className="sr-gacha-particles" aria-hidden>
            {PARTICLES.map((index) => (
              <i key={index} style={{ "--a": `${(360 / PARTICLES.length) * index}deg`, "--d": `${(index % 3) * 40}ms` } as CSSProperties} />
            ))}
          </span>

          {phase === "idle" && (
            <div className="sr-gacha-idle">
              {step === "category" ? (
                <div className="sr-gacha-fan" aria-hidden>
                  {DRAW_CATEGORIES.slice(0, 5).map((item, index) => (
                    <span key={item.id} className="sr-gbook sr-gbook--back" style={{ "--i": index, "--accent": item.accent } as CSSProperties}>
                      <span className="sr-gbook-mark">书</span>
                    </span>
                  ))}
                </div>
              ) : (
                category && (
                  <span className="sr-gbook sr-gbook--front sr-gacha-solo" style={{ "--accent": category.accent } as CSSProperties}>
                    <CategoryFace category={category} />
                  </span>
                )
              )}
            </div>
          )}

          {phase === "charge" && (
            <div className="sr-gacha-charge-text">{step === "category" ? "洗牌中…" : "正在从书架与公开来源里抽…"}</div>
          )}

          {(phase === "backs" || phase === "reveal" || phase === "done") && (
            <div className="sr-gacha-slots" data-count={step === "category" ? 1 : candidates.length}>
              {step === "category" && category ? (
                <FlipCard index={0} flipped={revealed >= 1} kind="category" accent={category.accent}>
                  <CategoryFace category={category} />
                </FlipCard>
              ) : (
                candidates.map((item, index) => (
                  <FlipCard
                    key={item.id}
                    index={index}
                    flipped={revealed > index}
                    kind="book"
                    selected={phase === "done" && selected === index}
                    onSelect={
                      phase === "done"
                        ? () => {
                            setSelected(index);
                            setShowResult(true);
                          }
                        : undefined
                    }
                    label={`查看《${item.title}》`}
                  >
                    <BookFace item={item} />
                  </FlipCard>
                ))
              )}
            </div>
          )}

          {animating && (
            <button type="button" className="sr-gacha-skip" onClick={revealAll}>
              <FastForward size={14} strokeWidth={1.8} />
              {phase === "charge" || phase === "burst" ? "跳过动画" : "全部翻开"}
            </button>
          )}
        </div>

        {/* ③ 底部：单抽 / 多抽与明确费用 */}
        <div className="sr-gacha-bar">
          {step === "category" ? (
            phase === "done" && category ? (
              <div className="sr-gacha-btns">
                <button type="button" className="sr-btn sr-gacha-btn" onClick={() => void drawCategoryCard()}>
                  <RefreshCw size={15} strokeWidth={1.7} />
                  重抽分类
                </button>
                <button type="button" className="sr-btn sr-btn-primary sr-gacha-btn" onClick={goToBooks}>
                  <BookOpen size={16} strokeWidth={1.7} />
                  就这一类，去抽书
                </button>
              </div>
            ) : (
              <div className="sr-gacha-btns">
                <button
                  type="button"
                  className="sr-btn sr-btn-primary sr-gacha-btn sr-gacha-btn--wide"
                  onClick={() => void drawCategoryCard()}
                  disabled={animating}
                >
                  <Layers size={16} strokeWidth={1.7} />
                  抽分类卡
                  <span className="sr-gacha-cost">免费</span>
                </button>
              </div>
            )
          ) : hasResult ? (
            <div className="sr-gacha-btns">
              <button
                type="button"
                className="sr-btn sr-gacha-btn"
                onClick={() => {
                  setStep("category");
                  setPhase("idle");
                  setCandidates([]);
                  setShowResult(false);
                }}
              >
                <RefreshCw size={15} strokeWidth={1.7} />
                换一类
              </button>
              <button type="button" className="sr-btn sr-btn-primary sr-gacha-btn" onClick={() => setShowResult(true)}>
                <BookOpen size={16} strokeWidth={1.7} />
                查看结果
              </button>
            </div>
          ) : (
            <div className="sr-gacha-btns">
              <button
                type="button"
                className="sr-btn sr-gacha-btn"
                onClick={() => requestDraw(5)}
                disabled={animating}
                aria-describedby="sr-gacha-hint"
              >
                <Layers size={15} strokeWidth={1.7} />
                五连
                <span className="sr-gacha-cost">{fiveLabel}</span>
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-primary sr-gacha-btn"
                onClick={() => requestDraw(1)}
                disabled={animating}
                aria-describedby="sr-gacha-hint"
              >
                {animating ? <Loader2 size={15} className="sr-spin" /> : <Sparkles size={15} strokeWidth={1.7} />}
                单抽
                <span className="sr-gacha-cost">{singleLabel}</span>
              </button>
            </div>
          )}
          <div className="sr-gacha-foot">
            <span id="sr-gacha-hint" className="sr-gacha-hint">
              {step === "books" && !hasResult
                ? cantAffordSingle && cantAffordFive
                  ? `余额不足：单抽需要 ${DRAW_PRICE.single} 币`
                  : free
                    ? "今日首次单抽免费"
                    : pity
                      ? "保底：这次单抽免费"
                      : `单抽翻 ${CANDIDATES_PER_DRAW[1]} 张 · 五连翻 ${CANDIDATES_PER_DRAW[5]} 张`
                : "抽分类免费，抽书才扣费"}
            </span>
            <button type="button" className="sr-chip sr-gacha-skipchip" data-active={skipAnimation ? "true" : undefined} onClick={toggleSkip} aria-pressed={skipAnimation}>
              跳过动画
            </button>
          </div>
        </div>
      </div>

      {/* 扣费确认：余额不足在这里讲清楚，不扣费 */}
      {confirming && confirmQuote && (
        <DrawSheet label="确认抽书" onClose={() => setConfirming(null)}>
          <div className="sr-gacha-sheet-title">确认{confirming === 5 ? "五连" : "单抽"}</div>
          {shortOf > 0 ? (
            <p className="sr-gacha-sheet-text">
              这次需要 <strong>{confirmQuote.cost}</strong> 币，当前余额 {balance.toFixed(2)}，还差 {shortOf.toFixed(2)}。
              余额不足，不会扣费，也不会开始抽取。可以先去钱包应用里补一些虚拟币。
            </p>
          ) : (
            <p className="sr-gacha-sheet-text">
              将从钱包扣 <strong>{confirmQuote.cost}</strong> 币（当前余额 {balance.toFixed(2)}），翻开 {CANDIDATES_PER_DRAW[confirming]} 张候选。
              扣费后即使中途关掉，下次也会沿用这一次，不会重复扣。
            </p>
          )}
          <div className="sr-sheet-actions">
            <button type="button" className="sr-btn" onClick={() => setConfirming(null)} style={{ flex: 1 }}>
              取消
            </button>
            <button
              type="button"
              className="sr-btn sr-btn-primary"
              style={{ flex: 1 }}
              onClick={() => void runDraw(confirming)}
              disabled={shortOf > 0}
              autoFocus
            >
              {shortOf > 0 ? "余额不足" : `确认，扣 ${confirmQuote.cost}`}
            </button>
          </div>
        </DrawSheet>
      )}

      {/* 结果面板：书封、书名、来源、阅读入口 */}
      {showResult && hasResult && category && (
        <DrawSheet label={`抽到的书，${category.label}`} onClose={() => setShowResult(false)} tall>
          <div className="sr-gacha-sheet-head">
            <span className="sr-gacha-sheet-title">这次抽到 · {category.label}</span>
            <button type="button" className="sr-icon-btn" onClick={() => setShowResult(false)} aria-label="关闭结果">
              <X size={20} strokeWidth={1.7} />
            </button>
          </div>
          <ul className="sr-gacha-results">
            {candidates.map((item, index) => {
              const open = selected === index;
              const saved = state.savedCards.some((card) => card.key === cardKey(item));
              return (
                <li key={item.id} className="sr-gacha-result" data-open={open ? "true" : undefined}>
                  <button type="button" className="sr-gacha-result-row" onClick={() => setSelected(index)} aria-expanded={open}>
                    <span className="sr-gacha-result-cover" aria-hidden>
                      {item.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.cover} alt="" loading="lazy" />
                      ) : (
                        <span>{(item.title || "书").slice(0, 1)}</span>
                      )}
                    </span>
                    <span className="sr-gacha-result-main">
                      <span className="sr-gacha-result-title">{item.title}</span>
                      <span className="sr-gacha-result-meta">
                        {[item.author || "佚名", item.sourceLabel].filter(Boolean).join(" · ")}
                      </span>
                      <span className="sr-gacha-result-tags">
                        <span className="sr-draw-badge" data-kind={item.availability}>
                          {AVAILABILITY_LABEL[item.availability]}
                        </span>
                        {item.duplicate ? (
                          <span className="sr-draw-badge" data-kind="duplicate">抽到过</span>
                        ) : (
                          <span className="sr-draw-badge" data-kind="new">新</span>
                        )}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="sr-gacha-result-more">
                      {item.description && <p className="sr-draw-desc">{item.description}</p>}
                      <div className="sr-gacha-result-actions">
                        {item.availability === "shelf" && (
                          <button type="button" className="sr-btn sr-btn-primary sr-btn-sm" onClick={() => readCandidate(item)}>
                            <BookOpen size={14} strokeWidth={1.8} />
                            开始阅读
                          </button>
                        )}
                        {item.availability === "import" && (
                          <button
                            type="button"
                            className="sr-btn sr-btn-primary sr-btn-sm"
                            onClick={() => void handleImport(item)}
                            disabled={importingId !== null}
                          >
                            {importingId === item.id ? <Loader2 size={14} className="sr-spin" /> : <Download size={14} strokeWidth={1.8} />}
                            加入书架
                          </button>
                        )}
                        {item.raw ? (
                          <button
                            type="button"
                            className={`sr-btn sr-btn-sm${item.availability === "preview" ? " sr-btn-primary" : ""}`}
                            onClick={() => setDetail(item.raw!)}
                          >
                            <Compass size={14} strokeWidth={1.8} />
                            {item.availability === "preview" ? "预览" : "详情"}
                          </button>
                        ) : (
                          item.externalUrl && (
                            <a className="sr-btn sr-btn-sm" href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                              <Compass size={14} strokeWidth={1.8} />
                              详情
                            </a>
                          )
                        )}
                        <button
                          type="button"
                          className="sr-btn sr-btn-sm"
                          onClick={() => setState(toggleSavedCard(state, item, category.label))}
                          aria-pressed={saved}
                          title="只是收藏这张卡留作纪念，不会买书或加进书架"
                        >
                          <Star size={14} strokeWidth={1.8} fill={saved ? "currentColor" : "none"} />
                          {saved ? "已收藏" : "收藏卡"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <HelpFoot id="draw-source-about" label="关于抽到的书">
            抽到的是书目与可读来源，不是正文版权：能导入的导入到书架，能预览的在书房内预览，只有书目的标「仅推荐」。
          </HelpFoot>
        </DrawSheet>
      )}

      {/* 抽取记录 */}
      {showHistory && (
        <DrawSheet label="抽取记录" onClose={() => setShowHistory(false)} tall>
          <div className="sr-gacha-sheet-head">
            <span className="sr-gacha-sheet-title">抽取记录</span>
            <button type="button" className="sr-icon-btn" onClick={() => setShowHistory(false)} aria-label="关闭记录">
              <X size={20} strokeWidth={1.7} />
            </button>
          </div>
          <div className="sr-gacha-history">
            {state.records.length === 0 ? (
              <p className="sr-note-meta">还没有抽取记录。</p>
            ) : (
              <ul className="sr-review-list">
                {state.records.slice(0, 30).map((record) => (
                  <li key={record.id}>
                    <span className="sr-detail-note-text">
                      {new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      {record.categoryLabel} · {record.count === 5 ? "五连" : "单抽"} · {record.free ? "免费" : `${record.cost} 币`}
                      <br />
                      {record.titles.join("、")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {state.savedCards.length > 0 && (
              <>
                <div className="sr-section-label">收藏的卡（纪念用，不是购买）</div>
                <div className="sr-chip-row">
                  {state.savedCards.slice(0, 30).map((card) => (
                    <span key={card.key} className="sr-note-tag">
                      {card.categoryLabel} ·《{card.title}》
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          {state.records.length > 0 && (
            <div className="sr-sheet-actions">
              <button
                type="button"
                className="sr-btn sr-btn-sm"
                onClick={() => {
                  if (!confirm("清空抽取记录？（只是记录，不影响书架里的书，也不退款）")) return;
                  setState(clearDrawHistory());
                  flash("已清空记录", 2000);
                }}
              >
                <X size={13} strokeWidth={1.8} /> 清空记录
              </button>
            </div>
          )}
        </DrawSheet>
      )}

      {detail && (
        <StudyRoomSourceDetail
          item={detail}
          onClose={() => setDetail(null)}
          onRead={(book) => {
            setDetail(null);
            onRead(book);
          }}
        />
      )}
    </section>
  );
}

/** 底部白玻璃面板：Esc / 点遮罩关闭，打开时焦点进面板，关闭后焦点回到原来的按钮。 */
function DrawSheet({ label, onClose, tall, children }: { label: string; onClose: () => void; tall?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
    // 只在打开时记一次来源焦点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`sr-sheet sr-gacha-sheet${tall ? " sr-sheet--tall" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** 一本可翻的书：背面是统一书封，正面是分类或书；带书脊和书页厚度。 */
function FlipCard({
  index,
  flipped,
  kind,
  accent,
  selected,
  onSelect,
  label,
  children,
}: {
  index: number;
  flipped: boolean;
  kind: "category" | "book";
  accent?: string;
  selected?: boolean;
  onSelect?: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sr-flip"
      data-kind={kind}
      data-flipped={flipped ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      style={{ "--i": index, "--accent": accent ?? "#5C6B8A" } as CSSProperties}
      onClick={onSelect}
      disabled={!onSelect}
      aria-label={label}
    >
      <span className="sr-flip-inner">
        <span className="sr-flip-face sr-flip-back sr-gbook sr-gbook--back" aria-hidden>
          <span className="sr-gbook-mark">书</span>
        </span>
        <span className="sr-flip-face sr-flip-front sr-gbook sr-gbook--front">{children}</span>
      </span>
    </button>
  );
}

function CategoryFace({ category }: { category: DrawCategory }) {
  return (
    <span className="sr-draw-catface" style={{ "--accent": category.accent } as CSSProperties}>
      <span className="sr-draw-catface-kicker">分类</span>
      <span className="sr-draw-catface-name">{category.label}</span>
      <span className="sr-draw-catface-tags">{category.tags.slice(0, 3).join(" · ")}</span>
    </span>
  );
}

function BookFace({ item }: { item: DrawCandidate }) {
  return (
    <span className="sr-draw-bookface">
      <span className="sr-draw-bookface-cover">
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.cover} alt="" loading="lazy" />
        ) : (
          <span className="sr-draw-bookface-initial">{(item.title || "书").slice(0, 1)}</span>
        )}
        {!item.duplicate && <span className="sr-draw-bookface-new">新</span>}
      </span>
      <span className="sr-draw-bookface-meta">
        <span className="sr-draw-bookface-title">{item.title}</span>
        <span className="sr-draw-bookface-sub">{item.author || "佚名"}</span>
      </span>
    </span>
  );
}

export { saveDrawState };
