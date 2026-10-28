"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { Book } from "@/lib/reading-types";
import {
  BOOK_GAP,
  BASE_BOOK_HEIGHT,
  ROW_PADDING_LEFT,
  ROW_PADDING_RIGHT,
  clampCoverRatio,
  generatedCover,
  layoutShelf,
  spineToneFromCover,
} from "@/lib/study-room/shelf-layout";

/**
 * 每本书的动效阶段（明确状态机，阶段结束以 transitionend 为准，定时器只做兜底）：
 *   shelf ──点击──▶ pulling ──transitionend(rotate)──▶ out
 *   out ──关闭详情/点另一本──▶ returning ──transitionend(translate)──▶ shelf
 * pulling 中再次点击同一本书被忽略；点另一本则当前书立即开始归位、新书开始抽出。
 *
 * 抽出动效按设计稿：轻转（rotateY ≤18°）+ 抬起 + 书脊面与正面封面交叉淡入淡出，
 * 不做 90° 翻牌，也不做橡皮拉伸（缩放始终等比）。
 */
type Phase = "pulling" | "out" | "returning";

type StudyRoomShelf3DProps = {
  books: Book[];
  /** 当前被抽出的书（由父组件控制）；null 表示全部在架上 */
  activeId: string | null;
  /** 用户点了一本书：父组件据此切换 activeId */
  onSelect: (book: Book) => void;
  /** 抽出并转到封面后回调：父组件此时展开书详情 */
  onPulled?: (book: Book) => void;
  /** 从阅读器回来：这本书直接以「已抽出」姿态出现，不重放动画 */
  restoreOutId?: string | null;
};

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

/** 兜底时长：略大于 CSS 中对应 transition 的总时长 */
const PULL_FALLBACK_MS = 820;
const RETURN_FALLBACK_MS = 640;

