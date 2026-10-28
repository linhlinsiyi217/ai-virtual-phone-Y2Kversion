"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

const KEY = "ai_phone_studyroom_help_dismissed_v1";
registerKvMigration(KEY);

function loadDismissed(): Record<string, boolean> {
  try {
    const raw = kvGet(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function isHelpDismissed(id: string): boolean {
  return loadDismissed()[id] === true;
}

/** 点「不再提示」后，这个位置的问号不再出现。 */
export function dismissHelp(id: string): void {
  kvSet(KEY, JSON.stringify({ ...loadDismissed(), [id]: true }));
}

type HelpTipProps = {
  /** 稳定 id：决定「不再提示」记在哪一条上 */
  id: string;
  /** 无障碍标签 */
  label: string;
  children: ReactNode;
  /** 气泡方向：靠近页面底部时用 up，免得被裁掉 */
  placement?: "down" | "up";
};

/**
 * 功能旁的小问号：点开在控件附近显示一句短说明（这是什么 / 点了会怎样 / 数据存在哪），
 * 提供「知道了」与「不再提示」。点外部或按 Esc 关闭，不遮挡主要按钮。
 * 只放在不容易理解的功能旁，返回、搜索、点赞这类通用按钮不挂。
 */
/** 气泡挂到「手机屏幕」这一层（书房 / 阅读器 / 聊天的根节点），不再被滚动区、面板的 overflow 裁掉。 */
const SCREEN_ROOTS = ".sr-app, .sr-reader, .sr-msg-app";
const EDGE = 12;
const GAP = 6;

type BubblePos = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  side: "down" | "up";
};

/** 按按钮在屏幕根节点里的位置算气泡坐标：左右夹在屏幕内，上下哪边空间大放哪边，超出部分在气泡内部滚动。 */
function measure(button: HTMLElement, root: HTMLElement, prefer: "down" | "up"): BubblePos {
  const rootRect = root.getBoundingClientRect();
  const btn = button.getBoundingClientRect();
  // 键盘弹出时可见区域变矮：底边取可见视口和屏幕根节点里更靠上的那个
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const visibleBottom = vv ? Math.min(rootRect.bottom, vv.offsetTop + vv.height) : rootRect.bottom;
  const rootW = root.clientWidth || rootRect.width;
  const width = Math.min(280, Math.max(160, rootW - EDGE * 2));
  const centerX = btn.left + btn.width / 2 - rootRect.left;
  const left = Math.min(Math.max(centerX - width / 2, EDGE), Math.max(EDGE, rootW - width - EDGE));
  const spaceBelow = visibleBottom - btn.bottom - GAP - EDGE;
  const spaceAbove = btn.top - rootRect.top - GAP - EDGE;
  const fitsPreferred = prefer === "down" ? spaceBelow >= 140 : spaceAbove >= 140;
  const side: "down" | "up" = fitsPreferred ? prefer : spaceBelow >= spaceAbove ? "down" : "up";
  if (side === "down") {
    return { left, width, top: btn.bottom - rootRect.top + GAP, maxHeight: Math.max(96, spaceBelow), side };
  }
  return { left, width, bottom: rootRect.bottom - btn.top + GAP, maxHeight: Math.max(96, spaceAbove), side };
}

export function HelpTip({ id, label, children, placement = "down" }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => isHelpDismissed(id));
  const [pos, setPos] = useState<BubblePos | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const button = buttonRef.current;
    if (!button) return;
    const screen = (button.closest(SCREEN_ROOTS) as HTMLElement | null) ?? document.body;
    setRoot(screen);
    const update = () => setPos(measure(button, screen, placement));
    update();
    const vv = window.visualViewport;
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    // 内部滚动区滚动时跟着按钮走（捕获阶段，任何层级的滚动都能收到）
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || bubbleRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (dismissed) return null;

  const bubbleStyle: CSSProperties | undefined = pos
    ? {
        left: pos.left,
        width: pos.width,
        top: pos.top,
        bottom: pos.bottom,
        maxHeight: pos.maxHeight,
      }
    : { visibility: "hidden" };

  return (
    <span className="sr-help" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="sr-help-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpCircle size={15} strokeWidth={1.8} />
      </button>
      {open && root && createPortal(
        <span
          ref={bubbleRef}
          className="sr-help-bubble"
          role="dialog"
          aria-label={label}
          data-placement={pos?.side ?? placement}
          style={bubbleStyle}
          // 气泡挂在屏幕根节点上：别让点击冒泡触发底下卡片的点击
          onClick={(event) => event.stopPropagation()}
        >
          <span className="sr-help-text">{children}</span>
          <span className="sr-help-actions">
            <button type="button" className="sr-help-link" onClick={() => setOpen(false)}>
              知道了
            </button>
            <button
              type="button"
              className="sr-help-link sr-help-link--muted"
              onClick={() => {
                dismissHelp(id);
                setDismissed(true);
              }}
            >
              不再提示
            </button>
          </span>
        </span>,
        root,
      )}
    </span>
  );
}

/** 页面底部的「关于 xx」：一行短标签 + 问号，说明收进气泡，不再铺成段小字。 */
export function HelpFoot({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  if (isHelpDismissed(id)) return null;
  return (
    <div className="sr-help-foot">
      <span>{label}</span>
      <HelpTip id={id} label={label} placement="up">
        {children}
      </HelpTip>
    </div>
  );
}
