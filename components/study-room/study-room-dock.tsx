"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type DockItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

type StudyRoomDockProps = {
  items: DockItem[];
  active: string;
  onSelect: (key: string) => void;
};

const TAB_GAP = 2;
const BAR_PADDING = 5;
/** 选中项左右内边距 + 图标 + 图标与文字间距 */
const ACTIVE_PAD_X = 14;
const ICON_SIZE = 20;
const ICON_GAP = 6;
/** 未选中项最窄也要放得下一个图标并保留 44px 左右的点击区 */
const MIN_IDLE_WIDTH = 40;
const MIN_ACTIVE_WIDTH = 64;
/** 选中项最宽：再长的名字（书友圈可以自己改名）就省略 */
const MAX_ACTIVE_WIDTH = 132;

/**
 * 书房底部 Dock。
 *
 * 规则：
 *  - 未选中只显示图标，选中显示「图标＋单行短名」；
 *  - 一整块圆角高亮在图标与文字后方，完整包住选中项（含四周内边距）；
 *  - 高亮的位置与宽度直接由布局公式算出（不读正在过渡中的 DOM 尺寸），
 *    所以高亮和按钮宽度用同一条曲线、同时到位，不会「高亮先到、按钮后挤」；
 *  - 选中项宽度按这一项的文字实际宽度测量（字体加载完成后会重测），
 *    名字长短不同时高亮宽度跟着变；
 *  - 只过渡 transform / width / opacity，CSS 过渡天然可从当前位置转向，连点不排队；
 *  - 首次定位、屏宽变化时不播放过渡（不会从左边飞进来）；
 *  - 输入框获得焦点时（软键盘弹起）Dock 让开，失焦后回来；
 *  - prefers-reduced-motion：去掉回弹与位移，只保留选中状态切换。
 */
export function StudyRoomDock({ items, active, onSelect }: StudyRoomDockProps) {
  const barRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const capsuleRef = useRef<HTMLSpanElement>(null);
  const squashRef = useRef<Animation | null>(null);
  const [usable, setUsable] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const [animate, setAnimate] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  const labelsKey = items.map((item) => `${item.key}:${item.label}`).join("|");

  // 量容器可用宽度与每个名字的文字宽度
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let frame = 0;
    const measure = () => {
      const count = Math.max(items.length, 1);
      // Dock 本身最宽是父容器减去两侧留白；这里用父容器宽度，避免读到自己被内容撑开的宽度
      const host = bar.parentElement?.clientWidth ?? bar.clientWidth;
      const outer = Math.min(host - 16, 460);
      setUsable(Math.max(outer - BAR_PADDING * 2 - TAB_GAP * (count - 1), 0));
      const box = measureRef.current;
      if (box) {
        const next: Record<string, number> = {};
        box.querySelectorAll<HTMLElement>("[data-key]").forEach((node) => {
          next[node.dataset.key ?? ""] = Math.ceil(node.getBoundingClientRect().width);
        });
        setLabelWidths(next);
      }
    };
    measure();
    const observer = new ResizeObserver(() => {
      // 屏宽变化时直接落位，不播放过渡
      setAnimate(false);
      measure();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAnimate(true));
    });
    observer.observe(bar.parentElement ?? bar);
    // 字体加载完成后文字宽度会变，重测一次
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    // 首次定位后的下一帧才开始允许过渡
    frame = requestAnimationFrame(() => setAnimate(true));
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(query?.matches === true);
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  // 软键盘：书房里的输入框获得焦点时 Dock 让开，不挡输入
  useEffect(() => {
    const isTyping = (node: EventTarget | null) => {
      if (!(node instanceof HTMLElement)) return false;
      if (!node.closest(".sr-app")) return false;
      if (node.isContentEditable) return true;
      if (node instanceof HTMLTextAreaElement) return true;
      if (node instanceof HTMLInputElement) {
        return !["button", "checkbox", "radio", "range", "file", "color", "submit", "reset"].includes(node.type);
      }
      return false;
    };
    const onIn = (event: FocusEvent) => setKeyboard(isTyping(event.target));
    const onOut = () => {
      // 焦点可能只是在两个输入框之间移动，等一帧再看
      requestAnimationFrame(() => setKeyboard(isTyping(document.activeElement)));
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  // 每次切换时一次克制的压缩回弹；先取消上一次，可直接被打断，不排队
  useEffect(() => {
    const el = capsuleRef.current;
    if (!el || reduced || !animate || typeof el.animate !== "function") return;
    squashRef.current?.cancel();
    squashRef.current = el.animate(
      [
        { scale: "1 1" },
        { scale: "0.95 1.02", offset: 0.3 },
        { scale: "1.015 0.995", offset: 0.68 },
        { scale: "1 1" },
      ],
      { duration: 320, easing: "ease-out" },
    );
    return () => squashRef.current?.cancel();
    // 只在切换选中项时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const count = Math.max(items.length, 1);
  const activeIndex = Math.max(
    items.findIndex((item) => item.key === active),
    0,
  );
  const activeKey = items[activeIndex]?.key ?? "";
  const labelWidth = labelWidths[activeKey] ?? 36;
  // 选中项：按文字真实宽度算，最窄 64、最宽 132；同时给其他项各留至少 40px
  const maxActive = count > 1 ? usable - MIN_IDLE_WIDTH * (count - 1) : usable;
  const activeWidth = Math.round(
    Math.max(
      MIN_ACTIVE_WIDTH,
      Math.min(ACTIVE_PAD_X * 2 + ICON_SIZE + ICON_GAP + labelWidth, MAX_ACTIVE_WIDTH, maxActive),
    ),
  );
  const idleWidth = count > 1 ? Math.max(Math.floor((usable - activeWidth) / (count - 1)), MIN_IDLE_WIDTH) : 0;
  const rowWidth = activeWidth + idleWidth * (count - 1) + TAB_GAP * (count - 1);
  // 选中项前面的都是未选中项：位置直接算，不读 DOM
  const capsuleX = activeIndex * (idleWidth + TAB_GAP);
  const ready = usable > 0;

  const select = useCallback((key: string) => onSelect(key), [onSelect]);

  return (
    <nav
      className="sr-dock"
      aria-label="书房导航"
      ref={barRef}
      data-animate={animate && ready ? "true" : undefined}
      data-hidden={keyboard ? "true" : undefined}
    >
      {/* 量文字宽度用的隐藏副本：和选中项用同一套字号字重 */}
      <span className="sr-dock-measure" ref={measureRef} aria-hidden>
        {items.map((item) => (
          <span key={item.key} data-key={item.key} className="sr-dock-label">
            {item.label}
          </span>
        ))}
      </span>
      <div className="sr-dock-row" style={{ width: `${Math.max(rowWidth, 0)}px` }}>
        {/* 高亮块在 row 内、按钮下层：一整块包住图标和文字 */}
        <span
          ref={capsuleRef}
          className="sr-dock-capsule"
          aria-hidden
          data-ready={ready ? "true" : undefined}
          style={{ transform: `translate3d(${capsuleX}px, 0, 0)`, width: `${activeWidth}px` }}
        />
        {items.map((item, index) => {
          const Icon = item.icon;
          const isActive = index === activeIndex;
          return (
            <button
              key={item.key}
              type="button"
              className="sr-dock-tab"
              data-active={isActive ? "true" : undefined}
              style={{ width: `${isActive ? activeWidth : idleWidth}px` }}
              onClick={() => select(item.key)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="sr-dock-icon" aria-hidden>
                <Icon size={ICON_SIZE} strokeWidth={isActive ? 1.9 : 1.7} />
              </span>
              <span className="sr-dock-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
