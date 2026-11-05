"use client";

// G4「剧情」App：HTML互动与剧情。三个子页：
//   1. 主线引导 —— 聚合现有 story 应用的主线会话进度、最近剧情预览与继续入口
//   2. HTML 互动 —— 编辑 HTML/CSS 互动卡，可发送到聊天（sandbox iframe 渲染，安全隔离）
//   3. 专注模式 —— 番茄钟计时 + 全局白噪音（lib/focus-ambient，跨页面持续播放）
// 接入现有聊天和 story，不建第二套数据源，不破坏原页面结构。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, Code2, Hourglass, Play, Square, Pause, Volume2, VolumeX } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import {
    addChatContact,
    createOrGetSession,
    hydrateChatStorage,
    loadChatContacts,
    pushChatMessage,
} from "@/lib/chat-storage";
import {
    getFocusAmbientState,
    pauseFocusAmbient,
    playFocusNoise,
    resumeFocusAmbient,
    setFocusAmbientVolume,
    stopFocusAmbient,
    subscribeFocusAmbient,
} from "@/lib/focus-ambient";
import { NOISE_HINTS, NOISE_LABELS, type NoiseKind } from "@/lib/noise-synth";
import {
    hydrateStoryStorage,
    loadStoryMessages,
    loadStorySessions,
} from "@/lib/story-storage";
import type { StorySession } from "@/lib/story-storage";

type StoryPlusView = "main" | "guide" | "html" | "focus";

const NOISE_KINDS: NoiseKind[] = ["rain", "room", "white", "pink", "brown"];

/** 专注计时预设（分钟）：[专注, 休息] */
const FOCUS_PRESETS: Array<{ label: string; focus: number; rest: number }> = [
    { label: "番茄 25/5", focus: 25, rest: 5 },
    { label: "深度 50/10", focus: 50, rest: 10 },
    { label: "小憩 15/3", focus: 15, rest: 3 },
];

type StoryGuideRow = {
    session: StorySession;
    characterName: string;
    participantNames: string[];
    messageCount: number;
    latestPreview: string;
};

type StoryPlusAppProps = {
    onClose: () => void;
    onNotice?: (msg: string) => void;
    /** 打开现有剧情 App（主线引导的「继续」入口） */
    onOpenStoryApp: () => void;
    /** 跳到统一聊天 App 打开会话（HTML 互动卡发送后跳转） */
    onOpenChatSession?: (sessionId: string) => void;
};

export function StoryPlusApp({ onClose, onNotice, onOpenStoryApp, onOpenChatSession }: StoryPlusAppProps) {
    const [view, setView] = useState<StoryPlusView>("main");

    const handleBack = () => {
        if (view === "main") onClose();
        else setView("main");
    };

    return (
        <PageShell
            title={view === "guide" ? "主线引导" : view === "html" ? "HTML 互动" : view === "focus" ? "专注模式" : "剧情"}
            onBack={handleBack}
        >
            {view === "main" ? (
                <StoryPlusMain onSelect={setView} ambientHint={getFocusAmbientState().status === "playing"} />
            ) : view === "guide" ? (
                <StoryGuidePanel onOpenStoryApp={onOpenStoryApp} />
            ) : view === "html" ? (
                <HtmlInteractivePanel onNotice={onNotice} onOpenChatSession={onOpenChatSession} />
            ) : (
                <FocusPanel onNotice={onNotice} />
            )}
        </PageShell>
    );
}

/* ── 主页 ── */

function StoryPlusMain({ onSelect, ambientHint }: { onSelect: (v: StoryPlusView) => void; ambientHint: boolean }) {
    const entries: Array<{ view: StoryPlusView; icon: React.ReactNode; title: string; desc: string }> = [
        { view: "guide", icon: <BookOpen size={20} strokeWidth={1.8} />, title: "主线引导", desc: "查看每条主线进行到哪了，一键回到剧情 App 继续" },
        { view: "html", icon: <Code2 size={20} strokeWidth={1.8} />, title: "HTML 互动", desc: "写一张可点击的 HTML 互动卡，发送到聊天里玩" },
        {
            view: "focus",
            icon: <Hourglass size={20} strokeWidth={1.8} />,
            title: "专注模式",
            desc: ambientHint ? "计时 + 白噪音（正在播放，退出后继续）" : "计时 + 白噪音，开始一段不被打扰的剧情时间",
        },
    ];
    return (
        <div className="storyplus-main">
            {entries.map(entry => (
                <button key={entry.view} type="button" className="storyplus-entry" onClick={() => onSelect(entry.view)}>
                    <span className="storyplus-entry-icon">{entry.icon}</span>
                    <span className="storyplus-entry-text">
                        <span className="storyplus-entry-title">{entry.title}</span>
                        <span className="storyplus-entry-desc">{entry.desc}</span>
                    </span>
                    <ChevronRight size={18} strokeWidth={1.6} className="storyplus-entry-chevron" />
                </button>
            ))}
        </div>
    );
}

