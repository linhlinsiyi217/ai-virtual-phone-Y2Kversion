"use client";

import { useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";

import type { Release } from "@/lib/update-log/types";
import {
  logGroupsOf,
  noticeOf,
  SHOW_TECH_DETAILS,
  USER_GROUP_COLOR,
  USER_GROUP_LABEL,
  userText,
} from "@/lib/update-log/user-view";

type UpdateLogViewProps = {
  releases: Release[];
  /** 当前版本（默认展开、带标记） */
  currentReleaseId?: string;
  /** 已读时间：显示「已看过」用 */
  seen?: Record<string, string>;
};

/**
 * 更新日志的版本卡片列表（系统与书房共用）。
 * 比公告详细：收起时是版本号、日期、涉及应用、概括与各类数量；展开后按
 * 新增 / 修复 / 优化 / 视觉调整 / 应用内容更新 / 全局功能更新 / 提示词更新 / 重要变更
 * 列出每条记录的应用（在哪里能看到）、标题（改了什么）和说明（带来什么影响）。
 */
export function UpdateLogView({ releases, currentReleaseId, seen }: UpdateLogViewProps) {
  const [open, setOpen] = useState<string[]>(() => (currentReleaseId ? [currentReleaseId] : []));

  const toggle = (releaseId: string) => {
    setOpen((prev) => (prev.includes(releaseId) ? prev.filter((id) => id !== releaseId) : [...prev, releaseId]));
  };

  return (
    <div className="upd-list">
      {releases.map((release) => {
        const expanded = open.includes(release.releaseId);
        const isCurrent = release.releaseId === currentReleaseId;
        const groups = logGroupsOf(release);
        const apps = noticeOf(release).apps;
        return (
          <section key={release.releaseId} className="upd-card" data-open={expanded ? "true" : undefined}>
            <button type="button" className="upd-card-head" onClick={() => toggle(release.releaseId)} aria-expanded={expanded}>
              <span className="upd-card-main">
                <span className="upd-card-top">
                  <strong className="upd-version">v{release.version}</strong>
                  {isCurrent && <span className="upd-current">当前版本</span>}
                  <span className="upd-date">
                    <Clock3 size={12} strokeWidth={1.8} aria-hidden />
                    {release.date}
                  </span>
                </span>
                {apps.length > 0 && <span className="upd-apps">{apps.join(" / ")}</span>}
                <span className="upd-summary">{userText(release.summary)}</span>
                {!expanded && groups.length > 0 && (
                  <span className="upd-counts">
                    {groups.map((item) => (
                      <span key={item.group} className="upd-count" style={{ color: USER_GROUP_COLOR[item.group] }}>
                        {USER_GROUP_LABEL[item.group]} {item.entries.length}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <ChevronDown size={18} strokeWidth={1.8} className="upd-arrow" aria-hidden />
            </button>

            {expanded && (
              <div className="upd-body">
                {groups.map((group) => (
                  <div key={group.group} className="upd-group">
                    <span className="upd-group-label" style={{ color: USER_GROUP_COLOR[group.group] }}>
                      <i style={{ background: USER_GROUP_COLOR[group.group] }} aria-hidden />
                      {USER_GROUP_LABEL[group.group]}
                    </span>
                    {group.entries.map((entry) => (
                      <div key={entry.id} className="upd-entry">
                        <span className="upd-entry-app">{entry.app}</span>
                        <span className="upd-entry-title">{entry.title}</span>
                        {entry.items.length > 0 && (
                          <ul>
                            {entry.items.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {/* 开发模式才显示内部标识与待确认事项；生产环境不渲染 */}
                {SHOW_TECH_DETAILS && (
                  <div className="upd-dev">
                    <span>开发模式 · {release.releaseId}</span>
                    {release.pending?.map((item, index) => (
                      <span key={index}>待确认：{item}</span>
                    ))}
                  </div>
                )}

                <p className="upd-meta">
                  {seen?.[release.releaseId]
                    ? `上次查看：${new Date(seen[release.releaseId]).toLocaleDateString("zh-CN")}`
                    : "还未查看过这一版"}
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
