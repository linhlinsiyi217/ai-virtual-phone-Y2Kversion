"use client";

import { useCallback, useEffect, useState } from "react";

import { UpdateNotePopup } from "@/components/update-log/update-note-popup";
import { claimSlot, releaseSlot, subscribeSlot } from "@/lib/update-log/popup-slot";
import {
  hasSeenStudyRoomRelease,
  latestStudyRoomRelease,
  markStudyRoomReleaseSeen,
} from "@/lib/update-log/studyroom";
import type { Release } from "@/lib/update-log/types";

type StudyRoomUpdateNoticeProps = {
  /** 启动画面结束后才显示（顺序：启动画面 → 进入书房 → 书房更新卡） */
  enabled: boolean;
  onOpenLog: () => void;
};

const SLOT_OWNER = "studyroom";

/**
 * 书房自己的更新卡：只跟书房版本有关。同批书房条目也在全局弹窗和设置总日志里，
 * 在全局弹窗点过「知道了」的版本这里不再重复弹。只有点「知道了」才算已读。
 * 如果系统更新卡正在前台，这里会等它被确认关闭后再接上，
 * 不让用户一进书房就被两个重复通知叠住。
 */
export function StudyRoomUpdateNotice({ enabled, onOpenLog }: StudyRoomUpdateNoticeProps) {
  const [release, setRelease] = useState<Release | null>(null);

  const tryShow = useCallback(() => {
    const latest = latestStudyRoomRelease();
    if (hasSeenStudyRoomRelease(latest.releaseId)) return true;
    if (!claimSlot(SLOT_OWNER)) return false;
    setRelease(latest);
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let unsubscribe: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      if (tryShow()) return;
      // 展示位被系统更新卡占着：等它空出来再试一次
      unsubscribe = subscribeSlot(() => {
        if (tryShow()) unsubscribe?.();
      });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [enabled, tryShow]);

  useEffect(() => () => releaseSlot(SLOT_OWNER), []);

  if (!release) return null;

  const hide = () => {
    setRelease(null);
    releaseSlot(SLOT_OWNER);
  };

  const confirm = () => {
    markStudyRoomReleaseSeen(release.releaseId);
    hide();
  };

  return (
    <UpdateNotePopup
      appName="书房"
      release={release}
      onConfirm={confirm}
      onHide={hide}
      onOpenLog={() => {
        hide();
        onOpenLog();
      }}
    />
  );
}
