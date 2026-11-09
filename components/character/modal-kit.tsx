"use client";

// 角色档案统一弹层骨架：
// CSheet   —— 长弹层（白色圆角大弹层 + 英文小标题 + 中文大标题 + 圆形关闭 + 底部黑色大按钮）
// CConfirm —— 小型确认框（居中白卡，左描边取消 / 右黑色主按钮）
// 样式统一在 styles/character-archive.css 的 .cm / .cf 段，不在各弹窗里单独写。

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function CSheet({
  eyebrow,
  title,
  onClose,
  onBackdrop,
  children,
  footer,
  closeDisabled = false,
  bodyClassName = "",
  ariaLabel,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  /** 点遮罩的行为，默认关闭 */
  onBackdrop?: () => void;
  children: ReactNode;
  footer?: { label: string; onClick: () => void; disabled?: boolean };
  closeDisabled?: boolean;
  bodyClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className="cm-overlay"
      onClick={closeDisabled ? undefined : (onBackdrop ?? onClose)}
    >
      <div
        className="cm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cm-top">
          <div className="cm-eyebrow">{eyebrow}</div>
          <h2 className="cm-title">{title}</h2>
          <button
            type="button"
            className="cm-x"
            aria-label="关闭"
            disabled={closeDisabled}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className={`cm-body ${bodyClassName}`}>{children}</div>
        {footer && (
          <div className="cm-foot">
            <button
              type="button"
              className="cm-primary"
              disabled={footer.disabled}
              onClick={footer.onClick}
            >
              {footer.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CConfirm({
  title,
  message,
  cancelLabel = "取消",
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  children,
  ariaLabel,
}: {
  title: string;
  message?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="cf-overlay" onClick={onCancel}>
      <div
        className="cf-card"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="cf-title">{title}</h3>
        {message && <p className="cf-desc">{message}</p>}
        {children}
        <div className="cf-actions">
          <button type="button" className="cf-btn cf-btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="cf-btn cf-btn-primary"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