function readBookScale(el: HTMLElement | null): number {
  if (!el) return 1;
  const raw = getComputedStyle(el).getPropertyValue("--sr-book-scale").trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0.3 && value < 3 ? value : 1;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function StudyRoomShelf3D({ books, activeId, onSelect, onPulled, restoreOutId }: StudyRoomShelf3DProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [phases, setPhases] = useState<Record<string, Phase>>(() =>
    restoreOutId ? { [restoreOutId]: "out" } : {},
  );
  const phasesRef = useRef(phases);
  phasesRef.current = phases;
  const timersRef = useRef<Map<string, number>>(new Map());
  // 封面源图比例（宽/高），读到后用于实体书正面比例
  const [ratios, setRatios] = useState<Record<string, number>>({});
  // 真实封面加载失败的书：退回「生成封面」（不是系统占位图）
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  // 从封面边缘取到的书脊色（取不到就用内置配色）
  const [spineTones, setSpineTones] = useState<Record<string, { tone: string; ink: string }>>({});

  const onPulledRef = useRef(onPulled);
  onPulledRef.current = onPulled;
  const booksRef = useRef(books);
  booksRef.current = books;

  // 按容器实际宽度排布；宽度变化（横竖屏、窗口缩放）时重新分层
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      setRowWidth(Math.max(el.clientWidth - ROW_PADDING_LEFT - ROW_PADDING_RIGHT, 60));
      setScale(readBookScale(el));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => (rowWidth > 0 ? layoutShelf(books, rowWidth, scale) : []), [books, rowWidth, scale]);

  const clearTimer = (id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  };

  /** 只有当前阶段与预期一致时才推进，避免 transitionend 与兜底定时器重复推进。 */
  const finish = useCallback((id: string, expected: Phase) => {
    if (phasesRef.current[id] !== expected) return;
    clearTimer(id);
    const synced = { ...phasesRef.current };
    if (expected === "pulling") synced[id] = "out";
    else delete synced[id];
    phasesRef.current = synced;
    setPhases((prev) => {
      if (prev[id] !== expected) return prev;
      const next = { ...prev };
      if (expected === "pulling") next[id] = "out";
      else delete next[id];
      return next;
    });
    if (expected === "pulling") {
      const book = booksRef.current.find((b) => b.id === id);
      if (book) onPulledRef.current?.(book);
    }
  }, []);

  const start = useCallback((id: string, phase: "pulling" | "returning") => {
    clearTimer(id);
    // 先同步更新 ref：减弱动态时兜底定时器为 0ms，可能早于重渲染触发
    phasesRef.current = { ...phasesRef.current, [id]: phase };
    setPhases((prev) => ({ ...prev, [id]: phase }));
    const wait = prefersReducedMotion() ? 0 : phase === "pulling" ? PULL_FALLBACK_MS : RETURN_FALLBACK_MS;
    timersRef.current.set(id, window.setTimeout(() => finish(id, phase), wait));
  }, [finish]);

  // activeId 变化驱动：新书抽出，其余已抽出/抽出中的书归位
  useEffect(() => {
    const current = phasesRef.current;
    const started = new Set<string>();
    for (const [id, phase] of Object.entries(current)) {
      if (id !== activeId && (phase === "pulling" || phase === "out")) {
        start(id, "returning");
        started.add(id);
      }
    }
    if (activeId && current[activeId] !== "pulling" && current[activeId] !== "out") start(activeId, "pulling");
    // 快速从 A 切到 B 时，B 可能已经走完抽出（out）却没轮到开详情：这里补一次
    if (activeId && !started.has(activeId) && phasesRef.current[activeId] === "out") {
      const book = booksRef.current.find((item) => item.id === activeId);
      if (book) onPulledRef.current?.(book);
    }
  }, [activeId, start]);

  // 卸载时清掉所有兜底定时器，不残留
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const coverOf = (book: Book): string | undefined =>
    book.cover && !failedCovers.has(book.id) ? book.cover : undefined;

  const rowMinHeight = Math.round((BASE_BOOK_HEIGHT + 46) * scale);

  return (
    <div className="sr3-stage" ref={stageRef}>
      <div className="sr3-shelves">
        {rows.map((row, rowIndex) => {
          // 计算每本书在本层的中心位置，抽出时把封面往层内拉，避免贴边被裁
          let cursor = ROW_PADDING_LEFT;
          const rowTotal = rowWidth + ROW_PADDING_LEFT + ROW_PADDING_RIGHT;
          return (
            <div className="sr3-shelf" key={rowIndex} data-empty={row.length === 0 ? "true" : undefined}>
              <div
                className="sr3-row"
                style={{ minHeight: rowMinHeight, paddingLeft: ROW_PADDING_LEFT, paddingRight: ROW_PADDING_RIGHT }}
              >
                {row.map((item, itemIndex) => {
                  // 书立：纯装饰，不承载功能
                  if (item.kind === "bookend") {
                    return (
                      <span
                        key={`bookend-${rowIndex}-${itemIndex}`}
                        className="sr3-bookend"
                        aria-hidden
                        style={{ width: item.width * scale, height: item.height * scale }}
                      />
                    );
                  }
                  // 纸签：藏书少时的「策展说明」
                  if (item.kind === "tag") {
                    return (
                      <span
                        key={`tag-${rowIndex}-${itemIndex}`}
                        className="sr3-tag"
                        aria-hidden
                        style={{
                          width: item.width * scale,
                          height: item.height * scale,
                          transform: `rotate(-5deg) translateY(${item.offsetY * scale}px)`,
                        }}
                      >
                        {item.text}
                      </span>
                    );
                  }

                  const { book, spine, height, tilt, lean, variant } = item;
                  const phase = phases[book.id];
                  const w = Math.round(spine * scale);
                  const h = Math.round(height * scale);
                  const ratio = clampCoverRatio(ratios[book.id]);
                  const d = Math.round(h * ratio);
                  const center = cursor + (item.gapBefore * scale) + w / 2;
                  cursor += (item.gapBefore + spine + BOOK_GAP) * scale;
                  // 抽出后封面宽 ≈ d；让封面完整落在层内
                  const minCenter = d / 2 + 8;
                  const maxCenter = rowTotal - d / 2 - 8;
                  const shift = Math.round(Math.min(Math.max(center, minCenter), maxCenter) - center);
                  const coverUrl = coverOf(book);
                  const spineTone = spineTones[book.id] ?? { tone: item.tone, ink: item.ink };
                  const generated = generatedCover(book);
                  const style: CssVars = {
                    "--w": `${w}px`,
                    "--h": `${h}px`,
                    "--d": `${d}px`,
                    "--tilt": `${tilt}deg`,
                    "--lean": `${lean}deg`,
                    "--shift": `${shift}px`,
                    "--tone": spineTone.tone,
                    "--ink": spineTone.ink,
                    "--gen-bg": generated.bg,
                    "--gen-ink": generated.ink,
                    "--gen-accent": generated.accent,
                    marginRight: `${BOOK_GAP * scale}px`,
                  };
                  return (
                    <button
                      key={book.id}
                      type="button"
                      className="sr3-book"
                      data-phase={phase}
                      data-lean={lean ? "true" : undefined}
                      data-narrow={w < 30 ? "true" : undefined}
                      data-variant={variant}
                      style={style}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 抽出动画中重复点击同一本：忽略。用 ref 判断，避免渲染间隔里漏判
                        if (phasesRef.current[book.id] === "pulling") return;
                        onSelect(book);
                      }}
                      onTransitionEnd={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (phase === "pulling" && e.propertyName === "rotate") finish(book.id, "pulling");
                        else if (phase === "returning" && e.propertyName === "translate") finish(book.id, "returning");
                      }}
                      aria-label={`${book.title}${book.author ? `，${book.author}` : ""}`}
                      aria-pressed={phase === "out" || phase === "pulling"}
                    >
                      {/* 书脊：书名与作者小字；底色来自封面取色或内置配色 */}
                      <span className="sr3-face sr3-spine">
                        <span className="sr3-spine-title">{book.title}</span>
                        {book.author && <span className="sr3-spine-author">{book.author}</span>}
                      </span>
                      <span className="sr3-face sr3-fore" />
                      {/* 正面封面：有真实封面用原图；没有则用生成封面（不是系统占位图） */}
                      <span className="sr3-face sr3-cover-front">
                        {coverUrl ? (
                          // 需要 onError 退回生成封面、onLoad 读比例与取书脊色；next/image 不便用于 3D 面
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="sr3-cover-art"
                            src={coverUrl}
                            alt=""
                            decoding="async"
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                                const r = img.naturalWidth / img.naturalHeight;
                                setRatios((prev) => (prev[book.id] === r ? prev : { ...prev, [book.id]: r }));
                              }
                              const tone = spineToneFromCover(img);
                              if (tone) {
                                setSpineTones((prev) => (prev[book.id]?.tone === tone.tone ? prev : { ...prev, [book.id]: tone }));
                              }
                            }}
                            onError={() => setFailedCovers((prev) => (prev.has(book.id) ? prev : new Set(prev).add(book.id)))}
                          />
                        ) : (
                          <span className="sr3-cover-generated">
                            <span className="sr3-cover-rule" aria-hidden />
                            <span className="sr3-cover-title">{book.title}</span>
                            {book.author && <span className="sr3-cover-author">{book.author}</span>}
                          </span>
                        )}
                      </span>
                      <span className="sr3-face sr3-cover-left" />
                      <span className="sr3-face sr3-cover sr3-cover-right">
                        {coverUrl ? (
                          // 侧面同时保留封面，转向时视觉连贯
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="sr3-cover-art" src={coverUrl} alt="" decoding="async" />
                        ) : (
                          <span className="sr3-cover-generated" aria-hidden>
                            <span className="sr3-cover-rule" />
                            <span className="sr3-cover-title">{book.title}</span>
                          </span>
                        )}
                      </span>
                      <span className="sr3-face sr3-top" />
                      <span className="sr3-face sr3-bottom" />
                    </button>
                  );
                })}
              </div>
              <span className="sr3-board" aria-hidden />
              <span className="sr3-board-edge" aria-hidden />
              <span className="sr3-contact" aria-hidden />
            </div>
          );
        })}
      </div>
    </div>
  );
}
