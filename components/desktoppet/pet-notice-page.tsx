"use client";

// 通知记录页（G5 气泡链）：站内横幅/灵动岛是单槽气泡，这里保留每一条真实
// 弹过的通知（notice-history 底账），错过的通知依次可回溯、点开直达会话。

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog } from "@/components/ui/modal";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import {
    clearNoticeHistory,
    getNoticeUnreadCount,
    loadNoticeHistory,
    markNoticesRead,
    subscribeNoticeHistory,
    type NoticeHistoryItem,
} from "@/lib/notice-history";
import { BellRingOutline, TrashCanOutlineIcon } from "./pet-icons";

function formatNoticeTime(createdAt: number): string {
    const now = Date.now();
    const diff = now - createdAt;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    const d = new Date(createdAt);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function PetNoticePage({
    onBack,
    onOpenChatSession,
}: {
    onBack: () => void;
    onOpenChatSession: (sessionId: string) => void;
}) {
    const [items, setItems] = useState<NoticeHistoryItem[]>(() => loadNoticeHistory());
    // 首帧先截住未读数，再把本轮标记为已读：hint 展示的是"进页那一刻有几条新的"
    const [initialUnread] = useState(() => getNoticeUnreadCount());
    const [confirmClear, setConfirmClear] = useState(false);
    const [, forceTick] = useState(0);

    const refresh = useCallback(() => {
        setItems(loadNoticeHistory());
    }, []);

    useEffect(() => {
        refresh();
        const off = subscribeNoticeHistory(refresh);
        // 相对时间文案跟随时钟
        const timer = window.setInterval(() => forceTick(t => t + 1), 30_000);
        return () => {
            off();
            window.clearInterval(timer);
        };
    }, [refresh]);

    // 进页即视为已读
    useEffect(() => {
        markNoticesRead();
    }, []);

    const openSession = useCallback((sessionId: string) => {
        onOpenChatSession(sessionId);
    }, [onOpenChatSession]);

    return (
        <PageShell
            title="通知记录"
            onBack={onBack}
            rightAction={
                items.length > 0 ? (
                    <button
                        className="desktoppet-header-btn"
                        type="button"
                        aria-label="清空通知记录"
                        onClick={() => setConfirmClear(true)}
                    >
                        <TrashCanOutlineIcon size={18} />
                    </button>
                ) : <span style={{ width: 40 }} />
            }
        >
            <div className="desktoppet-notices">
                {initialUnread > 0 && (
                    <p className="desktoppet-notices-hint">进入时有 {initialUnread} 条新通知，已全部视为已读</p>
                )}
                {items.length === 0 ? (
                    <EmptyState
                        icon={BellRingOutline}
                        message="还没有通知记录"
                    />
                ) : (
                    <div className="desktoppet-notice-list">
                        {items.map(item => (
                            <button
                                key={item.id}
                                className="desktoppet-notice-item"
                                type="button"
                                onClick={() => openSession(item.sessionId)}
                            >
                                <Avatar src={item.avatar ?? undefined} name={item.senderName} size="md" />
                                <div className="desktoppet-notice-main">
                                    <div className="desktoppet-notice-head">
                                        <span className="desktoppet-notice-name">
                                            {item.senderName}
                                            {item.isGroup ? <em className="desktoppet-notice-group">群</em> : null}
                                        </span>
                                        <span className="desktoppet-notice-time">{formatNoticeTime(item.createdAt)}</span>
                                    </div>
                                    <p className="desktoppet-notice-body">{item.body}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
                {items.length > 0 && (
                    <p className="desktoppet-notices-note">只保留最近 50 条；点击任意一条直达对应会话</p>
                )}
            </div>

            {confirmClear && (
                <ConfirmDialog
                    title="清空通知记录？"
                    message="只清空这里的底账，不影响聊天消息本身。"
                    confirmLabel="清空"
                    variant="danger"
                    onConfirm={() => {
                        clearNoticeHistory();
                        markNoticesRead();
                        setConfirmClear(false);
                        refresh();
                    }}
                    onCancel={() => setConfirmClear(false)}
                />
            )}
        </PageShell>
    );
}
