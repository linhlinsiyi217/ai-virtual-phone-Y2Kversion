"use client";

// components/kuaichuan/kuaichuan-app.tsx — 快穿局 App 主壳。
// 四个页签：文游（LLM 快穿文字冒险）/ 转盘（金币抽奖 + 命运重抽券兑换）/
// 表情包（联动聊天表情数据）/ 网易云歌单（联动全局音乐播放）。
// 样式见 styles/kuaichuan.css。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronLeft,
    Coins,
    Gamepad2,
    Image as ImageIcon,
    Loader2,
    ListMusic,
    MessageSquareText,
    RefreshCw,
    RotateCcw,
    Send,
    Settings2,
    Sparkles,
    Ticket,
} from "lucide-react";

import { resolveForumApiConfig } from "@/lib/study-room/forum";
import { simpleLLMCall } from "@/lib/api-helpers";
import {
    DEFAULT_WHEEL_CONFIG,
    KUAICHUAN_WORLDS,
    SPIN_LOG_KEEP,
    clearGameSave,
    isValidWheelConfig,
    loadGameSave,
    loadWallet,
    loadWheelConfig,
    saveGameSave,
    saveWallet,
    saveWheelConfig,
    type KuaichuanGameMessage,
    type KuaichuanGameSave,
    type KuaichuanWallet,
    type WheelConfig,
    type WheelSegmentConfig,
} from "@/lib/kuaichuan-storage";
import { loadStickerPacks, type StickerPack } from "@/lib/custom-sticker-storage";
import { getThemeAssetMap } from "@/lib/theme-storage";
import {
    getNeteaseLyrics,
    getNeteasePlayInfo,
    getNeteaseSongDetail,
    getPersonalizedPlaylists,
    getPlaylistTracksDetailed,
    isNeteaseConfigured,
    type NeteasePlaylist,
    type NeteaseSearchResult,
    type NeteaseTrackListError,
} from "@/lib/music-service";
import { useMusicControlsOptional } from "@/lib/music-context";
import type { MusicTrack } from "@/lib/music-storage";

type KuaichuanTab = "game" | "wheel" | "stickers" | "music";

const TABS: Array<{ id: KuaichuanTab; label: string; icon: typeof Gamepad2 }> = [
    { id: "game", label: "文游", icon: Gamepad2 },
    { id: "wheel", label: "转盘", icon: Coins },
    { id: "stickers", label: "表情包", icon: ImageIcon },
    { id: "music", label: "歌单", icon: ListMusic },
];

