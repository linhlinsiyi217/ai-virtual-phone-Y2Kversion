"use client";

import { useEffect, useState } from "react";
import type { StateValue } from "@/lib/chat-storage";
import { activeStyle, fillTemplate, sanitizeTemplate, DEFAULT_HTML } from "@/lib/inner-voice-style";

/** 心声（内心独白）弹窗：点角色头像打开，点空白处关闭。 */
export type InnerVoiceSheetData = {
    name: string;
    avatarUrl?: string;
    mood?: string;
    voice: string;
    fondness?: string;
    timeLabel?: string;
    stateValues?: StateValue[];
};

export function InnerVoiceSheet({ data, onClose }: { data: InnerVoiceSheetData; onClose: () => void }) {
    const [flipped, setFlipped] = useState(false);
    const [customHtml, setCustomHtml] = useState<string | null>(null);
    const [motion, setMotion] = useState<"fade" | "rise" | "spring" | "none">("rise");

    useEffect(() => {
        try {
            const style = activeStyle();
            setMotion(style?.motion ?? "rise");
            const tpl = (style?.html || "").trim();
            if (!tpl || tpl === DEFAULT_HTML.trim()) { setCustomHtml(null); return; }
            const values: Record<string, string> = {
                char: data.name,
                user: "",
                time: data.timeLabel || "",
                date: new Date().toLocaleDateString("zh-CN"),
                stamp: String(Date.now()),
                charAvatar: data.avatarUrl || "",
                userAvatar: "",
                "心情": data.mood || "",
                "心声": data.voice,
                "好感度": String((data.stateValues || []).find(v => v.name === "好感度")?.value ?? ""),
            };
            for (const v of data.stateValues || []) values[v.name] = String(v.value);
            setCustomHtml(sanitizeTemplate(fillTemplate(tpl, values)));
        } catch {
            setCustomHtml(null);
        }
    }, [data]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            className="ivs-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="心声"
            onClick={onClose}
        >
            <div className={`ivs-pop is-motion-${motion}`}>
                <div className={`ivs-card is-flippable${flipped ? " is-flipped" : ""}`} onClick={e => { e.stopPropagation(); setFlipped(v => !v); }}>
                <div className="ivs-face ivs-front">
                    <div className="ivs-head">
                        <span className="ivs-avatar">
                            {data.avatarUrl ? <img src={data.avatarUrl} alt="" /> : <span className="ivs-avatar-fallback" />}
                        </span>
                        <span className="ivs-who">
                            <span className="ivs-name">{data.name}</span>
                            <span className="ivs-time">{data.timeLabel || "刚刚"}</span>
                        </span>
                        {data.mood ? (
                            <span className="ivs-mood">
                                <span className="ivs-mood-label">MOOD</span>
                                <span className="ivs-mood-value">{data.mood}</span>
                            </span>
                        ) : null}
                    </div>
                    {customHtml ? (
                        <div className="ivs-custom" dangerouslySetInnerHTML={{ __html: customHtml }} />
                    ) : (
                        <div className="ivs-voice">{data.voice}</div>
                    )}
                    <div className="ivs-hint">点一下卡片，看这一轮的状态</div>
                </div>
                <div className="ivs-face ivs-back">
                    <div className="ivs-back-title">这一轮的状态</div>
                    <div className="ivs-bars">
                        {(data.stateValues || []).map(v => (
                            <div className="ivs-bar-row" key={v.name}>
                                <span className="ivs-bar-label">{v.name}</span>
                                <span className="ivs-bar-track">
                                    <span className="ivs-bar-fill" style={{ width: `${Math.max(0, Math.min(100, Number(v.value) || 0))}%` }} />
                                </span>
                                <span className="ivs-bar-num">{v.value}</span>
                            </div>
                        ))}
                        {(!data.stateValues || data.stateValues.length === 0) ? (
                            <div className="ivs-empty">这一轮没有状态数值</div>
                        ) : null}
                    </div>
                    <div className="ivs-hint">点一下回到心声</div>
                </div>
            </div>
            </div>
        </div>
    );
}
