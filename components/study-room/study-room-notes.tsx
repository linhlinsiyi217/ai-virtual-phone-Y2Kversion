"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Search,
  StickyNote,
  Quote,
  PenLine,
  Trash2,
  ArrowDownUp,
  Layers,
  Image as ImageIcon,
  MessagesSquare,
  Star,
  Tag,
} from "lucide-react";

import {
  loadAllNotes,
  loadAllAnnotations,
  loadBooks,
  loadChapters,
  deleteNote,
  saveNote,
} from "@/lib/reading-storage";
import type { Book, ReadingAnnotation, ReadingNote } from "@/lib/reading-types";
import { bookVersionOf } from "@/lib/study-room/annotations";

type StudyRoomNotesProps = {
  onBack: () => void;
  onOpenSource: (book: Book, chapterIndex: number, paragraphIndex: number) => void;
};

type EditingState = { note: ReadingNote; draft: string; tags: string };

/** 笔记很多时一次只渲染这么多，避免一次进几千张卡片 */
const NOTE_PAGE = 60;

export function StudyRoomNotes({ onBack, onOpenSource }: StudyRoomNotesProps) {
  const [notes, setNotes] = useState<ReadingNote[] | null>(null);
  const [books, setBooks] = useState<Record<string, Book>>({});
  const [chapterTitles, setChapterTitles] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [groupByBook, setGroupByBook] = useState(true);
  const [showCover, setShowCover] = useState(true);
  const [editing, setEditing] = useState<EditingState | null>(null);
  // 角色批注：只读，但可以跳回自己的阅读位置
  const [annotations, setAnnotations] = useState<ReadingAnnotation[] | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [listLimit, setListLimit] = useState(NOTE_PAGE);
  const [starredOnly, setStarredOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [allNotes, allAnnotations] = await Promise.all([
        loadAllNotes(),
        loadAllAnnotations().catch(() => []),
      ]);
      if (cancelled) return;
      setAnnotations(allAnnotations);
      const bookMap: Record<string, Book> = {};
      for (const book of loadBooks()) bookMap[book.id] = book;
      setBooks(bookMap);
      setNotes(allNotes);

      // 为有笔记的书补上章节标题（回跳与展示都需要）
      const bookIds = Array.from(new Set(allNotes.map((n) => n.bookId)));
      const titles: Record<string, string> = {};
      for (const bookId of bookIds) {
        const chapters = await loadChapters(bookId).catch(() => []);
        for (const chapter of chapters) titles[`${bookId}:${chapter.index}`] = chapter.title;
      }
      if (!cancelled) setChapterTitles(titles);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chapterLabel = (note: ReadingNote): string =>
    chapterTitles[`${note.bookId}:${note.chapterIndex}`] || `第 ${note.chapterIndex + 1} 章`;

  const filtered = useMemo(() => {
    if (!notes) return [];
    const q = query.trim().toLowerCase();
    const matched = notes
      .filter((note) => (starredOnly ? note.starred === true : true))
      .filter((note) => (tagFilter ? (note.tags ?? []).includes(tagFilter) : true))
      .filter((note) => {
        if (!q) return true;
        const bookTitle = books[note.bookId]?.title ?? "";
        return (
          note.quote.toLowerCase().includes(q) ||
          (note.content ?? "").toLowerCase().includes(q) ||
          bookTitle.toLowerCase().includes(q) ||
          chapterLabel(note).toLowerCase().includes(q) ||
          (note.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
        );
      });
    const sorted = [...matched].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, query, sortDesc, books, chapterTitles, starredOnly, tagFilter]);

  const visibleNotes = useMemo(() => filtered.slice(0, listLimit), [filtered, listLimit]);

  const allTags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const note of notes ?? []) {
      for (const tag of note.tags ?? []) counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
    return Array.from(counter.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
  }, [notes]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReadingNote[]>();
    for (const note of visibleNotes) {
      const list = map.get(note.bookId) ?? [];
      list.push(note);
      map.set(note.bookId, list);
    }
    return Array.from(map.entries());
  }, [visibleNotes]);

  /** 跳回原文前先确认版本：换过文件/重新导入过就提示定位可能不准。 */
  const jumpToSource = (book: Book, chapterIndex: number, paragraphIndex: number, version?: string) => {
    if (version && version !== bookVersionOf(book)) {
      const ok = confirm("这本书换过版本（重新导入或文件有变化），定位可能不准。仍要跳过去吗？");
      if (!ok) return;
    }
    onOpenSource(book, chapterIndex, paragraphIndex);
  };

  const handleDelete = async (note: ReadingNote) => {
    if (!confirm("删除这条笔记？原文上的标记也会一并移除。")) return;
    await deleteNote(note.id);
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const content = editing.draft.trim();
    const next: ReadingNote = {
      ...editing.note,
      kind: content || (editing.note.emoji ?? "") ? "note" : "excerpt",
      content: content || undefined,
      tags: editing.tags.split(/[、,，s]+/).filter(Boolean).slice(0, 6),
      updatedAt: new Date().toISOString(),
    };
    await saveNote(next);
    setNotes((prev) => (prev ? prev.map((n) => (n.id === next.id ? next : n)) : prev));
    setEditing(null);
  };

  /** 角色批注与用户批注分开管理：这里只展示与回跳，不提供编辑 */
  const filteredAnnotations = useMemo(() => {
    if (!annotations) return [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? annotations.filter((item) => {
          const bookTitle = books[item.bookId]?.title ?? "";
          return (
            item.content.toLowerCase().includes(q) ||
            item.characterName.toLowerCase().includes(q) ||
            bookTitle.toLowerCase().includes(q)
          );
        })
      : annotations;
    const sorted = [...matched].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, query, sortDesc, books, chapterTitles]);

  const renderAnnotationCard = (item: ReadingAnnotation) => {
    const book = books[item.bookId];
    return (
      <div key={item.id} className="sr-note-card" data-source="character">
        {item.quote && <p className="sr-note-quote">{item.quote}</p>}
        <p className="sr-note-thought">
          {item.emoji && <span className="sr-mark-emoji">{item.emoji} </span>}
          {item.content}
        </p>
        <div className="sr-note-foot">
          <span className="sr-note-meta">
            {item.characterName} · {book?.title ?? "未知书籍"} ·{" "}
            {chapterTitles[`${item.bookId}:${item.chapterIndex}`] || "第 " + (item.chapterIndex + 1) + " 章"} ·{" "}
            {new Date(item.createdAt).toLocaleDateString("zh-CN")}
          </span>
          <span className="sr-note-tools">
            <button
              type="button"
              className="sr-note-tool"
              title="回到我读到的地方"
              disabled={!book}
              onClick={() => book && jumpToSource(book, item.chapterIndex, item.paragraphIndex, undefined)}
            >
              <Quote size={15} strokeWidth={1.7} />
            </button>
          </span>
        </div>
      </div>
    );
  };

  const renderCard = (note: ReadingNote) => {
    const book = books[note.bookId];
    return (
      <div key={note.id} className="sr-note-card">
        <p className="sr-note-quote">{note.quote}</p>
        {note.tags && note.tags.length > 0 && (
          <div className="sr-chip-row" style={{ marginTop: 6, gap: 4 }}>
            {note.tags.map((tag) => (
              <span key={tag} className="sr-note-tag">{tag}</span>
            ))}
          </div>
        )}
        {(note.emoji || note.content) && (
          <p className="sr-note-thought">
            {note.emoji && <span className="sr-mark-emoji">{note.emoji} </span>}
            {note.content}
          </p>
        )}
        <div className="sr-note-foot">
          <span className="sr-note-meta">
            {book?.title ?? "未知书籍"} · {chapterLabel(note)} ·{" "}
            {new Date(note.updatedAt).toLocaleDateString("zh-CN")}
          </span>
          <span className="sr-note-tools">
            <button
              type="button"
              className="sr-note-tool"
              title="回到原文"
              disabled={!book}
              onClick={() => book && jumpToSource(book, note.chapterIndex, note.paragraphIndex, note.bookVersion)}
            >
              <Quote size={15} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              className="sr-note-tool"
              title={note.starred ? "取消收藏" : "收藏这条"}
              data-active={note.starred ? "true" : undefined}
              onClick={async () => {
                const next = { ...note, starred: !note.starred, updatedAt: new Date().toISOString() };
                await saveNote(next);
                setNotes((prev) => (prev ? prev.map((n) => (n.id === next.id ? next : n)) : prev));
              }}
            >
              <Star size={15} strokeWidth={1.7} fill={note.starred ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              className="sr-note-tool"
              title="编辑想法与标签"
              onClick={() => {
                setEditing({ note, draft: note.content ?? "", tags: (note.tags ?? []).join("、") });
              }}
            >
              <PenLine size={15} strokeWidth={1.7} />
            </button>
            <button type="button" className="sr-note-tool" title="删除" onClick={() => handleDelete(note)}>
              <Trash2 size={15} strokeWidth={1.7} />
            </button>
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">笔记</div>
            <span className="sr-header-sub">
              {notes ? `${notes.length} 条 · 摘录与批注` : "摘录与批注"}
            </span>
          </div>
          <button
            type="button"
            className="sr-icon-btn"
            data-active={!showCover ? "true" : undefined}
            onClick={() => setShowCover((v) => !v)}
            aria-label={showCover ? "隐藏封面" : "显示封面"}
            title={showCover ? "隐藏封面" : "显示封面"}
          >
            <ImageIcon size={20} strokeWidth={1.6} />
          </button>
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          <div className="sr-search">
            <Search size={18} strokeWidth={1.6} color="var(--c-icon)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记、书摘、书名或章节"
              aria-label="搜索笔记"
            />
          </div>

          <div className="sr-chip-row">
            <button
              type="button"
              className="sr-chip"
              data-active={groupByBook ? "true" : undefined}
              onClick={() => setGroupByBook((v) => !v)}
            >
              <Layers size={13} strokeWidth={1.8} style={{ marginRight: 5 }} />
              {groupByBook ? "按书分组" : "全部笔记"}
            </button>
            <button type="button" className="sr-btn sr-btn-sm" onClick={() => setSortDesc((v) => !v)}>
              <ArrowDownUp size={13} strokeWidth={1.8} style={{ marginRight: 5 }} />
              {sortDesc ? "从新到旧" : "从旧到新"}
            </button>
            <button
              type="button"
              className="sr-chip"
              data-active={showAnnotations ? "true" : undefined}
              onClick={() => setShowAnnotations((v) => !v)}
            >
              <MessagesSquare size={13} strokeWidth={1.8} style={{ marginRight: 5 }} />
              角色批注
            </button>
            <button
              type="button"
              className="sr-chip"
              data-active={starredOnly ? "true" : undefined}
              onClick={() => setStarredOnly((v) => !v)}
            >
              <Star size={13} strokeWidth={1.8} style={{ marginRight: 5 }} />
              收藏
            </button>
          </div>

          {allTags.length > 0 && (
            <div className="sr-chip-row" style={{ marginTop: -4 }}>
              <span className="sr-note-meta" style={{ alignSelf: "center" }}>
                <Tag size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 4 }} />
                标签
              </span>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="sr-chip"
                  data-active={tagFilter === tag ? "true" : undefined}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {showAnnotations && filteredAnnotations.length > 0 && (
            <div className="sr-note-group">
              <div className="sr-note-group-head">
                <span className="sr-note-group-title">角色批注</span>
                <span className="sr-note-group-count">{filteredAnnotations.length}</span>
              </div>
              {filteredAnnotations.map(renderAnnotationCard)}
            </div>
          )}

          {notes === null ? (
            <div className="sr-empty">
              <p>正在载入笔记…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="sr-empty">
              <StickyNote size={42} strokeWidth={1} />
              <p>
                {query.trim() ? "没有匹配的笔记。" : (
                  <>
                    还没有笔记。
                    <br />
                    阅读时选中文字即可收藏书摘或写下批注。
                  </>
                )}
              </p>
            </div>
          ) : groupByBook ? (
            grouped.map(([bookId, list]) => {
              const book = books[bookId];
              return (
                <div key={bookId} className="sr-note-group">
                  <div className="sr-note-group-head">
                    {showCover && (
                      <span className="sr-note-cover" aria-hidden>
                        {(book?.title ?? "书").slice(0, 1)}
                      </span>
                    )}
                    <span className="sr-note-group-title">{book?.title ?? "未知书籍"}</span>
                    <span className="sr-note-group-count">{list.length}</span>
                  </div>
                  {list.map(renderCard)}
                </div>
              );
            })
          ) : (
            visibleNotes.map(renderCard)
          )}

          {filtered.length > listLimit && (
            <button
              type="button"
              className="sr-btn"
              style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
              onClick={() => setListLimit((limit) => limit + NOTE_PAGE)}
            >
              显示更多笔记（还有 {filtered.length - listLimit} 条）
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="sr-sheet-mask" onClick={() => setEditing(null)}>
          <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sr-sheet-quote">{editing.note.quote}</div>
            <textarea
              className="sr-sheet-input"
              placeholder="写下你的想法…"
              value={editing.draft}
              rows={3}
              autoFocus
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
            />
            <input
              className="sr-appear-input"
              style={{ width: "100%", marginTop: 8 }}
              value={editing.tags}
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, tags: e.target.value } : prev))}
              placeholder="标签，用顿号分隔（如「人物」「伏笔」）"
              aria-label="标签"
            />
            <div className="sr-sheet-actions">
              <button type="button" className="sr-btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className="sr-btn sr-btn-primary" onClick={handleSaveEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
