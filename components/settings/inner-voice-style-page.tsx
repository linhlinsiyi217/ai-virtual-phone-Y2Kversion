"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    type InnerVoiceStyle,
    DEFAULT_STYLES,
    loadStyles,
    saveStyles,
    loadActiveStyleId,
    saveActiveStyleId,
    newStyle,
    renderPreview,
} from "@/lib/inner-voice-style";
import { exportTicket, readTicket } from "@/lib/ticket-png";

export function InnerVoiceStylePage({ onNotice }: { onNotice?: (text: string) => void }) {
    const [styles, setStyles] = useState<InnerVoiceStyle[]>(DEFAULT_STYLES);
    const [activeId, setActiveId] = useState("default");
    const [draft, setDraft] = useState<InnerVoiceStyle | null>(null);
    const [previewKey, setPreviewKey] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const list = loadStyles();
        setStyles(list);
        const id = loadActiveStyleId();
        setActiveId(id);
        setDraft(list.find(s => s.id === id) || list[0] || null);
    }, []);

    const persist = (next: InnerVoiceStyle[]) => {
        setStyles(next);
        saveStyles(next);
    };

    const updateDraft = (patch: Partial<InnerVoiceStyle>) => {
        setDraft(prev => (prev ? { ...prev, ...patch } : prev));
    };

    const saveDraft = () => {
        if (!draft) return;
        persist(styles.map(s => (s.id === draft.id ? draft : s)));
        onNotice?.("已保存");
    };

    const useStyle = () => {
        if (!draft) return;
        saveActiveStyleId(draft.id);
        setActiveId(draft.id);
        onNotice?.("已设为当前使用");
    };

    const create = () => {
        const item = newStyle();
        persist([...styles, item]);
        setDraft(item);
    };

    const remove = () => {
        if (!draft || styles.length <= 1) return;
        const next = styles.filter(s => s.id !== draft.id);
        persist(next);
        setDraft(next[0]);
        if (activeId === draft.id) { saveActiveStyleId(next[0].id); setActiveId(next[0].id); }
    };

    const restoreDefault = () => {
        const base = DEFAULT_STYLES.map(s => ({ ...s }));
        persist(base);
        setDraft(base[0]);
        saveActiveStyleId(base[0].id);
        setActiveId(base[0].id);
        onNotice?.("已恢复默认");
    };

    const exportJson = async () => {
        if (!draft) return;
        try {
            const blob = await exportTicket({
                format: "y2k-ticket",
                version: 1,
                id: `tk_${Date.now().toString(36)}`,
                type: "innerVoice",
                name: draft.name,
                author: { name: "本机用户" },
                createdAt: new Date().toISOString(),
                modules: ["提示词", "字段", "HTML", "动效"],
                payload: { style: draft },
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `y2k-innerVoice-${draft.name}-${new Date().toISOString().slice(0, 10)}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            onNotice?.("导出失败");
        }
    };

    const importJson = async (file: File) => {
        try {
            if (file.type.startsWith("image/")) {
                const ticket = readTicket(await file.arrayBuffer());
                const style = (ticket?.payload as { style?: InnerVoiceStyle } | undefined)?.style;
                if (!style || !style.name) throw new Error("bad");
                const item: InnerVoiceStyle = { ...style, id: `style_${Date.now().toString(36)}` };
                persist([...styles, item]);
                setDraft(item);
                onNotice?.("已导入这张票");
                return;
            }
            const text = await file.text();
            const parsed = JSON.parse(text) as { style?: InnerVoiceStyle };
            const style = parsed.style || (parsed as unknown as InnerVoiceStyle);
            if (!style || !style.name || !style.html) throw new Error("bad");
            const item: InnerVoiceStyle = { ...style, id: `style_${Date.now().toString(36)}` };
            persist([...styles, item]);
            setDraft(item);
            onNotice?.("已导入");
        } catch {
            onNotice?.("这个文件读不出来");
        }
    };

    const previewHtml = useMemo(() => (draft ? renderPreview(draft.html) : ""), [draft, previewKey]);

    if (!draft) return null;

    return (
        <div className="ivs-page">
            {/* 顶部：当前在改哪一套 */}
            <section className="ivs-card ivs-card-sets">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">心声样式</h3>
                    <span className="ivs-card-sub">{styles.length} 套 · 点选切换</span>
                </div>
                <div className="ivs-sets">
                    {styles.map(s => (
                        <button
                            key={s.id}
                            type="button"
                            className={`ivs-set${s.id === draft.id ? " is-on" : ""}`}
                            onClick={() => setDraft(s)}
                        >
                            <span className="ivs-set-name">{s.name}</span>
                            {s.id === activeId ? <span className="ivs-set-badge">使用中</span> : null}
                        </button>
                    ))}
                    <button type="button" className="ivs-set ivs-set-add" onClick={create}>＋ 新建</button>
                </div>
            </section>

            {/* 基本信息 */}
            <section className="ivs-card">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">名称</h3>
                    <span className="ivs-card-sub">给这套样式起个名字</span>
                </div>
                <input className="ivs-input" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} />
            </section>

            {/* 提示词：主内容，用折叠/展开区分主次 */}
            <section className="ivs-card">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">提示词</h3>
                    <span className="ivs-card-sub">决定心声怎么写</span>
                </div>
                <details className="ivs-fold" open>
                    <summary>日常对话 <span className="ivs-fold-hint">平时聊天用这套</span></summary>
                    <textarea className="ivs-textarea" rows={9} value={draft.prompt} onChange={e => updateDraft({ prompt: e.target.value })} />
                </details>
                <details className="ivs-fold">
                    <summary>小剧场 <span className="ivs-fold-hint">有场景时才用</span></summary>
                    <textarea className="ivs-textarea" rows={8} value={draft.scenePrompt} onChange={e => updateDraft({ scenePrompt: e.target.value })} />
                </details>
            </section>

            {/* 字段 */}
            <section className="ivs-card">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">字段</h3>
                    <span className="ivs-card-sub">模型要输出的内容项</span>
                </div>
                <div className="ivs-list">
                    {draft.fields.map((f, i) => (
                        <div className="ivs-list-row" key={f.key + i}>
                            <span className="ivs-list-key">{`{{${f.key}}}`}</span>
                            <span className="ivs-list-hint">{f.hint}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* 模板 */}
            <section className="ivs-card">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">卡片模板</h3>
                    <span className="ivs-card-sub">决定卡片长什么样</span>
                </div>
                <details className="ivs-fold">
                    <summary>HTML 与样式</summary>
                    <textarea className="ivs-textarea ivs-mono" rows={12} value={draft.html} onChange={e => updateDraft({ html: e.target.value })} />
                </details>
                <div className="ivs-motion">
                    <span className="ivs-motion-label">出现动效</span>
                    <div className="ivs-chips">
                        {([["rise", "上浮"], ["fade", "淡入"], ["spring", "弹性"], ["none", "无"]] as const).map(([k, label]) => (
                            <button key={k} type="button" className={`ivs-chip${draft.motion === k ? " is-on" : ""}`} onClick={() => updateDraft({ motion: k })}>{label}</button>
                        ))}
                    </div>
                </div>
            </section>

            {/* 预览 */}
            <section className="ivs-card">
                <div className="ivs-card-head">
                    <h3 className="ivs-card-title">预览</h3>
                    <button type="button" className="ivs-link" onClick={() => setPreviewKey(k => k + 1)}>重新预览</button>
                </div>
                <div className="ivs-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </section>

            <p className="ivs-note">模板只允许结构、文字与样式，脚本会被过滤。</p>

            {/* 底部固定主操作 */}
            <div className="ivs-dock">
                <button type="button" className="ivs-btn primary" onClick={saveDraft}>保存</button>
                <button type="button" className="ivs-btn" onClick={useStyle}>设为当前</button>
                <button type="button" className="ivs-btn icon" onClick={() => fileRef.current?.click()} aria-label="导入">导入</button>
                <button type="button" className="ivs-btn icon" onClick={exportJson} aria-label="导出">导出</button>
                <button type="button" className="ivs-btn icon" onClick={restoreDefault} aria-label="恢复默认">恢复</button>
                <button type="button" className="ivs-btn icon danger" onClick={remove} disabled={styles.length <= 1} aria-label="删除">删除</button>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/png,application/json,.json,.png"
                hidden
                onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void importJson(f);
                    e.target.value = "";
                }}
            />
        </div>
    );
}
