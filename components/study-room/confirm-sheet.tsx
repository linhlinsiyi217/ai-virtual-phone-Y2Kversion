"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * 书房自有的确认弹窗：写明要处理的对象，取消 / 确定两个按钮。
 * 用来替代浏览器 confirm()；取消、点遮罩、Esc 都不改数据。
 */
export function ConfirmSheet({
  title,
  message,
  confirmLabel = "删除",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="sr-confirm-mask"
      onClick={(event) => {
        event.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="sr-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="sr-confirm-title">{title}</p>
        {message && <p className="sr-confirm-text">{message}</p>}
        <div className="sr-confirm-actions">
          <button type="button" className="sr-btn" onClick={onCancel} autoFocus>
            取消
          </button>
          <button
            type="button"
            className={danger ? "sr-btn sr-confirm-danger" : "sr-btn sr-btn-primary"}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export type MenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 选择类菜单：当前选中项打勾 */
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

/**
 * 紧凑锚点菜单：贴着触发按钮展开，高度随条目数。
 * 下方空间（扣掉 Dock）不够时向上展开；点外面、Esc、选完都会收起。
 */
export function PopMenu({
  label,
  trigger,
  items,
  triggerClassName,
  align = "end",
}: {
  /** 触发按钮的无障碍名称 */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  triggerClassName?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const menuHeight = items.length * 44 + 12;
    // Dock 与安全区约 96px；可视区底部以外放不下就向上
    const room = window.innerHeight - rect.bottom - 96;
    setUp(room < menuHeight && rect.top > menuHeight + 40);
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="sr-pop" ref={wrapRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </button>
      {open && (
        <span className="sr-pop-menu" role="menu" data-up={up || undefined} data-align={align}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              className="sr-pop-item"
              data-danger={item.danger || undefined}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.checked && <Check size={16} strokeWidth={2} className="sr-pop-check" aria-hidden />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
