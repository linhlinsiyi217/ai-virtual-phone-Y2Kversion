"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  Copy,
  Quote,
  PenLine,
  MessagesSquare,
  Loader2,
  Trash2,
  Highlighter,
  Underline,
  MoreHorizontal,
  Share2,
  Search,
  Sparkles,
  Volume2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Timer,
  Waves,
  Music2,
  Square,
  X,
  BookText,
} from "lucide-react";

import {
  loadChapters,
  loadProgress,
  saveProgress,
  loadChapterNotes,
  saveNote,
  deleteNote,
  loadAnnotations,
  saveAnnotation,
  loadBookmarks,
  saveBookmark,
  deleteBookmark,
} from "@/lib/reading-storage";
import type { Book, BookChapter, ReadingAnnotation, ReadingBookmark, ReadingNote } from "@/lib/reading-types";
import { loadAppearance } from "@/lib/study-room/appearance";
import {
  NOTE_EMOJIS,
  buildNote,
  markAnnotationsSeen,
  marksByParagraph,
  shortText,
  unseenAnnotations,
} from "@/lib/study-room/annotations";
import {
  MARK_COLORS,
  quoteStillPresent,
  segmentParagraph,
  type InlineMark,
} from "@/lib/study-room/annotation-marks";
import { requestSearchInStore } from "@/lib/study-room/events";
import {
  loadTtsProgress,
  pickDefaultVoice,
  saveTtsProgress,
  speakParagraph,
  stopSpeaking,
  whenVoicesReady,
  type ReaderVoice,
  type SpeakHandle,
} from "@/lib/study-room/tts";
import { getReaderMusicController } from "@/lib/study-room/reader-music";
import { VolumeSlider } from "./volume-slider";
import {
  NOISE_HINTS,
  NOISE_LABELS,
  duckAmbient,
  getAmbientState,
  pauseAmbient,
  playNoise,
  resumeAmbient,
  previewAmbientVolume,
  setAmbientVolume,
  setReadingVolume,
  stopAmbient,
  subscribeAmbient,
  type AmbientStatus,
  type NoiseKind,
} from "@/lib/study-room/ambient";

const AMBIENT_STATUS_TEXT: Record<AmbientStatus, string> = {
  idle: "未播放",
  loading: "加载中",
  playing: "正在播放",
  paused: "已暂停",
  error: "播放失败",
};
import { resolveForumApiConfig } from "@/lib/study-room/forum";
import { simpleLLMCall } from "@/lib/api-helpers";
import { generateAnnotationBatch } from "@/lib/reading-engine";
import { HelpTip } from "./help-tip";
import {
  MAX_STAGE_CHAPTERS,
  generateStageSummary,
  lastSummarizedChapter,
  loadStageConfig,
  loadStageSummaries,
  saveStageSummary,
  shouldSummarize,
  stageCharacters,
} from "@/lib/study-room/reading-memory";
import { loadCharacters } from "@/lib/character-storage";
import { StudyRoomCoread } from "./study-room-coread";

type StudyRoomReaderProps = {
  book: Book;
  /** 从笔记「回跳原文」时指定章节 */
  initialChapterIndex?: number;
  /** 从笔记「回跳原文」时指定段落 */
  initialParagraphIndex?: number;
  /** 从书籍详情点「朗读」进来：打开后直接弹出朗读面板 */
  openTts?: boolean;
  onBack: () => void;
};

/** 选区位置：相对阅读器根容器（x 为选区水平中心，top/bottom 为选区上下沿） */
type SelectionState = {
  text: string;
  paragraphIndex: number;
  x: number;
  top: number;
  bottom: number;
};

type AnnotateState = {
  quote: string;
  paragraphIndex: number;
  draft: string;
  /** 表情批注：可与文字并存，也可以只有表情 */
  emoji?: string;
};

type RestoreTarget = { paragraphIndex?: number; paragraphOffset?: number; fraction: number };

