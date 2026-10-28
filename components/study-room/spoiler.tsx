"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

/** 剧透内容在摘要、搜索结果、分享卡等「不能逐块点开」的地方统一显示成这句。 */
export const SPOILER_SUMMARY = "含剧透内容，进入书友圈后点开查看";

/** 给摘要类场景用：含剧透就只给安全文案，不给原文。 */
export function spoilerSafe(text: string, spoiler: boolean | undefined): string {
  return spoiler ? SPOILER_SUMMARY : text;
}

/**
 * 剧透遮罩：每一块单独点开、单独收起。
 * 没点开时原文根本不渲染（不是模糊一下），读屏、复制、长按都拿不到内容。
 */
export function SpoilerBlock({
  spoiler,
  children,
  compact,
}: {
  spoiler: boolean | undefined;
  children: ReactNode;
  /** 评论、回复等小块用紧凑样式 */
  compact?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!spoiler) return <>{children}</>;
  if (!revealed) {
    return (
      <button
        type="button"
        className="sr-spoiler-mask"
        data-compact={compact ? "true" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setRevealed(true);
        }}
        aria-label="含剧透，点击查看"
      >
        <EyeOff size={compact ? 14 : 16} strokeWidth={1.8} aria-hidden />
        <span>含剧透，点击查看</span>
      </button>
    );
  }
  return (
    <div className="sr-spoiler-open">
      {children}
      <button
        type="button"
        className="sr-spoiler-rehide"
        onClick={(event) => {
          event.stopPropagation();
          setRevealed(false);
        }}
      >
        <Eye size={13} strokeWidth={1.8} aria-hidden />
        重新隐藏
      </button>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 进入书友圈前的剧透提示：每次进入书房后第一次打开书友圈时问（书房内切页不重复问）。
 * 「继续观看」才进入；「不再观看」、Esc、点遮罩都只是这一次不进，不算同意。
 * 焦点锁在弹窗里（Tab / Shift+Tab 循环），关闭后焦点回到进入前的位置。
 */
export function SpoilerGate({ onContinue, onLeave }: { onContinue: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onLeave();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      } else if (!ref.current.contains(document.activeElement)) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus?.();
    };
    // 只在打开时绑定一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sr-spoiler-gate-mask" onClick={onLeave}>
      <div
        ref={ref}
        className="sr-spoiler-gate"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sr-spoiler-gate-title"
        aria-describedby="sr-spoiler-gate-text"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sr-spoiler-gate-icon" aria-hidden>
          <EyeOff size={22} strokeWidth={1.7} />
        </span>
        <h2 id="sr-spoiler-gate-title" className="sr-spoiler-gate-title">
          剧透提示
        </h2>
        <p id="sr-spoiler-gate-text" className="sr-spoiler-gate-text">
          书友圈可能包含剧情讨论。剧透内容默认隐藏，请确认是否进入。
        </p>
        <div className="sr-spoiler-gate-actions">
          <button type="button" className="sr-btn" onClick={onLeave}>
            不再观看
          </button>
          <button type="button" className="sr-btn sr-btn-primary" onClick={onContinue}>
            继续观看
          </button>
        </div>
      </div>
    </div>
  );
}
