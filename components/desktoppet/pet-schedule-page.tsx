"use client";

// 后台调度页（G5）：追问 / 定时消息 / 冷场重连三类真实待发消息的统一面板。
// 全部读写现有存储（chat-storage / timed-wake-storage / idle-reconnect-storage），
// 不另建调度源。降级口径：API 或后端不可用时，到点的后台消息会真实失败，
// 并在对应会话落一条系统消息（聊天里可见、系统消息页可回看），绝不伪造成功。

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/primitives";
import { loadAllFollowUpSchedules, loadChatSessions } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { ChatSession, FollowUpSchedule } from "@/lib/chat-storage";
import {
    loadTimedWakeSchedules,
    makeTimedWakeId,
    removeTimedWakeSchedule,
    saveTimedWakeSchedule,
    type TimedWakeSchedule,
} from "@/lib/timed-wake-storage";
import {
    loadIdleReconnectRules,
    removeIdleReconnectRule,
    suppressIdleReconnectUntil,
    IDLE_RECONNECT_MAX_CONSECUTIVE,
    type IdleReconnectRule,
} from "@/lib/idle-reconnect-storage";
import { cancelFollowUp, isBackgroundReplyGenerating } from "@/lib/follow-up-service";
import {
    AlarmIcon,
    ChevronRight,
    Loader2,
    PauseCircleOutline,
    PlayCircleOutline,
    PlusIcon,
    TrashCanOutlineIcon,
} from "./pet-icons";

type SessionDisplay = {
    name: string;
    isGroup: boolean;
};

const DELAY_PRESET_MINUTES = [5, 15, 30, 60, 180];

