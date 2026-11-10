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

    const exportJson = () => {
        if (!draft) return;
        const blob = new Blob([JSON.stringify({ format: "y2k-inner-voice", version: 1, style: draft }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `y2k-innerVoice-${draft.name}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importJson = async (file: File) => {
        try {
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
            <div className="ivs-chips">
                {styles.map(s => (
                    <button
                        key={s.id}
                        type="button"
                        className={`ivs-chip${s.id === draft.id ? " is-on" : ""}`}
                        onClick={() => setDraft(s)}
                    >
                        {s.name}
                        {s.id === activeId ? <span className="ivs-chip-dot" /> : null}
                    </button>
                ))}
                <button type="button" className="ivs-chip ivs-chip-add" onClick={create}>＋ 新建</button>
            </div>

            <label className="ivs-label">名称</label>
            <input className="ivs-input" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} />

            <label className="ivs-label">日常提示词</label>
            <textarea className="ivs-textarea" rows={8} value={draft.prompt} onChange={e => updateDraft({ prompt: e.target.value })} />

            <label className="ivs-label">小剧场提示词</label>
            <textarea className="ivs-textarea" rows={7} value={draft.scenePrompt} onChange={e => updateDraft({ scenePrompt: e.target.value })} />

            <label className="ivs-label">字段</label>
            <div className="ivs-fields">
                {draft.fields.map((f, i) => (
                    <div className="ivs-field" key={f.key + i}>
                        <span className="ivs-field-key">{`{{${f.key}}}`}</span>
                        <span className="ivs-field-hint">{f.hint}</span>
                    </div>
                ))}
            </div>

            <label className="ivs-label">HTML 模板</label>
            <textarea className="ivs-textarea ivs-mono" rows={12} value={draft.html} onChange={e => updateDraft({ html: e.target.value })} />

            <label className="ivs-label">出现动效</label>
            <div className="ivs-chips">
                {([["rise", "上浮"], ["fade", "淡入"], ["spring", "弹性"], ["none", "无"]] as const).map(([k, label]) => (
                    <button key={k} type="button" className={`ivs-chip${draft.motion === k ? " is-on" : ""}`} onClick={() => updateDraft({ motion: k })}>{label}</button>
                ))}
            </div>

            <label className="ivs-label">预览</label>
            <div className="ivs-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            <button type="button" className="ivs-chip" onClick={() => setPreviewKey(k => k + 1)}>重新预览</button>

            <div className="ivs-actions">
                <button type="button" className="ivs-btn primary" onClick={saveDraft}>保存</button>
                <button type="button" className="ivs-btn" onClick={useStyle}>设为当前</button>
                <button type="button" className="ivs-btn" onClick={() => fileRef.current?.click()}>导入</button>
                <button type="button" className="ivs-btn" onClick={exportJson}>导出</button>
                <button type="button" className="ivs-btn" onClick={restoreDefault}>恢复默认</button>
                <button type="button" className="ivs-btn danger" onClick={remove} disabled={styles.length <= 1}>删除</button>
            </div>
            <p className="ivs-note">模板只允许结构、文字与样式，脚本会被过滤。</p>

            <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
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
