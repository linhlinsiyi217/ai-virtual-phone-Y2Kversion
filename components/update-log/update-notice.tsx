"use client";

import { useEffect, useRef, useState } from "react";

import { UpdateNotePopup } from "./update-note-popup";
import { UpdateSheet } from "./update-sheet";
import { markStudyRoomReleaseSeen } from "@/lib/update-log/studyroom";
import { hasSeenSystemRelease, latestSystemRelease, markSystemReleaseSeen } from "@/lib/update-log/system";
import { checkForUpdate, getLatestRelease, subscribeReleaseList } from "@/lib/update-log/update-service";
import { claimSlot, releaseSlot } from "@/lib/update-log/popup-slot";
import { pushIslandEvent } from "@/lib/island-center";
import type { Release } from "@/lib/update-log/types";

const SLOT_OWNER = "system";
const DEFERRED_KEY = "flot-update-sheet-later";

/**
 * 全局更新入口，按顺序只做三件事：
 *
 * 1. 线上部署比本机打包新 → 底部半弹窗「拉取更新」（本次会话点过稍后再说就不再弹）；
 * 2. 没有更新 → 当前最新发布没被确认过 → 正中公告「更新公告」；
 * 3. 点「知道了」写已读，之后刷新、重开都不再弹；换 releaseId 会重新弹。
 *
 * 公告和日志共用 /api/release 与同一份发布记录，不会一边一个版本。
 */
export function UpdateNotice() {
  const [release, setRelease] = useState<Release | null>(null);
  const [sheet, setSheet] = useState<Release | null>(null);
  const showingRef = useRef<string | null>(null);
  const announcedRef = useRef<string | null>(null);
  const sheetOpenRef = useRef(false);

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
      if (cancelled) return;
      if (result.state === "available") {
        if (announcedRef.current !== result.release.releaseId) {
          announcedRef.current = result.release.releaseId;
          pushIslandEvent({
            kind: "update",
            source: "发现新版本",
            text: `v${result.release.version} · 可在底部拉取更新`,
            target: { appId: "settings", settingsPage: "about" },
            mergeKey: "update:available",
            ttl: 6000,
          });
        }
        let deferred = false;
        try {
          deferred = window.sessionStorage.getItem(DEFERRED_KEY) === "1";
        } catch {
          deferred = false;
        }
        if (!deferred && claimSlot(SLOT_OWNER)) {
          sheetOpenRef.current = true;
          setSheet(result.release);
        }
        return;
      }
      // 线上就是最新（或暂时查不到）：回到本机这一版，没确认过就弹公告
      tryShow(getLatestRelease());
    };

    // 启动：先给首屏留 700ms，再核对线上版本
    const timer = window.setTimeout(() => {
      void runCheck();
    }, 700);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void checkForUpdate().then((result) => {
        if (cancelled || result.state !== "available" || !result.release) return;
        if (sheetOpenRef.current || showingRef.current) return;
        try {
          if (window.sessionStorage.getItem(DEFERRED_KEY) === "1") return;
        } catch {
          // 读不到就当没延后
        }
        if (claimSlot(SLOT_OWNER)) {
          sheetOpenRef.current = true;
          setSheet(result.release);
        }
      });
    };

    const unsubscribe = subscribeReleaseList(() => {
      if (!sheetOpenRef.current) tryShow(getLatestRelease());
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, []);

  useEffect(() => () => releaseSlot(SLOT_OWNER), []);

  const laterSheet = () => {
    try {
      window.sessionStorage.setItem(DEFERRED_KEY, "1");
    } catch {
      // 隐私模式写不进 sessionStorage：只影响本次提示频次，不影响功能
    }
    sheetOpenRef.current = false;
    setSheet(null);
    releaseSlot(SLOT_OWNER);
  };

  if (sheet) return <UpdateSheet release={sheet} onLater={laterSheet} />;
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
