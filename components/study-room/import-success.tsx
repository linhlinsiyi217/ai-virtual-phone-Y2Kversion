"use client";

import { useEffect, useState } from "react";

import { STUDYROOM_IMPORTED_EVENT, type StudyRoomImportedDetail } from "@/lib/study-room/events";

/**
 * 导入成功的小弹窗：绿色对勾 + 「已经导入成功」，约 1.8 秒后自己收起，点一下也能关。
 * 不加遮罩、不拦点击（只有卡片本身可点），不挡后续操作；连续导入只显示最新一本。
 */
export function ImportSuccessHost() {
  const [shown, setShown] = useState<{ title: string; key: number } | null>(null);

  useEffect(() => {
    const onImported = (event: Event) => {
      const title = (event as CustomEvent<StudyRoomImportedDetail>).detail?.title ?? "";
      setShown({ title, key: Date.now() });
    };
    window.addEventListener(STUDYROOM_IMPORTED_EVENT, onImported);
    return () => window.removeEventListener(STUDYROOM_IMPORTED_EVENT, onImported);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), 1800);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  return (
    <div className="sr-imported-layer" aria-live="polite">
      <button key={shown.key} type="button" className="sr-imported" onClick={() => setShown(null)}>
        <svg className="sr-imported-check" viewBox="0 0 52 52" aria-hidden>
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27.5l7.5 7.5L38 19" />
        </svg>
        <span className="sr-imported-text">已经导入成功</span>
        {shown.title && <span className="sr-imported-title">《{shown.title}》</span>}
      </button>
    </div>
  );
}
