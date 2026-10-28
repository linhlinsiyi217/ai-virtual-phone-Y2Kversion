"use client";

import { useEffect, useState } from "react";

import { CreativePanel } from "./study-room-creative-panel";

import { loadAllBookmarks, loadAllNotes, loadBooks } from "@/lib/reading-storage";
import type { ReadingBookmark } from "@/lib/reading-types";

type StudyRoomDeskProps = {
  /** 打开某个创作草稿（写作界面在独立页面） */
  onOpenDraft: (draftId: string) => void;
  /** 资料盒里的两个入口 */
  onOpenNotes: () => void;
  onOpenWishlist: () => void;
};

/**
 * 书桌：主要入口一屏可达。
 * 「阅读留下的东西」（书摘批注、书签）不再在页面底部堆列表，
 * 而是作为工具格子之一，点开是底部面板。
 */
export function StudyRoomDesk({ onOpenDraft, onOpenNotes, onOpenWishlist }: StudyRoomDeskProps) {
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[] | null>(null);
  const [noteCount, setNoteCount] = useState(0);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [marks, notes] = await Promise.all([loadAllBookmarks(), loadAllNotes()]);
      if (cancelled) return;
      const titles: Record<string, string> = {};
      for (const book of loadBooks()) titles[book.id] = book.title;
      setBookTitles(titles);
      setBookmarks(marks);
      setNoteCount(notes.length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sr-desk">
      <CreativePanel
        onOpenDraft={onOpenDraft}
        onOpenNotes={onOpenNotes}
        onOpenWishlist={onOpenWishlist}
        reading={{ noteCount, bookmarks, bookTitles }}
      />
    </div>
  );
}
