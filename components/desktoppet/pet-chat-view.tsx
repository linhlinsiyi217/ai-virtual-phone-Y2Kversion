"use client";

// 桌宠聊天页：与浮球面板共用 mascot-chat-store 的同一份会话数据。
// 这里不建新会话库——浮球里聊过的、这里接着聊；这里新开的对话、浮球里也能看到。

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/primitives";
import {
    getMascotChatSnapshot,
    hydrateMascotChat,
    sendMascotMessage,
    stopMascotGeneration,
    subscribeMascotChat,
    resetMascotConversation,
    createMascotSession,
    type MascotChatSnapshot,
} from "@/lib/mascot-chat-store";
import type { MascotMsg } from "@/lib/mascot-engine";
import {
    DEFAULT_MASCOT_AVATAR,
    loadMascotSettings,
    resolveMascotImageRef,
    subscribeMascotSettings,
} from "@/lib/mascot-settings";
import { getMascotContext, setMascotContext } from "@/lib/mascot-context";
import {
    Loader2,
    PawOutline,
    PlusIcon,
    SendOutlineIcon,
    StopCircleOutlineIcon,
    TrashCanOutlineIcon,
} from "./pet-icons";

const HIDDEN_TOOL_PLACEHOLDER_RE = /^（(调用工具中|无内容)/;

function messageText(msg: MascotMsg): string {
    return (msg.displayText || msg.text || "").trim();
}

function isIgnorableMascotMessage(msg: MascotMsg): boolean {
    if (msg.hidden) return true;
    if (msg.role === "mascot" && HIDDEN_TOOL_PLACEHOLDER_RE.test(msg.displayText || "")) return true;
    return false;
}

function ToolChip({ msg }: { msg: MascotMsg }) {
    const name = msg.toolDisplayName || msg.toolName || "工具";
    return (
        <div className="desktoppet-msg-tool" data-ok={msg.toolSuccess !== false}>
            <span className="desktoppet-msg-tool-dot" />
            {msg.toolSuccess === false ? `${name} · 失败` : name}
        </div>
    );
}

