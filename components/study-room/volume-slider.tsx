"use client";

import { useEffect, useRef, useState } from "react";

type VolumeSliderProps = {
  label: string;
  value: number;
  /** 拖动中：只改声音本身（不重绘页面、不写存储），可不传 */
  onPreview?: (value: number) => void;
  /** 停下后提交（松手，或停顿 300ms） */
  onCommit: (value: number) => void;
};

/**
 * 书房音量条：拖动时只更新自己这一小块，停下后才提交给外部状态，
 * 避免每动一格都让整个阅读页重绘、写一次存储，导致拖起来一卡一卡。
 */
export function VolumeSlider({ label, value, onPreview, onCommit }: VolumeSliderProps) {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);

  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        onCommit(latestRef.current);
      }
    },
    // 只在卸载时提交最后一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const commit = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onCommit(latestRef.current);
  };

  return (
    <div className="sr-appear-row sr-appear-row--slider">
      <span className="sr-appear-label">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={local}
        onChange={(event) => {
          const next = Number(event.target.value);
          draggingRef.current = true;
          latestRef.current = next;
          setLocal(next);
          onPreview?.(next);
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(commit, 300);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="sr-slider"
        aria-label={label}
      />
      <span className="sr-appear-value">{Math.round(local * 100)}%</span>
    </div>
  );
}
