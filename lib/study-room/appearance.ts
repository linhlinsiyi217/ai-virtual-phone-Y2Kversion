// lib/study-room/appearance.ts — 书房外观与自定义。
//
// 结构：
//  - vars：各模块的 CSS 变量（基础控件改这些）
//  - css：各模块的用户自定义 CSS 覆盖层（作用域限定到 .sr-app）
// 两者互不覆盖：变量写在前面，用户 CSS 写在后面（优先级更高）。
// 样式出错不会白屏：注入失败/解析失败只影响自定义层，基础样式仍在。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

const STORAGE_KEY = "ai_phone_studyroom_appearance_v1";
registerKvMigration(STORAGE_KEY);

/**
 * 设置分组。"coread" 只为兼容旧存档里的共读侧栏自定义 CSS（仍会注入），
 * 界面上已并入「聊天外观」，不再单独成组。
 */
export type AppearanceModule = "global" | "background" | "shelf" | "reader" | "chat" | "coread" | "notes";

/** 全局书房背景：本地图片或链接，含贴图方式、位置、透明度与遮罩。 */
export type BackgroundFit = "cover" | "contain" | "repeat";
export type BackgroundPosition = "center" | "top" | "bottom" | "left" | "right";

export type AppearanceBackground = {
  /** data:image/... 或 http(s) 链接；空表示不使用背景图 */
  url: string;
  fit: BackgroundFit;
  position: BackgroundPosition;
  /** 图片本身的不透明度 0-100 */
  opacity: number;
  /** 遮罩强度 0-100：越大越接近页面底色，用来保证文字可读 */
  mask: number;
  /** 遮罩颜色；留空表示跟随页面底色 */
  maskColor: string;
  /** 阅读页是否也显示背景（默认关闭，正文保持干净底色） */
  inReader: boolean;
};

export const DEFAULT_BACKGROUND: AppearanceBackground = {
  url: "",
  fit: "cover",
  position: "center",
  opacity: 100,
  mask: 30,
  maskColor: "",
  inReader: false,
};

export const FIT_LABEL: Record<BackgroundFit, string> = {
  cover: "铺满",
  contain: "完整显示",
  repeat: "平铺",
};

export const POSITION_LABEL: Record<BackgroundPosition, string> = {
  center: "居中",
  top: "靠上",
  bottom: "靠下",
  left: "靠左",
  right: "靠右",
};

export type AppearanceState = {
  vars: Record<string, string>;
  css: Record<string, string>;
  background: AppearanceBackground;
};

/** 外观页里看到的分组（顺序即显示顺序）。 */
export const APPEARANCE_MODULES: Array<{ key: AppearanceModule; label: string; desc: string }> = [
  { key: "global", label: "主题", desc: "强调色、字体、圆角、玻璃与页面底色" },
  { key: "background", label: "背景", desc: "背景图、显示方式与遮罩" },
  { key: "shelf", label: "书架", desc: "层间距、架板、书本尺寸" },
  { key: "chat", label: "聊天外观", desc: "聊天室与共读侧栏共用的气泡、尾巴与间距" },
  { key: "reader", label: "阅读器", desc: "正文字号、行距与工具栏" },
  { key: "notes", label: "笔记与其他", desc: "卡片与列表外观" },
];

/** 自定义 CSS 的全部存放位置（含旧版共读侧栏），注入时按这个顺序拼接。 */
const CSS_MODULES: Array<{ key: AppearanceModule; label: string }> = [
  ...APPEARANCE_MODULES.map(({ key, label }) => ({ key, label })),
  { key: "coread", label: "共读侧栏（旧版设置）" },
];

