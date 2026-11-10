"use client";

import type { UpdateEntry } from "@/lib/update-log/journal";

import { Cat } from "./cat";
import { TYPE_META, fullDate, noticeLines } from "./labels";

/**
 * ② 更新公告：更新完成后首次进入时，正中位置的公告卡。
 * 只展示最新一版改了什么，点「知道了」后不再打扰。
 */
export function UpdateNoticeCard({
  entry,
  unseen,
  onConfirm,
}: {
  entry: UpdateEntry;
  unseen: number;
  onConfirm: () => void;
}) {
  const lines = noticeLines(entry);

  return (
    <div className="uui-mask uui-mask-note" role="dialog" aria-modal="true" aria-labelledby="uui-note-title">
      <div className="uui-nt">
        <div className="uui-hero">
          <Cat pose="wave" acc="halo" />
          <div className="uui-eyebrow" id="uui-note-title">更新公告</div>
          <div className="uui-num uui-ver">v{entry.version}</div>
          <div className="uui-meta">{fullDate(entry.date)}</div>
          <div className="uui-rule" />
        </div>
        <div className="uui-box">
          {lines.map((line, index) => {
            const meta = TYPE_META[line.type] ?? TYPE_META.improve;
            return (
              <div className="uui-row" key={`${line.type}-${index}`}>
                <i className={`uui-chip ${meta.cls}`}>{meta.label}</i>
                <span>{line.text}</span>
              </div>
            );
          })}
        </div>
        {unseen > 1 && <p className="uui-note uui-note-flat">另外还有 {unseen - 1} 次更新的内容，可以在设置里的更新日志翻到</p>}
        <button type="button" className="uui-btn uui-pri uui-block" onClick={onConfirm}>
          知道了
        </button>
      </div>
    </div>
  );
}
