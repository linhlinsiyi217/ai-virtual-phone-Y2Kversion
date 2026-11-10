"use client";

import { useEffect, useState } from "react";
import type { StateValue } from "@/lib/chat-storage";

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
                    <div className="ivs-voice">{data.voice}</div>
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
    );
}
