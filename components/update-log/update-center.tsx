"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { checkForRelease, deferForAWhile, rememberSeen } from "@/lib/update-log/journal";
import type { UpdateEntry } from "@/lib/update-log/journal";

import { UpdateNoticeCard } from "./update-notice";
import { UpdateSheet } from "./update-sheet";

/**
 * 更新界面的唯一入口：挂在应用最外层一次。
 * 启动后检查一次；之后只在页面重新可见时补查，同一时间最多显示一个界面。
 */
export function UpdateCenter() {
  const [sheetEntry, setSheetEntry] = useState<UpdateEntry | null>(null);
  const [notice, setNotice] = useState<{ entry: UpdateEntry; unseen: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    let disposed = false;
    let busy = false;

    const run = async () => {
      if (disposed || busy || openRef.current) return;
      busy = true;
      const result = await checkForRelease();
      busy = false;
      if (disposed) return;
      if (result.kind === "sheet") {
        openRef.current = true;
        setSheetEntry(result.entry);
      } else if (result.kind === "notice") {
        openRef.current = true;
        setNotice({ entry: result.entry, unseen: result.unseen });
      }
    };

    // 启动时检查一次；留一点时间给首屏，不让弹窗抢在页面之前
    const first = window.setTimeout(() => void run(), 700);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 60000);

    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!host) return null;

  return createPortal(
    <>
      {sheetEntry && (
        <UpdateSheet
          entry={sheetEntry}
          onLater={() => {
            deferForAWhile();
            openRef.current = false;
            setSheetEntry(null);
          }}
        />
      )}
      {notice && (
        <UpdateNoticeCard
          entry={notice.entry}
          unseen={notice.unseen}
          onConfirm={() => {
            rememberSeen(notice.entry);
            openRef.current = false;
            setNotice(null);
          }}
        />
      )}
    </>,
    host,
  );
}