export function KuaichuanApp({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<KuaichuanTab>("game");

    return (
        <div className="kc-app">
            <header className="kc-header">
                <button type="button" className="kc-icon-btn" onClick={onClose} aria-label="关闭">
                    <ChevronLeft size={20} strokeWidth={1.8} />
                </button>
                <div className="kc-header-title">
                    快穿<em>局</em>
                </div>
                <span className="kc-header-sub">世界线管理局 · 娱乐分局</span>
            </header>

            {tab === "game" && <KuaichuanGamePane />}
            {tab === "wheel" && <KuaichuanWheelPane />}
            {tab === "stickers" && <KuaichuanStickerPane />}
            {tab === "music" && <KuaichuanMusicPane />}

            <nav className="kc-tabbar">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        className="kc-tab"
                        data-active={tab === id ? "true" : undefined}
                        onClick={() => setTab(id)}
                    >
                        <Icon size={20} strokeWidth={1.7} />
                        <span>{label}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
}

// ══════════════════════ 文游 ══════════════════════

/**
 * 文游 prompt 上下文窗口（G8 修复）：不再粗暴取最近 10 条——
 * 从最新往前取最多 24 条、总字数 ≤4000，至少保留 4 条。
 * 存档侧的历史上限压缩在 lib/kuaichuan-storage.ts 的 saveGameSave 里做。
 */
function buildPromptWindow(history: KuaichuanGameMessage[]): KuaichuanGameMessage[] {
    const MAX_MSGS = 24;
    const MAX_CHARS = 4000;
    const MIN_MSGS = 4;
    if (history.length <= MAX_MSGS) return history;
    for (let take = MAX_MSGS; take >= MIN_MSGS; take--) {
        const slice = history.slice(-take);
        if (slice.reduce((n, m) => n + m.content.length, 0) <= MAX_CHARS) return slice;
    }
    return history.slice(-MIN_MSGS);
}

function KuaichuanGamePane() {
    const [save, setSave] = useState<KuaichuanGameSave | null>(null);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    const world = useMemo(() => KUAICHUAN_WORLDS.find((w) => w.id === save?.worldId) ?? null, [save?.worldId]);

    // 进入某世界：有存档恢复存档，没有就用开场白开新档
    const enterWorld = useCallback((worldId: string) => {
        const meta = KUAICHUAN_WORLDS.find((w) => w.id === worldId);
        if (!meta) return;
        const existing = loadGameSave(worldId);
        if (existing) {
            setSave(existing);
        } else {
            const fresh: KuaichuanGameSave = {
                worldId,
                rounds: 0,
                history: [{ role: "assistant", content: meta.opener }],
                updatedAt: new Date().toISOString(),
            };
            saveGameSave(fresh);
            setSave(fresh);
        }
        setInput("");
        setError(null);
    }, []);

    useEffect(() => {
        const body = bodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
    }, [save?.rounds, save?.history.length, busy]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || !save || !world || busy) return;
        const apiConfig = resolveForumApiConfig();
        if (!apiConfig) {
            setError("还没有配置 API：到「设置 → API 配置」添加一个并设为默认");
            return;
        }
        if (!apiConfig.apiKey || !apiConfig.baseUrl) {
            setError(`API「${apiConfig.name || "默认"}」缺地址或密钥，到「设置 → API 配置」补上`);
            return;
        }
        const userMsg = { role: "user" as const, content: text };
        const nextHistory = [...save.history, userMsg];
        setSave({ ...save, rounds: save.rounds + 1, history: nextHistory });
        setInput("");
        setError(null);
        setBusy(true);
        try {
            const systemPrompt = [
                `你是「快穿局」的文字冒险主持人。玩家是快穿者，当前世界「${world.title}」（${world.subtitle}）。`,
                `本局任务：${world.goal}。`,
                "",
                "规则：",
                "- 每轮用 2-4 段推进剧情：环境变化、NPC 反应、新事件，结尾留出玩家可行动的空间。",
                "- 不替玩家做决定、不替玩家说话。",
                `- 文风：快穿网文的干脆节奏，画面感强，可偶尔插入【系统】提示音调侃玩家。`,
                "- 玩家达成任务目标时，给出收束结局并祝贺通关；通关后若玩家继续输入，就开启番外闲聊。",
                "- 全程使用中文，单次回复 300 字以内。",
            ].join("\n");
            const result = await simpleLLMCall(
                apiConfig,
                [
                    { role: "system", content: systemPrompt },
                    ...buildPromptWindow(nextHistory).map((m) => ({ role: m.role, content: m.content })),
                ],
                { temperature: 0.9, max_tokens: 600, label: "kuaichuan-game" },
            );
            if (result.error || !result.content) throw new Error(result.error || "没有返回内容");
            const done: KuaichuanGameSave = {
                ...save,
                rounds: save.rounds + 1,
                history: [...nextHistory, { role: "assistant", content: result.content.trim() }],
                updatedAt: new Date().toISOString(),
            };
            saveGameSave(done);
            setSave(done);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            setError(`推进失败：${reason.slice(0, 80)}`);
            // 玩家那句话留在历史里，可以直接重试（发送时重新带上）
        } finally {
            setBusy(false);
        }
    };

    const handleRestart = () => {
        if (!save) return;
        clearGameSave(save.worldId);
        enterWorld(save.worldId);
    };

    if (!save) {
        // 世界选择页
        return (
            <div className="kc-pane kc-world-list">
                <p className="kc-world-intro">
                    局里备着六条世界线，各派一个任务。选一条投放自己——进度自动保存，随时回来接着穿。
                </p>
                <div className="kc-world-grid">
                    {KUAICHUAN_WORLDS.map((w) => {
                        const existing = loadGameSave(w.id);
                        return (
                            <button key={w.id} type="button" className="kc-world-card" onClick={() => enterWorld(w.id)}>
                                <span className="kc-world-title">{w.title}</span>
                                <span className="kc-world-sub">{w.subtitle}</span>
                                <span className="kc-world-goal">任务：{w.goal}</span>
                                <span className="kc-world-meta">
                                    {existing ? `已推进 ${existing.rounds} 轮 · 继续穿越` : "新世界线"}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="kc-pane kc-game">
            <div className="kc-game-head">
                <button type="button" className="kc-icon-btn" onClick={() => setSave(null)} aria-label="回到世界列表">
                    <ChevronLeft size={18} strokeWidth={1.8} />
                </button>
                <div className="kc-game-title">
                    {world?.title ?? "世界线"}
                    <small>{world?.subtitle}</small>
                </div>
                <button type="button" className="kc-icon-btn" onClick={handleRestart} aria-label="重开本世界">
                    <RotateCcw size={18} strokeWidth={1.8} />
                </button>
            </div>
            <div className="kc-game-goal">【系统】本局任务：{world?.goal}</div>
            <div ref={bodyRef} className="kc-game-body">
                {save.history.map((msg, i) => (
                    <div key={i} className="kc-game-msg" data-role={msg.role}>
                        {msg.content}
                    </div>
                ))}
                {busy && (
                    <div className="kc-game-msg" data-role="assistant" data-typing="true">
                        <Loader2 size={14} className="kc-spin" /> 系统推演中…
                    </div>
                )}
                {error && (
                    <div className="kc-game-error">
                        {error}
                        <button type="button" onClick={() => void handleSend()}>
                            重试
                        </button>
                    </div>
                )}
            </div>
            <div className="kc-game-input-row">
                <textarea
                    className="kc-game-input"
                    rows={1}
                    placeholder="写下你的下一步行动…"
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                        }
                    }}
                />
                <button
                    type="button"
                    className="kc-game-send"
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || busy}
                    aria-label="发送"
                >
                    {busy ? <Loader2 size={18} className="kc-spin" /> : <Send size={18} strokeWidth={1.8} />}
                </button>
            </div>
        </div>
    );
}

// ══════════════════════ 提现转盘 ══════════════════════
// 扇区与每日次数可配置（G8 修复）：默认值与校验在 lib/kuaichuan-storage.ts，本页「配置」面板里改。

function KuaichuanWheelPane() {
    const [wheelConfig, setWheelConfig] = useState<WheelConfig>(() => loadWheelConfig());
    const [wallet, setWallet] = useState<KuaichuanWallet>(() => loadWallet(loadWheelConfig().freeSpinsPerDay));
    const [rotation, setRotation] = useState(0);
    const [spinning, setSpinning] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [showConfig, setShowConfig] = useState(false);
    const timerRef = useRef<number | null>(null);

    const segments = wheelConfig.segments;
    const segmentAngle = 360 / segments.length;
    // 最大金币段：命运重抽券必中它（不再写死 88，配置改了依然成立）
    const jackpotIndex = segments.reduce((best, s, i) => (s.coins > segments[best].coins ? i : best), 0);
    const jackpotCoins = segments[jackpotIndex].coins;
    // 转盘修复：扇区背景跟着配置走——以前 CSS 里写死 8 段 45° 渐变，改成 6/10/12 段后
    // 色块和标签错位、看不出扇区边界。现在按 segments 动态生成 conic-gradient。
    const wheelBackground = useMemo(() => {
        const n = segments.length;
        const step = 100 / n;
        const colors = segments.map((s, i) => {
            if (s.coins === jackpotCoins && s.coins > 0) return "#d9a94e"; // 大奖格金色
            if (s.coins === -1) return "#46356b"; // 「再来一次」紫
            return i % 2 === 0 ? "#2f2b45" : "#3b3557";
        });
        const stops = colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ");
        return `conic-gradient(${stops})`;
    }, [segments, jackpotCoins]);

    useEffect(() => {
        return () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        };
    }, []);

    const spin = () => {
        if (spinning) return;
        if (wallet.freeSpinsLeft <= 0) {
            setResult("今天的免费次数用完了，明天再来。");
            return;
        }
        // 命运重抽券：强制落在最大金币段
        const useCharm = wallet.luckyCharm > 0;
        const targetIndex = useCharm ? jackpotIndex : Math.floor(Math.random() * segments.length);
        const base = rotation - (rotation % 360);
        // 让第 targetIndex 格的中心对准正上方的指针
        const target = base + 360 * 5 - targetIndex * segmentAngle - segmentAngle / 2;
        const seg = segments[targetIndex];
        const nextWallet: KuaichuanWallet = {
            ...wallet,
            freeSpinsLeft: wallet.freeSpinsLeft - 1,
            luckyCharm: useCharm ? wallet.luckyCharm - 1 : wallet.luckyCharm,
            totalSpins: wallet.totalSpins + 1,
        };
        // G8 修复：开转瞬间就把最终结果算清并落库——动画期间切页签/退出 App 都不会丢金币。
        // 界面先显示扣掉次数/券的过渡钱包，动画结束后再刷新成结算钱包。
        // 转盘修复：中奖结果同时记入 spinLog（最近 SPIN_LOG_KEEP 条），刷新后仍在。
        const settled: KuaichuanWallet =
            seg.coins === -1
                ? { ...nextWallet, freeSpinsLeft: nextWallet.freeSpinsLeft + 1 } // 再来一次：次数原路返还
                : { ...nextWallet, coins: nextWallet.coins + seg.coins };
        const settledWithLog: KuaichuanWallet = {
            ...settled,
            spinLog: [
                { at: new Date().toISOString(), label: seg.label, coins: seg.coins },
                ...(settled.spinLog ?? []),
            ].slice(0, SPIN_LOG_KEEP),
        };
        saveWallet(settledWithLog);
        setWallet(nextWallet);
        setResult(null);
        setSpinning(true);
        setRotation(target);
        // CSS transition 是 4s，结算 4.1s 触发：动画先停、结算紧随其后，不会提前结束。
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setSpinning(false);
            setWallet(settledWithLog);
            if (seg.coins === -1) {
                setResult("再来一次！次数已返还，接着转。");
            } else {
                setResult(seg.coins === 0 ? "谢谢参与——局里说：穿越也有空窗期。" : `中了 ${seg.label}！金币已入账。`);
            }
        }, 4100);
    };

    const exchangeCharm = () => {
        if (wallet.coins < 100 || spinning) return;
        const next: KuaichuanWallet = {
            ...wallet,
            coins: wallet.coins - 100,
            luckyCharm: wallet.luckyCharm + 1,
            withdrawLog: [{ at: new Date().toISOString(), coins: 100, note: "兑换命运重抽券" }, ...wallet.withdrawLog].slice(0, 20),
        };
        saveWallet(next);
        setWallet(next);
        setResult(`提现成功：100 金币兑换 1 张命运重抽券，下一抽必中 ${jackpotCoins} 大奖。`);
    };

    return (
        <div className="kc-pane kc-wheel-pane">
            <div className="kc-wallet-row">
                <span className="kc-wallet-chip">
                    <Coins size={14} strokeWidth={1.8} /> {wallet.coins}
                </span>
                <span className="kc-wallet-chip">
                    <Ticket size={14} strokeWidth={1.8} /> 重抽券 ×{wallet.luckyCharm}
                </span>
                <span className="kc-wallet-chip">今日免费 {wallet.freeSpinsLeft}/{wheelConfig.freeSpinsPerDay}</span>
                <button
                    type="button"
                    className="kc-config-toggle"
                    onClick={() => setShowConfig((v) => !v)}
                    disabled={spinning}
                    aria-expanded={showConfig ? "true" : undefined}
                >
                    <Settings2 size={13} strokeWidth={1.8} /> 配置
                </button>
            </div>

            {showConfig && (
                <WheelConfigPanel
                    config={wheelConfig}
                    onClose={() => setShowConfig(false)}
                    onSaved={(cfg) => {
                        setWheelConfig(cfg);
                        setWallet(loadWallet(cfg.freeSpinsPerDay));
                        setShowConfig(false);
                    }}
                />
            )}

            <div className="kc-wheel-stage">
                <div className="kc-wheel-pointer" />
                <div
                    className="kc-wheel"
                    style={{ transform: `rotate(${rotation}deg)`, background: wheelBackground }}
                    data-spinning={spinning ? "true" : undefined}
                >
                    {segments.map((seg, i) => {
                        const angle = i * segmentAngle + segmentAngle / 2;
                        return (
                            <span
                                key={i}
                                className="kc-wheel-label"
                                style={{ transform: `rotate(${angle}deg) translateY(-74px)` }}
                            >
                                <span
                                    className="kc-wheel-label-text"
                                    style={{ transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
                                >
                                    {seg.label}
                                </span>
                            </span>
                        );
                    })}
                </div>
            </div>

            <button type="button" className="kc-spin-btn" onClick={spin} disabled={spinning}>
                {spinning ? <Loader2 size={18} className="kc-spin" /> : <Sparkles size={18} strokeWidth={1.8} />}
                {spinning ? "转盘中…" : "开转"}
            </button>
            {result && <p className="kc-wheel-result">{result}</p>}

            {wallet.spinLog.length > 0 && (
                <div className="kc-spinlog">
                    <div className="kc-spinlog-title">最近中奖</div>
                    <ul className="kc-spinlog-list">
                        {wallet.spinLog.slice(0, 8).map((item, i) => (
                            <li key={`${item.at}-${i}`}>
                                <span className="kc-spinlog-label">{item.label}</span>
                                <span className="kc-spinlog-time">{new Date(item.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="kc-exchange">
                <div className="kc-exchange-title">提现柜台</div>
                <p className="kc-exchange-note">
                    金币攒到 100，可提现兑换 1 张「命运重抽券」——下一抽必中 {jackpotCoins} 金币大奖格。累计已转 {wallet.totalSpins} 次。
                </p>
                <button
                    type="button"
                    className="kc-exchange-btn"
                    onClick={exchangeCharm}
                    disabled={spinning || wallet.coins < 100}
                >
                    100 金币 → 1 张重抽券
                </button>
                {wallet.withdrawLog.length > 0 && (
                    <ul className="kc-exchange-log">
                        {wallet.withdrawLog.map((item, i) => (
                            <li key={i}>
                                {new Date(item.at).toLocaleString("zh-CN")} · {item.note}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

// ── 转盘配置面板（G8 修复：扇区与每日次数不再写死）──

function WheelConfigPanel({
    config,
    onClose,
    onSaved,
}: {
    config: WheelConfig;
    onClose: () => void;
    onSaved: (cfg: WheelConfig) => void;
}) {
    const [draft, setDraft] = useState<WheelConfig>(() => ({
        ...config,
        segments: config.segments.map((s) => ({ ...s })),
    }));
    const [error, setError] = useState<string | null>(null);

    const updateSegment = (i: number, patch: Partial<WheelSegmentConfig>) => {
        setDraft((d) => ({ ...d, segments: d.segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
    };

    const save = () => {
        const clean: WheelConfig = {
            segments: draft.segments.map((s) => ({ label: s.label.trim() || "未命名", coins: Math.round(Number(s.coins)) || 0 })),
            freeSpinsPerDay: Math.round(Number(draft.freeSpinsPerDay)) || 0,
        };
        if (!isValidWheelConfig(clean)) {
            setError("配置不合法：需要 4-16 个扇区、文案 1-12 字、金币 -1~10000 的整数、每日 1-20 次");
            return;
        }
        saveWheelConfig(clean);
        onSaved(clean);
    };

    const resetDefault = () => {
        const def: WheelConfig = { ...DEFAULT_WHEEL_CONFIG, segments: DEFAULT_WHEEL_CONFIG.segments.map((s) => ({ ...s })) };
        saveWheelConfig(def);
        onSaved(def);
    };

    return (
        <div className="kc-wheel-config">
            <div className="kc-config-head">
                <span>转盘配置</span>
                <button type="button" className="kc-config-close" onClick={onClose} aria-label="收起配置">
                    收起
                </button>
            </div>
            {draft.segments.map((seg, i) => (
                <div className="kc-config-row" key={i}>
                    <span className="kc-config-idx">{i + 1}</span>
                    <input
                        className="kc-config-input"
                        value={seg.label}
                        maxLength={12}
                        placeholder="扇区文案"
                        onChange={(e) => updateSegment(i, { label: e.target.value })}
                    />
                    <input
                        className="kc-config-input kc-config-num"
                        type="number"
                        value={seg.coins}
                        onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            updateSegment(i, { coins: Number.isFinite(v) ? v : 0 });
                        }}
                    />
                </div>
            ))}
            <div className="kc-config-row kc-config-meta">
                <span>每日免费次数</span>
                <input
                    className="kc-config-input kc-config-num"
                    type="number"
                    value={draft.freeSpinsPerDay}
                    onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setDraft((d) => ({ ...d, freeSpinsPerDay: Number.isFinite(v) ? v : 0 }));
                    }}
                />
            </div>
            <p className="kc-config-note">金币填 -1 表示「再来一次」（返还一次机会），其余按数值入账；改次数次日生效。</p>
            {error && <p className="kc-config-error">{error}</p>}
            <div className="kc-config-actions">
                <button type="button" className="kc-config-save" onClick={save}>
                    保存
                </button>
                <button type="button" className="kc-config-reset" onClick={resetDefault}>
                    恢复默认
                </button>
            </div>
        </div>
    );
}

// ══════════════════════ 表情包 ══════════════════════

function KuaichuanStickerPane() {
    const [packs, setPacks] = useState<StickerPack[] | null>(null);
    const [assetMap, setAssetMap] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const list = loadStickerPacks();
            const ids = list.flatMap((p) => p.stickers.map((s) => s.assetId)).filter(Boolean);
            const map = ids.length > 0 ? await getThemeAssetMap(ids).catch(() => ({})) : {};
            if (cancelled) return;
            setPacks(list);
            setAssetMap(map);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const total = packs?.reduce((sum, p) => sum + p.stickers.length, 0) ?? 0;

    return (
        <div className="kc-pane kc-sticker-pane">
            {packs === null ? (
                <div className="kc-empty">
                    <Loader2 size={18} className="kc-spin" /> 正在读取表情包…
                </div>
            ) : packs.length === 0 ? (
                <div className="kc-empty">
                    还没有表情包。
                    <br />
                    到聊天的「我的 → 表情管理」创建一个，局里会同步展示。
                </div>
            ) : (
                <>
                    <p className="kc-sticker-summary">
                        共 {packs.length} 个表情包、{total} 张贴纸，来自 FLOT 聊天。聊天里用「表情包:名字」即可发送。
                    </p>
                    <div className="kc-sticker-list">
                        {packs.map((pack) => (
                            <div key={pack.id} className="kc-sticker-pack">
                                <div className="kc-sticker-pack-head">
                                    {pack.name}
                                    <small>{pack.stickers.length} 张</small>
                                </div>
                                {pack.stickers.length === 0 ? (
                                    <div className="kc-empty" style={{ padding: "12px 0" }}>这个包还是空的。</div>
                                ) : (
                                    <div className="kc-sticker-grid">
                                        {pack.stickers.map((sticker) => {
                                            const src = sticker.externalUrl || assetMap[sticker.assetId] || "";
                                            return (
                                                <div key={sticker.id} className="kc-sticker-item" title={sticker.name}>
                                                    {src ? <img src={src} alt={sticker.name} /> : <ImageIcon size={20} />}
                                                    <span>{sticker.name}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
            <button
                type="button"
                className="kc-link-btn"
                onClick={() => window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat" } }))}
            >
                <MessageSquareText size={16} strokeWidth={1.8} /> 去聊天里创建和管理表情包
            </button>
        </div>
    );
}

// ══════════════════════ 网易云歌单 ══════════════════════

function KuaichuanMusicPane() {
    const player = useMusicControlsOptional();
    const [playlists, setPlaylists] = useState<NeteasePlaylist[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState<NeteasePlaylist | null>(null);
    const [tracks, setTracks] = useState<NeteaseSearchResult[] | null>(null);
    // G8 修复：区分「需要登录网易云」与「API 不可用」，不再一律当成空歌单
    const [tracksError, setTracksError] = useState<NeteaseTrackListError | null>(null);
    const [loadingTracks, setLoadingTracks] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const showToast = useCallback((message: string) => {
        setToast(message);
        window.setTimeout(() => setToast((prev) => (prev === message ? null : prev)), 2400);
    }, []);

    const load = useCallback(() => {
        if (!isNeteaseConfigured()) {
            setPlaylists([]);
            setFailed(false);
            return;
        }
        setPlaylists(null);
        setFailed(false);
        getPersonalizedPlaylists(12)
            .then((list) => setPlaylists(list))
            .catch(() => setFailed(true));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const openPlaylist = async (playlist: NeteasePlaylist) => {
        setActive(playlist);
        setLoadingTracks(true);
        setTracks(null);
        setTracksError(null);
        const { tracks: list, error } = await getPlaylistTracksDetailed(playlist.id);
        if (error) {
            setTracksError(error);
            setTracks([]);
        } else {
            setTracks(list);
        }
        setLoadingTracks(false);
    };

    const playSong = async (song: NeteaseSearchResult) => {
        if (!player) {
            showToast("全局播放器还没准备好，稍后再试");
            return;
        }
        try {
            const info = await getNeteasePlayInfo(song.id);
            if (!info.url) {
                showToast(info.reason || "这首暂时放不了");
                return;
            }
            const detail = await getNeteaseSongDetail(song.id);
            const lyrics = await getNeteaseLyrics(song.id).catch(() => "");
            const track: MusicTrack = {
                id: `netease_${song.id}`,
                title: detail?.name || song.name,
                artist: detail?.artists || song.artists,
                duration: song.duration / 1000,
                coverUrl: detail?.coverUrl || song.coverUrl,
                lyrics,
                liked: false,
                addedAt: new Date().toISOString(),
            };
            if (!player.queue.some((t) => t.id === track.id)) {
                player.setQueue([track, ...player.queue]);
            }
            // G8 修复：playUrl 返回是否真的起播——失败不再「假装播放成功」
            const started = await player.playUrl(info.url, track);
            if (!started) {
                showToast("播放失败：链接加载不了（可能已失效或被浏览器拦截）");
                return;
            }
            showToast(info.trial ? "VIP 歌曲，试听 30 秒" : `正在播放：${track.title}`);
        } catch {
            showToast("播放失败：获取歌曲信息出错，稍后再试");
        }
    };

    if (!isNeteaseConfigured()) {
        return (
            <div className="kc-pane kc-music-pane">
                <div className="kc-empty">
                    还没有配置音乐 API。
                    <br />
                    到音乐 App 的网易云登录页配置后，这里会同步推荐歌单。
                </div>
                <button
                    type="button"
                    className="kc-link-btn"
                    onClick={() => window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "music" } }))}
                >
                    <ListMusic size={16} strokeWidth={1.8} /> 去音乐 App 配置
                </button>
            </div>
        );
    }

    return (
        <div className="kc-pane kc-music-pane">
            {active ? (
                <>
                    <div className="kc-game-head">
                        <button type="button" className="kc-icon-btn" onClick={() => setActive(null)} aria-label="返回歌单列表">
                            <ChevronLeft size={18} strokeWidth={1.8} />
                        </button>
                        <div className="kc-game-title">
                            {active.name}
                            <small>{active.creator} · {active.trackCount} 首</small>
                        </div>
                        <span />
                    </div>
                    {loadingTracks ? (
                        <div className="kc-empty"><Loader2 size={18} className="kc-spin" /> 正在拉取歌单歌曲…</div>
                    ) : tracksError ? (
                        <div className="kc-empty">
                            {tracksError.message}
                            <br />
                            {tracksError.kind === "auth" ? "到音乐 App 的网易云登录页登录后再回来重试。" : "检查音乐 API 是否在线，稍后重试。"}
                            <br />
                            <button
                                type="button"
                                className="kc-retry"
                                onClick={() => {
                                    if (active) void openPlaylist(active);
                                }}
                            >
                                <RefreshCw size={14} strokeWidth={1.8} /> 重试
                            </button>
                        </div>
                    ) : (tracks ?? []).length === 0 ? (
                        <div className="kc-empty">这个歌单没有可用歌曲，换一个试试。</div>
                    ) : (
                        <div className="kc-track-list">
                            {(tracks ?? []).map((song) => (
                                <button key={song.id} type="button" className="kc-track" onClick={() => void playSong(song)}>
                                    <span className="kc-track-name">{song.name}</span>
                                    <span className="kc-track-artist">{song.artists}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {playlists === null ? (
                        <div className="kc-empty"><Loader2 size={18} className="kc-spin" /> 正在加载推荐歌单…</div>
                    ) : failed ? (
                        <div className="kc-empty">
                            歌单加载失败。
                            <button type="button" className="kc-retry" onClick={load}>
                                <RefreshCw size={14} strokeWidth={1.8} /> 重试
                            </button>
                        </div>
                    ) : playlists.length === 0 ? (
                        <div className="kc-empty">暂时没有拿到推荐歌单，稍后再来。</div>
                    ) : (
                        <div className="kc-playlist-grid">
                            {playlists.map((pl) => (
                                <button key={pl.id} type="button" className="kc-playlist-card" onClick={() => void openPlaylist(pl)}>
                                    <span
                                        className="kc-playlist-cover"
                                        style={pl.coverUrl ? { backgroundImage: `url("${pl.coverUrl}")` } : undefined}
                                    >
                                        {!pl.coverUrl && <ListMusic size={22} strokeWidth={1.6} />}
                                    </span>
                                    <span className="kc-playlist-name">{pl.name}</span>
                                    <span className="kc-playlist-meta">{pl.trackCount} 首</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <button
                        type="button"
                        className="kc-link-btn"
                        onClick={() => window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "music" } }))}
                    >
                        <ListMusic size={16} strokeWidth={1.8} /> 在音乐 App 里打开
                    </button>
                </>
            )}
            {toast && <div className="kc-music-toast">{toast}</div>}
        </div>
    );
}
