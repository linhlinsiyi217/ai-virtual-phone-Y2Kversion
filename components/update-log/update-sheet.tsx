"use client";

import { useEffect, useMemo, useState } from "react";

import type { Release } from "@/lib/update-log/types";
import { noticeOf } from "@/lib/update-log/user-view";

import { chipClass } from "./update-note-popup";

/** 本次会话里点过「稍后再说」，就不再反复弹；新开一个会话才会再提示 */
const DEFERRED_KEY = "flot-update-sheet-later";

/**
 * 拉取更新：从底部升起的半弹窗。
 *
 * 只在线上部署比本机打包新的时候出现，写清这次大概改了什么，
 * 两个按钮「稍后再说」和「拉取更新」。网页版更新就是重新加载当前部署，
 * 因此这里不显示假进度，只用一条不确定进度的细线。
 */
export function UpdateSheet({ release, onLater }: { release: Release; onLater: () => void }) {
  const notice = useMemo(() => noticeOf(release), [release]);
  const [pulling, setPulling] = useState(false);
  const lines = notice.lines.slice(0, 4);

  const pull = () => {
    if (pulling) return;
    setPulling(true);
    // 让「正在拉取」这一帧先显示，再重新加载页面拿到新部署
    window.setTimeout(() => window.location.reload(), 700);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pulling) onLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater, pulling]);

  return (
    <div
      className="up2-sheet-mask"
      role="dialog"
      aria-modal="true"
      aria-labelledby="up2-sheet-title"
      onMouseDown={() => {
        if (!pulling) onLater();
      }}
    >
      <section className="up2-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <span className="up2-sheet-bar" aria-hidden />
        <span className="up2-eyebrow">发现新版本</span>
        <h2 className="up2-sheet-ver" id="up2-sheet-title">
          v{notice.version}
          <em>{notice.date}</em>
        </h2>

        {notice.headline ? <p className="up2-headline">{notice.headline}</p> : null}

        <ul className="up2-sheet-lines">
          {lines.map((line, index) => (
            <li className="up2-line" key={`${line.group}-${index}`}>
              <span className={`up2-chip ${chipClass(line.group)}`}>{line.group}</span>
              <span className="up2-line-text">{line.title}</span>
            </li>
          ))}
        </ul>

        <p className="up2-impact">拉取后会刷新当前页面，不需要重新安装。</p>

        {pulling ? (
          <div className="up2-pulling" role="status">
            <span className="up2-pulling-bar" aria-hidden />
            <span>正在拉取新版本…</span>
          </div>
        ) : (
          <div className="up2-sheet-actions">
            <button type="button" className="up2-secondary" onClick={onLater}>
              稍后再说
            </button>
            <button type="button" className="up2-primary" onClick={pull}>
              拉取更新
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
