"use client";

// 情侣页（G6）：把一个已有会话的角色绑定为「恋人」。
// 绑定信息只存一条关系元数据（lib/couple-storage kv），所有互动——
// 确定关系、早安晚安、说句想你、和平分手——都真实落进现有聊天会话，
// 聊天记录里能看到、AI 也能读到上下文。不建第二套聊天数据。

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog } from "@/components/ui/modal";
import {
    createOrGetSession,
    loadChatContacts,
    pushChatMessage,
    type ChatSession,
} from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import {
    COUPLE_BINDING_UPDATED_EVENT,
    clearCoupleBinding,
    coupleDaysSince,
    loadCoupleBinding,
    saveCoupleBinding,
    type CoupleBinding,
} from "@/lib/couple-storage";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";

const QUICK_ACTIONS = [
    { key: "morning", label: "早安问候", text: "早安，新的一天也要开心呀。" },
    { key: "night", label: "晚安好梦", text: "晚安，做个好梦。" },
    { key: "miss", label: "说句想你", text: "突然有点想你了。" },
] as const;

const characterAvatar = (character: { avatar?: string | null } | null | undefined) => character?.avatar || "";

export function CouplePage({
    onBack,
    onSelectSession,
}: {
    onBack: () => void;
    onSelectSession: (session: ChatSession) => void;
}) {
    const [binding, setBinding] = useState<CoupleBinding | null>(() => loadCoupleBinding());
    const [confirmBindId, setConfirmBindId] = useState<string | null>(null);
    const [confirmUnbind, setConfirmUnbind] = useState(false);
    const [noteDraft, setNoteDraft] = useState<string | null>(null);

    // 绑定变化（本页/其他入口解绑）时刷新
    useEffect(() => {
        const onUpdate = () => setBinding(loadCoupleBinding());
        window.addEventListener(COUPLE_BINDING_UPDATED_EVENT, onUpdate);
        return () => window.removeEventListener(COUPLE_BINDING_UPDATED_EVENT, onUpdate);
    }, []);

    // 绑定的角色与候选列表（与通讯录同口径：已加为联系人且在当前 scope 内）
    const chars = useMemo(() => loadCharacters(), []);
    const loverChar = useMemo(
        () => (binding ? chars.find(c => c.id === binding.characterId) ?? null : null),
        [binding, chars],
    );
    const candidates = useMemo(() => {
        try {
            const knownIds = new Set(loadChatContacts().map(c => c.characterId));
            return chars.filter(c => knownIds.has(c.id));
        } catch {
            return [];
        }
    }, [chars]);

    const candidateName = (id: string) => chars.find(c => c.id === id)?.name || "TA";

    // 绑定：写关系元数据 + 在会话里落一条真实的系统消息
    const handleBind = useCallback(() => {
        const charId = confirmBindId;
        setConfirmBindId(null);
        if (!charId) return;
        const session = createOrGetSession(charId);
        saveCoupleBinding({ characterId: charId, since: Date.now() });
        pushChatMessage({
            sessionId: session.id,
            role: "system",
            content: `你和${candidateName(charId)}确定了恋爱关系，今天是你们在一起的第一天。`,
            status: "sent",
        });
    }, [confirmBindId, chars]);

    // 解绑：先在会话里落一条真实的系统消息，再清掉关系元数据
    const handleUnbind = useCallback(() => {
        setConfirmUnbind(false);
        if (!binding) return;
        try {
            const session = createOrGetSession(binding.characterId);
            pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `你和${candidateName(binding.characterId)}和平地结束了这段恋爱关系。`,
                status: "sent",
            });
        } catch {
            // 会话已不存在：只清绑定，不留孤儿消息
        }
        clearCoupleBinding();
        setNoteDraft(null);
    }, [binding, chars]);

    // 快捷互动：一句真实消息送进会话，然后跳进聊天室
    const handleQuickAction = useCallback((text: string) => {
        if (!binding) return;
        const session = createOrGetSession(binding.characterId);
        pushChatMessage({ sessionId: session.id, role: "user", content: text, status: "sent" });
        onSelectSession(session);
    }, [binding, onSelectSession]);

    const handleSaveNote = useCallback(() => {
        if (!binding || noteDraft === null) return;
        const trimmed = noteDraft.trim();
        saveCoupleBinding(trimmed ? { ...binding, note: trimmed } : { ...binding, note: undefined });
        setNoteDraft(null);
    }, [binding, noteDraft]);

    const days = binding ? coupleDaysSince(binding.since) : 0;
    const noteValue = noteDraft ?? binding?.note ?? "";

    return (
        <PageShell title="情侣空间" onBack={onBack}>
            <div className="page-menu">
                {binding && loverChar ? (
                    <>
                        {/* 恋人卡 */}
                        <div className="menu-group">
                            <div className="flex items-center gap-3">
                                <div className="w-[64px] h-[64px] rounded-full overflow-hidden shrink-0 bg-[var(--c-card,#eee)]">
                                    {characterAvatar(loverChar) ? (
                                        <img
                                            src={characterAvatar(loverChar) || undefined}
                                            className="w-full h-full object-cover"
                                            alt={loverChar.name || ""}
                                        />
                                    ) : (
                                        <ChatFallbackAvatar className="w-full h-full" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="ts-17 font-semibold text-[var(--c-text-title)] truncate">
                                        {loverChar.name || "恋人"}
                                    </div>
                                    <div className="ts-13 text-[var(--c-icon)] mt-1">
                                        在一起第 {days} 天
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 纪念日备注 */}
                        <div className="menu-group mt-3">
                            <div className="menu-item !items-start">
                                <textarea
                                    className="ui-textarea ui-input-inline min-h-[52px]"
                                    value={noteValue}
                                    maxLength={80}
                                    placeholder="写一句属于你们的纪念日备注，如：在一起的第一天"
                                    onChange={e => setNoteDraft(e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                className="ui-btn ui-btn-ghost w-full mt-2"
                                onClick={handleSaveNote}
                                disabled={noteDraft === null || noteDraft === binding?.note}
                            >
                                保存备注
                            </button>
                        </div>

                        {/* 快捷互动 */}
                        <div className="menu-group mt-3">
                            <div className="menu-label">想对TA说</div>
                            <div className="flex flex-col gap-2 mt-2">
                                {QUICK_ACTIONS.map(action => (
                                    <button
                                        key={action.key}
                                        type="button"
                                        className="ui-btn ui-btn-ghost w-full"
                                        onClick={() => handleQuickAction(action.text)}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                            <p className="menu-group-desc mx-0 mt-2">
                                每句都会真实送进你们的聊天并直接跳到会话里。
                            </p>
                        </div>

                        {/* 解绑 */}
                        <div className="mt-4">
                            <button
                                type="button"
                                className="ui-btn w-full"
                                style={{ color: "var(--c-danger,#e5484d)" }}
                                onClick={() => setConfirmUnbind(true)}
                            >
                                结束这段关系
                            </button>
                        </div>
                    </>
                ) : binding && !loverChar ? (
                    <>
                        {/* 绑定的角色已不在通讯录（被删除） */}
                        <div className="ui-empty">
                            <span className="menu-desc">绑定的角色已经不在通讯录里了。</span>
                        </div>
                        <div className="mt-3">
                            <button
                                type="button"
                                className="ui-btn ui-btn-ghost w-full"
                                onClick={handleUnbind}
                            >
                                清除这段绑定
                            </button>
                        </div>
                    </>
                ) : candidates.length === 0 ? (
                    <div className="ui-empty">
                        <span className="menu-desc">
                            通讯录里还没有联系人。先去「添加朋友」或「邂逅」认识一位，再回来开始这段关系吧。
                        </span>
                    </div>
                ) : (
                    <>
                        <p className="menu-group-desc mx-0">
                            从通讯录里选一位，确定恋爱关系后这里会变成你们的情侣空间。
                            确定关系时会在你们的聊天里真实落一条系统消息。
                        </p>
                        <div className="menu-group mt-3">
                            {candidates.map(c => (
                                <div
                                    key={c.id}
                                    className="menu-item"
                                    onClick={() => setConfirmBindId(c.id)}
                                >
                                    <div className="w-[40px] h-[40px] rounded-full overflow-hidden shrink-0 bg-[var(--c-card,#eee)]">
                                        {characterAvatar(c) ? (
                                            <img
                                                src={characterAvatar(c) || undefined}
                                                className="w-full h-full object-cover"
                                                alt={c.name || ""}
                                            />
                                        ) : (
                                            <ChatFallbackAvatar className="w-full h-full" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="ts-15 font-medium text-[var(--c-text-title)] truncate">
                                            {c.name || "UNNAMED"}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {confirmBindId && (
                <ConfirmDialog
                    title="确定恋爱关系？"
                    message={`确定和${candidateName(confirmBindId)}开始这段恋爱关系？确定后会在你们的聊天里落一条系统消息，并在这里记录你们的纪念日。`}
                    confirmLabel="确定"
                    variant="action"
                    onConfirm={handleBind}
                    onCancel={() => setConfirmBindId(null)}
                />
            )}
            {confirmUnbind && (
                <ConfirmDialog
                    title="结束这段关系？"
                    message={`会和${binding ? candidateName(binding.characterId) : "TA"}和平地分手：聊天里会落一条系统消息，纪念日记录也会清除。`}
                    confirmLabel="分手"
                    variant="danger"
                    onConfirm={handleUnbind}
                    onCancel={() => setConfirmUnbind(false)}
                />
            )}
        </PageShell>
    );
}
