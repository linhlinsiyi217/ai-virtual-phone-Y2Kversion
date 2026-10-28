"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Copy, Download, Upload, Undo2, Info, ImagePlus, X } from "lucide-react";

import {
  APPEARANCE_MODULES,
  FIT_LABEL,
  FONT_CHOICES,
  POSITION_LABEL,
  VAR_DEFS,
  applyAppearance,
  buildAppearanceCss,
  defaultState,
  loadAppearance,
  loadPresets,
  moduleVarKeys,
  resetModule,
  sanitizeState,
  saveAppearance,
  savePresets,
  upsertPreset,
  varDef,
  type AppearancePreset,
  type AppearanceBackground,
  type AppearanceModule,
  type AppearanceState,
  type BackgroundFit,
  type BackgroundPosition,
} from "@/lib/study-room/appearance";
import {
  BACKGROUND_ACCEPT,
  UnsupportedBackgroundError,
  canLoadImageUrl,
  fileToBackgroundImage,
  looksLikeImageUrl,
} from "@/lib/study-room/background-image";
import { ColorSheet } from "./color-sheet";
import { HelpFoot, HelpTip } from "./help-tip";

type StudyRoomAppearanceProps = { onBack: () => void };

/** 调色面板当前在改哪个颜色：某个变量，或背景遮罩色。 */
type ColorTarget = { kind: "var"; key: string } | { kind: "bgMask" };

