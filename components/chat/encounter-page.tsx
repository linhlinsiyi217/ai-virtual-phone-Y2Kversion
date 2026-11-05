"use client";

// 邂逅页（G6）：从角色库里随机遇见一位"还没有会话"的新朋友。
// 候选口径与联系人列表完全一致（loadChatContacts + 当前聊天 scope），
// 打招呼走的也是现有"添加朋友"的同一条真实调用链：加联系人 → 建会话 →
// 落系统消息 + 可编辑的招呼语 → 跳进聊天室。不建任何第二数据源。

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import {
    createOrGetSession,
    addChatContact,
    loadChatContacts,
    pushChatMessage,
    type ChatSession,
} from "@/lib/chat-storage";
import { addChatAltAccountFriend } from "@/lib/chat-alt-account-storage";
import {
    characterMatchesChatScope,
    loadChatScope,
    resolveChatScopeUserIdentity,
} from "@/lib/chat-scope-storage";
import { loadCharacters } from "@/lib/character-storage";
import {
    clearRequestsForCharacter,
    dispatchFriendRequestUpdated,
} from "@/lib/friend-request-storage";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";

const PERSONA_PREVIEW_LIMIT = 120;
const characterAvatar = (character: { avatar?: string | null } | null | undefined) => character?.avatar || "";

export function EncounterPage({
    onBack,
    onSelectSession,
}: {
    onBack: () => void;
    onSelectSession: (session: ChatSession) => void;
}) {
    // 候选池：当前 scope 内、还没有任何会话的角色（与通讯录同口径）
    const candidates = useMemo(() => {
        try {
            const chatScope = loadChatScope();
            const knownIds = new Set(loadChatContacts().map(c => c.characterId));
            return loadCharacters()
                .filter(c => !knownIds.has(c.id))
                .filter(c => characterMatchesChatScope(c.id, chatScope));
        } catch {
            return [];
        }
    }, []);

    const [currentId, setCurrentId] = useState<string | null>(null);
    const [greeting, setGreeting] = useState("你好，很高兴遇见你");
    const [adding, setAdding] = useState(false);

    const pickNext = useCallback((excludeId: string | null) => {
        const pool = excludeId ? candidates.filter(c => c.id !== excludeId) : candidates;
        if (pool.length === 0) return excludeId; // 只剩同一个人，维持不变
        const next = pool[Math.floor(Math.random() * pool.length)];
        return next.id;
    }, [candidates]);

    // 首次进入抽一位；候选为空时保持 null（展示空态）
    useEffect(() => {
        setCurrentId(prev => prev ?? (candidates.length > 0 ? pickNext(null) : null));
    }, [candidates, pickNext]);

    const current = useMemo(
        () => candidates.find(c => c.id === currentId) ?? null,
        [candidates, currentId],
    );

    const handleGreet = useCallback(() => {
        if (!current || adding) return;
        setAdding(true);
        try {
            // 与「添加朋友」发送完全同构的真实调用链（含小号 scope 分支）
            const chatScope = loadChatScope();
            if (chatScope.chatAccountId) addChatAltAccountFriend(chatScope.chatAccountId, current.id);
            else addChatContact(current.id);
            clearRequestsForCharacter(current.id);
            dispatchFriendRequestUpdated();
            const session = createOrGetSession(current.id);
            const charIdentity = resolveChatScopeUserIdentity(current.id, "chat");
            const userName = charIdentity?.name || "我";
            pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `${userName}在「邂逅」里遇见了${current.name || "新朋友"}，你们成为了好友，现在可以开始聊天了。`,
                status: "sent",
            });
            const text = greeting.trim();
            if (text) {
                pushChatMessage({ sessionId: session.id, role: "user", content: text, status: "sent" });
            }
            onSelectSession(session);
        } finally {
            setAdding(false);
        }
    }, [current, adding, greeting, onSelectSession]);

    const personaPreview = current?.persona
        ? current.persona.slice(0, PERSONA_PREVIEW_LIMIT) + (current.persona.length > PERSONA_PREVIEW_LIMIT ? "…" : "")
        : "";

    return (
        <PageShell title="邂逅" onBack={onBack}>
            <div className="page-menu">
                {candidates.length === 0 || !current ? (
                    <div className="ui-empty">
                        <span className="menu-desc">
                            通讯录里的每一位你都遇见过了。<br />
                            去角色页新建角色，或去「添加朋友」找老朋友叙旧吧。
                        </span>
                    </div>
                ) : (
                    <>
                        {/* 资料卡 */}
                        <div className="menu-group">
                            <div className="flex items-center gap-3">
                                <div className="w-[64px] h-[64px] rounded-full overflow-hidden shrink-0 bg-[var(--c-card,#eee)]">
                                    {characterAvatar(current) ? (
                                        <img
                                            src={characterAvatar(current) || undefined}
                                            className="w-full h-full object-cover"
                                            alt={current.name || ""}
                                        />
                                    ) : (
                                        <ChatFallbackAvatar className="w-full h-full" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="ts-17 font-semibold text-[var(--c-text-title)] truncate">
                                        {current.name || "神秘的人"}
                                    </div>
                                    {current.tags && current.tags.length > 0 && (
                                        <div className="ts-12 text-[var(--c-icon)] mt-1 truncate">
                                            {current.tags.slice(0, 4).join(" · ")}
                                        </div>
                                    )}
                                    <div className="ts-12 text-[var(--c-text)] opacity-70 mt-1">
                                        第 {candidates.length} 位有缘人待你认识
                                    </div>
                                </div>
                            </div>
                            {personaPreview && (
                                <p className="ts-13 text-[var(--c-text)] leading-relaxed mt-3 whitespace-pre-wrap">
                                    {personaPreview}
                                </p>
                            )}
                        </div>

                        {/* 换一个 */}
                        <div className="mt-3">
                            <button
                                type="button"
                                className="ui-btn ui-btn-ghost w-full"
                                onClick={() => setCurrentId(prev => pickNext(prev))}
                                disabled={candidates.length <= 1}
                            >
                                {candidates.length <= 1 ? "缘分只有这一位" : "换个缘分"}
                            </button>
                        </div>

                        {/* 招呼语 + 打招呼 */}
                        <div className="mt-3">
                            <div className="menu-group">
                                <div className="menu-item !items-start">
                                    <textarea
                                        className="ui-textarea ui-input-inline min-h-[60px]"
                                        value={greeting}
                                        maxLength={100}
                                        onChange={e => setGreeting(e.target.value)}
                                        placeholder="写一句想对TA说的话…"
                                    />
                                </div>
                            </div>
                            <button
                                type="button"
                                className="ui-btn ui-btn-success w-full mt-3"
                                onClick={handleGreet}
                                disabled={adding}
                            >
                                {adding ? "正在相遇…" : "打个招呼"}
                            </button>
                            <p className="menu-group-desc mx-0 mt-2">
                                打招呼会真实把TA加进通讯录、建立会话并送出这句话，随后直接跳进你们的聊天。
                            </p>
                        </div>
                    </>
                )}
            </div>
        </PageShell>
    );
}
