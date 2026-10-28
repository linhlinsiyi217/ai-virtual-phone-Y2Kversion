"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import { kvGet, kvSet } from "@/lib/kv-db";

const RECENT_KEY = "ai_phone_studyroom_recent_colors_v1";

/** 常用色板：书房的冷白 / 黑灰 / 浅冷蓝为主，加几种柔和的点缀色。 */
const PRESET_SWATCHES = [
  "#ffffff", "#f4f6f9", "#d8dde5", "#8e939b", "#4a4a4a", "#1c1f24",
  "#e8f0fb", "#9bb7d9", "#5b7db1", "#0a84ff", "#7aa58c", "#c98f8f",
];

type Rgba = { r: number; g: number; b: number; a: number };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseColor(input: string): Rgba {
  const value = (input || "").trim();
  const hex = value.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{8}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: clamp(parts[0], 0, 255), g: clamp(parts[1], 0, 255), b: clamp(parts[2], 0, 255), a: Number.isFinite(parts[3]) ? clamp(parts[3], 0, 1) : 1 };
    }
  }
  return { r: 10, g: 132, b: 255, a: 1 };
}

/** 能识别的颜色写法：#RGB / #RRGGBB / #RRGGBBAA / rgb() / rgba()。 */
function isParsableColor(input: string): boolean {
  const value = (input || "").trim();
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return true;
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return false;
  const parts = rgb[1].split(",").map((p) => Number(p.trim()));
  return parts.length >= 3 && parts.length <= 4 && parts.every((n) => Number.isFinite(n));
}

function toHex({ r, g, b }: Rgba): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function toCss({ r, g, b, a }: Rgba): string {
  if (a >= 0.999) return toHex({ r, g, b, a });
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
}

