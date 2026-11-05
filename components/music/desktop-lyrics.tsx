// components/music/desktop-lyrics.tsx — 桌面歌词浮层
// 紧贴状态栏下方的一条细歌词，跟随播放进度滚动当前句。
// 点击整条进完整播放器；右侧关闭按钮直接关掉桌面歌词开关。
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMusicPlayerOptional } from "@/lib/music-context";
import {
    parseLrc, activeLyricIndex,
    isDesktopLyricsEnabled, setDesktopLyricsEnabled, DESKTOP_LYRICS_EVENT,
    type LyricLine,
} from "@/lib/music-lyrics";

export default function DesktopLyrics({ hidden }: { hidden?: boolean }) {
    const player = useMusicPlayerOptional();
    const [enabled, setEnabled] = useState(() => isDesktopLyricsEnabled());

    useEffect(() => {
        const onChange = () => setEnabled(isDesktopLyricsEnabled());
        window.addEventListener(DESKTOP_LYRICS_EVENT, onChange);
        return () => window.removeEventListener(DESKTOP_LYRICS_EVENT, onChange);
    }, []);

    const lyrics = useMemo<LyricLine[]>(
        () => (enabled ? parseLrc(player?.currentTrack?.lyrics || "") : []),
        [enabled, player?.currentTrack?.lyrics],
    );

    const activeIdx = lyrics.length > 0 ? activeLyricIndex(lyrics, player?.currentTime ?? 0) : -1;
    const activeText = activeIdx >= 0 ? lyrics[activeIdx].text : "";
    // 下一句用于预告：当前句唱完前先淡显 upcoming，避免句子间空白太生硬
    const nextText = activeIdx >= 0 && activeIdx + 1 < lyrics.length ? lyrics[activeIdx + 1].text : "";

    const handleDisable = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setDesktopLyricsEnabled(false);
    }, []);

    if (!player || !player.currentTrack || !enabled || hidden || player.showFullPlayer) return null;
    if (!activeText && !nextText) return null;

    const track = player.currentTrack;

    return (
        <div
            className="desktop-lyrics"
            role="button"
            tabIndex={0}
            onClick={() => player.openFullPlayer()}
            {...(player.isPlaying ? { "data-playing": "" } : {})}
        >
            <div className="desktop-lyrics-lines">
                {activeText ? <span className="desktop-lyrics-current">{activeText}</span> : null}
                {nextText ? <span className="desktop-lyrics-upcoming">{nextText}</span> : null}
                {!activeText && !nextText ? <span className="desktop-lyrics-upcoming">♪ {track.title}</span> : null}
            </div>
            <button
                type="button"
                className="desktop-lyrics-close"
                aria-label="关闭桌面歌词"
                onClick={handleDisable}
            >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
    );
}
