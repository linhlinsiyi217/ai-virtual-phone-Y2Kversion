"use client";

// 系统消息页（G5）：聚合各会话里 role="system" 的真实系统提示——通话记录、
// 红包转账领取、快捷动作回执，以及后台发送的真实失败记录（"后端不可用时
// 不伪造成功"的失败在这里集中可查）。只读聚合，不建第二套消息源。

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/primitives";
import { hydrateChatStorage, loadChatMessages, loadChatSessions, type ChatMessage } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { InformationOutline } from "./pet-icons";

const MAX_SESSIONS_SCAN = 20;
const MAX_PER_SESSION = 15;
const MAX_TOTAL = 100;

type SystemMessageRow = {
    message: ChatMessage;
    sessionId: string;
    sessionName: string;
};

function formatSystemTime(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const now = Date.now();
    const diff = now - t;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    const d = new Date(t);
    if (diff < 86_400_000) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function PetSystemPage({
    onBack,
    onOpenChatSession,
}: {
    onBack: () => void;
    onOpenChatSession: (sessionId: string) => void;
}) {
    const [rows, setRows] = useState<SystemMessageRow[] | null>(null);

    const reload = useCallback(() => {
        void hydrateChatStorage().then(() => {
            const sessions = loadChatSessions()
                .slice()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, MAX_SESSIONS_SCAN);
            const chars = loadCharacters();
            const collected: SystemMessageRow[] = [];
            for (const session of sessions) {
                const name = session.isGroup
                    ? session.groupName?.trim() || "群聊"
                    : session.alias?.trim() || chars.find(c => c.id === session.contactId)?.name?.trim() || "未知会话";
                const systemMsgs = loadChatMessages(session.id)
                    .filter(m => m.role === "system")
                    .slice(-MAX_PER_SESSION);
                for (const message of systemMsgs) {
                    collected.push({ message, sessionId: session.id, sessionName: name });
                }
            }
            collected.sort((a, b) => Date.parse(b.message.createdAt) - Date.parse(a.message.createdAt));
            setRows(collected.slice(0, MAX_TOTAL));
        }).catch(() => setRows([]));
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    const failureRows = useMemo(() => {
        if (!rows) return 0;
        return rows.filter(row => /失败/.test(row.message.content)).length;
    }, [rows]);

    return (
        <PageShell title="系统消息" onBack={onBack}>
            <div className="desktoppet-system">
                {rows === null ? (
                    <div className="desktoppet-loading">
                        <span className="desktoppet-loading-dot" />
                        正在汇总系统提示…
                    </div>
                ) : rows.length === 0 ? (
                    <EmptyState
                        icon={InformationOutline}
                        message="还没有系统消息"
                    />
                ) : (
                    <>
                        {failureRows > 0 && (
                            <p className="desktoppet-system-warn">
                                有 {failureRows} 条后台发送失败的记录：多为 API 或网络不可用，对应会话里可看到原文
                            </p>
                        )}
                        <div className="desktoppet-system-list">
                            {rows.map(row => (
                                <button
                                    key={row.message.id}
                                    className="desktoppet-system-item"
                                    type="button"
                                    data-fail={/失败/.test(row.message.content) || undefined}
                                    onClick={() => onOpenChatSession(row.sessionId)}
                                >
                                    <div className="desktoppet-system-head">
                                        <span className="desktoppet-system-session">{row.sessionName}</span>
                                        <span className="desktoppet-system-time">{formatSystemTime(row.message.createdAt)}</span>
                                    </div>
                                    <p className="desktoppet-system-body">{row.message.content || "（空系统提示）"}</p>
                                </button>
                            ))}
                        </div>
                        <p className="desktoppet-notices-note">只展示最近活跃会话的系统提示，点击直达对应会话</p>
                    </>
                )}
            </div>
        </PageShell>
    );
}
