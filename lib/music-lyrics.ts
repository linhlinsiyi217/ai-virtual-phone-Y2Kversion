// lib/music-lyrics.ts — LRC 歌词解析 + 桌面歌词开关
// 桌面歌词与锁屏歌词卡片共用这里的解析结果；开关状态走 kv + window 事件广播。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type LyricLine = { time: number; text: string };

/** 解析 LRC 文本为按时间排序的歌词行；无时间戳的行忽略。 */
export function parseLrc(lrc: string): LyricLine[] {
    if (!lrc) return [];
    const lines: LyricLine[] = [];
    for (const line of lrc.split("\n")) {
        const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
        if (match) {
            lines.push({
                time: parseInt(match[1], 10) * 60 + parseFloat(match[2]),
                text: match[3].trim(),
            });
        }
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
}

/** 返回 currentTime 所在歌词行下标；没有歌词或尚未开始返回 -1。 */
export function activeLyricIndex(lines: LyricLine[], currentTime: number): number {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (currentTime >= lines[i].time) return i;
    }
    return -1;
}

// ── 桌面歌词开关 ──

const DESKTOP_LYRICS_KEY = "music-desktop-lyrics-v1";
registerKvMigration(DESKTOP_LYRICS_KEY);

export const DESKTOP_LYRICS_EVENT = "music-desktop-lyrics-change";

export function isDesktopLyricsEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return kvGet(DESKTOP_LYRICS_KEY) === "on";
}

export function setDesktopLyricsEnabled(enabled: boolean): void {
    try {
        if (enabled) kvSet(DESKTOP_LYRICS_KEY, "on");
        else kvSet(DESKTOP_LYRICS_KEY, "off");
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(DESKTOP_LYRICS_EVENT));
}