export function StudyRoomAppearance({ onBack }: StudyRoomAppearanceProps) {
  const [module, setModule] = useState<AppearanceModule | "hub">("hub");
  const [saved, setSaved] = useState<AppearanceState>(() => loadAppearance());
  const [draft, setDraft] = useState<AppearanceState>(() => loadAppearance());
  const [colorTarget, setColorTarget] = useState<ColorTarget | null>(null);
  const [cssDraft, setCssDraft] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState("");
  const [presets, setPresets] = useState<AppearancePreset[]>(() => loadPresets());
  const [presetName, setPresetName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);

  // 草稿实时预览：把草稿直接注入，用户在真实界面上看到的就是结果
  useEffect(() => {
    applyAppearance(draft);
  }, [draft]);

  // 离开外观页时恢复为已保存的外观（取消未保存的草稿）
  useEffect(() => () => {
    applyAppearance(loadAppearance());
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const moduleVars = module === "hub" ? [] : VAR_DEFS.filter((d) => d.module === module);
  const moduleCss = module === "hub" ? "" : (cssDraft[module] ?? draft.css[module] ?? "");

  const setVar = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, vars: { ...prev.vars, [key]: value } }));
  };
  const setBackground = (patch: Partial<AppearanceBackground>) => {
    setDraft((prev) => ({ ...prev, background: { ...prev.background, ...patch } }));
  };
  const flashNotice = (message: string, ms = 1800) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), ms);
  };

  /** 本地图片：读成 data URL（过大的图会先等比缩小）。 */
  const handleBackgroundFile = async (file: File) => {
    try {
      const picked = await fileToBackgroundImage(file);
      setBackground({ url: picked.dataUrl });
      flashNotice(picked.note ? `背景已设置（${picked.note}）` : "背景已设置", 2200);
    } catch (err) {
      flashNotice(
        err instanceof UnsupportedBackgroundError ? err.message : "这张图片读不出来，请换一张再试",
        2600,
      );
    }
  };

  /** 链接背景：先试着加载出来，坏链就不写进设置（保持原有底色）。 */
  const handleBackgroundUrl = async () => {
    const url = bgUrl.trim();
    if (!looksLikeImageUrl(url)) {
      flashNotice("请填写 http(s) 图片链接或 data:image 数据", 2600);
      return;
    }
    const usable = await canLoadImageUrl(url);
    if (!usable) {
      flashNotice("这个链接加载不出图片（可能失效或禁止外链），已保持原来的背景", 3000);
      return;
    }
    setBackground({ url });
    flashNotice("已使用该链接作为背景");
  };
  const setCss = (mod: AppearanceModule, value: string) => {
    setCssDraft((prev) => ({ ...prev, [mod]: value }));
    setDraft((prev) => ({ ...prev, css: { ...prev.css, [mod]: value } }));
  };
  const applyCssDraftToState = (mod: AppearanceModule) => {
    const value = cssDraft[mod];
    if (value === undefined) return;
    setDraft((prev) => ({ ...prev, css: { ...prev.css, [mod]: value } }));
  };

  const handleSave = () => {
    saveAppearance(draft);
    setSaved(draft);
    setNotice("已保存");
    window.setTimeout(() => setNotice((n) => (n === "已保存" ? null : n)), 1600);
  };
  const handleCancel = () => {
    setDraft(saved);
    setCssDraft({});
    applyAppearance(saved);
    setNotice("已取消未保存的修改");
    window.setTimeout(() => setNotice((n) => (n === "已取消未保存的修改" ? null : n)), 1600);
  };
  const handleUndo = () => {
    setDraft(saved);
    setCssDraft({});
    applyAppearance(saved);
  };
  const handleResetModule = () => {
    if (module === "hub") {
      const fresh = defaultState();
      setDraft(fresh);
      setCssDraft({});
      applyAppearance(fresh);
      setNotice("已恢复全部默认");
      return;
    }
    const next = resetModule(draft, module);
    setDraft(next);
    setCssDraft((prev) => ({ ...prev, [module]: "" }));
    setNotice(`已恢复「${APPEARANCE_MODULES.find((m) => m.key === module)?.label}」默认`);
    window.setTimeout(() => setNotice(null), 1800);
  };

  const handleCopyCss = async () => {
    try {
      await navigator.clipboard.writeText(module === "hub" ? buildAppearanceCss(draft) : moduleCss);
      setNotice("已复制 CSS");
    } catch {
      setNotice("复制失败");
    }
    window.setTimeout(() => setNotice(null), 1600);
  };

  /** 存一套命名预设；同名会覆盖，不会越存越乱。 */
  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) {
      flashNotice("先给预设起个名字，例如「深色阅读」", 2200);
      return;
    }
    const next = upsertPreset(presets, name, draft);
    setPresets(next);
    savePresets(next);
    setPresetName("");
    flashNotice(`已保存预设「${name}」`);
  };

  /** 应用预设：直接进草稿，仍是「保存后才生效」，可取消。 */
  const handleApplyPreset = (preset: AppearancePreset) => {
    const next = sanitizeState(preset.state);
    setDraft(next);
    setCssDraft({});
    applyAppearance(next);
    flashNotice(`已套用「${preset.name}」，保存后长期生效`, 2400);
  };

  const handleDeletePreset = (preset: AppearancePreset) => {
    const next = presets.filter((item) => item.id !== preset.id);
    setPresets(next);
    savePresets(next);
    flashNotice(`已删除预设「${preset.name}」`);
  };

  const handleExport = () => {
    // 导出里带上一份预设，换设备导入后可以直接切回
    const payload = JSON.stringify({ app: "float-0217-studyroom-appearance", version: 1, state: draft, presets }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "studyroom-appearance.json";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("已导出外观文件");
    window.setTimeout(() => setNotice(null), 1600);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { state?: unknown; presets?: unknown };
      // 兼容两种文件：带 state/presets 的导出包，或直接就是一份外观 JSON
      const rawState = parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : parsed;
      const next = sanitizeState(rawState);
      setDraft(next);
      setCssDraft({});
      applyAppearance(next);

      const incoming = Array.isArray(parsed?.presets)
        ? (parsed.presets as AppearancePreset[]).map((preset) => ({
            id: String(preset.id ?? `preset_${Math.random().toString(36).slice(2, 8)}`),
            name: String(preset.name ?? "未命名预设"),
            createdAt: String(preset.createdAt ?? new Date().toISOString()),
            state: sanitizeState(preset.state),
          }))
        : [];
      if (incoming.length > 0) {
        const merged = incoming.reduce((list, preset) => upsertPreset(list, preset.name, preset.state), presets);
        setPresets(merged);
        savePresets(merged);
        setNotice(`已导入外观与 ${incoming.length} 个预设，未保存前可取消`);
      } else {
        setNotice("已导入，未保存前可取消");
      }
    } catch {
      setNotice("导入失败：文件格式不正确");
    }
    window.setTimeout(() => setNotice(null), 2000);
  };

  const hasBg = Boolean(draft.background.url);

  /** 单个变量的控件：颜色色块 / 字体下拉 / 文本 / 开关 / 滑杆。 */
  const renderControl = (def: (typeof VAR_DEFS)[number], value: string, label: ReactNode) => {
    if (def.type === "color") {
      return (
        <div key={def.key} className="sr-appear-row">
          {label}
          <span className="sr-appear-value">{value}</span>
          <button type="button" className="sr-swatch" style={{ background: value }} onClick={() => setColorTarget({ kind: "var", key: def.key })} aria-label={`${def.label}，当前 ${value}`} />
        </div>
      );
    }
    if (def.type === "font") {
      const known = FONT_CHOICES.some((choice) => choice.value === value);
      return (
        <div key={def.key} className="sr-appear-row">
          {label}
          <select className="sr-appear-select" value={value} onChange={(e) => setVar(def.key, e.target.value)} aria-label={def.label}>
            {!known && <option value={value}>当前自定义字体</option>}
            {FONT_CHOICES.map((choice) => (
              <option key={choice.label} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (def.type === "text") {
      return (
        <div key={def.key} className="sr-appear-row">
          {label}
          <input className="sr-appear-input" value={value} onChange={(e) => setVar(def.key, e.target.value)} aria-label={def.label} />
        </div>
      );
    }
    if (def.type === "toggle") {
      const on = value !== "0";
      return (
        <div key={def.key} className="sr-appear-row">
          {label}
          <button type="button" className="sr-chip" aria-pressed={on} data-active={on ? "true" : undefined} onClick={() => setVar(def.key, on ? "0" : "1")}>{on ? "开" : "关"}</button>
        </div>
      );
    }
    return (
      <div key={def.key} className="sr-appear-row sr-appear-row--slider">
        {label}
        <input
          type="range"
          min={def.min} max={def.max} step={def.step}
          value={Number(value)}
          onChange={(e) => setVar(def.key, e.target.value)}
          className="sr-slider"
          aria-label={def.label}
        />
        <span className="sr-appear-value">{value}{def.unit}</span>
      </div>
    );
  };

  return (
    <section className="sr-app sr-appear-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={() => (module === "hub" ? onBack() : setModule("hub"))} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">外观</div>
            <span className="sr-header-sub">{module === "hub" ? "书房外观与自定义" : APPEARANCE_MODULES.find((m) => m.key === module)?.desc}</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane sr-appearance-pane">
          {notice && <div className="sr-note-card"><div className="sr-note-meta">{notice}</div></div>}

          {module === "hub" ? (
            <>
              <div className="sr-section-label">选择要调整的部分</div>
              {APPEARANCE_MODULES.map((m) => (
                <button key={m.key} type="button" className="sr-btn" style={{ width: "100%", marginBottom: 10, justifyContent: "space-between" }} onClick={() => { setModule(m.key); setCssDraft({}); }}>
                  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <span>{m.label}</span>
                    <span className="sr-note-meta">{m.desc}</span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.6} color="var(--c-icon)" />
                </button>
              ))}
              <div className="sr-section-label" style={{ marginTop: 18 }}>预设</div>
              {presets.length === 0 ? (
                <p className="sr-note-meta" style={{ margin: "2px 2px 10px", lineHeight: 1.7 }}>
                  还没有预设。调好外观后在这里命名保存，之后可以一键切换（例如「白天」「夜间阅读」）。
                </p>
              ) : (
                <ul className="sr-preset-list">
                  {presets.map((preset) => (
                    <li key={preset.id} className="sr-preset-item">
                      <div className="sr-preset-main">
                        <span className="sr-preset-name">{preset.name}</span>
                        <span className="sr-note-meta">
                          {new Date(preset.createdAt).toLocaleDateString()} 保存
                        </span>
                      </div>
                      <button type="button" className="sr-btn sr-btn-sm" onClick={() => handleApplyPreset(preset)}>
                        套用
                      </button>
                      <button
                        type="button"
                        className="sr-btn sr-btn-sm"
                        onClick={() => handleDeletePreset(preset)}
                        aria-label={`删除预设 ${preset.name}`}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sr-appear-row">
                <input
                  className="sr-appear-input"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="给当前外观起个名字"
                  aria-label="预设名称"
                />
                <button type="button" className="sr-btn sr-btn-sm" onClick={handleSavePreset} disabled={!presetName.trim()}>
                  保存预设
                </button>
              </div>

              <div className="sr-actions" style={{ marginTop: 14 }}>
                <button type="button" className="sr-btn" onClick={handleExport}><Download size={16} strokeWidth={1.7} />导出外观</button>
                <button type="button" className="sr-btn" onClick={() => fileRef.current?.click()}><Upload size={16} strokeWidth={1.7} />导入外观</button>
              </div>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleImportFile(f); }} />
              <button type="button" className="sr-btn" style={{ width: "100%", marginTop: 10, justifyContent: "center", color: "var(--c-danger)" }} onClick={handleResetModule}>
                <RotateCcw size={16} strokeWidth={1.7} />恢复全部默认
              </button>
            </>
          ) : (
            <>
              {module === "background" && (
                <>
                  <div className="sr-section-label">书房背景</div>
                  <div className="sr-appear-row">
                    <span className="sr-appear-label">背景图</span>
                    <span className="sr-appear-value">{draft.background.url ? "已设置" : "未设置"}</span>
                  </div>
                  <div className="sr-actions" style={{ marginBottom: 8 }}>
                    <button type="button" className="sr-btn" onClick={() => bgFileRef.current?.click()}>
                      <ImagePlus size={16} strokeWidth={1.7} />选择本地图片
                    </button>
                    {draft.background.url && (
                      <button type="button" className="sr-btn" onClick={() => setBackground({ url: "" })}>
                        <X size={16} strokeWidth={1.7} />清除背景
                      </button>
                    )}
                  </div>
                  <input
                    ref={bgFileRef}
                    type="file"
                    accept={BACKGROUND_ACCEPT}
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void handleBackgroundFile(f);
                    }}
                  />
                  <div className="sr-appear-row">
                    <input
                      className="sr-appear-input"
                      value={bgUrl}
                      onChange={(e) => setBgUrl(e.target.value)}
                      placeholder="或粘贴图片链接 https://…"
                      aria-label="背景图片链接"
                    />
                    <button type="button" className="sr-btn sr-btn-sm" onClick={() => void handleBackgroundUrl()} disabled={!bgUrl.trim()}>
                      使用
                    </button>
                  </div>
                  {!hasBg && (
                    <p className="sr-note-meta sr-appear-hint">先选一张图片或填链接，下面的显示方式、透明度和遮罩才会起作用。</p>
                  )}
                  <div className="sr-appear-row">
                    <span className="sr-appear-label">显示方式</span>
                    {(["cover", "contain", "repeat"] as BackgroundFit[]).map((fit) => (
                      <button
                        key={fit}
                        type="button"
                        className="sr-chip"
                        data-active={draft.background.fit === fit ? "true" : undefined}
                        onClick={() => setBackground({ fit })}
                        disabled={!hasBg}
                      >
                        {FIT_LABEL[fit]}
                      </button>
                    ))}
                  </div>
                  <div className="sr-appear-row">
                    <span className="sr-appear-label">位置</span>
                    {(["center", "top", "bottom", "left", "right"] as BackgroundPosition[]).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        className="sr-chip"
                        data-active={draft.background.position === pos ? "true" : undefined}
                        onClick={() => setBackground({ position: pos })}
                        disabled={!hasBg}
                      >
                        {POSITION_LABEL[pos]}
                      </button>
                    ))}
                  </div>
                  <div className="sr-appear-row sr-appear-row--slider">
                    <span className="sr-appear-label">图片不透明度</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={draft.background.opacity}
                      onChange={(e) => setBackground({ opacity: Number(e.target.value) })}
                      disabled={!hasBg}
                      className="sr-slider"
                      aria-label="背景图片不透明度"
                    />
                    <span className="sr-appear-value">{draft.background.opacity}%</span>
                  </div>
                  <div className="sr-appear-row sr-appear-row--slider">
                    <span className="sr-appear-label">遮罩强度</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={draft.background.mask}
                      onChange={(e) => setBackground({ mask: Number(e.target.value) })}
                      disabled={!hasBg}
                      className="sr-slider"
                      aria-label="背景遮罩强度"
                    />
                    <span className="sr-appear-value">{draft.background.mask}%</span>
                  </div>
                  <div className="sr-appear-row">
                    <span className="sr-appear-label">遮罩颜色</span>
                    <button
                      type="button"
                      className="sr-swatch"
                      style={{ background: draft.background.maskColor || draft.vars["--sr-page-bg"] }}
                      onClick={() => setColorTarget({ kind: "bgMask" })}
                      disabled={!hasBg}
                      aria-label="选择遮罩颜色"
                    />
                  </div>
                  <div className="sr-appear-row">
                    <span className="sr-appear-label">阅读页也显示背景</span>
                    <button
                      type="button"
                      className="sr-chip"
                      data-active={draft.background.inReader ? "true" : undefined}
                      onClick={() => setBackground({ inReader: !draft.background.inReader })}
                      disabled={!hasBg}
                    >
                      {draft.background.inReader ? "开" : "关"}
                    </button>
                  </div>
                  <HelpFoot id="bg-format-about" label="关于背景图">
                    支持 JPG / PNG / WebP / GIF（GIF 保留动画）；其它格式会提示改用这几种。
                    背景覆盖书房各子页面，阅读页默认保持干净底色，需要时可单独打开。
                  </HelpFoot>
                </>
              )}

              {/* 基础控件：同组里按小节分开（例如聊天外观里的「共读侧栏专属」） */}
              {moduleVars.length > 0 && <div className="sr-section-label">基础样式</div>}
              {moduleVars.map((def, index) => {
                const value = draft.vars[def.key] ?? def.fallback;
                const prevGroup = index > 0 ? moduleVars[index - 1].group : undefined;
                const groupHead = def.group && def.group !== prevGroup ? (
                  <div className="sr-section-label sr-appear-subhead">
                    {def.group}
                    <HelpTip id={`appear-group-${def.group}`} label={`关于${def.group}`}>
                      共读侧栏是阅读页里的「AI 共读」抽屉。气泡颜色、圆角、尾巴与聊天室共用上面的设置；这里只调侧栏自己的宽度和字号。
                    </HelpTip>
                  </div>
                ) : null;
                const label = (
                  <span className="sr-appear-label">
                    {def.label}
                    {def.hint && (
                      <HelpTip id={`appear-var-${def.key}`} label={`关于${def.label}`}>
                        {def.hint}
                      </HelpTip>
                    )}
                  </span>
                );
                const control = renderControl(def, value, label);
                return groupHead ? <div key={def.key}>{groupHead}{control}</div> : control;
              })}

              {module !== "background" && (<>
              {/* 只读的基础样式说明 */}
              <details className="sr-css-base">
                <summary><Info size={14} strokeWidth={1.7} />基础样式（只读）与可用的选择器</summary>
                <div className="sr-note-meta" style={{ marginTop: 8, lineHeight: 1.8 }}>
                  下面的变量就是上方控件在改的东西，可以直接写进下面的自定义 CSS：
                  <br />
                  {moduleVarKeys(module).map((k) => <code key={k} className="sr-code-inline">{k}</code>)}
                  <br />
                  本部分主要选择器：<code className="sr-code-inline">{MODULE_SELECTORS[module]}</code>
                </div>
              </details>

              {/* 实时预览：复用真实类名与相同样式机制，数据为明确标注的预览数据 */}
              <div className="sr-section-label">实时预览（预览数据，不写入书架/会话）</div>
              <div className="sr-preview-box"><ModulePreview module={module} bookScale={Number(draft.vars["--sr-book-scale"]) || 1} /></div>

              {/* 自定义 CSS 覆盖层：默认收起，页面更短；已经写过的会自动展开 */}
              <details className="sr-css-fold" open={moduleCss.trim() !== "" || undefined}>
              <summary className="sr-section-label">自定义 CSS（覆盖层，作用域限定在书房）</summary>
              <textarea
                className="sr-css-editor"
                value={moduleCss}
                onChange={(e) => setCss(module, e.target.value)}
                onBlur={() => applyCssDraftToState(module)}
                spellCheck={false}
                rows={6}
                placeholder={`例如：\n.sr-btn { letter-spacing: .4px; }`}
              />
              <div className="sr-css-actions">
                <button type="button" className="sr-chip" onClick={handleCopyCss}><Copy size={13} strokeWidth={1.8} />复制</button>
                <button type="button" className="sr-chip" onClick={handleExport}><Download size={13} strokeWidth={1.8} />导出</button>
                <button type="button" className="sr-chip" onClick={() => fileRef.current?.click()}><Upload size={13} strokeWidth={1.8} />导入</button>
              </div>
              </details>
              <div className="sr-css-actions">
                <button type="button" className="sr-btn sr-btn-sm" onClick={handleResetModule}><RotateCcw size={13} strokeWidth={1.8} />恢复本部分默认</button>
              </div>
              </>)}
              {module === "background" && (
                <div className="sr-css-actions">
                  <button type="button" className="sr-btn sr-btn-sm" onClick={handleResetModule}><RotateCcw size={13} strokeWidth={1.8} />清除背景设置</button>
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleImportFile(f); }} />
            </>
          )}
        </div>
      </div>

      {module !== "hub" && (
        <footer className="sr-appear-footer">
          <button type="button" className="sr-btn" onClick={handleUndo} disabled={!dirty}>
            <Undo2 size={16} strokeWidth={1.7} />撤销未保存
          </button>
          <button type="button" className="sr-btn" onClick={handleCancel} disabled={!dirty}>取消</button>
          <button type="button" className="sr-btn sr-btn-primary" onClick={handleSave} disabled={!dirty}>保存</button>
        </footer>
      )}

      {colorTarget && (
        <ColorSheet
          title={
            colorTarget.kind === "bgMask"
              ? "背景遮罩颜色"
              : varDef(colorTarget.key)?.label ?? "颜色"
          }
          value={
            colorTarget.kind === "bgMask"
              ? draft.background.maskColor || draft.vars["--sr-page-bg"] || "#ffffff"
              : draft.vars[colorTarget.key] ?? "#0a84ff"
          }
          onChange={(v) =>
            colorTarget.kind === "bgMask" ? setBackground({ maskColor: v }) : setVar(colorTarget.key, v)
          }
          onClose={() => setColorTarget(null)}
        />
      )}
    </section>
  );
}

/** 各部分的真实选择器（给用户写覆盖 CSS 参考，稳定且不含编译哈希）。 */
const MODULE_SELECTORS: Record<AppearanceModule, string> = {
  global: ".sr-app / .sr-btn / .sr-tabbar",
  background: ".sr-app::before（图片）/ .sr-app::after（遮罩）",
  shelf: ".sr3-stage / .sr3-shelf / .sr3-board / .sr3-book / .sr3-spine-title",
  reader: ".sr-reader / .sr-reader-body / .sr-para / .sr-chapter-title",
  chat: ".sr-msg-app / .sr-msg-bubble / .sr-msg-inputbar · 共读侧栏 .sr-coread / .sr-coread-msg",
  coread: ".sr-coread / .sr-coread-msg / .sr-coread-foot",
  notes: ".sr-note-card / .sr-note-group / .sr-res-card",
};

/** 预览块：用真实类名渲染，数据全部是写死的预览样本。 */
function ModulePreview({ module, bookScale }: { module: AppearanceModule; bookScale: number }) {
  if (module === "shelf") {
    return (
      <div className="sr3-stage" style={{ padding: 0, minHeight: 0 }}>
        <div className="sr3-shelves" style={{ gap: 18 }}>
          {[[0, 1, 2], [3, 4]].map((row, ri) => (
            <div className="sr3-shelf" key={ri}>
              <div className="sr3-row" style={{ minHeight: Math.round(92 * bookScale), transformStyle: "flat" }}>
                {row.map((i) => {
                  const bookStyle = {
                    // 书本尺寸在真实书架里由 JS 读取后乘到宽高上，预览这里同样乘上去
                    "--w": `${Math.round((24 + i * 4) * bookScale)}px`,
                    "--h": `${Math.round(88 * bookScale)}px`,
                    "--d": `${Math.round(58 * bookScale)}px`,
                    "--tone": ["#33465e", "#5a3f36", "#3d4d41", "#5c3a46", "#2f4b4c"][i],
                    "--ink": "#eef2f8",
                    pointerEvents: "none",
                  } as CSSProperties;
                  return (
                    <span key={i} className="sr3-book" style={bookStyle}>
                      <span className="sr3-face sr3-spine"><span className="sr3-spine-title">样本{i + 1}</span></span>
                    </span>
                  );
                })}
              </div>
              <span className="sr3-board" /><span className="sr3-board-edge" /><span className="sr3-contact" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (module === "reader") {
    return (
      <div className="sr-reader sr-reader--preview">
        <div className="sr-reader-body">
          <h2 className="sr-chapter-title" style={{ marginTop: 0 }}>第一章</h2>
          <p className="sr-para">预览正文：风从窗外进来，把书页吹得轻轻响了一声。</p>
          <p className="sr-para">第二行用来检查行距与字号是否合适。</p>
        </div>
      </div>
    );
  }
  if (module === "chat" || module === "coread") {
    return (
      <>
        <ChatPreview kind="chat" />
        <div className="sr-note-meta" style={{ margin: "10px 2px 6px" }}>共读侧栏</div>
        <ChatPreview kind="coread" />
      </>
    );
  }
  return <OtherPreview />;
}

/** 聊天室 / 共读侧栏的气泡样本。 */
function ChatPreview({ kind }: { kind: "chat" | "coread" }) {
  const module = kind;
  {
    const wrap = module === "chat" ? "sr-msg-body" : "sr-coread-body";
    const cls = module === "chat" ? "sr-msg-bubble" : "sr-coread-msg";
    const rowCls = module === "chat" ? "sr-msg-row" : null;
    const bubble = (mine: boolean, text: string, groupEnd: boolean, groupStart: boolean) => {
      const inner = <div className={cls} data-role={mine ? "user" : "assistant"} data-mine={mine ? "true" : "false"} data-group-start={groupStart ? "true" : undefined} data-group-end={groupEnd ? "true" : undefined}>{text}</div>;
      return rowCls
        ? <div className={rowCls} data-mine={mine ? "true" : "false"} data-group-start={groupStart ? "true" : undefined} data-group-end={groupEnd ? "true" : undefined}>{inner}</div>
        : inner;
    };
    return (
      <div className={wrap} style={{ padding: 12, maxHeight: 230, display: "flex", flexDirection: "column", gap: 2 }}>
        {bubble(false, "短消息，带尾巴。", true, true)}
        {bubble(false, "同一个人连续的第二条，组内不重复尾巴。", true, false)}
        {bubble(true, "这是一条比较长的消息，用来看多行换行、最大宽度和气泡圆角是否合适。", true, true)}
      </div>
    );
  }
}

function OtherPreview() {
  return (
    <div style={{ padding: 4 }}>
      <div className="sr-note-card">
        <p className="sr-note-quote">样本摘录：一句话被标记下来。</p>
        <p className="sr-note-thought">样本想法：这是我写下的批注。</p>
        <div className="sr-note-foot"><span className="sr-note-meta">样本书籍 · 第 1 章</span></div>
      </div>
      <div className="sr-res-card" style={{ marginTop: 10 }}>
        <div className="sr-res-cover">样</div>
        <div className="sr-res-main">
          <div className="sr-res-title">样本结果卡片</div>
          <div className="sr-res-meta">用于检查圆角与底色</div>
        </div>
      </div>
    </div>
  );
}
