"use client";

import { useEffect } from "react";

/** 心声（内心独白）弹窗：点角色头像打开，点空白处关闭。 */
export type InnerVoiceSheetData = {
    name: string;
    avatarUrl?: string;
    mood?: string;
    voice: string;
    fondness?: string;
    timeLabel?: string;
};

export function InnerVoiceSheet({ data, onClose }: { data: InnerVoiceSheetData; onClose: () => void }) {
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
            <div className="ivs-card" onClick={e => e.stopPropagation()}>
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

                {data.fondness ? (
                    <div className="ivs-foot">
                        <span className="ivs-foot-label">好感度</span>
                        <span className="ivs-bar"><span className="ivs-bar-fill" style={{ width: `${Math.max(0, Math.min(100, Number(data.fondness) || 0))}%` }} /></span>
                        <span className="ivs-foot-value">{data.fondness}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
