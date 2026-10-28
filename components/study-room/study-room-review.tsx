"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, Quote, PenLine, Bookmark, MessagesSquare, Star } from "lucide-react";

import { loadAllAnnotations, loadBookmarks, loadChapters, loadNotes, loadProgress } from "@/lib/reading-storage";
import type { Book, ReadingAnnotation, ReadingBookmark, ReadingNote, ReadingProgress } from "@/lib/reading-types";
import { loadStageSummaries, summariesForBook, type StageSummary } from "@/lib/study-room/reading-memory";

type StudyRoomReviewProps = {
  book: Book;
  onRead: (book: Book, chapterIndex: number, paragraphIndex?: number) => void;
  onClose: () => void;
};

type ReviewData = {
  chapters: string[];
  progress: ReadingProgress | null;
  notes: ReadingNote[];
  bookmarks: ReadingBookmark[];
  annotations: ReadingAnnotation[];
  summaries: StageSummary[];
};

type TimelineIcon = "summary" | "note" | "annotate" | "bookmark";

type TimelineItem = {
  key: string;
  icon: TimelineIcon;
  text: string;
  meta: string;
  paragraphIndex?: number;
};

/**
 * 回顾：快速回顾只看阶段小结与关键数字；
 * 精细回顾按章把阶段小结、笔记、角色批注、书签并成一条时间线，每条都能跳回原文。
 */