/* ── 主线引导 ── */

function stripToText(raw: string): string {
    return raw
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function StoryGuidePanel({ onOpenStoryApp }: { onOpenStoryApp: () => void }) {
    const [rows, setRows] = useState<StoryGuideRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await hydrateStoryStorage();
                if (cancelled) return;
                const chars = loadCharacters();
                const nameOf = (id: string) => chars.find(c => c.id === id)?.name ?? "未知角色";
                // 当前仓库每个剧情会话就是一条可继续的主线。
                const mainline = loadStorySessions()
                    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
                const top = mainline.slice(0, 8);
                const result: StoryGuideRow[] = [];
                for (const session of top) {
                    const messages = loadStoryMessages(session.id);
                    const latest = messages[messages.length - 1];
                    result.push({
                        session,
                        characterName: nameOf(session.characterId),
                        participantNames: [nameOf(session.characterId)],
                        messageCount: messages.length,
                        latestPreview: latest ? stripToText(latest.renderedContent || latest.rawContent).slice(0, 80) : "（还没有剧情消息）",
                    });
                    if (cancelled) return;
                }
                if (!cancelled) setRows(result);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="storyplus-guide">
            <p className="storyplus-hint">
                主线进度读取现有剧情 App 的数据（同一份存储）。「继续」会打开剧情 App，在对应主线里接着推进。
            </p>
            {loading ? (
                <p className="storyplus-empty">加载中…</p>
            ) : rows.length === 0 ? (
                <p className="storyplus-empty">还没有主线剧情。去剧情 App 开一条新故事吧。</p>
            ) : (
                <div className="storyplus-guide-list">
                    {rows.map(row => (
                        <div key={row.session.id} className="storyplus-guide-card">
                            <div className="storyplus-guide-head">
                                <span className="storyplus-guide-title">
                                    {row.session.title || `${row.participantNames.join(" × ")}`}
                                </span>
                                <span className="storyplus-guide-count">{row.messageCount} 条</span>
                            </div>
                            <p className="storyplus-guide-latest">{row.latestPreview || "（空剧情）"}</p>
                            <div className="storyplus-guide-foot">
                                <span className="storyplus-guide-time">
                                    更新于 {new Date(row.session.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <button type="button" className="storyplus-btn primary" onClick={onOpenStoryApp}>
                                    继续
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── HTML 互动 ── */

const HTML_TEMPLATES: Array<{ label: string; html: string }> = [
    {
        label: "按钮计数",
        html: `<p style="text-align:center;margin:6px 0 12px">今天想 TA 几次？</p>
<button onclick="const n=document.getElementById('n');n.textContent=Number(n.textContent)+1">想一次</button>
<p style="text-align:center;font-size:32px;margin:12px 0" id="n">0</p>`,
    },
    {
        label: "翻牌答案",
        html: `<p style="text-align:center;margin:6px 0 12px">心里想一个问题，点卡片</p>
<div onclick="this.textContent=['是！','不是','再等等','看情况','明天再说'][Math.floor(Math.random()*5)]" style="text-align:center;padding:28px;border-radius:12px;background:linear-gradient(135deg,#b8a6ff,#ffc7e0);cursor:pointer;font-size:17px;color:#fff;font-weight:600">点我翻牌</div>`,
    },
    {
        label: "心情滑条",
        html: `<p style="margin:6px 0 6px">现在的心情值：</p>
<input type="range" min="0" max="100" value="60" style="width:100%" oninput="document.getElementById('mood').textContent=this.value">
<p style="margin:8px 0 0;text-align:center;font-size:26px" id="mood">60</p>`,
    },
];

function buildPreviewDoc(html: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;padding:10px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.6;color:#1c1c1e;background:#fff;}
button{font-size:13px;padding:6px 12px;border:none;border-radius:8px;background:#5b4ddb;color:#fff;cursor:pointer;}
input,textarea,select{font-size:13px;padding:6px 8px;border:1px solid rgba(0,0,0,.15);border-radius:8px;}
</style></head><body>${html}</body></html>`;
}

function HtmlInteractivePanel({
    onNotice,
    onOpenChatSession,
}: {
    onNotice?: (msg: string) => void;
    onOpenChatSession?: (sessionId: string) => void;
}) {
    const [html, setHtml] = useState(HTML_TEMPLATES[0].html);
    const [sending, setSending] = useState(false);
    const [targets, setTargets] = useState<Array<{ character: Character; contactId: string }>>([]);
    const [targetId, setTargetId] = useState<string | null>(null);

    const reloadTargets = useCallback(async () => {
        await hydrateChatStorage();
        const chars = loadCharacters();
        const rows = loadChatContacts()
            .map(contact => {
                const character = chars.find(c => c.id === contact.characterId);
                return character ? { character, contactId: contact.id } : null;
            })
            .filter((x): x is { character: Character; contactId: string } => x !== null);
        setTargets(rows);
        setTargetId(prev => prev ?? rows[0]?.contactId ?? null);
    }, []);

    useEffect(() => {
        void reloadTargets();
    }, [reloadTargets]);

    const handleSend = async () => {
        if (sending || !html.trim()) return;
        const contactId = targetId ?? targets[0]?.contactId;
        if (!contactId) {
            onNotice?.("没有可发送的聊天联系人，先去聊天里加一个");
            return;
        }
        setSending(true);
        try {
            await hydrateChatStorage();
            const character = targets.find(t => t.contactId === contactId)?.character;
            const contact = loadChatContacts().find(c => c.id === contactId)
                ?? (character ? addChatContact(character.id) : null);
            if (!contact) {
                onNotice?.("未能找到聊天联系人");
                return;
            }
            const session = createOrGetSession(contact.id);
            pushChatMessage({
                sessionId: session.id,
                role: "user",
                content: html,
                mediaType: "html_interactive",
            });
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
            onNotice?.(`互动卡已发送到与 ${character?.name ?? "联系人"} 的聊天`);
            if (onOpenChatSession) onOpenChatSession(session.id);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="storyplus-html">
            <p className="storyplus-hint">卡片在 sandbox iframe 里渲染：可点击、可输入，但拿不到小手机的任何数据。</p>
            <div className="storyplus-tpl-bar">
                {HTML_TEMPLATES.map(tpl => (
                    <button key={tpl.label} type="button" className="storyplus-btn ghost" onClick={() => setHtml(tpl.html)}>
                        {tpl.label}
                    </button>
                ))}
            </div>
            <textarea
                className="storyplus-html-editor"
                value={html}
                onChange={e => setHtml(e.target.value)}
                spellCheck={false}
                placeholder="写一段 HTML/CSS，支持 onclick 等内联脚本"
            />
            <p className="storyplus-section-label">预览</p>
            <iframe
                className="storyplus-html-preview"
                title="HTML 互动卡预览"
                sandbox="allow-scripts allow-forms allow-pointer-lock"
                srcDoc={buildPreviewDoc(html)}
            />
            {targets.length > 0 ? (
                <div className="storyplus-send-bar">
                    <select className="storyplus-send-select" value={targetId ?? ""} onChange={e => setTargetId(e.target.value)}>
                        {targets.map(t => (
                            <option key={t.contactId} value={t.contactId}>{t.character.name}</option>
                        ))}
                    </select>
                    <button type="button" className="storyplus-btn primary" onClick={() => void handleSend()} disabled={sending || !html.trim()}>
                        {sending ? "发送中…" : "发送到聊天"}
                    </button>
                </div>
            ) : (
                <p className="storyplus-empty">还没有聊天联系人，先去聊天 App 添加。</p>
            )}
        </div>
    );
}

/* ── 专注模式 ── */

function formatClock(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function beep(): void {
    try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.value = 0.12;
        gain.gain.setTargetAtTime(0.0001, ctx.currentTime + 0.5, 0.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
        osc.onended = () => void ctx.close().catch(() => undefined);
    } catch {
        /* 出不了声就算了，还有通知 */
    }
}

function FocusPanel({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [presetIndex, setPresetIndex] = useState(0);
    const [phase, setPhase] = useState<"idle" | "focus" | "rest" | "done">("idle");
    const [remain, setRemain] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [ambient, setAmbient] = useState(getFocusAmbientState());
    const [volumeDrag, setVolumeDrag] = useState<number | null>(null);

    useEffect(() => subscribeFocusAmbient(() => setAmbient(getFocusAmbientState())), []);

    const preset = FOCUS_PRESETS[presetIndex];
    const totalSeconds = useMemo(
        () => (phase === "rest" ? preset.rest : preset.focus) * 60,
        [phase, preset],
    );

    const stopTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    useEffect(() => stopTimer, [stopTimer]);

    const startPhase = useCallback((next: "focus" | "rest") => {
        stopTimer();
        setPhase(next);
        setRemain((next === "focus" ? preset.focus : preset.rest) * 60);
        timerRef.current = setInterval(() => {
            setRemain(prev => {
                if (prev <= 1) {
                    stopTimer();
                    beep();
                    if (next === "focus") {
                        onNotice?.("专注结束！休息一下");
                        setPhase("rest");
                        setRemain(preset.rest * 60);
                    } else {
                        onNotice?.("休息结束，随时可以开始下一轮");
                        setPhase("done");
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, [preset, stopTimer, onNotice]);

    const progress = (phase === "focus" || phase === "rest") && totalSeconds > 0 ? 1 - remain / totalSeconds : 0;

    const playing = ambient.status === "playing";

    return (
        <div className="storyplus-focus">
            {/* 计时 */}
            <div className="storyplus-timer-card">
                <div className="storyplus-timer-presets">
                    {FOCUS_PRESETS.map((p, i) => (
                        <button
                            key={p.label}
                            type="button"
                            className={`storyplus-btn ghost ${i === presetIndex ? "active" : ""}`}
                            onClick={() => {
                                if (phase === "idle" || phase === "done") setPresetIndex(i);
                                else onNotice?.("计时进行中，先结束这一轮再换时长");
                            }}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                <p className={`storyplus-clock ${phase === "rest" ? "rest" : ""}`}>{formatClock(remain)}</p>
                <div className="storyplus-timer-progress">
                    <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
                </div>
                <p className="storyplus-phase-label">
                    {phase === "idle" ? "准备好就开始" : phase === "focus" ? "专注中，别看手机" : phase === "rest" ? "休息一下" : "本轮完成"}
                </p>
                <div className="storyplus-timer-actions">
                    {phase === "idle" || phase === "done" ? (
                        <button type="button" className="storyplus-btn primary" onClick={() => startPhase("focus")}>
                            <Play size={15} strokeWidth={2} /> 开始专注
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="storyplus-btn ghost"
                                onClick={() => {
                                    stopTimer();
                                    setPhase("idle");
                                    setRemain(0);
                                }}
                            >
                                <Square size={15} strokeWidth={2} /> 结束
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* 白噪音（全局，退出本页继续播放） */}
            <div className="storyplus-noise-card">
                <div className="storyplus-noise-head">
                    {playing ? <Volume2 size={16} strokeWidth={1.8} /> : <VolumeX size={16} strokeWidth={1.8} />}
                    <span>白噪音</span>
                    <span className="storyplus-badge">{playing ? "全局播放中" : ambient.status === "paused" ? "已暂停" : "未播放"}</span>
                </div>
                <p className="storyplus-hint">本机合成，不联网；关闭本页也会继续播放，直到你停止。</p>
                <div className="storyplus-noise-grid">
                    {NOISE_KINDS.map(kind => (
                        <button
                            key={kind}
                            type="button"
                            className={`storyplus-noise-item ${ambient.kind === kind ? "active" : ""}`}
                            onClick={() => void playFocusNoise(kind)}
                            title={NOISE_HINTS[kind]}
                        >
                            <span className="storyplus-noise-name">{NOISE_LABELS[kind]}</span>
                            <span className="storyplus-noise-hint">{NOISE_HINTS[kind]}</span>
                        </button>
                    ))}
                </div>
                <div className="storyplus-noise-controls">
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((volumeDrag ?? ambient.volume) * 100)}
                        onInput={e => {
                            const v = Number((e.target as HTMLInputElement).value) / 100;
                            setVolumeDrag(v);
                            setFocusAmbientVolume(v);
                        }}
                        onPointerUp={() => setVolumeDrag(null)}
                        aria-label="白噪音音量"
                    />
                    {ambient.status === "paused" ? (
                        <button type="button" className="storyplus-btn ghost" onClick={() => void resumeFocusAmbient()}>
                            <Play size={14} strokeWidth={2} />
                        </button>
                    ) : playing ? (
                        <button type="button" className="storyplus-btn ghost" onClick={() => void pauseFocusAmbient()}>
                            <Pause size={14} strokeWidth={2} />
                        </button>
                    ) : null}
                    {ambient.status !== "idle" ? (
                        <button type="button" className="storyplus-btn ghost" onClick={() => stopFocusAmbient()}>
                            停止
                        </button>
                    ) : null}
                </div>
                {ambient.error ? <p className="storyplus-error">{ambient.error}</p> : null}
            </div>
        </div>
    );
}
