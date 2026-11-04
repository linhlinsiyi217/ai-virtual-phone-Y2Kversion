"use client";

import { useEffect, useMemo, useState } from "react";

import type { Release } from "@/lib/update-log/types";
import { noticeOf, SHOW_TECH_DETAILS } from "@/lib/update-log/user-view";

type UpdateNotePopupProps = {
  /** 应用名，例如「FLOT」「书房」 */
  appName: string;
  release: Release;
  /** 用户点「知道了」：调用方在这里写入已读（只有这一处算确认） */
  onConfirm: () => void;
  /** 「查看完整日志」：只收起弹窗去看日志，不算已读，下次打开还会弹 */
  onOpenLog?: () => void;
  /** 按 Esc / 点遮罩收起：同样不算已读 */
  onHide?: () => void;
};

/** 小标签只保留三种颜色：新增绿、优化蓝、修复橙，其余一律中性灰 */
export function chipClass(label: string): string {
  if (label.includes("新增")) return "is-new";
  if (label.includes("修复")) return "is-fix";
  if (label.includes("优化")) return "is-improve";
  return "is-plain";
}

/**
 * 更新公告（居中弹窗）。
 *
 * 只在更新后的第一次进入时出现，只写这一版的内容；点「知道了」才算读过。
 * 详细说明统一放在设置里的更新日志，这里不再放第二个按钮。
 */
export function UpdateNotePopup({ appName, release, onConfirm, onOpenLog, onHide }: UpdateNotePopupProps) {
  const [leaving, setLeaving] = useState(false);
  const notice = useMemo(() => noticeOf(release), [release]);
  const hidden = release.entries.length - notice.lines.length;

  const handleConfirm = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onConfirm, 160);
  };

  const handleDismiss = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => (onHide ?? onOpenLog ?? onConfirm)(), 160);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div className="up2-mask" role="dialog" aria-modal="true" aria-labelledby="up2-notice-title" onMouseDown={handleDismiss}>
      <section className="up2-notice" data-leaving={leaving ? "true" : undefined} onMouseDown={(event) => event.stopPropagation()}>
        <span className="up2-eyebrow">更新公告</span>
        <h2 className="up2-ver" id="up2-notice-title">
          v{notice.version}
        </h2>
        <span className="up2-date">
          {appName} · {notice.date}
        </span>

        {notice.headline ? <p className="up2-headline">{notice.headline}</p> : null}

        <ul className="up2-lines">
          {notice.lines.map((line, index) => (
            <li className="up2-line" key={`${line.group}-${index}`}>
              <span className={`up2-chip ${chipClass(line.group)}`}>{line.group}</span>
              <span className="up2-line-text">{line.title}</span>
            </li>
          ))}
        </ul>
        {hidden > 0 ? <p className="up2-more">另有 {hidden} 项改动，见设置里的更新日志</p> : null}

        <p className="up2-impact">
          {notice.needsReinstall ? "安卓版需要安装新的安装包才能看到全部改动。" : "本次更新不需要重新安装，打开即生效。"}
        </p>

        {SHOW_TECH_DETAILS ? (
          <p className="up2-dev">
            开发模式 · {release.releaseId}
            {release.pending?.length ? ` · 待确认 ${release.pending.length} 条` : ""}
          </p>
        ) : null}

        <button type="button" className="up2-primary" onClick={handleConfirm}>
          知道了
        </button>
      </section>
    </div>
  );
}