function formatFireTime(fireAt: number, now: number): string {
    const diff = fireAt - now;
    if (diff <= 0) return "即将发送";
    if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒后`;
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟后`;
    const d = new Date(fireAt);
    const sameDay = new Date(now).toDateString() === d.toDateString();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (sameDay) return `今天 ${hm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function PetSchedulePage({
    onBack,
    onNotice,
    onOpenChatSession,
}: {
    onBack: () => void;
    onNotice: (text: string | null) => void;
    onOpenChatSession: (sessionId: string) => void;
}) {
    const [followups, setFollowups] = useState<FollowUpSchedule[]>([]);
    const [timedWakes, setTimedWakes] = useState<TimedWakeSchedule[]>([]);
    const [idleRules, setIdleRules] = useState<IdleReconnectRule[]>([]);
    const [sessionNames, setSessionNames] = useState<Record<string, SessionDisplay>>({});
    const [generatingSessions, setGeneratingSessions] = useState<Set<string>>(new Set());
    const [privateSessions, setPrivateSessions] = useState<ChatSession[]>([]);
    const [creating, setCreating] = useState(false);
    const [confirmRemoveIdle, setConfirmRemoveIdle] = useState<IdleReconnectRule | null>(null);
    const [formSessionId, setFormSessionId] = useState("");
    const [formDelayMinutes, setFormDelayMinutes] = useState(15);
    const [formIntent, setFormIntent] = useState("");
    const [formSubmitting, setFormSubmitting] = useState(false);

    const reload = useCallback(() => {
        const sessions = loadChatSessions();
        const chars = loadCharacters();
        const names: Record<string, SessionDisplay> = {};
        for (const s of sessions) {
            if (s.isGroup) {
                names[s.id] = { name: s.groupName?.trim() || "群聊", isGroup: true };
            } else {
                const char = chars.find(c => c.id === s.contactId);
                names[s.id] = { name: s.alias?.trim() || char?.name?.trim() || "未知联系人", isGroup: false };
            }
        }
        setSessionNames(names);
        setFollowups(loadAllFollowUpSchedules());
        setTimedWakes(loadTimedWakeSchedules());
        setIdleRules(loadIdleReconnectRules());
        setPrivateSessions(
            sessions
                .filter(s => !s.isGroup)
                .slice()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
        const generating = new Set<string>();
        for (const s of sessions) {
            if (isBackgroundReplyGenerating(s.id)) generating.add(s.id);
        }
        setGeneratingSessions(generating);
    }, []);

    useEffect(() => {
        reload();
        const onEvent = () => reload();
        window.addEventListener("followup-started", onEvent);
        window.addEventListener("followup-fired", onEvent);
        // 倒计时文案跟着时钟走（reload 本身会触发重渲染）
        const timer = window.setInterval(reload, 10_000);
        return () => {
            window.removeEventListener("followup-started", onEvent);
            window.removeEventListener("followup-fired", onEvent);
            window.clearInterval(timer);
        };
    }, [reload]);

    const totalPending = followups.length + timedWakes.length + idleRules.length;

    const handleCancelFollowup = useCallback((sched: FollowUpSchedule) => {
        cancelFollowUp(sched.sessionId);
        onNotice("已取消该追问");
        reload();
    }, [onNotice, reload]);

    const handleTriggerTimedNow = useCallback((sched: TimedWakeSchedule) => {
        saveTimedWakeSchedule({ ...sched, fireAt: Date.now() });
        onNotice("已把定时消息提前到此刻，稍后自动发送");
        reload();
    }, [onNotice, reload]);

    const handleRemoveTimed = useCallback((sched: TimedWakeSchedule) => {
        removeTimedWakeSchedule(sched.id);
        onNotice("已删除该定时消息");
        reload();
    }, [onNotice, reload]);

    const handlePostponeIdle = useCallback((rule: IdleReconnectRule) => {
        suppressIdleReconnectUntil(rule.id, Date.now() + Math.max(1, rule.intervalMinutes) * 60_000);
        onNotice("已把下次冷场重连顺延一个周期");
        reload();
    }, [onNotice, reload]);

    const handleCreateTimed = useCallback(async () => {
        const sessionId = formSessionId || privateSessions[0]?.id || "";
        if (!sessionId) {
            onNotice("还没有可用的私聊会话");
            return;
        }
        const session = loadChatSessions().find(s => s.id === sessionId);
        if (!session) return;
        const minutes = Math.max(1, Math.min(4320, Math.round(formDelayMinutes)));
        setFormSubmitting(true);
        try {
            saveTimedWakeSchedule({
                id: makeTimedWakeId(sessionId),
                sessionId,
                characterId: session.contactId,
                fireAt: Date.now() + minutes * 60_000,
                createdAt: Date.now(),
                delayMinutes: minutes,
                intent: formIntent.trim() || "用户预约的定时问候",
                source: "user",
            });
            onNotice(`已预约：${minutes} 分钟后主动联系 ${sessionNames[sessionId]?.name || "TA"}`);
            setFormIntent("");
            setCreating(false);
            reload();
        } catch (err) {
            onNotice(`预约失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setFormSubmitting(false);
        }
    }, [formSessionId, formDelayMinutes, formIntent, privateSessions, sessionNames, onNotice, reload]);

    const nameOf = (sessionId: string) => sessionNames[sessionId]?.name || "未知会话";

    return (
        <PageShell
            title="后台调度"
            onBack={onBack}
            rightAction={
                <button
                    className="desktoppet-header-btn"
                    type="button"
                    aria-label="新建定时消息"
                    onClick={() => setCreating(open => !open)}
                    disabled={privateSessions.length === 0}
                >
                    <PlusIcon size={20} />
                </button>
            }
        >
            <div className="desktoppet-schedule">
                {totalPending === 0 && !creating && (
                    <EmptyState
                        icon={AlarmIcon}
                        message="暂无待发的后台消息"
                        action={
                            privateSessions.length > 0 ? (
                                <button className="desktoppet-chip-btn" type="button" onClick={() => setCreating(true)}>
                                    预约一条定时消息
                                </button>
                            ) : undefined
                        }
                    />
                )}

                {creating && (
                    <section className="desktoppet-card desktoppet-schedule-create">
                        <div className="desktoppet-section-title">预约定时消息</div>
                        <div className="desktoppet-field">
                            <label className="desktoppet-field-label" htmlFor="desktoppet-timed-session">联系人</label>
                            <select
                                id="desktoppet-timed-session"
                                className="desktoppet-select"
                                value={formSessionId || privateSessions[0]?.id || ""}
                                onChange={e => setFormSessionId(e.target.value)}
                            >
                                {privateSessions.map(s => (
                                    <option key={s.id} value={s.id}>{sessionNames[s.id]?.name || "联系人"}</option>
                                ))}
                            </select>
                            {(() => {
                                const chosen = formSessionId || privateSessions[0]?.id || "";
                                const existed = timedWakes.find(t => t.sessionId === chosen);
                                return existed ? (
                                    <p className="desktoppet-field-desc">该会话已有一条定时消息，保存会替换它（{formatFireTime(existed.fireAt, Date.now())}）</p>
                                ) : null;
                            })()}
                        </div>
                        <div className="desktoppet-field">
                            <span className="desktoppet-field-label">延迟</span>
                            <div className="desktoppet-chip-row">
                                {DELAY_PRESET_MINUTES.map(min => (
                                    <button
                                        key={min}
                                        className="desktoppet-chip-btn"
                                        type="button"
                                        data-active={formDelayMinutes === min}
                                        onClick={() => setFormDelayMinutes(min)}
                                    >
                                        {min >= 60 ? `${min / 60} 小时` : `${min} 分钟`}
                                    </button>
                                ))}
                                <input
                                    className="desktoppet-mini-input"
                                    type="number"
                                    min={1}
                                    max={4320}
                                    value={formDelayMinutes}
                                    onChange={e => setFormDelayMinutes(Number(e.target.value) || 1)}
                                    aria-label="自定义分钟数"
                                />
                            </div>
                        </div>
                        <div className="desktoppet-field">
                            <label className="desktoppet-field-label" htmlFor="desktoppet-timed-intent">意图（可选）</label>
                            <input
                                id="desktoppet-timed-intent"
                                className="desktoppet-input"
                                type="text"
                                value={formIntent}
                                maxLength={60}
                                placeholder="想让TA醒来后聊什么，如：提醒我明天一起吃早饭"
                                onChange={e => setFormIntent(e.target.value)}
                            />
                        </div>
                        <div className="desktoppet-field-row">
                            <button
                                className="desktoppet-mini-btn"
                                type="button"
                                disabled={formSubmitting}
                                onClick={() => setCreating(false)}
                            >
                                取消
                            </button>
                            <button
                                className="desktoppet-mini-btn desktoppet-mini-btn-primary"
                                type="button"
                                disabled={formSubmitting || privateSessions.length === 0}
                                onClick={() => void handleCreateTimed()}
                            >
                                {formSubmitting ? <Loader2 className="desktoppet-spin" size={14} /> : "保存预约"}
                            </button>
                        </div>
                        <p className="desktoppet-field-desc">
                            到点后由后台服务真实生成并送进会话；API 不可用时会如实失败并在会话里落系统消息，不会假装发送成功
                        </p>
                    </section>
                )}

                {followups.length > 0 && (
                    <section className="desktoppet-card">
                        <div className="desktoppet-section-title">追问队列（TA 还想再说）</div>
                        {followups.map(sched => (
                            <div key={sched.sessionId} className="desktoppet-schedule-item">
                                <button
                                    className="desktoppet-schedule-main"
                                    type="button"
                                    onClick={() => onOpenChatSession(sched.sessionId)}
                                >
                                    <span className="desktoppet-schedule-name">{nameOf(sched.sessionId)}</span>
                                    <span className="desktoppet-schedule-meta">
                                        第 {sched.count + 1} 次追问 · {formatFireTime(sched.fireAt, Date.now())}
                                        {generatingSessions.has(sched.sessionId) ? " · 正在生成…" : ""}
                                    </span>
                                </button>
                                <span className="desktoppet-schedule-tag" data-kind="followup">追问</span>
                                <button
                                    className="desktoppet-schedule-act"
                                    type="button"
                                    onClick={() => handleCancelFollowup(sched)}
                                    aria-label="取消追问"
                                >
                                    取消
                                </button>
                            </div>
                        ))}
                    </section>
                )}

                {timedWakes.length > 0 && (
                    <section className="desktoppet-card">
                        <div className="desktoppet-section-title">定时消息</div>
                        {timedWakes.map(sched => (
                            <div key={sched.id} className="desktoppet-schedule-item">
                                <button
                                    className="desktoppet-schedule-main"
                                    type="button"
                                    onClick={() => onOpenChatSession(sched.sessionId)}
                                >
                                    <span className="desktoppet-schedule-name">{nameOf(sched.sessionId)}</span>
                                    <span className="desktoppet-schedule-meta">
                                        {formatFireTime(sched.fireAt, Date.now())}
                                        {generatingSessions.has(sched.sessionId) ? " · 正在生成…" : ""}
                                        {sched.source === "user" ? " · 我预约" : " · TA自己约的"}
                                    </span>
                                    {sched.intent && <span className="desktoppet-schedule-intent">“{sched.intent}”</span>}
                                </button>
                                <span className="desktoppet-schedule-tag" data-kind="timed">定时</span>
                                <span className="desktoppet-schedule-acts">
                                    <button
                                        className="desktoppet-schedule-act"
                                        type="button"
                                        onClick={() => handleTriggerTimedNow(sched)}
                                        aria-label="立即触发"
                                    >
                                        <PlayCircleOutline size={16} />
                                    </button>
                                    <button
                                        className="desktoppet-schedule-act"
                                        type="button"
                                        onClick={() => handleRemoveTimed(sched)}
                                        aria-label="删除定时消息"
                                    >
                                        <TrashCanOutlineIcon size={16} />
                                    </button>
                                </span>
                            </div>
                        ))}
                    </section>
                )}

                {idleRules.length > 0 && (
                    <section className="desktoppet-card">
                        <div className="desktoppet-section-title">冷场重连（沉默太久TA会主动找你）</div>
                        {idleRules.map(rule => {
                            const intervalMs = Math.max(1, rule.intervalMinutes) * 60_000;
                            const nextDueAt = Math.max(
                                rule.lastFiredAt ? rule.lastFiredAt + intervalMs : 0,
                                rule.suppressedUntil ?? 0,
                            );
                            return (
                                <div key={rule.id} className="desktoppet-schedule-item">
                                    <button
                                        className="desktoppet-schedule-main"
                                        type="button"
                                        onClick={() => onOpenChatSession(rule.sessionId)}
                                    >
                                        <span className="desktoppet-schedule-name">{nameOf(rule.sessionId)}</span>
                                        <span className="desktoppet-schedule-meta">
                                            {rule.intervalMinutes >= 60
                                                ? `每 ${Math.round(rule.intervalMinutes / 60)} 小时`
                                                : `每 ${rule.intervalMinutes} 分钟`}
                                            {" · 已连发 "}{rule.consecutiveCount}/{IDLE_RECONNECT_MAX_CONSECUTIVE}
                                            {nextDueAt > Date.now() ? ` · 下次 ${formatFireTime(nextDueAt, Date.now())}` : " · 沉默达标后随时"}
                                            {generatingSessions.has(rule.sessionId) ? " · 正在生成…" : ""}
                                        </span>
                                    </button>
                                    <span className="desktoppet-schedule-tag" data-kind="idle">重连</span>
                                    <span className="desktoppet-schedule-acts">
                                        <button
                                            className="desktoppet-schedule-act"
                                            type="button"
                                            onClick={() => handlePostponeIdle(rule)}
                                            aria-label="顺延一个周期"
                                        >
                                            <PauseCircleOutline size={16} />
                                        </button>
                                        <button
                                            className="desktoppet-schedule-act"
                                            type="button"
                                            onClick={() => setConfirmRemoveIdle(rule)}
                                            aria-label="删除冷场重连规则"
                                        >
                                            <TrashCanOutlineIcon size={16} />
                                        </button>
                                    </span>
                                </div>
                            );
                        })}
                    </section>
                )}

                {totalPending > 0 && (
                    <p className="desktoppet-schedule-note">
                        生成中与待发的消息都会按计划送进对应会话；点击联系人名字可直达会话
                        <ChevronRight size={12} />
                    </p>
                )}
            </div>

            {confirmRemoveIdle && (
                <ConfirmDialog
                    title="删除冷场重连规则？"
                    message={`删除后「${nameOf(confirmRemoveIdle.sessionId)}」沉默再久也不会主动发消息，需要重新去聊天里开启。`}
                    confirmLabel="删除"
                    variant="danger"
                    onConfirm={() => {
                        removeIdleReconnectRule(confirmRemoveIdle.id);
                        setConfirmRemoveIdle(null);
                        onNotice("已删除冷场重连规则");
                        reload();
                    }}
                    onCancel={() => setConfirmRemoveIdle(null)}
                />
            )}
        </PageShell>
    );
}
