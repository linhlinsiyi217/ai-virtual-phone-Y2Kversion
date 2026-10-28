"use client";

import { useEffect, useRef, useState } from "react";

import { UpdateNotePopup } from "./update-note-popup";
import { markStudyRoomReleaseSeen } from "@/lib/update-log/studyroom";
import { hasSeenSystemRelease, latestSystemRelease, markSystemReleaseSeen } from "@/lib/update-log/system";
import { checkForUpdate, getLatestRelease, shouldCheckOnForeground, subscribeReleaseList } from "@/lib/update-log/update-service";
import { claimSlot, releaseSlot } from "@/lib/update-log/popup-slot";
import { pushIslandEvent } from "@/lib/island-center";
import type { Release } from "@/lib/update-log/types";

const SLOT_OWNER = "system";

/**
 * 全局更新公告（全项目统一，设置「更新日志」读同一份数据）。
 *
 * 只有一条触发路径、一套已读规则：当前最新发布（本机打包的，或线上拉到的更新一版）
 * 的 releaseId 没被确认过 → 弹一次。线上与本机是同一份发布记录（/api/release 直接读
 * 部署里的数据），不再把版本清单的原始文本拼成第二份公告。
 *
 * 检查时机：启动、从后台回到前台（一分钟内不重复）；设置 → 更新日志进入时与手动「检查更新」
 * 也会拉线上版本，拉到新一版后这里通过 subscribeReleaseList 同步弹出公告。
 * 线上有比本机更新的版本时，灵动岛提示一次「发现新版本」，点进去看日志。
 * 只有点「知道了」才记录已读；「查看完整日志」和 Esc 只是暂时收起，下次打开还会弹。
 * 确认时把同批的书房版本一起记为已读，进书房不会再弹一遍同样的内容。
 */
export function UpdateNotice() {
  const [release, setRelease] = useState<Release | null>(null);
  const showingRef = useRef<string | null>(null);
  const announcedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tryShow = (candidate: Release) => {
      if (cancelled || showingRef.current || hasSeenSystemRelease(candidate.releaseId)) return;
      if (!claimSlot(SLOT_OWNER)) return;
      showingRef.current = candidate.releaseId;
      setRelease(candidate);
    };

    const runCheck = async () => {
      const result = await checkForUpdate();
      if (cancelled || result.state === "failed") return;
      if (result.state === "available" && announcedRef.current !== result.release.releaseId) {
        announcedRef.current = result.release.releaseId;
        pushIslandEvent({
          kind: "update",
          source: "发现新版本",
          text: `v${result.release.version} · 刷新后即可使用`,
          target: { appId: "settings", settingsPage: "about" },
          mergeKey: "update:available",
          ttl: 6000,
        });
      }
      tryShow(getLatestRelease());
    };

    // 启动：给首屏留 700ms，先用本机打包的数据，再实时核对线上
    const timer = window.setTimeout(() => {
      tryShow(latestSystemRelease());
      void runCheck();
    }, 700);

    const onVisible = () => {
      if (document.visibilityState === "visible" && shouldCheckOnForeground()) void runCheck();
    };
    const unsubscribe = subscribeReleaseList(() => tryShow(getLatestRelease()));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, []);

  useEffect(() => () => releaseSlot(SLOT_OWNER), []);

  if (!release) return null;

  const hide = () => {
    setRelease(null);
    showingRef.current = null;
    releaseSlot(SLOT_OWNER);
  };

  const confirm = () => {
    markSystemReleaseSeen(release.releaseId);
    if (release.includes?.studyroom) markStudyRoomReleaseSeen(release.includes.studyroom);
    hide();
    // 确认的是本机打包的旧一版、而线上已经有更新的一版：接着弹新版
    const next = getLatestRelease();
    if (next.releaseId !== release.releaseId && !hasSeenSystemRelease(next.releaseId) && claimSlot(SLOT_OWNER)) {
      showingRef.current = next.releaseId;
      setRelease(next);
    }
  };

  return (
    <UpdateNotePopup
      appName="FLOT"
      release={release}
      onConfirm={confirm}
      onHide={hide}
      onOpenLog={() => {
        hide();
        window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "settings", settingsPage: "about" } }));
      }}
    />
  );
}