/** 基础变量：每个控件对应一个 CSS 变量，画布上的真实样式直接读它。 */
/** 字体候选：留空表示跟随宿主手机的字体设置。 */
export const FONT_CHOICES: Array<{ value: string; label: string }> = [
  { value: "", label: "跟随系统" },
  { value: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif', label: "黑体（默认）" },
  { value: '"Songti SC", "Noto Serif SC", "SimSun", serif', label: "宋体 / 衬线" },
  { value: '"Kaiti SC", "KaiTi", "STKaiti", serif', label: "楷体" },
  { value: '"ui-monospace", "SFMono-Regular", Menlo, Consolas, monospace', label: "等宽" },
];

export const VAR_DEFS: Array<{
  key: string;
  module: AppearanceModule;
  label: string;
  type: "color" | "range" | "toggle" | "text" | "font";
  fallback: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** 同组里再分小节（例如聊天外观里的「共读侧栏专属」） */
  group?: string;
  /** 问号里的说明：这个控件在什么情况下看得出变化 */
  hint?: string;
}> = [
  // 整体
  { key: "--sr-accent", module: "global", label: "界面强调色", type: "color", fallback: "#4a4a4a" },
  { key: "--sr-font-family", module: "global", label: "字体", type: "font", fallback: "" },
  { key: "--sr-text-ink", module: "global", label: "文字颜色", type: "color", fallback: "#1c1f24" },
  { key: "--sr-glass-blur", module: "global", label: "毛玻璃模糊", type: "range", fallback: "18", min: 0, max: 32, step: 1, unit: "px", hint: "作用于顶栏、Dock、浮层等玻璃材质。纯白底色下几乎看不出模糊，设置了背景图或内容滚到玻璃下方时最明显。" },
  { key: "--sr-shadow-alpha", module: "global", label: "阴影强度", type: "range", fallback: "10", min: 0, max: 40, step: 1, unit: "%", hint: "调整 Dock、底部操作条、浮层等悬浮元素的投影深浅。" },
  { key: "--sr-radius", module: "global", label: "圆角", type: "range", fallback: "20", min: 0, max: 28, step: 1, unit: "px" },
  { key: "--sr-page-bg", module: "global", label: "页面底色", type: "color", fallback: "#ffffff" },

  // 书架
  { key: "--sr-shelf-gap", module: "shelf", label: "层间距", type: "range", fallback: "34", min: 10, max: 72, step: 2, unit: "px" },
  { key: "--sr-board-height", module: "shelf", label: "架板厚度", type: "range", fallback: "8", min: 4, max: 18, step: 1, unit: "px" },
  { key: "--sr-board-color", module: "shelf", label: "架板颜色", type: "color", fallback: "#d8dde5" },
  { key: "--sr-book-scale", module: "shelf", label: "书本尺寸", type: "range", fallback: "1", min: 0.72, max: 1.3, step: 0.02, unit: "", hint: "按倍数缩放书架上的书（1 为默认）。书变大后每层放的书变少，会自动换层。" },
  { key: "--sr-spine-font", module: "shelf", label: "书脊字号", type: "range", fallback: "12", min: 9, max: 16, step: 0.5, unit: "px" },

  // 阅读器
  { key: "--sr-reader-font", module: "reader", label: "正文字号", type: "range", fallback: "17", min: 13, max: 24, step: 0.5, unit: "px" },
  { key: "--sr-reader-leading", module: "reader", label: "行距", type: "range", fallback: "1.95", min: 1.3, max: 2.6, step: 0.05, unit: "" },
  { key: "--sr-reader-ink", module: "reader", label: "正文颜色", type: "color", fallback: "#33383f" },
  { key: "--sr-reader-bg", module: "reader", label: "阅读底色", type: "color", fallback: "#ffffff" },
  // 顶/底栏：隐藏后轻点正文即可唤回，返回入口不会永久不可达
  { key: "--sr-bar-autohide", module: "reader", label: "进入时隐藏工具栏", type: "toggle", fallback: "0" },
  { key: "--sr-bar-btn", module: "reader", label: "工具栏按钮尺寸", type: "range", fallback: "40", min: 34, max: 52, step: 1, unit: "px" },
  { key: "--sr-bar-bg", module: "reader", label: "工具栏底色", type: "color", fallback: "#ffffff" },
  { key: "--sr-bar-alpha", module: "reader", label: "工具栏不透明度", type: "range", fallback: "70", min: 20, max: 100, step: 1, unit: "%" },
  { key: "--sr-bar-ink", module: "reader", label: "工具栏图标/文字色", type: "color", fallback: "#1c1f24" },

  // 聊天室
  { key: "--sr-chat-send", module: "chat", label: "发送气泡", type: "color", fallback: "#0a84ff" },
  { key: "--sr-chat-recv", module: "chat", label: "接收气泡", type: "color", fallback: "#e9e9eb" },
  { key: "--sr-chat-max", module: "chat", label: "气泡最大宽度", type: "range", fallback: "74", min: 50, max: 92, step: 1, unit: "%" },
  { key: "--sr-chat-radius", module: "chat", label: "气泡圆角", type: "range", fallback: "18", min: 4, max: 24, step: 1, unit: "px" },
  { key: "--sr-chat-gap", module: "chat", label: "组间距", type: "range", fallback: "10", min: 2, max: 24, step: 1, unit: "px" },
  { key: "--sr-chat-tail", module: "chat", label: "显示气泡尾巴", type: "toggle", fallback: "1", hint: "只在一组连续消息的最后一条显示尾巴；同一个人连发的中间几条不重复。" },

  // 聊天外观 · 共读侧栏专属（侧栏是阅读页里的抽屉，宽度和字号与聊天室不同，单独设）
  { key: "--sr-coread-width", module: "chat", group: "共读侧栏专属", label: "侧栏宽度", type: "range", fallback: "88", min: 60, max: 100, step: 1, unit: "%", hint: "阅读页里「AI 共读」抽屉占屏幕宽度的比例，最宽不超过 460px。" },
  { key: "--sr-coread-font", module: "chat", group: "共读侧栏专属", label: "侧栏字号", type: "range", fallback: "14", min: 12, max: 18, step: 0.5, unit: "px", hint: "只影响共读侧栏里的消息文字，聊天室字号跟随系统。" },

  // 笔记与其他
  { key: "--sr-card-radius", module: "notes", label: "卡片圆角", type: "range", fallback: "16", min: 0, max: 26, step: 1, unit: "px" },
  { key: "--sr-card-bg", module: "notes", label: "卡片底色", type: "color", fallback: "#ffffff" },
];

const GLOBAL_VAR_KEYS = VAR_DEFS.filter((d) => d.module === "global").map((d) => d.key);
const MODULE_VAR_KEYS: Record<AppearanceModule, string[]> = {
  global: GLOBAL_VAR_KEYS,
  background: [],
  shelf: VAR_DEFS.filter((d) => d.module === "shelf").map((d) => d.key),
  reader: VAR_DEFS.filter((d) => d.module === "reader").map((d) => d.key),
  chat: VAR_DEFS.filter((d) => d.module === "chat").map((d) => d.key),
  coread: VAR_DEFS.filter((d) => d.module === "coread").map((d) => d.key),
  notes: VAR_DEFS.filter((d) => d.module === "notes").map((d) => d.key),
};

export function varDef(key: string) {
  return VAR_DEFS.find((d) => d.key === key);
}

export function defaultVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of VAR_DEFS) out[def.key] = def.fallback;
  return out;
}

