"use client";

// 桌宠 App（G5）：桌宠与后台消息的统一新入口。
// 四个子页全部复用 FLOT 现有数据层，不建第二套数据源：
//  · 桌宠本体 —— mascot-settings / mascot-state（与浮球、桌面组件同一个桌宠）
//  · 桌宠聊天 —— mascot-chat-store（与浮球面板同一份会话）
//  · 后台调度 —— chat-storage 追问表 + timed-wake-storage + idle-reconnect-storage
//  · 通知记录 —— notice-history（挂现有通知事件的底账）
//  · 系统消息 —— 各会话 role="system" 消息聚合（含后台发送的真实失败记录）

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
    BellRingOutline,
    ChevronRight,
    ClockOutline,
    InformationOutline,
    MessageTextOutline,
    PawOutline,
    RotateCcw,
    Send,
} from "./pet-icons";
import { PageShell } from "@/components/ui/page-shell";
import { PetChatView } from "./pet-chat-view";
import { PetSchedulePage } from "./pet-schedule-page";
import { PetNoticePage } from "./pet-notice-page";
import { PetSystemPage } from "./pet-system-page";
import {
    closeMascotPanel,
    deactivateMascot,
    getMascotState,
    isMascotPanelOpen,
    subscribeMascot,
    toggleMascotPanel,
} from "@/lib/mascot-state";
import {
    DEFAULT_MASCOT_AVATAR,
    loadMascotSettings,
    resolveMascotImageRef,
    subscribeMascotSettings,
    updateMascotSettings,
    type MascotSettings,
} from "@/lib/mascot-settings";
import {
    getNoticeUnreadCount,
    subscribeNoticeHistory,
} from "@/lib/notice-history";
import { loadAllFollowUpSchedules } from "@/lib/chat-storage";
import { loadTimedWakeSchedules } from "@/lib/timed-wake-storage";
import { loadIdleReconnectRules } from "@/lib/idle-reconnect-storage";

type PetPage = "home" | "chat" | "schedule" | "notices" | "system";

/** 头像压成 256px JPEG dataURL：kv 是 localStorage 底座，原图会把它撑爆 */
async function compressAvatarFile(file: File): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = dataUrl;
    });
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    canvas.getContext("2d")?.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
}

function resolveMascotStateLabel(state: ReturnType<typeof getMascotState>): string {
    if (state === "floating") return "浮球巡游中";
    if (state === "animating_in" || state === "animating_out") return "变身中…";
    return "桌面组件休眠中";
}

export function DesktopPetApp({
    onClose,
    onNotice,
    onOpenChatSession,
}: {
    onClose: () => void;
    onNotice: (text: string | null) => void;
    onOpenChatSession: (sessionId: string) => void;
}) {
    const [page, setPage] = useState<PetPage>("home");

    if (page === "chat") {
        return (
            <PetChatView
                onBack={() => setPage("home")}
            />
        );
    }
    if (page === "schedule") {
        return (
            <PetSchedulePage
                onBack={() => setPage("home")}
                onNotice={onNotice}
                onOpenChatSession={onOpenChatSession}
            />
        );
    }
    if (page === "notices") {
        return (
            <PetNoticePage
                onBack={() => setPage("home")}
                onOpenChatSession={onOpenChatSession}
            />
        );
    }
    if (page === "system") {
        return (
            <PetSystemPage
                onBack={() => setPage("home")}
                onOpenChatSession={onOpenChatSession}
            />
        );
    }
    return (
        <PetHomePage
            onClose={onClose}
            onNotice={onNotice}
            onOpenPage={setPage}
        />
    );
}

/* ── 主页：桌宠状态卡 + 设置 + 三个消息中心入口 ── */