/** 长章节只渲染当前位置附近的一段，避免上千段一次性进 DOM。 */
const LARGE_CHAPTER_PARAGRAPHS = 600;
const RENDER_WINDOW = 400;
const WINDOW_LEAD = 40;
const WINDOW_STEP = 200;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function StudyRoomReader({ book, initialChapterIndex, initialParagraphIndex, openTts, onBack }: StudyRoomReaderProps) {
  const [chapters, setChapters] = useState<BookChapter[] | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterNotes, setChapterNotes] = useState<ReadingNote[]>([]);
  const [chapterAnnotations, setChapterAnnotations] = useState<ReadingAnnotation[]>([]);
  // 本章还没看过的角色批注（提醒用）
  const [newAnnotationIds, setNewAnnotationIds] = useState<string[]>([]);
  // 角色批注：选中角色后按需请求，不整章发往 API
  const [characters] = useState(() => loadCharacters().map((c) => ({ id: c.id, name: c.name })));
  const [characterId, setCharacterId] = useState<string>(() => loadCharacters()[0]?.id ?? "");
  const [annotating, setAnnotating] = useState(false);
  const [markSheet, setMarkSheet] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ id: string; text: string } | null>(null);
  // 选词工具条：高亮配色 / 更多动作 / AI 起草
  const [markColorKey, setMarkColorKey] = useState(MARK_COLORS[0].key);
  const [showMarkColors, setShowMarkColors] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  // 段落 AI 书评：选中文字后由模型写一段短书评，可编辑后存为批注
  const [review, setReview] = useState<{ quote: string; paragraphIndex: number; text: string; loading: boolean } | null>(null);
  // 朗读：音色来自宿主角色卡或设备系统语音；断点续播按书记录
  const [ttsOpen, setTtsOpen] = useState(Boolean(openTts));
  const [voices, setVoices] = useState<ReaderVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  // 背景声音（白噪音 / 背景音乐）：独立入口，没有朗读音色也能用
  const [ambientOpen, setAmbientOpen] = useState(false);
  const ambient = useSyncExternalStore(subscribeAmbient, getAmbientState, getAmbientState);
  const [pickedNoise, setPickedNoise] = useState<NoiseKind>(() => getAmbientState().kind ?? "rain");
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[]>([]);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [annotate, setAnnotate] = useState<AnnotateState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [coreadOpen, setCoreadOpen] = useState(false);
  const [coreadAnchor, setCoreadAnchor] = useState(0);
  // 「询问角色」时带进共读侧栏的原文（选区在点按钮时会被清掉，要先记下来）
  const [coreadQuote, setCoreadQuote] = useState<string | undefined>(undefined);
  // 顶/底栏：点正文空白处切换；外观里可设为默认隐藏
  const [barsHidden, setBarsHidden] = useState(() => loadAppearance().vars["--sr-bar-autohide"] === "1");
  const [showHint, setShowHint] = useState(false);

  // 当前渲染的段落窗口（长章节用；短章节就是全部段落）
  const [range, setRange] = useState({ start: 0, end: Number.MAX_SAFE_INTEGER });
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const preHeightRef = useRef<number | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selbarRef = useRef<HTMLDivElement>(null);
  const [selbarPos, setSelbarPos] = useState<{ left: number; top: number } | null>(null);
  // 手机上点工具条按钮时，系统会先把原生选区收起来；按下工具条后的短时间内、
  // 以及「高亮配色 / 更多」展开期间，保留刚才选中的文字，按钮才拿得到正确的原文
  const selbarTouchRef = useRef(0);
  const selMenuOpenRef = useRef(false);
  selMenuOpenRef.current = showMore || showMarkColors;
  const speakRef = useRef<SpeakHandle | null>(null);
  const playingRef = useRef(false);
  const rateRef = useRef(1);
  const voiceRef = useRef<ReaderVoice | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const restoreRef = useRef<RestoreTarget | null>(null);
  const pendingAnchorRef = useRef<number | null>(initialParagraphIndex ?? null);

  // 音色：先把宿主角色卡绑定的音色列出来，再补上设备自带语音
  useEffect(() => {
    const stop = whenVoicesReady((list) => {
      setVoices(list);
      setVoiceId((current) => {
        if (current && list.some((voice) => voice.id === current)) return current;
        return pickDefaultVoice(list)?.id ?? "";
      });
    });
    return stop;
  }, []);

  useEffect(() => {
    voiceRef.current = voices.find((voice) => voice.id === voiceId) ?? null;
  }, [voices, voiceId]);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  // 朗读时背景声音自动调低，停下 / 暂停 / 失败后回到用户设定的音量（只是一个开关，不会越降越低）
  useEffect(() => {
    duckAmbient(playing);
  }, [playing]);

  // 离开阅读器时停掉朗读；背景声音在书房里切页面继续播放，退出书房时由 StudyRoomApp 停止
  useEffect(() => {
    return () => {
      playingRef.current = false;
      speakRef.current?.abort();
      stopSpeaking();
      duckAmbient(false);
      if (sleepTimerRef.current !== null) window.clearTimeout(sleepTimerRef.current);
    };
  }, []);

  const isPdf = book.format === "pdf";
  const chapter = chapters && chapters.length > 0 ? chapters[Math.min(chapterIndex, chapters.length - 1)] : null;
  const paragraphs = useMemo(() => (chapter && !isPdf ? chapter.paragraphs : []), [chapter, isPdf]);
  const total = chapters?.length ?? 0;

  /** 用户批注与角色批注按段归拢，正文行下方显示标记 */
  const marks = useMemo(() => marksByParagraph(chapterNotes, chapterAnnotations), [chapterNotes, chapterAnnotations]);

  const currentBookmark = bookmarks.find((b) => b.chapterIndex === chapterIndex) ?? null;

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash((prev) => (prev === message ? null : prev)), 1600);
  }, []);

  const refreshChapterNotes = useCallback(async () => {
    const [notes, annotations] = await Promise.all([
      loadChapterNotes(book.id, chapterIndex),
      loadAnnotations(book.id, chapterIndex).catch(() => []),
    ]);
    setChapterNotes(notes);
    setChapterAnnotations(annotations);
    setNewAnnotationIds(unseenAnnotations(book.id, annotations).map((item) => item.id));
  }, [book.id, chapterIndex]);

  // 载入章节 + 恢复进度
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [chs, progress, marks] = await Promise.all([
        loadChapters(book.id),
        loadProgress(book.id),
        loadBookmarks(book.id),
      ]);
      if (cancelled) return;
      setChapters(chs);
      setBookmarks(marks);
      const startIndex = initialChapterIndex !== undefined
        ? Math.min(Math.max(initialChapterIndex, 0), Math.max(chs.length - 1, 0))
        : Math.min(Math.max(progress?.chapterIndex ?? 0, 0), Math.max(chs.length - 1, 0));
      // 只有回到上次读的那一章才恢复位置；从目录/笔记跳转用指定段落
      restoreRef.current = progress && initialChapterIndex === undefined && progress.chapterIndex === startIndex
        ? { paragraphIndex: progress.paragraphIndex, paragraphOffset: progress.paragraphOffset, fraction: progress.scrollPosition }
        : null;
      // 先把渲染窗口定在目标段落附近，再切章，这样恢复滚动时目标段已经在 DOM 里
      const targetParagraph = initialParagraphIndex
        ?? (restoreRef.current?.paragraphIndex !== undefined ? restoreRef.current.paragraphIndex : undefined)
        ?? 0;
      const chapterLength = chs[startIndex]?.paragraphs.length ?? 0;
      if (chapterLength > LARGE_CHAPTER_PARAGRAPHS) {
        const start = Math.min(
          Math.max(targetParagraph - WINDOW_LEAD, 0),
          Math.max(chapterLength - RENDER_WINDOW, 0),
        );
        setRange({ start, end: Math.min(start + RENDER_WINDOW, chapterLength) });
      } else {
        setRange({ start: 0, end: chapterLength });
      }
      setChapterIndex(startIndex);
    })();
    return () => {
      cancelled = true;
    };
    // 只在进入阅读器时读一次初始定位，之后章节切换由阅读器自己管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, initialChapterIndex]);

  useEffect(() => {
    void refreshChapterNotes();
  }, [refreshChapterNotes]);

  // 恢复滚动位置（或从笔记回跳时定位到指定段落）
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !chapter) return;
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (anchor !== null && anchor !== undefined) {
      const el = body.querySelector<HTMLElement>(`[data-pi="${anchor}"]`);
      if (el) {
        body.scrollTop = Math.max(el.offsetTop - 14, 0);
        return;
      }
    }
    const target = restoreRef.current;
    restoreRef.current = null;
    if (!target) {
      body.scrollTop = 0;
      return;
    }
    // 优先按段落锚点恢复：字号/行距变化后仍落在同一段
    if (target.paragraphIndex !== undefined) {
      const el = body.querySelector<HTMLElement>(`[data-pi="${target.paragraphIndex}"]`);
      if (el) {
        body.scrollTop = Math.max(el.offsetTop + el.offsetHeight * (target.paragraphOffset ?? 0) - 8, 0);
        return;
      }
    }
    body.scrollTop = Math.max(body.scrollHeight - body.clientHeight, 0) * target.fraction;
  }, [chapterIndex, chapter]);

  // 保存进度
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !chapters || chapters.length === 0) return;
    let timer: number | null = null;
    const persist = () => {
      const anchor = readAnchor();
      // 长章节是分窗渲染的，滚动比例按「段落位置」换算才准
      const fraction = paragraphs.length > LARGE_CHAPTER_PARAGRAPHS
        ? Math.min(Math.max(((anchor.paragraphIndex ?? 0) + (anchor.paragraphOffset ?? 0)) / paragraphs.length, 0), 1)
        : body.scrollHeight > body.clientHeight
          ? body.scrollTop / (body.scrollHeight - body.clientHeight)
          : 0;
      void saveProgress({
        bookId: book.id,
        chapterIndex,
        scrollPosition: Math.min(Math.max(fraction, 0), 1),
        readingMode: "scroll",
        paragraphIndex: anchor.paragraphIndex,
        paragraphOffset: anchor.paragraphOffset,
        lastReadAt: new Date().toISOString(),
      });
    };
    const onScroll = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(persist, 400);
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      body.removeEventListener("scroll", onScroll);
      if (timer !== null) window.clearTimeout(timer);
      persist();
    };
  }, [book.id, chapterIndex, chapters, paragraphs.length]);

  // 阶段阅读记忆：按配置在后台更新，不阻塞阅读，失败也不打断
  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    const config = loadStageConfig();
    if (config.mode === "manual") return;
    const targets = stageCharacters(config).filter((character) =>
      shouldSummarize({
        config,
        bookId: book.id,
        characterId: character.id,
        currentChapter: chapterIndex,
        totalChapters: chapters.length,
        summaries: loadStageSummaries(),
      }),
    );
    if (targets.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const character of targets) {
        if (cancelled) return;
        const last = lastSummarizedChapter(loadStageSummaries(), book.id, character.id);
        const fromChapter = Math.max(last + 1, chapterIndex - MAX_STAGE_CHAPTERS + 1, 0);
        try {
          const result = await generateStageSummary({
            book,
            chapters,
            fromChapter,
            toChapter: chapterIndex,
            // 之前的章节视为已读完，当前章只到已读段落
            readParagraphOf: (index) =>
              index === chapterIndex
                ? (readAnchor().paragraphIndex ?? (chapters[index]?.paragraphs.length ?? 1) - 1)
                : (chapters[index]?.paragraphs.length ?? 1) - 1,
            characterId: character.id,
          });
          if (cancelled) return;
          await saveStageSummary({
            book,
            characterId: character.id,
            characterName: character.name,
            fromChapter,
            toChapter: chapterIndex,
            summary: result.summary,
            detail: result.detail,
          });
          showFlash(character.name + " 的阅读记录已更新");
        } catch {
          // 总结失败（未配置辅助 API、网络问题等）不打扰阅读
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, chapterIndex, chapters]);

  // 长章节：滚到两端时继续展开上下相邻的段落
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || paragraphs.length <= LARGE_CHAPTER_PARAGRAPHS) return;
    const onScroll = () => {
      const prev = rangeRef.current;
      let { start, end } = prev;
      let changed = false;
      if (body.scrollTop + body.clientHeight > body.scrollHeight - 700 && end < paragraphs.length) {
        end = Math.min(paragraphs.length, end + WINDOW_STEP);
        changed = true;
      }
      if (body.scrollTop < 400 && start > 0) {
        const step = Math.min(WINDOW_STEP, start);
        start -= step;
        // 记下展开前的高度，渲染后把滚动位置补回来，视觉上不跳动
        preHeightRef.current = body.scrollHeight;
        changed = true;
      }
      if (changed) {
        const next = { start, end };
        rangeRef.current = next;
        setRange(next);
      }
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => body.removeEventListener("scroll", onScroll);
  }, [paragraphs.length, chapterIndex]);

  // 向上展开后补回滚动高度差
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || preHeightRef.current === null) return;
    const delta = body.scrollHeight - preHeightRef.current;
    preHeightRef.current = null;
    if (delta > 0) body.scrollTop += delta;
  }, [range]);

  // 选中文字 → 弹出精简操作条
  useEffect(() => {
    if (isPdf) return;
    let debounce: number | null = null;

    const findParagraphIndex = (node: Node | null): number => {
      let el: Node | null = node;
      const root = bodyRef.current;
      while (el && el !== root) {
        if (el instanceof HTMLElement && el.dataset.pi !== undefined) return Number(el.dataset.pi);
        el = el.parentNode;
      }
      return -1;
    };

    // 正在点工具条（或配色 / 更多已展开）时，原生选区被收起不算「取消选择」
    const sticky = () => selMenuOpenRef.current || Date.now() - selbarTouchRef.current < 1500;
    const drop = () => {
      if (sticky()) return;
      setSelection(null);
    };

    const compute = () => {
      const sel = window.getSelection();
      const root = bodyRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) {
        drop();
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        drop();
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        drop();
        return;
      }
      const pi = findParagraphIndex(range.startContainer);
      const rect = range.getBoundingClientRect();
      // 按阅读器根容器换算坐标：外层手机壳可能有缩放/位移，fixed 定位会跑偏
      const base = rootRef.current?.getBoundingClientRect();
      const ox = base?.left ?? 0;
      const oy = base?.top ?? 0;
      setSelection({ text, paragraphIndex: pi, x: rect.left + rect.width / 2 - ox, top: rect.top - oy, bottom: rect.bottom - oy });
    };

    const onChange = () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(compute, 220);
    };

    // 滚动时工具条跟着选区走；原生选区已经没了就收起
    const onScroll = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        selbarTouchRef.current = 0;
        setShowMore(false);
        setShowMarkColors(false);
        setSelection(null);
        return;
      }
      onChange();
    };
    // 点到工具条以外的地方：收起配色 / 更多，选区按原生状态走
    const onPointerDown = (event: PointerEvent) => {
      if (selbarRef.current?.contains(event.target as Node)) return;
      selbarTouchRef.current = 0;
      setShowMore(false);
      setShowMarkColors(false);
    };

    const body = bodyRef.current;
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    body?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      body?.removeEventListener("scroll", onScroll);
      if (debounce !== null) window.clearTimeout(debounce);
    };
  }, [isPdf, chapterIndex]);

  // 翻章：上一章的选区和菜单一并清掉
  useEffect(() => {
    selbarTouchRef.current = 0;
    setSelection(null);
    setShowMore(false);
    setShowMarkColors(false);
  }, [chapterIndex]);

  // 选区菜单：先渲染再量尺寸。优先放在选区下方（手机系统自带的复制菜单多在上方，避免叠在一起），
  // 下方放不下（靠近底栏）就放到上方；左右夹在阅读器内，不被屏幕边缘裁掉。
  useLayoutEffect(() => {
    if (!selection || annotate) {
      setSelbarPos(null);
      return;
    }
    const bar = selbarRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    // 选字手柄（选区两端的圆点）大约伸出文字 20px，工具条再让开一点，不挡手柄
    const gap = 26;
    const footer = root.querySelector<HTMLElement>(".sr-reader-footer");
    const header = root.querySelector<HTMLElement>(".sr-reader-header");
    const bottomLimit = H - (barsHidden ? 16 : (footer?.offsetHeight ?? 0) + 12);
    const topLimit = barsHidden ? 16 : (header?.offsetHeight ?? 0) + 8;
    let top = selection.bottom + gap;
    if (top + h > bottomLimit) top = selection.top - gap - h;
    top = Math.min(Math.max(top, topLimit), Math.max(topLimit, bottomLimit - h));
    const left = Math.min(Math.max(selection.x - w / 2, 8), Math.max(8, W - w - 8));
    setSelbarPos({ left, top });
  }, [selection, annotate, barsHidden, showMarkColors, showMore]);

  const clearSelection = () => {
    selbarTouchRef.current = 0;
    selMenuOpenRef.current = false;
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const handleCopy = async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      showFlash("已复制");
    } catch {
      showFlash("复制失败");
    }
    clearSelection();
  };

  /** 给选中的原文加行内标记（高亮 / 下划线）；再点一次同样的标记表示取消。 */
  const applyMark = async (mark: InlineMark) => {
    if (!selection) return;
    const existing = chapterNotes.find(
      (note) => note.quote === selection.text && note.mark && note.paragraphIndex === selection.paragraphIndex,
    );
    if (existing) {
      if (existing.mark === mark) {
        await deleteNote(existing.id);
        showFlash(mark === "highlight" ? "已取消高亮" : "已取消下划线");
      } else {
        await saveNote({ ...existing, mark, color: markColorKey, updatedAt: new Date().toISOString() });
        showFlash(mark === "highlight" ? "已改为高亮" : "已改为下划线");
      }
    } else {
      await saveNote(
        buildNote({
          book,
          chapterIndex,
          paragraphIndex: selection.paragraphIndex,
          quote: selection.text,
          emoji: undefined,
          content: undefined,
        }) as never,
      );
      // buildNote 不带标记字段，这里补上（保持同一套定位模型）
      const list = await loadChapterNotes(book.id, chapterIndex);
      const created = list.find(
        (note) => note.quote === selection.text && note.paragraphIndex === selection.paragraphIndex && !note.mark,
      );
      if (created) {
        await saveNote({ ...created, mark, color: markColorKey, updatedAt: new Date().toISOString() });
      }
      showFlash(mark === "highlight" ? "已高亮" : "已加下划线");
    }
    await refreshChapterNotes();
    clearSelection();
    setShowMarkColors(false);
  };

  /** 分享选中的原文：系统分享面板可用就用它，不可用就复制到剪贴板（如实提示）。 */
  const handleShare = async () => {
    if (!selection) return;
    const text = selection.text;
    try {
      if (navigator.share) {
        await navigator.share({ text, title: book.title });
        showFlash("已分享");
      } else {
        await navigator.clipboard.writeText(text);
        showFlash("当前环境不支持分享，已复制原文");
      }
    } catch {
      showFlash("分享已取消");
    }
    clearSelection();
    setShowMore(false);
  };

  /** 用选中的原文去书城搜一搜（跳到书城并带上关键词）。 */
  const handleSearchText = () => {
    if (!selection) return;
    requestSearchInStore(selection.text);
    clearSelection();
    setShowMore(false);
  };

  /** 就这段原文去问角色（打开共读侧栏，带着选中文字）。 */
  const handleAskCharacter = () => {
    setCoreadAnchor(selection?.paragraphIndex ?? visibleParagraphIndex());
    setCoreadQuote(selection?.text);
    setCoreadOpen(true);
    clearSelection();
    setShowMore(false);
  };

  /** AI 辅助写作：让模型就这段原文写一句批注，填进批注草稿（可以再改）。 */
  const handleAiDraft = async () => {
    // 从批注面板里点「AI 写一句」时，selection 可能已经清掉，用面板里的原文
    const source = selection?.text ?? annotate?.quote ?? "";
    const sourceParagraph = selection?.paragraphIndex ?? annotate?.paragraphIndex ?? 0;
    if (!source) {
      showFlash("没拿到选中的文字，请重新长按选一段");
      return;
    }
    const apiConfig = resolveForumApiConfig();
    if (!apiConfig) {
      showFlash("还没有配置 API：到「设置 → API 配置」添加一个并设为默认");
      return;
    }
    if (!apiConfig.apiKey || !apiConfig.baseUrl) {
      showFlash(`API「${apiConfig.name || "默认"}」缺地址或密钥，到「设置 → API 配置」补上`);
      return;
    }
    setAiDrafting(true);
    try {
      const result = await simpleLLMCall(
        apiConfig,
        [
          {
            role: "user",
            content: [
              "你是读者的读书助手。请就下面这段原文写一句批注，一到两句，具体、不空泛，不要复述原文。",
              "只输出批注本身。",
              "",
              source,
            ].join("\n"),
          },
        ],
        { temperature: 0.8, max_tokens: 300, label: "studyroom-annotation-draft" },
      );
      if (result.error || !result.content) throw new Error(result.error || "没有返回内容");
      const draft = result.content.trim().slice(0, 300);
      setAnnotate((prev) =>
        prev
          ? { ...prev, draft: prev.draft ? `${prev.draft}\n${draft}` : draft }
          : { quote: source, paragraphIndex: sourceParagraph, draft },
      );
      setShowMore(false);
      clearSelection();
      showFlash("已写进批注草稿，可以再改；保存前不会写进书里");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showFlash(`AI 起草失败：${reason.slice(0, 60)}`);
    } finally {
      setAiDrafting(false);
    }
  };

  /** 段落 AI 书评：让模型就这段原文写三到五句短书评，可编辑后存为批注。 */
  const handleParagraphReview = async () => {
    const source = selection?.text ?? "";
    if (!source) {
      showFlash("没拿到选中的文字，请重新长按选一段");
      return;
    }
    const sourceParagraph = selection?.paragraphIndex ?? 0;
    const apiConfig = resolveForumApiConfig();
    if (!apiConfig) {
      showFlash("还没有配置 API：到「设置 → API 配置」添加一个并设为默认");
      return;
    }
    if (!apiConfig.apiKey || !apiConfig.baseUrl) {
      showFlash(`API「${apiConfig.name || "默认"}」缺地址或密钥，到「设置 → API 配置」补上`);
      return;
    }
    setReview({ quote: source, paragraphIndex: sourceParagraph, text: "", loading: true });
    try {
      const result = await simpleLLMCall(
        apiConfig,
        [
          {
            role: "user",
            content: [
              "你是读者的读书助手。请就下面这段原文写一段简短书评，三到五句。",
              "从语言、结构或主题里挑一两个角度给出具体看法，不要复述原文，不要空泛吹捧。",
              "只输出书评本身。",
              "",
              source,
            ].join("\n"),
          },
        ],
        { temperature: 0.7, max_tokens: 500, label: "studyroom-paragraph-review" },
      );
      if (result.error || !result.content) throw new Error(result.error || "没有返回内容");
      const text = result.content.trim();
      setReview((prev) => (prev ? { ...prev, text, loading: false } : prev));
      setShowMore(false);
      clearSelection();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // 失败时保留选区，用户可以直接重试
      setReview(null);
      showFlash(`AI 书评失败：${reason.slice(0, 60)}`);
    }
  };

  /** 把 AI 书评存成一条批注。 */
  const handleSaveReview = async () => {
    if (!review) return;
    const text = review.text.trim();
    if (!text) return;
    await saveNote(
      buildNote({
        book,
        chapterIndex,
        paragraphIndex: review.paragraphIndex,
        quote: review.quote,
        content: text,
      }),
    );
    await refreshChapterNotes();
    setReview(null);
    showFlash("书评已存为批注");
  };

  const handleExcerpt = async () => {
    if (!selection) return;
    await saveNote(
      buildNote({
        book,
        chapterIndex,
        paragraphIndex: selection.paragraphIndex,
        quote: selection.text,
      }),
    );
    await refreshChapterNotes();
    showFlash("已收藏书摘");
    clearSelection();
  };

  const handleSaveAnnotate = async () => {
    if (!annotate) return;
    const content = annotate.draft.trim();
    const emoji = annotate.emoji;
    // 表情与文字至少有一个才算一条批注
    if (!content && !emoji) return;
    await saveNote(
      buildNote({
        book,
        chapterIndex,
        paragraphIndex: annotate.paragraphIndex,
        quote: annotate.quote,
        content,
        emoji,
      }),
    );
    await refreshChapterNotes();
    setAnnotate(null);
    clearSelection();
    showFlash(content ? "已保存批注" : "已保存表情批注");
  };

  /** 让选中角色为这一段写一条批注：只把这一段发给 API，不整章发。 */
  const handleCharacterAnnotate = async (paragraphIndex: number, text: string) => {
    const character = characters.find((c) => c.id === characterId);
    const chapter = chapters?.[chapterIndex];
    if (!character) {
      showFlash("先在「我的 → 角色」里创建一个角色");
      return;
    }
    if (!chapter) return;
    setAnnotating(true);
    try {
      const created = await generateAnnotationBatch(
        book,
        chapter.title,
        [{ chapterIndex, paragraphIndex, text }],
        chapterAnnotations,
        character.id,
      );
      if (created.length === 0) {
        showFlash(character.name + " 这次没有写下批注");
        return;
      }
      for (const item of created) {
        await saveAnnotation({ ...item, quote: text.slice(0, 200) });
      }
      await refreshChapterNotes();
      showFlash(character.name + " 已批注这一段");
    } catch (err) {
      showFlash(err instanceof Error ? err.message : "批注失败，请检查 API 配置");
    } finally {
      setAnnotating(false);
    }
  };

  const handleDeleteNote = async (note: ReadingNote) => {
    await deleteNote(note.id);
    await refreshChapterNotes();
    showFlash("已删除这条批注");
  };

  const handleUpdateNote = async (note: ReadingNote, content: string) => {
    const next: ReadingNote = {
      ...note,
      content: content.trim() || undefined,
      kind: content.trim() ? "note" : "excerpt",
      updatedAt: new Date().toISOString(),
    };
    await saveNote(next);
    await refreshChapterNotes();
  };

  const handleToggleBookmark = async () => {
    if (currentBookmark) {
      await deleteBookmark(currentBookmark.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== currentBookmark.id));
      showFlash("已取消书签");
      return;
    }
    const body = bodyRef.current;
    const fraction = body && body.scrollHeight > body.clientHeight
      ? Math.min(Math.max(body.scrollTop / (body.scrollHeight - body.clientHeight), 0), 1)
      : 0;
    const bookmark: ReadingBookmark = {
      id: makeId("bm"),
      bookId: book.id,
      chapterIndex,
      paragraphIndex: visibleParagraphIndex(),
      scrollFraction: fraction,
      excerpt: selection?.text,
      createdAt: new Date().toISOString(),
    };
    await saveBookmark(bookmark);
    setBookmarks((prev) => [...prev, bookmark]);
    showFlash("已加书签");
    clearSelection();
  };

  /** 屏幕顶部所在段落 + 段内偏移比例，用于跨字号/分页恢复位置。 */
  function readAnchor(): { paragraphIndex?: number; paragraphOffset?: number } {
    const body = bodyRef.current;
    if (!body) return {};
    const top = body.scrollTop + 8;
    const nodes = body.querySelectorAll<HTMLElement>("[data-pi]");
    for (const node of Array.from(nodes)) {
      if (node.offsetTop + node.offsetHeight > top) {
        const offset = node.offsetHeight > 0 ? (top - node.offsetTop) / node.offsetHeight : 0;
        return { paragraphIndex: Number(node.dataset.pi ?? 0), paragraphOffset: Math.min(Math.max(offset, 0), 1) };
      }
    }
    return {};
  }

  /** 朗读一段，读完自动进入下一段；播放位置按书保存，下次可从断点继续。 */
  const speakAt = useCallback(
    async (index: number) => {
      const total = paragraphs.length;
      if (index < 0 || index >= total) {
        playingRef.current = false;
        setPlaying(false);
        setSpeakingIndex(null);
        return;
      }
      const voice = voiceRef.current;
      if (!voice) {
        setTtsNotice("这台设备没有可用的语音，且没有绑定角色音色：朗读尚未配置。");
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      setSpeakingIndex(index);
      saveTtsProgress(book.id, chapterIndex, index);
      speakRef.current?.abort();
      try {
        const handle = await speakParagraph({ text: paragraphs[index] ?? "", voice, rate: rateRef.current });
        if (!handle) {
          setTtsNotice(unavailableNotice());
          playingRef.current = false;
          setPlaying(false);
          return;
        }
        speakRef.current = handle;
        await handle.promise;
      } catch {
        // 单段失败就跳过，不打断整篇朗读
      }
      if (!playingRef.current) return;
      if (index + 1 >= total) {
        // 本章读完：如果还有下一章就自动续读
        if (chapters && chapterIndex + 1 < chapters.length) {
          setChapterIndex(chapterIndex + 1);
        } else {
          playingRef.current = false;
          setPlaying(false);
          setSpeakingIndex(null);
        }
        return;
      }
      void speakAt(index + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paragraphs, book.id, chapterIndex, chapters],
  );

  const unavailableNotice = () =>
    "朗读尚未配置：这台设备没有系统语音，且没有可用语音配置的角色卡。可以在设置 → 绑定配置里给角色绑定语音。";

  const handlePlayPause = () => {
    if (playing) {
      playingRef.current = false;
      setPlaying(false);
      speakRef.current?.abort();
      stopSpeaking();
      return;
    }
    if (voices.length === 0) {
      setTtsNotice(unavailableNotice());
      return;
    }
    const base = speakingIndex ?? loadTtsProgress(book.id)?.paragraphIndex ?? visibleParagraphIndex();
    const index = loadTtsProgress(book.id)?.chapterIndex === chapterIndex ? base : visibleParagraphIndex();
    playingRef.current = true;
    setPlaying(true);
    setTtsNotice(null);
    void speakAt(index);
  };

  const jumpSpeech = (delta: -1 | 1) => {
    const base = speakingIndex ?? visibleParagraphIndex();
    speakRef.current?.abort();
    stopSpeaking();
    void speakAt(base + delta);
  };

  /** 定时关闭：到点停止朗读与白噪音。 */
  const setSleepTimer = (minutes: number | null) => {
    if (sleepTimerRef.current !== null) window.clearTimeout(sleepTimerRef.current);
    if (minutes === null) {
      setSleepUntil(null);
      return;
    }
    setSleepUntil(Date.now() + minutes * 60_000);
    sleepTimerRef.current = window.setTimeout(() => {
      playingRef.current = false;
      setPlaying(false);
      setSpeakingIndex(null);
      stopSpeaking();
      stopAmbient();
      setSleepUntil(null);
      setTtsNotice("定时时间到，已停止朗读和背景声音。");
    }, minutes * 60_000);
  };

  /** 选一种白噪音：正在播放时直接换过去（同一时间只有一路） */
  const pickNoise = (kind: NoiseKind) => {
    setPickedNoise(kind);
    if (ambient.kind && ambient.kind !== kind && (ambient.status === "playing" || ambient.status === "paused")) {
      void playNoise(kind);
    }
  };

  const toggleAmbient = () => {
    if (ambient.status === "loading") return;
    if (ambient.status === "playing" && ambient.kind === pickedNoise) {
      void pauseAmbient();
      return;
    }
    if (ambient.status === "paused" && ambient.kind === pickedNoise) {
      void resumeAmbient();
      return;
    }
    void playNoise(pickedNoise);
  };

  // 点正文切换顶/底栏；选中文字、点按钮或链接时不切换
  const handleBodyClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (!barsHidden) setShowHint(true);
    setBarsHidden(!barsHidden);
  };

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(() => setShowHint(false), 1800);
    return () => window.clearTimeout(timer);
  }, [showHint]);

  // 键盘：Esc 唤回工具栏，保证返回入口始终可达
  useEffect(() => {
    if (!barsHidden) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBarsHidden(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [barsHidden]);

  /** 找到当前屏幕顶部附近的段落索引，供书签定位。 */
  const visibleParagraphIndex = (): number => {
    const body = bodyRef.current;
    if (!body) return 0;
    const nodes = body.querySelectorAll<HTMLElement>("[data-pi]");
    for (const node of Array.from(nodes)) {
      if (node.offsetTop + node.offsetHeight > body.scrollTop + 8) {
        return Number(node.dataset.pi ?? 0);
      }
    }
    return 0;
  };

  const progressPct = total > 0 ? ((chapterIndex + 1) / total) * 100 : 0;

  return (
    <div ref={rootRef} className="sr-reader" data-bars={barsHidden ? "hidden" : undefined}>
      <header className="sr-reader-header" aria-hidden={barsHidden || undefined}>
        <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回书架">
          <ChevronLeft size={22} strokeWidth={1.6} />
        </button>
        <div className="sr-reader-title">{book.title}</div>
        <div className="sr-reader-actions">
          <button
            type="button"
            className="sr-icon-btn"
            data-active={coreadOpen ? "true" : undefined}
            onClick={() => {
              setCoreadAnchor(visibleParagraphIndex());
              setCoreadOpen(true);
              clearSelection();
            }}
            aria-label="打开共读"
            title="AI 共读"
            disabled={!chapter || isPdf}
          >
            <MessagesSquare size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="sr-icon-btn"
            data-active={playing || ttsOpen ? "true" : undefined}
            onClick={() => setTtsOpen((value) => !value)}
            aria-label="朗读"
            title="AI 朗读"
            disabled={isPdf}
          >
            <Volume2 size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="sr-icon-btn"
            data-active={ambientOpen || ambient.status === "playing" ? "true" : undefined}
            onClick={() => setAmbientOpen(true)}
            aria-label="背景声音"
            title="背景声音"
          >
            <Waves size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="sr-icon-btn"
            data-active={currentBookmark ? "true" : undefined}
            onClick={handleToggleBookmark}
            aria-label={currentBookmark ? "取消本章书签" : "为本章加书签"}
            disabled={!chapter}
          >
            {currentBookmark ? <BookmarkCheck size={20} strokeWidth={1.7} /> : <Bookmark size={20} strokeWidth={1.6} />}
          </button>
        </div>
      </header>

      <div
        ref={bodyRef}
        className="sr-reader-body"
        onClick={handleBodyClick}
        // 只在正文里拦浏览器的右键 / 长按菜单（安卓 Chrome、电脑有效）；iOS 与部分第三方浏览器的
        // 选字菜单网页无法关掉，书房工具条放在选区另一侧并让开手柄
        onContextMenu={(event) => {
          if (window.getSelection()?.toString().trim()) event.preventDefault();
        }}
      >
        {chapters === null ? (
          <div className="sr-empty" style={{ paddingTop: 60 }}>
            <p>正在载入正文…</p>
          </div>
        ) : chapters.length === 0 ? (
          <div className="sr-empty" style={{ paddingTop: 60 }}>
            <p>这本书暂无正文内容。</p>
          </div>
        ) : isPdf ? (
          <div className="sr-empty" style={{ paddingTop: 60 }}>
            <p>PDF 的原生分页阅读在后续阶段接入书房阅读器。当前阶段书房提供 TXT / EPUB 正文阅读。</p>
          </div>
        ) : (
          <>
            {chapter && <h2 className="sr-chapter-title">{chapter.title}</h2>}
            {newAnnotationIds.length > 0 && (
              <button
                type="button"
                className="sr-annotation-hint"
                onClick={() => {
                  const first = chapterAnnotations.find((item) => item.id === newAnnotationIds[0]);
                  if (first) {
                    setMarkSheet(first.paragraphIndex);
                    setEditDraft(null);
                  }
                  markAnnotationsSeen(book.id, newAnnotationIds);
                  setNewAnnotationIds([]);
                }}
              >
                角色在这一章写了 {newAnnotationIds.length} 条新批注 · 点这里看
              </button>
            )}
            {paragraphs.slice(range.start, range.end).map((para, offset) => {
              const index = range.start + offset;
              const paraMarks = marks.get(index);
              return (
                <div key={index} className="sr-para-block">
                  <p
                    className={paraMarks ? "sr-para sr-para--marked" : "sr-para"}
                    data-pi={index}
                    data-speaking={speakingIndex === index ? "true" : undefined}
                  >
                    {(() => {
                      const segs = segmentParagraph(para, chapterNotes.filter((n) => n.paragraphIndex === index));
                      if (!segs) return para;
                      return segs.map((seg, segIndex) =>
                        seg.kind === "plain" ? (
                          <span key={segIndex}>{seg.text}</span>
                        ) : (
                          <mark
                            key={segIndex}
                            className="sr-inline-mark"
                            data-mark={seg.mark}
                            data-has-note={seg.hasNote ? "true" : undefined}
                            style={{ "--mark-color": seg.color } as React.CSSProperties}
                            onClick={(event) => {
                              event.stopPropagation();
                              setMarkSheet(index);
                              setEditDraft(null);
                            }}
                          >
                            {seg.text}
                          </mark>
                        ),
                      );
                    })()}
                  </p>
                  {paraMarks && (
                    <div className="sr-para-marks">
                      {paraMarks.map((mark) => (
                        <button
                          key={mark.id}
                          type="button"
                          className="sr-mark"
                          data-source={mark.source}
                          onClick={() => {
                            setMarkSheet(index);
                            setEditDraft(null);
                            const ids = (marks.get(index) ?? [])
                              .map((mark) => mark.annotation?.id)
                              .filter((id): id is string => Boolean(id));
                            markAnnotationsSeen(book.id, ids);
                            if (ids.length > 0) {
                              setNewAnnotationIds((prev) => prev.filter((id) => !ids.includes(id)));
                            }
                          }}
                          aria-label={`查看这一段上的 ${paraMarks.length} 条批注`}
                        >
                          {mark.emoji && <span className="sr-mark-emoji">{mark.emoji}</span>}
                          {mark.source === "character" && <span className="sr-mark-author">{mark.author}</span>}
                          {shortText(mark.text) && <span className="sr-mark-text">{shortText(mark.text)}</span>}
                          {!mark.emoji && !mark.text && <span className="sr-mark-text">批注</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {flash && <div className="sr-flash">{flash}</div>}
      {ttsNotice && (
        <div className="sr-note-card" style={{ position: "absolute", left: 16, right: 16, bottom: 96, zIndex: 45 }}>
          <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>{ttsNotice}</div>
          <button type="button" className="sr-btn-text" onClick={() => setTtsNotice(null)}>知道了</button>
        </div>
      )}
      {barsHidden && showHint && <div className="sr-reader-hint">轻点正文显示工具栏</div>}

      {selection && !annotate && !review && (
        <div
          ref={selbarRef}
          className="sr-selbar sr-selbar--anchored"
          role="toolbar"
          aria-label="选中文字的操作"
          style={selbarPos ? { left: selbarPos.left, top: selbarPos.top } : { left: 8, top: Math.max(selection.bottom + 12, 0), visibility: "hidden" }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={() => {
            selbarTouchRef.current = Date.now();
          }}
        >
          <span className="sr-selbar-row">
          <button type="button" className="sr-selbar-btn" onClick={handleCopy}>
            <Copy size={16} strokeWidth={1.7} /> 复制
          </button>
          <button
            type="button"
            className="sr-selbar-btn"
            data-active={showMarkColors ? "true" : undefined}
            onClick={() => {
              setShowMore(false);
              setShowMarkColors((value) => !value);
            }}
            aria-expanded={showMarkColors}
          >
            <Highlighter size={16} strokeWidth={1.7} /> 高亮
          </button>
          <button type="button" className="sr-selbar-btn" onClick={() => void applyMark("underline")}>
            <Underline size={16} strokeWidth={1.7} /> 下划线
          </button>
          <button
            type="button"
            className="sr-selbar-btn"
            onClick={() => setAnnotate({ quote: selection.text, paragraphIndex: selection.paragraphIndex, draft: "" })}
          >
            <PenLine size={16} strokeWidth={1.7} /> 批注
          </button>
          <button type="button" className="sr-selbar-btn" onClick={handleExcerpt}>
            <Quote size={16} strokeWidth={1.7} /> 摘录
          </button>
          <button
            type="button"
            className="sr-selbar-btn"
            data-active={showMore ? "true" : undefined}
            onClick={() => {
              setShowMarkColors(false);
              setShowMore((value) => !value);
            }}
            aria-expanded={showMore}
          >
            <MoreHorizontal size={16} strokeWidth={1.7} /> 更多
          </button>
          </span>
          {showMarkColors && (
            <span className="sr-selbar-colors" role="group" aria-label="高亮颜色">
              {MARK_COLORS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="sr-selbar-color"
                  data-active={markColorKey === item.key ? "true" : undefined}
                  style={{ background: item.color }}
                  aria-label={item.label}
                  onClick={async () => {
                    setMarkColorKey(item.key);
                    await applyMark("highlight");
                  }}
                />
              ))}
            </span>
          )}
          {showMore && (
            <span className="sr-selbar-more" role="menu">
              <button type="button" className="sr-selbar-btn" onClick={() => void handleShare()}>
                <Share2 size={16} strokeWidth={1.7} /> 分享
              </button>
              <button type="button" className="sr-selbar-btn" onClick={handleSearchText}>
                <Search size={16} strokeWidth={1.7} /> 搜索
              </button>
              <button type="button" className="sr-selbar-btn" onClick={handleAskCharacter} disabled={isPdf}>
                <MessagesSquare size={16} strokeWidth={1.7} /> 询问角色
              </button>
              <button type="button" className="sr-selbar-btn" onClick={() => void handleAiDraft()} disabled={aiDrafting}>
                {aiDrafting ? <Loader2 size={16} className="sr-spin" /> : <Sparkles size={16} strokeWidth={1.7} />} AI 写作
              </button>
              <button type="button" className="sr-selbar-btn" onClick={() => void handleParagraphReview()}>
                <BookText size={16} strokeWidth={1.7} /> AI 书评
              </button>
            </span>
          )}
        </div>
      )}

      {annotate && (
        <div className="sr-sheet-mask" onClick={() => setAnnotate(null)}>
          <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sr-sheet-quote">{annotate.quote}</div>
            {!quoteStillPresent(paragraphs[annotate.paragraphIndex], annotate.quote) && (
              <p className="sr-note-meta" style={{ marginBottom: 8 }}>
                这段原文在当前版本的第 {annotate.paragraphIndex + 1} 段里没有找到：可能是换过版本或译本，位置仅供参考。
              </p>
            )}
            <div className="sr-sheet-label">表情批注（可以只选表情，也可以表情＋文字）</div>
            <div className="sr-emoji-grid">
              {NOTE_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="sr-emoji"
                  data-active={annotate.emoji === emoji ? "true" : undefined}
                  aria-pressed={annotate.emoji === emoji}
                  aria-label={`选择表情 ${emoji}`}
                  onClick={() =>
                    setAnnotate((prev) => (prev ? { ...prev, emoji: prev.emoji === emoji ? undefined : emoji } : prev))
                  }
                >
                  {emoji}
                </button>
              ))}
            </div>
            <textarea
              className="sr-sheet-input"
              placeholder="写下你的想法（可留空，只留表情）…"
              value={annotate.draft}
              rows={3}
              autoFocus
              onChange={(e) => setAnnotate((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
            />
            <div className="sr-sheet-actions">
              <button
                type="button"
                className="sr-btn"
                onClick={() => void handleAiDraft()}
                disabled={aiDrafting}
              >
                {aiDrafting ? <Loader2 size={15} className="sr-spin" /> : <Sparkles size={15} strokeWidth={1.7} />}
                AI 写一句
              </button>
              <button type="button" className="sr-btn" onClick={() => setAnnotate(null)}>
                取消
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-primary"
                onClick={handleSaveAnnotate}
                disabled={!annotate.draft.trim() && !annotate.emoji}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {review && (
        <div className="sr-sheet-mask" onClick={() => setReview(null)}>
          <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sr-sheet-quote">{review.quote}</div>
            <div className="sr-sheet-label">AI 书评</div>
            {review.loading ? (
              <p className="sr-note-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={14} className="sr-spin" /> 正在写这段的书评…
              </p>
            ) : (
              <textarea
                className="sr-sheet-input"
                value={review.text}
                rows={5}
                onChange={(e) => setReview((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
              />
            )}
            <div className="sr-sheet-actions">
              <button
                type="button"
                className="sr-btn sr-btn-primary"
                onClick={() => void handleSaveReview()}
                disabled={review.loading || !review.text.trim()}
              >
                存为批注
              </button>
              <button type="button" className="sr-btn" onClick={() => setReview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {markSheet !== null && (
        <div
          className="sr-sheet-mask"
          onClick={() => {
            setMarkSheet(null);
            setEditDraft(null);
          }}
        >
          <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sr-sheet-quote">{paragraphs[markSheet]}</div>
            {(marks.get(markSheet) ?? []).some((mark) => !quoteStillPresent(paragraphs[markSheet], mark.note?.quote)) && (
              <p className="sr-note-meta" style={{ marginBottom: 8 }}>
                有批注的原文在当前版本里对不上（可能换过版本或译本），跳回位置可能不准。
              </p>
            )}
            <ul className="sr-mark-list">
              {(marks.get(markSheet) ?? []).map((mark) => {
                const editing = editDraft !== null && mark.note !== undefined && editDraft.id === mark.note.id;
                return (
                  <li key={mark.id} className="sr-mark-item" data-source={mark.source}>
                    {mark.emoji && <span className="sr-mark-emoji">{mark.emoji}</span>}
                    <div className="sr-mark-body">
                      <div className="sr-mark-head">
                        <span className="sr-mark-author">
                          {mark.source === "character" ? `${mark.author} 的批注` : "我的批注"}
                        </span>
                        <span className="sr-note-meta">
                          {new Date(mark.annotation?.createdAt ?? mark.note?.updatedAt ?? Date.now()).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      {mark.note ? (
                        editing ? (
                          <textarea
                            className="sr-sheet-input"
                            rows={2}
                            value={editDraft?.text ?? ""}
                            onChange={(e) => setEditDraft({ id: mark.note!.id, text: e.target.value })}
                          />
                        ) : (
                          <p className="sr-mark-text-full">{mark.note.content || "（只加了表情）"}</p>
                        )
                      ) : (
                        <p className="sr-mark-text-full">{mark.text}</p>
                      )}
                    </div>
                    {mark.note && (
                      <span className="sr-mark-tools">
                        {editing ? (
                          <button
                            type="button"
                            className="sr-note-tool"
                            title="保存修改"
                            onClick={async () => {
                              await handleUpdateNote(mark.note!, editDraft?.text ?? "");
                              setEditDraft(null);
                            }}
                          >
                            保存
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sr-note-tool"
                            title="修改我的批注"
                            onClick={() => setEditDraft({ id: mark.note!.id, text: mark.note!.content ?? "" })}
                          >
                            <PenLine size={15} strokeWidth={1.7} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="sr-note-tool"
                          title="删除这条批注"
                          onClick={async () => {
                            await handleDeleteNote(mark.note!);
                            setEditDraft(null);
                          }}
                        >
                          <Trash2 size={15} strokeWidth={1.7} />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="sr-mark-foot">
              {characters.length > 0 ? (
                <>
                  <select
                    className="sr-appear-select"
                    value={characterId}
                    onChange={(e) => setCharacterId(e.target.value)}
                    aria-label="选择要批注的角色"
                  >
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sr-btn"
                    disabled={annotating}
                    onClick={() => void handleCharacterAnnotate(markSheet, paragraphs[markSheet] ?? "")}
                  >
                    {annotating ? (
                      <Loader2 size={15} className="sr-spin" />
                    ) : (
                      <MessagesSquare size={15} strokeWidth={1.7} />
                    )}
                    让 TA 批注这段
                  </button>
                </>
              ) : (
                <span className="sr-note-meta">还没有角色：先在「我的 → 角色」里创建，就能让 TA 为这段写批注。</span>
              )}
            </div>
            <p className="sr-note-meta" style={{ marginTop: 6 }}>
              只把这一段原文发给 AI，不会发送整章。
              <HelpTip id="ai-annotate" label="AI 批注说明">
                点「让 TA 批注这段」会把选中的这一段落和这本书已有的批注记录发给该角色（用你在设置里配的 API），
                回来的批注存在本机，和你的批注一起显示在这一段下面，可以随时删掉。
              </HelpTip>
            </p>
          </div>
        </div>
      )}

      {ttsOpen && (
        <div className="sr-sheet-mask" onClick={() => setTtsOpen(false)}>
          <div className="sr-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>AI 朗读</span>
              <button type="button" className="sr-icon-btn" onClick={() => setTtsOpen(false)} aria-label="关闭">
                <X size={18} strokeWidth={1.7} />
              </button>
            </div>

            {voices.length === 0 ? (
              <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>朗读尚未配置：这台设备没有系统语音，且没有可用语音配置的角色卡。</p>
            ) : (
              <>
                <div className="sr-appear-row">
                  <span className="sr-appear-label">音色</span>
                  <select className="sr-appear-select" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} aria-label="朗读音色">
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}（{voice.note}）
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sr-css-actions" style={{ justifyContent: "center", gap: 10, marginTop: 6 }}>
                  <button type="button" className="sr-icon-btn" onClick={() => jumpSpeech(-1)} aria-label="上一段">
                    <SkipBack size={20} strokeWidth={1.7} />
                  </button>
                  <button type="button" className="sr-btn sr-btn-primary" onClick={handlePlayPause}>
                    {playing ? <Pause size={16} strokeWidth={1.9} /> : <Play size={16} strokeWidth={1.9} />}
                    {playing ? "暂停" : "朗读"}
                  </button>
                  <button type="button" className="sr-icon-btn" onClick={() => jumpSpeech(1)} aria-label="下一段">
                    <SkipForward size={20} strokeWidth={1.7} />
                  </button>
                </div>
                {speakingIndex !== null && (
                  <p className="sr-note-meta" style={{ textAlign: "center" }}>正在读第 {speakingIndex + 1} 段</p>
                )}

                <div className="sr-appear-row sr-appear-row--slider">
                  <span className="sr-appear-label">倍速</span>
                  <input
                    type="range"
                    min={0.6}
                    max={2}
                    step={0.1}
                    value={rate}
                    onChange={(event) => setRate(Number(event.target.value))}
                    className="sr-slider"
                    aria-label="朗读倍速"
                  />
                  <span className="sr-appear-value">{rate.toFixed(1)}×</span>
                </div>

                <div className="sr-appear-row">
                  <span className="sr-appear-label">
                    <Timer size={13} strokeWidth={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
                    定时关闭
                  </span>
                  <div className="sr-chip-row">
                    {[null, 5, 15, 30].map((minutes) => (
                      <button
                        key={String(minutes)}
                        type="button"
                        className="sr-chip"
                        data-active={
                          minutes === null ? (sleepUntil === null ? "true" : undefined) : undefined
                        }
                        onClick={() => setSleepTimer(minutes)}
                      >
                        {minutes === null ? "不设" : `${minutes} 分钟`}
                      </button>
                    ))}
                  </div>
                </div>
                {sleepUntil !== null && (
                  <p className="sr-note-meta">将在 {new Date(sleepUntil).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 停止朗读。</p>
                )}

                <VolumeSlider label="朗读音量" value={ambient.readingVolume} onCommit={setReadingVolume} />
                <p className="sr-note-meta">朗读音量从下一段开始生效，只管朗读，不影响背景声音。</p>
              </>
            )}

            <button
              type="button"
              className="sr-ambient-link"
              onClick={() => {
                setTtsOpen(false);
                setAmbientOpen(true);
              }}
            >
              <Waves size={18} strokeWidth={1.7} />
              <span>背景声音</span>
              <span className="sr-ambient-link-state">
                {ambient.kind && ambient.status !== "idle" ? `${NOISE_LABELS[ambient.kind]} · ${AMBIENT_STATUS_TEXT[ambient.status]}` : "未播放"}
              </span>
            </button>
          </div>
        </div>
      )}

      {ambientOpen && (
        <div className="sr-sheet-mask" onClick={() => setAmbientOpen(false)}>
          <div
            className="sr-sheet sr-ambient-sheet"
            role="dialog"
            aria-label="背景声音"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>背景声音</span>
              <button type="button" className="sr-icon-btn" onClick={() => setAmbientOpen(false)} aria-label="关闭">
                <X size={18} strokeWidth={1.7} />
              </button>
            </div>

            <section className="sr-ambient-sec">
              <div className="sr-ambient-sec-head">
                <Waves size={15} strokeWidth={1.8} />
                <span>白噪音</span>
                <small>本机生成的持续环境声，不联网</small>
              </div>
              <div className="sr-chip-row" role="radiogroup" aria-label="选择白噪音">
                {(Object.keys(NOISE_LABELS) as NoiseKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={pickedNoise === kind}
                    className="sr-chip"
                    data-active={pickedNoise === kind ? "true" : undefined}
                    onClick={() => pickNoise(kind)}
                  >
                    {NOISE_LABELS[kind]}
                  </button>
                ))}
              </div>
              <p className="sr-note-meta">{NOISE_HINTS[pickedNoise]}</p>

              <p className="sr-ambient-status" data-status={ambient.status} role="status" aria-live="polite">
                {ambient.status === "error"
                  ? ambient.error ?? "播放失败"
                  : ambient.kind && ambient.status !== "idle"
                    ? `${NOISE_LABELS[ambient.kind]} · ${AMBIENT_STATUS_TEXT[ambient.status]}${ambient.ducked ? "（朗读中，已调低）" : ""}`
                    : "未播放"}
              </p>

              <div className="sr-ambient-ctrl">
                <button
                  type="button"
                  className="sr-btn sr-btn-primary"
                  onClick={toggleAmbient}
                  disabled={ambient.status === "loading"}
                  aria-busy={ambient.status === "loading" || undefined}
                >
                  {ambient.status === "playing" && ambient.kind === pickedNoise ? (
                    <Pause size={16} strokeWidth={1.9} />
                  ) : (
                    <Play size={16} strokeWidth={1.9} />
                  )}
                  {ambient.status === "loading"
                    ? "加载中"
                    : ambient.status === "playing" && ambient.kind === pickedNoise
                      ? "暂停"
                      : ambient.status === "paused" && ambient.kind === pickedNoise
                        ? "继续"
                        : ambient.status === "playing"
                          ? `换成${NOISE_LABELS[pickedNoise]}`
                          : "播放"}
                </button>
                <button
                  type="button"
                  className="sr-btn"
                  onClick={() => stopAmbient()}
                  disabled={ambient.status === "idle"}
                >
                  <Square size={14} strokeWidth={1.9} />
                  停止
                </button>
              </div>

              <VolumeSlider
                label="背景音量"
                value={ambient.volume}
                onPreview={previewAmbientVolume}
                onCommit={setAmbientVolume}
              />
              <p className="sr-note-meta">朗读时自动调低，停下后回到这个音量；在书房里切换页面会继续播放，退出书房才停止。锁屏或切到后台时是否继续由系统决定。</p>
            </section>

            <section className="sr-ambient-sec">
              <div className="sr-ambient-sec-head">
                <Music2 size={15} strokeWidth={1.8} />
                <span>背景音乐</span>
                <small>有旋律的歌曲 / 曲目</small>
              </div>
              <p className="sr-note-meta">{getReaderMusicController().unavailableReason}</p>
            </section>
          </div>
        </div>
      )}

      {total > 1 && (
        <footer className="sr-reader-footer">
          <button
            type="button"
            className="sr-icon-btn"
            onClick={() => setChapterIndex((i) => Math.max(0, i - 1))}
            disabled={chapterIndex <= 0}
            aria-label="上一章"
          >
            <ChevronLeft size={20} strokeWidth={1.7} />
          </button>
          <div className="sr-progress">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <span className="sr-progress-label">
            {chapterIndex + 1}/{total}
          </span>
          <button
            type="button"
            className="sr-icon-btn"
            onClick={() => setChapterIndex((i) => Math.min(total - 1, i + 1))}
            disabled={chapterIndex >= total - 1}
            aria-label="下一章"
          >
            <ChevronRight size={20} strokeWidth={1.7} />
          </button>
        </footer>
      )}

      {coreadOpen && (
        <StudyRoomCoread
          book={book}
          chapter={chapter}
          chapterIndex={chapterIndex}
          readParagraphIndex={coreadAnchor}
          selectedText={coreadQuote ?? selection?.text}
          onClose={() => {
            setCoreadOpen(false);
            setCoreadQuote(undefined);
          }}
        />
      )}
    </div>
  );
}