export function defaultState(): AppearanceState {
  return { vars: defaultVars(), css: {}, background: { ...DEFAULT_BACKGROUND } };
}

const FITS: BackgroundFit[] = ["cover", "contain", "repeat"];
const POSITIONS: BackgroundPosition[] = ["center", "top", "bottom", "left", "right"];

/** 只接受认识的字段，避免坏数据让背景层失效。 */
function sanitizeBackground(raw: unknown): AppearanceBackground {
  const out = { ...DEFAULT_BACKGROUND };
  if (!raw || typeof raw !== "object") return out;
  const value = raw as Partial<AppearanceBackground>;
  if (typeof value.url === "string" && value.url.trim()) out.url = value.url.trim();
  if (value.fit && FITS.includes(value.fit)) out.fit = value.fit;
  if (value.position && POSITIONS.includes(value.position)) out.position = value.position;
  if (typeof value.opacity === "number" && Number.isFinite(value.opacity)) {
    out.opacity = Math.min(Math.max(Math.round(value.opacity), 0), 100);
  }
  if (typeof value.mask === "number" && Number.isFinite(value.mask)) {
    out.mask = Math.min(Math.max(Math.round(value.mask), 0), 100);
  }
  if (typeof value.maskColor === "string") out.maskColor = value.maskColor.trim();
  if (typeof value.inReader === "boolean") out.inReader = value.inReader;
  return out;
}

/** 读取已保存的外观（兼容缺字段的旧数据）。 */
export function loadAppearance(): AppearanceState {
  try {
    const raw = kvGet(STORAGE_KEY);
    if (!raw) return defaultState();
    return sanitizeState(JSON.parse(raw) as unknown);
  } catch {
    return defaultState();
  }
}

export function saveAppearance(state: AppearanceState): void {
  kvSet(STORAGE_KEY, JSON.stringify(state));
}

// ── 命名预设：把一整套外观存下来随时切换 ──

const PRESETS_KEY = "ai_phone_studyroom_appearance_presets_v1";
registerKvMigration(PRESETS_KEY);

export type AppearancePreset = {
  id: string;
  name: string;
  createdAt: string;
  state: AppearanceState;
};

const LEGACY_PAGE_BG = "#f1f2f6";

