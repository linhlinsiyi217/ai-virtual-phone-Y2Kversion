"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";

import type { Release } from "@/lib/update-log/types";
import { noticeOf, SHOW_TECH_DETAILS, USER_GROUP_COLOR, USER_GROUP_LABEL } from "@/lib/update-log/user-view";

type UpdateNotePopupProps = {
  /** 应用名，例如「FLOT」「书房」 */
  appName: string;
  release: Release;
  /** 用户点「我知道了」：调用方在这里写入已读（只有这一处算确认） */
  onConfirm: () => void;
  /** 「查看完整日志」：只收起弹窗去看日志，不算已读，下次打开还会弹 */
  onOpenLog?: () => void;
  /** 按 Esc / 点遮罩 / 点「稍后查看」收起：同样不算已读 */
  onHide?: () => void;
};

/**
 * 更新公告（系统与书房共用一套）。
 *
 * 公告面向普通用户，只放：版本号、日期、一句话总结、本次新增 / 修复 / 优化的标题、
 * 涉及的应用、需不需要刷新或重装。每条的详细说明在「查看完整日志」里，
 * 公告与日志由同一份发布记录派生（lib/update-log/user-view.ts），不会一边一个版本。
 * 只有点「我知道了」才写入已读；「稍后查看」、点遮罩、按 Esc 都只是暂时收起。
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
    <div className="updn-mask" role="dialog" aria-modal="true" aria-labelledby="updn-title" onMouseDown={handleDismiss}>
      <section
        className="updn-card"
        data-leaving={leaving ? "true" : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="updn-head">
          <span className="updn-eyebrow">更新公告</span>
          <h2 className="updn-title" id="updn-title">
            {appName} v{notice.version}
          </h2>
          <span className="updn-meta">{notice.date}</span>
        </header>

        {notice.headline ? <p className="updn-headline">{notice.headline}</p> : null}

        <p className="updn-section-label">本次更新</p>
        <ul className="updn-list">
          {notice.lines.map((line, index) => (
            <li key={`${line.group}-${index}`} className="updn-row">
              <span className="updn-row-top">
                <span className="updn-tag updn-tag-solid" style={{ background: USER_GROUP_COLOR[line.group] }}>
                  {USER_GROUP_LABEL[line.group]}
                </span>
                <span className="updn-row-title">{line.title}</span>
              </span>
            </li>
          ))}
        </ul>
        {hidden > 0 ? <p className="updn-more-note">另有 {hidden} 项改动，见完整日志</p> : null}

        <p className="updn-impact">
          {notice.apps.length ? `涉及：${notice.apps.join("、")}。` : ""}
          {notice.needsReinstall ? "安卓版需要安装新的安装包才能看到全部改动。" : "本次更新不需要重新安装，打开即生效。"}
        </p>

        {SHOW_TECH_DETAILS ? (
          <p className="updn-dev">开发模式 · {release.releaseId}{release.pending?.length ? ` · 待确认 ${release.pending.length} 条` : ""}</p>
        ) : null}

        <footer className="updn-foot">
          {onOpenLog ? (
            <button
              type="button"
              className="updn-link"
              onClick={() => {
                if (leaving) return;
                setLeaving(true);
                window.setTimeout(onOpenLog, 160);
              }}
            >
              查看完整日志
            </button>
          ) : (
            <button type="button" className="updn-link" onClick={handleDismiss}>
              稍后查看
            </button>
          )}
          <button type="button" className="updn-confirm" onClick={handleConfirm}>
            <Check size={14} strokeWidth={2.2} aria-hidden />
            知道了
          </button>
        </footer>
      </section>
    </div>
  );
}
