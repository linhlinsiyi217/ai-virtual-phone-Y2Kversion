"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type StudyRoomSplashProps = {
  onDone: () => void;
};

/** 冷启动才播放：同一次会话里切页不重播；短暂离开再回来也跳过。 */
const SKIP_WINDOW_MS = 45 * 1000;
let lastSplashAt = 0;

export function shouldSkipStudyRoomSplash(): boolean {
  return Date.now() - lastSplashAt < SKIP_WINDOW_MS;
}

/**
 * 书房启动画面：Pearl Glass 底 + 玻璃雨滴（单画布）+ 可点按的书本。
 *
 * 原则：
 *  - 雨滴克制：细小雨点落下，少量水珠沿玻璃缓慢下滑，偶尔汇合，不遮挡标题；
 *  - 单个轻量 canvas，限制像素比与数量，页面不可见时立刻停帧并释放监听；
 *  - 点空白处产生一圈极淡的水波纹，附近雨滴短暂散开后恢复；
 *  - 点书本：下压回弹 + 翻一页 + 书签轻跳，节流不堆叠；
 *  - 不点击约 2 秒自动进入书架；点书本可以稍微提前结束；
 *  - prefers-reduced-motion 下只保留静态雨痕与淡入淡出。
 */
export function StudyRoomSplash({ onDone }: StudyRoomSplashProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [flipKey, setFlipKey] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      lastSplashAt = Date.now();
      onDone();
    }, 320);
  }, [onDone]);

  // 自动进入：约 2 秒
  useEffect(() => {
    const timer = window.setTimeout(finish, 2000);
    return () => window.clearTimeout(timer);
  }, [finish]);

  const handleBookTap = () => {
    if (finishedRef.current || flipping) return;
    setFlipping(true);
    setFlipKey((key) => key + 1);
    // 轻触反馈：支持才用，不支持就静默跳过
    try {
      navigator.vibrate?.(8);
    } catch {
      // 忽略
    }
    window.setTimeout(() => setFlipping(false), 420);
    // 点书本稍微提前进入
    window.setTimeout(finish, 360);
  };

  // 玻璃雨滴：单画布，dpr 上限 2，页面隐藏即停
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let raf = 0;
    let lastTime = 0;

    type Drop = { x: number; y: number; len: number; speed: number; alpha: number; push: number; pushDir: number };
    type Slider = { x: number; y: number; r: number; speed: number; wobble: number; trail: number };
    type Ripple = { x: number; y: number; r: number; born: number };

    let drops: Drop[] = [];
    let sliders: Slider[] = [];
    const ripples: Ripple[] = [];

    const theme = () => {
      const styles = getComputedStyle(canvas);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      return {
        drop: read("--sr-splash-drop", "rgba(92, 118, 152, 0.42)"),
        slider: read("--sr-splash-slider", "rgba(120, 146, 178, 0.30)"),
        ripple: read("--sr-splash-ripple", "rgba(120, 146, 178, 0.20)"),
      };
    };
    let palette = theme();

    const seed = () => {
      const area = Math.max(width * height, 1);
      // 数量按面积给，封顶避免大屏堆太多
      const count = Math.round(Math.min(80, Math.max(22, area / 17000)));
      drops = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        len: 8 + Math.random() * 16,
        speed: 34 + Math.random() * 52,
        alpha: 0.16 + Math.random() * 0.3,
        push: 0,
        pushDir: 1,
      }));
      sliders = Array.from({ length: 3 + Math.round(Math.random() * 2) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1.6 + Math.random() * 2.2,
        speed: 5 + Math.random() * 7,
        wobble: Math.random() * Math.PI * 2,
        trail: 0,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(rect.width, 1);
      height = Math.max(rect.height, 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      palette = theme();
      seed();
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = palette.drop;
      ctx.lineWidth = 1;
      for (const drop of drops) {
        ctx.globalAlpha = drop.alpha * 0.8;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x, drop.y + drop.len * 0.7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const frame = (time: number) => {
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
      lastTime = time;
      ctx.clearRect(0, 0, width, height);

      // 雨点
      ctx.strokeStyle = palette.drop;
      ctx.lineWidth = 1;
      for (const drop of drops) {
        drop.y += drop.speed * delta;
        if (drop.push !== 0) {
          drop.x += drop.push * drop.pushDir * delta * 22;
          drop.push = Math.max(0, drop.push - delta * 1.6);
        }
        if (drop.y - drop.len > height) {
          drop.y = -drop.len;
          drop.x = Math.random() * width;
        }
        ctx.globalAlpha = drop.alpha;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y - drop.len);
        ctx.lineTo(drop.x, drop.y);
        ctx.stroke();
      }

      // 沿玻璃缓慢下滑的水珠
      ctx.fillStyle = palette.slider;
      for (const slider of sliders) {
        slider.wobble += delta * 1.1;
        slider.y += slider.speed * delta;
        slider.x += Math.sin(slider.wobble) * 0.22;
        if (slider.y > height + 8) {
          slider.y = -8;
          slider.x = Math.random() * width;
        }
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(slider.x, slider.y, slider.r, slider.r * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 点击水波：极淡的一圈，扩散后消失
      const now = time;
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const ripple = ripples[i];
        const age = (now - ripple.born) / 900;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        ripple.r = 6 + age * 64;
        ctx.globalAlpha = (1 - age) * 0.5;
        ctx.strokeStyle = palette.ripple;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      raf = window.requestAnimationFrame(frame);
    };

    const start = () => {
      if (raf || reduceMotion) return;
      lastTime = 0;
      raf = window.requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      ripples.push({ x, y, r: 6, born: performance.now() });
      // 附近雨滴被轻轻推开，随后恢复
      for (const drop of drops) {
        const dx = drop.x - x;
        const dy = drop.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist < 70) {
          drop.push = 1;
          drop.pushDir = dx >= 0 ? 1 : -1;
        }
      }
      if (reduceMotion) {
        // 减少动态时也要有反馈：画一帧静态雨痕 + 水波
        drawStatic();
        ctx.strokeStyle = palette.ripple;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    resize();
    if (reduceMotion) drawStatic();
    else start();

    window.addEventListener("resize", resize);
    window.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("pointerdown", onPointerDown);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <div className="sr-splash" data-leaving={leaving ? "true" : undefined} role="presentation">
      <canvas ref={canvasRef} className="sr-splash-canvas" aria-hidden />

      <div className="sr-splash-center">
        <button
          type="button"
          className="sr-splash-book"
          onClick={handleBookTap}
          aria-label="打开书房"
          data-flipping={flipping ? "true" : undefined}
          key={`book-${flipKey % 2}`}
        >
          <svg viewBox="0 0 120 96" role="img" aria-hidden>
            {/* 书脊与封面 */}
            <path d="M16 22c12-6 26-6 38 0v58c-12-6-26-6-38 0V22Z" className="sr-splash-book-left" />
            <path d="M54 22c12-6 26-6 38 0v58c-12-6-26-6-38 0V22Z" className="sr-splash-book-right" />
            {/* 翻动的书页 */}
            <g className="sr-splash-page">
              <path d="M54 24c10-5 22-5 32 0v54c-10-5-22-5-32 0V24Z" />
            </g>
            {/* 书签 */}
            <g className="sr-splash-mark">
              <path d="M74 18h8v22l-4-5-4 5V18Z" />
            </g>
            <path d="M54 22v58" className="sr-splash-spine" />
          </svg>
        </button>
        <h1 className="sr-splash-title">书房</h1>
        {/* 固定小标题：按项目要求用品牌名，不写宣传语 */}
        <p className="sr-splash-brand">FLOT</p>
      </div>
    </div>
  );
}