/** 把外部数据（存档/预设/导入文件）收成一份可用的外观状态。 */
export function sanitizeState(raw: unknown): AppearanceState {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Partial<AppearanceState>;
  const vars = { ...base.vars };
  if (parsed.vars && typeof parsed.vars === "object") {
    for (const [key, value] of Object.entries(parsed.vars)) {
      if (typeof value === "string" && key in vars) vars[key] = value;
    }
  }
  // 旧版默认页面底色是冷灰 #f1f2f6，存档把它原样存了下来，老用户一直是灰底；
  // 改回纯白默认。用户自己挑过的其他颜色、背景图和夜间模式都不动。
  if (vars["--sr-page-bg"]?.trim().toLowerCase() === LEGACY_PAGE_BG) vars["--sr-page-bg"] = "#ffffff";
  const css: Record<string, string> = {};
  if (parsed.css && typeof parsed.css === "object") {
    for (const [key, value] of Object.entries(parsed.css)) {
      if (typeof value === "string" && value.trim()) css[key] = value;
    }
  }
  return { vars, css, background: sanitizeBackground(parsed.background) };
}

export function loadPresets(): AppearancePreset[] {
  try {
    const raw = kvGet(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is AppearancePreset => Boolean(item) && typeof item === "object" && typeof (item as AppearancePreset).id === "string")
      .map((item) => ({
        id: item.id,
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "未命名预设",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        state: sanitizeState(item.state),
      }));
  } catch {
    return [];
  }
}

export function savePresets(list: AppearancePreset[]): void {
  kvSet(PRESETS_KEY, JSON.stringify(list));
}

/** 新建预设（同名的覆盖，避免越存越多重复项）。 */
export function upsertPreset(list: AppearancePreset[], name: string, state: AppearanceState): AppearancePreset[] {
  const trimmed = name.trim() || "未命名预设";
  const existing = list.find((preset) => preset.name === trimmed);
  if (existing) {
    return list.map((preset) =>
      preset.id === existing.id ? { ...preset, state, createdAt: new Date().toISOString() } : preset,
    );
  }
  const preset: AppearancePreset = {
    id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    createdAt: new Date().toISOString(),
    state,
  };
  return [...list, preset];
}

export function resetModule(state: AppearanceState, module: AppearanceModule): AppearanceState {
  const vars = { ...state.vars };
  for (const key of MODULE_VAR_KEYS[module]) vars[key] = varDef(key)?.fallback ?? "";
  const css = { ...state.css };
  delete css[module];
  // 聊天外观合并了旧的共读侧栏：恢复默认时一起清掉旧版侧栏 CSS
  if (module === "chat") delete css.coread;
  const background = module === "background" ? { ...DEFAULT_BACKGROUND } : { ...state.background };
  return { vars, css, background };
}

