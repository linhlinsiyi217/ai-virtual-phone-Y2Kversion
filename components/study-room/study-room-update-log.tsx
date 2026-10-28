"use client";

import { ChevronLeft } from "lucide-react";

import { UpdateLogView } from "@/components/update-log/update-log-view";
import { STUDYROOM_RELEASE_LIST, seenStudyRoomReleases } from "@/lib/update-log/studyroom";

type StudyRoomUpdateLogProps = { onBack: () => void };

/** 书房「我的 → 更新日志」：只记录书房自己的变化，与系统更新分开。 */
export function StudyRoomUpdateLog({ onBack }: StudyRoomUpdateLogProps) {
  const seen = seenStudyRoomReleases();
  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">书房更新日志</div>
            <span className="sr-header-sub">书架 · 阅读 · 书城 · 书桌 · 书友圈</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>
      <div className="sr-body">
        <div className="sr-tab-pane">
          <p className="sr-note-meta" style={{ marginBottom: 12, lineHeight: 1.8 }}>
            这里只记书房应用自己的变化；小手机整体项目的变化在「设置 → 更新日志」里。
            书房有新版本时，进入书房会弹一次便签说明，关掉后不再重复弹。
          </p>
          <UpdateLogView
            releases={STUDYROOM_RELEASE_LIST}
            currentReleaseId={STUDYROOM_RELEASE_LIST[0]?.releaseId}
            seen={seen}
          />
        </div>
      </div>
    </section>
  );
}