function ChatMessageRow({ msg, avatarUrl, nickname }: { msg: MascotMsg; avatarUrl: string; nickname: string }) {
    if (msg.role === "tool") return <ToolChip msg={msg} />;
    const text = messageText(msg);
    if (!text && !(msg.images?.length ?? 0)) return null;

    if (msg.role === "user") {
        return (
            <div className="desktoppet-msg-row" data-side="user">
                <div className="desktoppet-bubble" data-side="user">
                    {!!msg.images?.length && (
                        <div className="desktoppet-msg-images">
                            {msg.images.map((src, idx) => (
                                <img key={idx} src={src} alt="" />
                            ))}
                        </div>
                    )}
                    {text && <p>{text}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="desktoppet-msg-row" data-side="mascot">
            <img className="desktoppet-msg-avatar" src={avatarUrl} alt={nickname} />
            <div className="desktoppet-bubble" data-side="mascot">
                {!!msg.images?.length && (
                    <div className="desktoppet-msg-images">
                        {msg.images.map((src, idx) => (
                            <img key={idx} src={src} alt="" />
                        ))}
                    </div>
                )}
                {text && <p>{text}</p>}
            </div>
        </div>
    );
}

export function PetChatView({ onBack }: { onBack: () => void }) {
    const snapshot = useSyncExternalStore(subscribeMascotChat, getMascotChatSnapshot, getMascotChatSnapshot);
    const settings = useSyncExternalStore(
        subscribeMascotSettings,
        () => loadMascotSettings(),
        () => loadMascotSettings(),
    );
    const [avatarUrl, setAvatarUrl] = useState(DEFAULT_MASCOT_AVATAR);
    const [draft, setDraft] = useState("");
    const [confirmReset, setConfirmReset] = useState(false);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const lastCountRef = useRef(-1);

    // 首挂载水合；并告知桌宠引擎当前上下文（与浮球一致的模式）
    useEffect(() => {
        setMascotContext({ ...getMascotContext(), page: "desktop", mode: "chatting", label: "桌宠聊天" });
        void hydrateMascotChat();
    }, []);

    useEffect(() => {
        let alive = true;
        void resolveMascotImageRef(settings.avatarImage)
            .then(url => { if (alive) setAvatarUrl(url || DEFAULT_MASCOT_AVATAR); })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [settings.avatarImage]);

    // 新消息时滚到底部（首挂载也滚一次，从历史接着聊）
    useEffect(() => {
        const count = snapshot.messages.length;
        if (count !== lastCountRef.current) {
            lastCountRef.current = count;
            bottomRef.current?.scrollIntoView({ behavior: count > 0 && lastCountRef.current >= 0 ? "smooth" : "auto", block: "end" });
        }
    }, [snapshot.messages.length]);

    const handleSend = useCallback(async () => {
        const text = draft.trim();
        if (!text || snapshot.isThinking || !settings.chatEnabled) return;
        setDraft("");
        await sendMascotMessage({
            text,
            context: { page: "desktop", mode: "chatting", label: "桌宠聊天", fields: {} },
        });
    }, [draft, snapshot.isThinking, settings.chatEnabled]);

    const handleNewSession = useCallback(() => {
        if (snapshot.isThinking) return;
        if (!createMascotSession()) {
            // 水合未完成等场景：静默失败比伪造成功好，直接不动
        }
    }, [snapshot.isThinking]);

    const visibleMessages = snapshot.messages.filter(msg => !isIgnorableMascotMessage(msg));
    const chatEnabled = settings.chatEnabled;

    return (
        <PageShell
            title="桌宠聊天"
            onBack={onBack}
            rightAction={
                <span className="desktoppet-header-actions">
                    <button
                        className="desktoppet-header-btn"
                        type="button"
                        onClick={handleNewSession}
                        disabled={snapshot.isThinking}
                        aria-label="新对话"
                    >
                        <PlusIcon size={18} />
                    </button>
                    <button
                        className="desktoppet-header-btn"
                        type="button"
                        onClick={() => setConfirmReset(true)}
                        disabled={snapshot.isThinking || visibleMessages.length === 0}
                        aria-label="清空对话"
                    >
                        <TrashCanOutlineIcon size={18} />
                    </button>
                </span>
            }
            bodyRef={bodyRef}
        >
            <div className="desktoppet-chat">
                {!snapshot.hydrated ? (
                    <div className="desktoppet-loading">
                        <Loader2 className="desktoppet-spin" size={22} />
                        <span>正在载入桌宠记忆…</span>
                    </div>
                ) : !chatEnabled ? (
                    <div className="desktoppet-chat-disabled">
                        <PawOutline size={36} />
                        <p>桌宠聊天已关闭</p>
                        <p className="desktoppet-chat-disabled-hint">回到桌宠主页，在「桌宠设置」里打开桌宠聊天后即可继续</p>
                        <button className="desktoppet-chip-btn" type="button" onClick={onBack}>去开启</button>
                    </div>
                ) : visibleMessages.length === 0 ? (
                    <EmptyState
                        icon={PawOutline}
                        message="还没有和桌宠说过话，先打个招呼吧"
                    />
                ) : (
                    <div className="desktoppet-msg-list">
                        {visibleMessages.map((msg, idx) => (
                            <ChatMessageRow
                                key={msg.createdAt ?? `msg_${idx}`}
                                msg={msg}
                                avatarUrl={avatarUrl}
                                nickname={settings.nickname}
                            />
                        ))}
                        {snapshot.isThinking && (
                            <div className="desktoppet-msg-row" data-side="mascot">
                                <img className="desktoppet-msg-avatar" src={avatarUrl} alt={settings.nickname} />
                                <div className="desktoppet-bubble desktoppet-typing" data-side="mascot">
                                    <span /><span /><span />
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            <footer className="desktoppet-chat-footer">
                {snapshot.isThinking ? (
                    <button
                        className="desktoppet-chat-stop"
                        type="button"
                        onClick={() => stopMascotGeneration()}
                    >
                        <StopCircleOutlineIcon size={16} />
                        停止生成
                    </button>
                ) : chatEnabled ? (
                    <>
                        <input
                            className="desktoppet-chat-input"
                            type="text"
                            value={draft}
                            placeholder={`和${settings.nickname || "桌宠"}说点什么…`}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                        />
                        <button
                            className="desktoppet-chat-send"
                            type="button"
                            disabled={!draft.trim()}
                            onClick={() => void handleSend()}
                            aria-label="发送"
                        >
                            <SendOutlineIcon size={18} />
                        </button>
                    </>
                ) : null}
            </footer>

            {confirmReset && (
                <ConfirmDialog
                    title="清空当前对话？"
                    message="只清空当前这轮对话的内容，桌宠的其他会话不受影响。"
                    confirmLabel="清空"
                    variant="danger"
                    onConfirm={() => {
                        resetMascotConversation({ withGreeting: true });
                        setConfirmReset(false);
                    }}
                    onCancel={() => setConfirmReset(false)}
                />
            )}
        </PageShell>
    );
}