/** 生成注入用的 CSS 文本：先是变量，再是各模块的用户覆盖（作用域限定到 .sr-app）。 */
export function buildAppearanceCss(state: AppearanceState): string {
  const varLines: string[] = [];
  for (const def of VAR_DEFS) {
    const value = state.vars[def.key];
    if (!value) continue;
    varLines.push(`  ${def.key}: ${normalizeValue(def, value)};`);
  }

  const blocks: string[] = [];
  for (const entry of CSS_MODULES) {
    const raw = state.css[entry.key];
    if (!raw || !raw.trim()) continue;
    // 用 CSS 嵌套把用户规则限制在书房作用域内；即使写了裸元素选择器也只影响书房
    blocks.push(`/* ${entry.label} */\n${SCOPE} {\n${indent(raw)}\n}`);
  }

  return [`${SCOPE} {\n${varLines.join("\n")}\n}`, buildBackgroundCss(state.background), ...blocks, SAFETY_CSS]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 兜底：外观页自己的返回与保存/取消入口不受自定义 CSS 影响。
 * 用户写坏 CSS 时，仍然进得来、退得出去、还能一键恢复默认。
 */
const SAFETY_CSS = `/* 兜底：外观页的退出与恢复入口不被自定义 CSS 藏掉 */
.sr-appear-app .sr-header,
.sr-appear-app .sr-header .sr-icon-btn,
.sr-appear-app .sr-appear-footer {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: none !important;
  clip-path: none !important;
  filter: none !important;
  mix-blend-mode: normal !important;
  max-height: none !important;
  overflow: visible !important;
  z-index: 60 !important;
}`;

/**
 * 背景层：.sr-app 的 ::before 放图、::after 放遮罩，两个伪元素都是负 z-index，
 * 配合 isolation 只压在本页内容之下、页面底色之上，不影响布局与点击。
 * 图片链接失效时只是这张图不显示，页面底色仍在（自带回退）。
 */
export function buildBackgroundCss(bg: AppearanceBackground): string {
  if (!bg.url) return "";
  const url = cssUrl(bg.url);
  const size = bg.fit === "cover" ? "cover" : bg.fit === "contain" ? "contain" : "auto";
  const repeat = bg.fit === "repeat" ? "repeat" : "no-repeat";
  const position = `${positionX(bg.position)} ${positionY(bg.position)}`;
  const opacity = Math.min(Math.max(bg.opacity, 0), 100) / 100;
  const maskColor = bg.maskColor || "var(--sr-page-bg)";
  const maskAlpha = Math.min(Math.max(bg.mask, 0), 100);

  const imageLayer = (selector: string) => `${selector}::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: url("${url}");
  background-size: ${size};
  background-position: ${position};
  background-repeat: ${repeat};
  opacity: ${opacity};
}`;

  const maskLayer = (selector: string, alpha: number) => `${selector}::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: color-mix(in srgb, ${maskColor} ${alpha}%, transparent);
}`;

  const rules = [
    "/* 背景层：只影响书房内部，不会漏到其他应用 */",
    // isolation 让负 z-index 的伪元素只待在本页之内（不改成 relative，别动现有全屏定位）
    `${BG_SCOPE} { isolation: isolate; }`,
    imageLayer(BG_SCOPE),
    maskLayer(BG_SCOPE, maskAlpha),
  ];

  if (bg.inReader) {
    // 阅读页：正文底色让位给背景图，遮罩至少 45% 保证字迹清楚
    rules.push(
      ".sr-reader { isolation: isolate; }",
      imageLayer(".sr-reader"),
      maskLayer(".sr-reader", Math.max(maskAlpha, 45)),
      ".sr-reader-body { background: transparent; }",
    );
  }

  return rules.join("\n\n");
}

function positionX(position: BackgroundPosition): string {
  if (position === "left") return "left";
  if (position === "right") return "right";
  return "center";
}

function positionY(position: BackgroundPosition): string {
  if (position === "top") return "top";
  if (position === "bottom") return "bottom";
  return "center";
}

/** 把链接安全地放进 url("")：引号、括号、反斜杠会把 CSS 截断。 */
function cssUrl(raw: string): string {
  return raw.replace(/["'()\\\s]/g, (ch) => encodeURIComponent(ch));
}

function normalizeValue(def: { type: string; unit?: string; key: string }, value: string): string {
  // 阴影强度在样式里写作 calc(var(--sr-shadow-alpha) / 100) 当透明度用，必须是纯数字；
  // 以前带着 % 写出去，算出来只有 0.1%，滑杆怎么拖阴影都看不见
  if (def.key === "--sr-shadow-alpha") {
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : "10";
  }
  if (def.type === "range" && def.unit) {
    const num = Number(value);
    if (Number.isFinite(num)) return `${num}${def.unit}`;
  }
  if (def.type === "range" && !def.unit) {
    const num = Number(value);
    if (Number.isFinite(num)) return String(num);
  }
  if (def.key === "--sr-chat-tail") return value === "0" ? "0" : "1";
  // 字体串里若混入 ; 或 } 会把后面的规则吃掉，先去掉
  if (def.type === "font") return value.replace(/[;{}]/g, "");
  return value;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join("\n");
}

/** 该模块下所有变量（用于「基础样式只读展示」）。 */
export function moduleVarKeys(module: AppearanceModule): string[] {
  return MODULE_VAR_KEYS[module];
}

/**
 * 书房的三个「屏幕根节点」：普通页面 .sr-app、阅读器 .sr-reader、聊天会话 .sr-msg-app。
 * 阅读器和聊天会话是整屏替换渲染的，不在 .sr-app 里面——以前变量只挂在 .sr-app 上，
 * 阅读器字号、工具栏、聊天气泡、共读侧栏的滑杆在真实页面上全都不生效。
 */
const SCOPE = ":is(.sr-app, .sr-reader, .sr-msg-app)";
/** 背景图铺在普通页面和聊天会话上；阅读页另有「阅读页也显示背景」开关。 */
const BG_SCOPE = ":is(.sr-app, .sr-msg-app)";
const STYLE_ID = "sr-appearance-layer";

/**
 * 把外观注入页面。作用域限定在书房的屏幕根节点，样式写法有问题也只影响书房，
 * 不会让整个手机白屏；注入本身用 try/catch 兜底。
 */
export function applyAppearance(state: AppearanceState): void {
  if (typeof document === "undefined") return;
  try {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = buildAppearanceCss(state);
  } catch (err) {
    console.warn("[studyroom] appearance layer failed:", err);
  }
}

/** 清除外观覆盖层（重置入口用）。 */
export function clearAppearanceLayer(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ID)?.remove();
}
