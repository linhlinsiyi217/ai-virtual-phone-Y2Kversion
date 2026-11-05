"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { pullLatest } from "@/lib/update-log/journal";
import type { UpdateEntry } from "@/lib/update-log/journal";

import { Cat } from "./cat";
import { TYPE_META, briefOf, fullDate } from "./labels";

type Stage = "offer" | "run" | "done" | "fail";

/**
 * ① 更新弹窗：底部浮起的白卡片。
 * 先展示这次更新改了什么，点「拉取更新」后换成三步真实进度，完成后提示重启。
 */
export function UpdateSheet({ entry, onLater }: { entry: UpdateEntry; onLater: () => void }) {
  const [stage, setStage] = useState<Stage>("offer");
  const [step, setStep] = useState(0);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef({ active: false, startY: 0, distance: 0 });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stage === "offer") onLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater, stage]);

  const run = async () => {
    setStage("run");
    setStep(0);
    const ok = await pullLatest(entry, setStep);
    setStage(ok ? "done" : "fail");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { active: true, startY: event.clientY, distance: 0 };
    if (sheetRef.current) sheetRef.current.style.transition = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.distance = Math.max(0, event.clientY - dragRef.current.startY);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dragRef.current.distance}px)`;
  };

  const onPointerEnd = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.transform = "";
    }
    if (dragRef.current.distance > 110 && stage === "offer") onLater();
  };

  const labels =
    entry.needsApk
      ? ["检查最新版本", "下载安装包", "安装并重启"]
      : ["检查最新版本", "下载最新内容", "清理旧缓存并重启"];

  return (
    <div className="uui-mask uui-mask-sheet" role="dialog" aria-modal="true" aria-labelledby="uui-sheet-title">
      <section
        className="uui-sh"
        ref={sheetRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="uui-hd">
          <b id="uui-sheet-title">发现新版本</b>
          <button type="button" className="uui-x" aria-label="关闭" onClick={onLater} />
        </div>

        <div className="uui-bd">
          {stage === "offer" && (
            <>
              <div className="uui-hero">
                <Cat pose="box" />
                <div className="uui-num uui-ver">v{entry.version}</div>
                <div className="uui-meta">{fullDate(entry.date)}</div>
              </div>
              <div className="uui-box">
                {briefOf(entry).map((line, index) => {
                  const meta = TYPE_META[line.type] ?? TYPE_META.improve;
                  return (
                    <div className="uui-row" key={`${line.type}-${index}`}>
                      <i className={`uui-chip ${meta.cls}`}>{meta.label}</i>
                      <span>{line.text}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {stage === "run" && (
            <>
              <div className="uui-hero">
                <Cat pose="walk" />
                <div className="uui-hl">正在更新</div>
              </div>
              <div className="uui-box">
                {labels.map((label, index) => (
                  <div
                    className={`uui-st ${index < step ? "ok" : index === step ? "cur" : ""}`}
                    key={label}
                  >
                    <i className="uui-dot">{index < step ? "✓" : index + 1}</i>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {stage === "done" && (
            <div className="uui-hero">
              <Cat pose="wave" />
              <div className="uui-hl">已经准备好了</div>
              <div className="uui-meta">重启后就是新版本</div>
            </div>
          )}

          {stage === "fail" && (
            <div className="uui-hero">
              <Cat pose="sleep" face="sleepy" />
              <div className="uui-hl">没有更新成功</div>
              <div className="uui-meta">可能是网络不太稳</div>
            </div>
          )}
        </div>

        <div className="uui-ft">
          {stage === "offer" && (
            <>
              <p className="uui-note">
                {entry.needsApk ? "这次需要重新下载安装包" : "不用重新下载，点一下就能更新"}
              </p>
              <div className="uui-btns">
                <button type="button" className="uui-btn uui-sec" onClick={onLater}>
                  稍后再说
                </button>
                <button type="button" className="uui-btn uui-pri" onClick={() => void run()}>
                  拉取更新
                </button>
              </div>
            </>
          )}

          {stage === "run" && <p className="uui-note uui-note-flat">请先不要关闭，马上就好</p>}

          {stage === "done" && (
            <div className="uui-btns">
              <button type="button" className="uui-btn uui-sec" onClick={onLater}>
                下次打开再说
              </button>
              <button type="button" className="uui-btn uui-pri" onClick={() => window.location.reload()}>
                立即重启
              </button>
            </div>
          )}

          {stage === "fail" && (
            <div className="uui-btns">
              <button type="button" className="uui-btn uui-sec" onClick={onLater}>
                稍后再说
              </button>
              <button type="button" className="uui-btn uui-pri" onClick={() => void run()}>
                再试一次
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