function PetHomePage({
    onClose,
    onNotice,
    onOpenPage,
}: {
    onClose: () => void;
    onNotice: (text: string | null) => void;
    onOpenPage: (page: PetPage) => void;
}) {
    const mascotState = useSyncExternalStore(subscribeMascot, getMascotState, () => "widget" as const);
    const panelOpen = useSyncExternalStore(subscribeMascot, isMascotPanelOpen, () => false);
    const settings = useSyncExternalStore(
        subscribeMascotSettings,
        () => loadMascotSettings(),
        () => loadMascotSettings(),
    );

    const [avatarUrl, setAvatarUrl] = useState<string>(DEFAULT_MASCOT_AVATAR);
    const [nicknameDraft, setNicknameDraft] = useState(settings.nickname);
    const [personaDraft, setPersonaDraft] = useState(settings.personaPrompt);
    const [personaOpen, setPersonaOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [unreadNotices, setUnreadNotices] = useState(0);
    const [pendingSends, setPendingSends] = useState(0);
    const avatarFileRef = useRef<HTMLInputElement | null>(null);

    // 头像 ref 异步解析（dataURL 直通；资产 id 走 IndexedDB）
    useEffect(() => {
        let alive = true;
        void resolveMascotImageRef(settings.avatarImage)
            .then(url => { if (alive) setAvatarUrl(url || DEFAULT_MASCOT_AVATAR); })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [settings.avatarImage]);

    // 设置刷新时同步草稿（外部改动，比如浮球面板里改了昵称）
    useEffect(() => {
        setNicknameDraft(settings.nickname);
        setPersonaDraft(settings.personaPrompt);
    }, [settings.nickname, settings.personaPrompt]);

    // 角标：通知未读数 + 后台待发条数（真实数据，进页/事件时刷新）
    const refreshBadges = useCallback(() => {
        setUnreadNotices(getNoticeUnreadCount());
        setPendingSends(
            loadAllFollowUpSchedules().length
            + loadTimedWakeSchedules().length
            + loadIdleReconnectRules().length,
        );
    }, []);
    useEffect(() => {
        refreshBadges();
        const offNotice = subscribeNoticeHistory(refreshBadges);
        const onFired = () => refreshBadges();
        window.addEventListener("followup-fired", onFired);
        window.addEventListener("followup-started", onFired);
        return () => {
            offNotice();
            window.removeEventListener("followup-fired", onFired);
            window.removeEventListener("followup-started", onFired);
        };
    }, [refreshBadges]);

    const saveSettings = useCallback(async (updates: Partial<MascotSettings>) => {
        setSaving(true);
        try {
            updateMascotSettings(updates);
            onNotice("桌宠设置已保存");
        } catch (err) {
            onNotice(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSaving(false);
        }
    }, [onNotice]);

    const handleAvatarPick = useCallback(async (file: File | undefined) => {
        if (!file) return;
        try {
            const dataUrl = await compressAvatarFile(file);
            await saveSettings({ avatarImage: dataUrl });
        } catch (err) {
            onNotice(`头像更新失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, [onNotice, saveSettings]);

    const isFloating = mascotState === "floating";

    return (
        <PageShell
            title="桌宠"
            onBack={onClose}
            rightAction={
                <button
                    className="desktoppet-header-btn"
                    type="button"
                    onClick={() => onOpenPage("chat")}
                    aria-label="和桌宠聊天"
                >
                    <MessageTextOutline size={20} />
                </button>
            }
        >
            <div className="desktoppet-home">
                {/* 状态卡 */}
                <section className="desktoppet-card desktoppet-hero">
                    <img className="desktoppet-hero-avatar" src={avatarUrl} alt={settings.nickname} />
                    <div className="desktoppet-hero-main">
                        <div className="desktoppet-hero-name">{settings.nickname || "AI助手"}</div>
                        <div className="desktoppet-hero-state" data-state={mascotState}>
                            <PawOutline size={14} />
                            {resolveMascotStateLabel(mascotState)}
                        </div>
                        <div className="desktoppet-hero-actions">
                            {isFloating ? (
                                <>
                                    <button
                                        className="desktoppet-chip-btn"
                                        type="button"
                                        onClick={() => toggleMascotPanel()}
                                    >
                                        {panelOpen ? "收起面板" : "打开面板"}
                                    </button>
                                    <button
                                        className="desktoppet-chip-btn"
                                        type="button"
                                        onClick={() => {
                                            closeMascotPanel();
                                            deactivateMascot();
                                            onNotice("桌宠已回到桌面组件休息");
                                        }}
                                    >
                                        送回桌面
                                    </button>
                                </>
                            ) : (
                                <span className="desktoppet-hero-hint">桌宠正在桌面小组件上休息，点桌面上的它即可唤出浮球</span>
                            )}
                        </div>
                    </div>
                </section>

                {/* 消息中心入口 */}
                <section className="desktoppet-card">
                    <div className="desktoppet-section-title">消息中心</div>
                    <button
                        className="desktoppet-entry"
                        type="button"
                        onClick={() => onOpenPage("schedule")}
                    >
                        <span className="desktoppet-entry-icon" data-tone="amber"><ClockOutline size={20} /></span>
                        <span className="desktoppet-entry-text">
                            <span className="desktoppet-entry-name">后台调度</span>
                            <span className="desktoppet-entry-desc">
                                {pendingSends > 0 ? `${pendingSends} 条待发：追问 / 定时 / 冷场重连` : "暂无待发的后台消息"}
                            </span>
                        </span>
                        {pendingSends > 0 && <span className="desktoppet-badge">{pendingSends}</span>}
                        <ChevronRight size={18} className="desktoppet-entry-chevron" />
                    </button>
                    <button
                        className="desktoppet-entry"
                        type="button"
                        onClick={() => onOpenPage("notices")}
                    >
                        <span className="desktoppet-entry-icon" data-tone="teal"><BellRingOutline size={20} /></span>
                        <span className="desktoppet-entry-text">
                            <span className="desktoppet-entry-name">通知记录</span>
                            <span className="desktoppet-entry-desc">错过的通知气泡都在这里，点开直达会话</span>
                        </span>
                        {unreadNotices > 0 && <span className="desktoppet-badge">{unreadNotices}</span>}
                        <ChevronRight size={18} className="desktoppet-entry-chevron" />
                    </button>
                    <button
                        className="desktoppet-entry"
                        type="button"
                        onClick={() => onOpenPage("system")}
                    >
                        <span className="desktoppet-entry-icon" data-tone="violet"><InformationOutline size={20} /></span>
                        <span className="desktoppet-entry-text">
                            <span className="desktoppet-entry-name">系统消息</span>
                            <span className="desktoppet-entry-desc">通话、红包、后台发送结果等系统提示</span>
                        </span>
                        <ChevronRight size={18} className="desktoppet-entry-chevron" />
                    </button>
                </section>

                {/* 桌宠设置 */}
                <section className="desktoppet-card">
                    <div className="desktoppet-section-title">桌宠设置</div>
                    <div className="desktoppet-field">
                        <label className="desktoppet-field-label" htmlFor="desktoppet-nickname">昵称</label>
                        <div className="desktoppet-field-row">
                            <input
                                id="desktoppet-nickname"
                                className="desktoppet-input"
                                type="text"
                                value={nicknameDraft}
                                maxLength={12}
                                placeholder="给桌宠起个名字"
                                onChange={e => setNicknameDraft(e.target.value)}
                            />
                            <button
                                className="desktoppet-mini-btn"
                                type="button"
                                disabled={saving || !nicknameDraft.trim() || nicknameDraft === settings.nickname}
                                onClick={() => void saveSettings({ nickname: nicknameDraft.trim() })}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                    <div className="desktoppet-field">
                        <span className="desktoppet-field-label">头像</span>
                        <div className="desktoppet-field-row">
                            <button
                                className="desktoppet-mini-btn"
                                type="button"
                                onClick={() => avatarFileRef.current?.click()}
                            >
                                更换头像
                            </button>
                            <button
                                className="desktoppet-mini-btn"
                                type="button"
                                onClick={() => void saveSettings({ avatarImage: DEFAULT_MASCOT_AVATAR })}
                            >
                                恢复默认
                            </button>
                            <input
                                ref={avatarFileRef}
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={e => {
                                    void handleAvatarPick(e.target.files?.[0]);
                                    e.target.value = "";
                                }}
                            />
                        </div>
                    </div>
                    <div className="desktoppet-field">
                        <div className="desktoppet-field-label-row">
                            <span className="desktoppet-field-label">桌宠聊天</span>
                            <button
                                className="desktoppet-toggle"
                                type="button"
                                role="switch"
                                aria-checked={settings.chatEnabled}
                                data-active={settings.chatEnabled}
                                onClick={() => void saveSettings({ chatEnabled: !settings.chatEnabled })}
                            >
                                <span className="desktoppet-toggle-knob" />
                            </button>
                        </div>
                        <p className="desktoppet-field-desc">
                            关闭后浮球面板与这里的聊天页都不可用（不影响浮球帮你编辑角色、预设等工具能力）
                        </p>
                    </div>
                    <div className="desktoppet-field">
                        <div className="desktoppet-field-label-row">
                            <span className="desktoppet-field-label">人设提示词</span>
                            <button
                                className="desktoppet-mini-btn"
                                type="button"
                                onClick={() => setPersonaOpen(open => !open)}
                            >
                                {personaOpen ? "收起" : "展开"}
                            </button>
                        </div>
                        {personaOpen && (
                            <>
                                <textarea
                                    className="desktoppet-textarea"
                                    rows={6}
                                    value={personaDraft}
                                    onChange={e => setPersonaDraft(e.target.value)}
                                    placeholder="桌宠的行为准则：它如何称呼你、说话风格、擅长做什么"
                                />
                                <div className="desktoppet-field-row">
                                    <button
                                        className="desktoppet-mini-btn"
                                        type="button"
                                        disabled={saving || !personaDraft.trim() || personaDraft === settings.personaPrompt}
                                        onClick={() => void saveSettings({ personaPrompt: personaDraft.trim() })}
                                    >
                                        保存人设
                                    </button>
                                    <button
                                        className="desktoppet-mini-btn"
                                        type="button"
                                        disabled={saving}
                                        onClick={() => setPersonaDraft(settings.personaPrompt)}
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* 聊天入口 */}
                <button
                    className="desktoppet-chat-cta"
                    type="button"
                    onClick={() => onOpenPage("chat")}
                >
                    <Send size={16} />
                    和桌宠聊天
                </button>
            </div>
        </PageShell>
    );
}