export function StudyRoomReview({ book, onRead, onClose }: StudyRoomReviewProps) {
  const [mode, setMode] = useState<"quick" | "fine">("quick");
  const [data, setData] = useState<ReviewData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [chapters, progress, notes, bookmarks, allAnnotations] = await Promise.all([
        loadChapters(book.id).catch(() => []),
        loadProgress(book.id).catch(() => null),
        loadNotes(book.id).catch(() => []),
        loadBookmarks(book.id).catch(() => []),
        loadAllAnnotations().catch(() => []),
      ]);
      if (cancelled) return;
      setData({
        chapters: chapters.map((chapter) => chapter.title),
        progress,
        notes,
        bookmarks,
        annotations: allAnnotations.filter((item) => item.bookId === book.id),
        summaries: summariesForBook(loadStageSummaries(), book.id),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      summaries: data.summaries.length,
      notes: data.notes.length,
      starred: data.notes.filter((note) => note.starred).length,
      annotations: data.annotations.length,
      bookmarks: data.bookmarks.length,
      readTo: data.progress?.lastReadAt ? `读到第 ${data.progress.chapterIndex + 1} 章` : "还没开始读",
    };
  }, [data]);

  /** 精细回顾：按章合并所有痕迹 */
  const timeline = useMemo(() => {
    if (!data) return [] as Array<[number, TimelineItem[]]>;
    const byChapter = new Map<number, TimelineItem[]>();
    const push = (chapterIndex: number, item: TimelineItem) => {
      const list = byChapter.get(chapterIndex) ?? [];
      list.push(item);
      byChapter.set(chapterIndex, list);
    };
    for (const summary of data.summaries) {
      push(summary.fromChapter, {
        key: summary.id,
        icon: "summary",
        text: summary.summary,
        meta: `${summary.characterName} · 第 ${summary.fromChapter + 1}–${summary.toChapter + 1} 章的阶段记录`,
      });
    }
    for (const note of data.notes) {
      push(note.chapterIndex, {
        key: note.id,
        icon: "note",
        text: `${note.emoji ? `${note.emoji} ` : ""}${note.content || note.quote}`,
        meta: note.starred ? "我的笔记 · 已收藏" : "我的笔记",
        paragraphIndex: note.paragraphIndex,
      });
    }
    for (const annotation of data.annotations) {
      push(annotation.chapterIndex, {
        key: annotation.id,
        icon: "annotate",
        text: `${annotation.emoji ? `${annotation.emoji} ` : ""}${annotation.content}`,
        meta: `${annotation.characterName} 的批注`,
        paragraphIndex: annotation.paragraphIndex,
      });
    }
    for (const bookmark of data.bookmarks) {
      push(bookmark.chapterIndex, {
        key: bookmark.id,
        icon: "bookmark",
        text: bookmark.excerpt || "书签",
        meta: "阅读书签",
        paragraphIndex: bookmark.paragraphIndex,
      });
    }
    return Array.from(byChapter.entries()).sort((a, b) => a[0] - b[0]);
  }, [data]);

  const icons = {
    summary: <Sparkles size={14} strokeWidth={1.8} />,
    note: <PenLine size={14} strokeWidth={1.8} />,
    annotate: <MessagesSquare size={14} strokeWidth={1.8} />,
    bookmark: <Bookmark size={14} strokeWidth={1.8} />,
  };

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div className="sr-sheet sr-sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sr-gift-head">
          <span className="sr-sheet-label" style={{ margin: 0 }}>
            回顾《{book.title}》
          </span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <div className="sr-chip-row" style={{ marginBottom: 10 }}>
          <button type="button" className="sr-chip" data-active={mode === "quick" ? "true" : undefined} onClick={() => setMode("quick")}>
            快速回顾
          </button>
          <button type="button" className="sr-chip" data-active={mode === "fine" ? "true" : undefined} onClick={() => setMode("fine")}>
            精细回顾
          </button>
        </div>

        {!data || !stats ? (
          <p className="sr-note-meta">正在整理…</p>
        ) : mode === "quick" ? (
          <>
            <div className="sr-review-stats">
              <span>{stats.readTo}</span>
              <span>阶段记录 {stats.summaries}</span>
              <span>笔记 {stats.notes}</span>
              <span>
                <Star size={11} strokeWidth={1.8} style={{ verticalAlign: -1 }} /> 收藏 {stats.starred}
              </span>
              <span>角色批注 {stats.annotations}</span>
              <span>书签 {stats.bookmarks}</span>
            </div>
            {stats.summaries === 0 ? (
              <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>
                还没有阶段记录：读过一段后可以在书详情点「现在总结」，或在「我的 → 阅读记忆」里设置自动记录的间隔。
              </p>
            ) : (
              <ul className="sr-review-list">
                {data.summaries.map((summary) => (
                  <li key={summary.id}>
                    <button type="button" onClick={() => onRead(book, summary.toChapter)}>
                      <Sparkles size={14} strokeWidth={1.8} />
                      <span className="sr-detail-note-text">
                        <strong>{summary.characterName}</strong> · 第 {summary.fromChapter + 1}–{summary.toChapter + 1} 章
                        <br />
                        {summary.summary}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : timeline.length === 0 ? (
          <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>
            这本书还没有留下任何痕迹。阅读时选中文字可以书摘、批注，也可以让角色批注，都会出现在这里。
          </p>
        ) : (
          <div className="sr-review-timeline">
            {timeline.map(([chapterIndex, items]) => (
              <div key={chapterIndex} className="sr-review-chapter">
                <button type="button" className="sr-review-chapter-head" onClick={() => onRead(book, chapterIndex, 0)}>
                  第 {chapterIndex + 1} 章 · {data.chapters[chapterIndex] || "（无标题）"}
                  <span className="sr-note-meta">{items.length} 条</span>
                </button>
                <ul>
                  {items.map((item) => (
                    <li key={item.key} data-kind={item.icon}>
                      {icons[item.icon]}
                      <button type="button" onClick={() => onRead(book, chapterIndex, item.paragraphIndex ?? 0)}>
                        <span className="sr-review-text">{item.text}</span>
                        <span className="sr-note-meta">{item.meta}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="sr-note-meta" style={{ marginTop: 10 }}>
              <Quote size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 4 }} />
              每条都能跳回原文位置；位置记的是章节与段落，改字号或换设备后仍能对上。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