function rgbToHsv({ r, g, b }: Rgba): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number, a: number): Rgba {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

function loadRecent(): string[] {
  try {
    const raw = kvGet(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

function pushRecent(color: string): void {
  const next = [color, ...loadRecent().filter((c) => c !== color)].slice(0, 12);
  kvSet(RECENT_KEY, JSON.stringify(next));
}

/** 任意可识别的颜色写法 → 不透明的 #rrggbb */
export function toOpaqueHex(input: string): string {
  return toHex(parseColor(input));
}

type ColorSheetProps = {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  /** 只要不透明色：隐藏透明度滑杆，输出一律 #RRGGBB */
  opaque?: boolean;
};

/** 底部半屏调色面板：二维色块 + 色相/透明度滑杠 + HEX/RGB + 最近使用。 */
export function ColorSheet({ title, value, onChange: rawOnChange, onClose, opaque }: ColorSheetProps) {
  const original = useRef(value);
  const onChange = useCallback(
    (next: string) => rawOnChange(opaque ? toOpaqueHex(next) : next),
    [rawOnChange, opaque],
  );
  const initial = parseColor(value);
  if (opaque) initial.a = 1;
  const initialHsv = rgbToHsv(initial);
  const [h, setH] = useState(initialHsv.h);
  const [s, setS] = useState(initialHsv.s);
  const [v, setV] = useState(initialHsv.v);
  const [a, setA] = useState(initial.a);
  const [hexDraft, setHexDraft] = useState(toHex(initial));
  const [hexError, setHexError] = useState(false);
  // 正在输入 HEX 时不跟着色块/滑杆改写输入框，免得打字被打断
  const hexEditingRef = useRef(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => setRecent(loadRecent()), []);

  const svRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"sv" | null>(null);

  const emit = useCallback((nh: number, ns: number, nv: number, na: number) => {
    onChange(toCss(hsvToRgb(nh, ns, nv, na)));
  }, [onChange]);

  const applySvFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ns = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nv = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
    setS(ns); setV(nv);
    emit(h, ns, nv, a);
  }, [emit, h, a]);

  const handleSvPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = "sv";
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    applySvFromPointer(e.clientX, e.clientY);
  };
  const handleSvPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current !== "sv") return;
    applySvFromPointer(e.clientX, e.clientY);
  };
  const handleSvPointerUp = () => { draggingRef.current = null; };

  const handleHue = (nh: number) => { setH(nh); emit(nh, s, v, a); };
  const handleAlpha = (na: number) => { setA(na); emit(h, s, v, na); };

  const handleHexCommit = () => {
    // 输错的值不采用：保留当前颜色并提示，不会悄悄换成默认色
    if (!isParsableColor(hexDraft)) {
      setHexError(true);
      return;
    }
    setHexError(false);
    const parsed = parseColor(hexDraft);
    const hsv = rgbToHsv(parsed);
    const na = opaque ? 1 : parsed.a;
    setH(hsv.h); setS(hsv.s); setV(hsv.v); setA(na);
    emit(hsv.h, hsv.s, hsv.v, na);
  };

  const handleRgb = (channel: "r" | "g" | "b", raw: string) => {
    const num = clamp(Number(raw) || 0, 0, 255);
    const current = hsvToRgb(h, s, v, a);
    const next = { ...current, [channel]: num };
    const hsv = rgbToHsv(next);
    setH(hsv.h); setS(hsv.s); setV(hsv.v);
    onChange(toCss({ ...next, a }));
    setHexDraft(toHex(next));
  };

  const current = hsvToRgb(h, s, v, a);
  const hex = toHex(current);

  // 拖色块、色相、RGB 时，HEX 输入框同步显示当前颜色
  useEffect(() => {
    if (!hexEditingRef.current) {
      setHexDraft(hex);
      setHexError(false);
    }
  }, [hex]);

  const pickColor = (c: string) => {
    const parsed = parseColor(c);
    const hsv = rgbToHsv(parsed);
    setH(hsv.h); setS(hsv.s); setV(hsv.v); setA(parsed.a);
    setHexDraft(toHex(parsed));
    setHexError(false);
    onChange(c);
  };

  const handleConfirm = () => {
    const final = toCss(hsvToRgb(h, s, v, a));
    pushRecent(final);
    setRecent(loadRecent());
    onChange(final);
    onClose();
  };
  const handleCancel = () => {
    onChange(original.current);
    onClose();
  };

  return (
    <div className="sr-sheet-mask" onClick={handleCancel}>
      <div className="sr-color-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sr-color-head">
          <button type="button" className="sr-color-head-btn" onClick={handleCancel} aria-label="取消"><X size={17} /></button>
          <span className="sr-color-title">{title}</span>
          <button type="button" className="sr-color-head-btn sr-color-head-btn--ok" onClick={handleConfirm} aria-label="确定"><Check size={17} /></button>
        </div>

        <div
          ref={svRef}
          className="sr-sv"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
          onPointerDown={handleSvPointerDown}
          onPointerMove={handleSvPointerMove}
          onPointerUp={handleSvPointerUp}
          onPointerCancel={handleSvPointerUp}
          role="slider"
          aria-label="饱和度与明度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(v * 100)}
          aria-valuetext={`S ${Math.round(s * 100)}% V ${Math.round(v * 100)}%`}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            if (e.key === "ArrowLeft") { e.preventDefault(); const ns = clamp(s - step, 0, 1); setS(ns); emit(h, ns, v, a); }
            if (e.key === "ArrowRight") { e.preventDefault(); const ns = clamp(s + step, 0, 1); setS(ns); emit(h, ns, v, a); }
            if (e.key === "ArrowUp") { e.preventDefault(); const nv = clamp(v + step, 0, 1); setV(nv); emit(h, s, nv, a); }
            if (e.key === "ArrowDown") { e.preventDefault(); const nv = clamp(v - step, 0, 1); setV(nv); emit(h, s, nv, a); }
          }}
        >
          <span className="sr-sv-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
        </div>

        <div className="sr-color-sliders">
          <div className="sr-slider-row">
            <span className="sr-slider-label">色相</span>
            <input
              type="range" min={0} max={360} step={1} value={Math.round(h)}
              onChange={(e) => handleHue(Number(e.target.value))}
              className="sr-slider sr-slider--hue"
              aria-label="色相"
            />
          </div>
          {!opaque && <div className="sr-slider-row">
            <span className="sr-slider-label">透明</span>
            <input
              type="range" min={0} max={100} step={1} value={Math.round(a * 100)}
              onChange={(e) => handleAlpha(Number(e.target.value) / 100)}
              className="sr-slider"
              aria-label="透明度"
            />
          </div>}
        </div>

        <div className="sr-color-inputs">
          <span className="sr-color-preview" style={{ background: toCss(current) }} aria-hidden />
          <label className="sr-field">
            <span>HEX</span>
            <input
              value={hexDraft}
              onChange={(e) => { setHexDraft(e.target.value); setHexError(false); }}
              onFocus={() => { hexEditingRef.current = true; }}
              onBlur={() => { hexEditingRef.current = false; handleHexCommit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleHexCommit(); }}
              spellCheck={false}
              aria-label="HEX 颜色"
              aria-invalid={hexError || undefined}
            />
          </label>
          {hexError && <span className="sr-color-error" role="alert">颜色格式不对，例如 #5B7DB1</span>}
          <div className="sr-rgb">
            <label className="sr-field sr-field--sm"><span>R</span>
              <input value={Math.round(current.r)} onChange={(e) => handleRgb("r", e.target.value)} inputMode="numeric" aria-label="红" /></label>
            <label className="sr-field sr-field--sm"><span>G</span>
              <input value={Math.round(current.g)} onChange={(e) => handleRgb("g", e.target.value)} inputMode="numeric" aria-label="绿" /></label>
            <label className="sr-field sr-field--sm"><span>B</span>
              <input value={Math.round(current.b)} onChange={(e) => handleRgb("b", e.target.value)} inputMode="numeric" aria-label="蓝" /></label>
          </div>
        </div>

        <div className="sr-recent">
          <span className="sr-recent-label">色板</span>
          <div className="sr-recent-row">
            {PRESET_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className="sr-recent-chip"
                data-active={hex === c ? "true" : undefined}
                style={{ background: c }}
                onClick={() => pickColor(c)}
                aria-label={`使用颜色 ${c}`}
              />
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div className="sr-recent">
            <span className="sr-recent-label">最近使用</span>
            <div className="sr-recent-row">
              {recent.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="sr-recent-chip"
                  style={{ background: c }}
                  onClick={() => pickColor(c)}
                  aria-label={`使用颜色 ${c}`}
                />
              ))}
            </div>
          </div>
        )}
        <span className="sr-color-hex-readout">{hex}</span>
      </div>
    </div>
  );
}
