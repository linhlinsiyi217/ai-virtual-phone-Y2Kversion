"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Trash2, X } from "lucide-react";

import type { Book } from "@/lib/reading-types";
import type { ShelfSort } from "@/lib/study-room/shelf-layout";

export type ShelfReadStatus = "unread" | "reading" | "finished";

const STATUS_FILTERS: Array<{ value: ShelfReadStatus | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "reading", label: "在读" },
  { value: "unread", label: "未读" },
  { value: "finished", label: "读完" },
];

const STATUS_TEXT: Record<ShelfReadStatus, string> = { unread: "未读", reading: "在读", finished: "读完" };

const SORT_OPTIONS: Array<{ value: ShelfSort; label: string }> = [
  { value: "import", label: "导入顺序" },
  { value: "recent", label: "最近阅读" },
  { value: "manual", label: "手动" },
];

/**
 * 书架管理：搜本架、按阅读状态筛、勾选后批量移出。
 * 排序降为次要项放在最下面；手动排序仍在书详情里用「前移 / 后移」调整。
 */
export function StudyRoomShelfManager({
  books,
  statusOf,
  sort,
  onSort,
  onOpen,
  onRemove,
  onClose,
}: {
  books: Book[];
  statusOf: (book: Book) => ShelfReadStatus;
  sort: ShelfSort;
  onSort: (sort: ShelfSort) => void;
  onOpen: (book: Book) => void;
  onRemove: (books: Book[]) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ShelfReadStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const counts = useMemo(() => {
    const result: Record<ShelfReadStatus | "all", number> = { all: books.length, unread: 0, reading: 0, finished: 0 };
    for (const book of books) result[statusOf(book)] += 1;
    return result;
  }, [books, statusOf]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((book) => {
      if (status !== "all" && statusOf(book) !== status) return false;
      if (!q) return true;
      return `${book.title} ${book.author ?? ""}`.toLowerCase().includes(q);
    });
  }, [books, query, status, statusOf]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((book) => selected.has(book.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((book) => next.delete(book.id));
      else visible.forEach((book) => next.add(book.id));
      return next;
    });

  const removeSelected = async () => {
    const targets = books.filter((book) => selected.has(book.id));
    if (targets.length === 0 || removing) return;
    const names = targets.length === 1 ? `《${targets[0].title}》` : `这 ${targets.length} 本书`;
    if (!confirm(`确定从书架移出${names}吗？阅读进度、书签与笔记会一并删除，不能撤销。`)) return;
    setRemoving(true);
    try {
      await onRemove(targets);
      setSelected(new Set());
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sr-sheet sr-sheet--tall sr-shelfm"
        role="dialog"
        aria-modal="true"
        aria-label="书架管理"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sr-shelfm-head">
          <span className="sr-shelfm-title">书架管理</span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭书架管理">
            <X size={20} strokeWidth={1.7} />
          </button>
        </div>

        <label className="sr-search sr-shelfm-search">
          <Search size={17} strokeWidth={1.6} color="var(--c-icon)" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜本架书名、作者"
            aria-label="搜索本架"
            enterKeyHint="search"
          />
          {query && (
            <button type="button" className="sr-shelfm-clear" onClick={() => setQuery("")} aria-label="清空搜索">
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </label>

        <div className="sr-uline-tabs" role="tablist" aria-label="按阅读状态筛选">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={status === item.value}
              className="sr-uline-tab"
              onClick={() => setStatus(item.value)}
            >
              {item.label}
              <span className="sr-uline-count">{counts[item.value]}</span>
            </button>
          ))}
        </div>

        <div className="sr-shelfm-bar">
          <button type="button" className="sr-btn-text" onClick={toggleAll} disabled={visible.length === 0}>
            {allVisibleSelected ? "取消全选" : "全选当前"}
          </button>
          <span className="sr-note-meta">已选 {selected.size} 本</span>
        </div>

        <ul className="sr-shelfm-list">
          {visible.length === 0 ? (
            <li className="sr-shelfm-empty">{books.length === 0 ? "书架还是空的。" : "没有符合条件的书。"}</li>
          ) : (
            visible.map((book) => {
              const on = selected.has(book.id);
              return (
                <li key={book.id} className="sr-shelfm-row" data-on={on || undefined}>
                  <button
                    type="button"
                    className="sr-shelfm-check"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`选择《${book.title}》`}
                    onClick={() => toggle(book.id)}
                  >
                    <span aria-hidden>{on && <Check size={14} strokeWidth={2.4} />}</span>
                  </button>
                  <button type="button" className="sr-shelfm-book" onClick={() => onOpen(book)}>
                    <span className="sr-shelfm-name">{book.title}</span>
                    <span className="sr-note-meta">
                      {book.author ? `${book.author} · ` : ""}
                      {STATUS_TEXT[statusOf(book)]}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="sr-shelfm-foot">
          <div className="sr-shelfm-sort">
            <span className="sr-note-meta">排序</span>
            <div className="sr-sort" role="radiogroup" aria-label="书架排序">
              {SORT_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={sort === item.value}
                  data-active={sort === item.value ? "true" : undefined}
                  onClick={() => onSort(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="sr-btn sr-btn-danger"
            disabled={selected.size === 0 || removing}
            onClick={() => void removeSelected()}
          >
            <Trash2 size={16} strokeWidth={1.8} />
            {removing ? "正在移出…" : `移出书架${selected.size > 0 ? ` ${selected.size}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
