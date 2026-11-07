"use client";

import type { MusicListeningContext } from "@/lib/music-listening";
import { memo, useState, useEffect, useRef } from "react";
import { ChatMessageList } from "./chat-message-list";
import { ChatContactsList } from "./chat-contacts-list";
import { MomentsFeed } from "./moments-feed";
import { ChatRoom } from "./chat-room";
import { MascotChatRoom } from "./mascot-chat-room";
import { UserProfilePanel } from "./user-profile-panel";
import { MessageCircle, Users, Aperture, UserRound, Plus, Palette, LogOut, X } from "lucide-react";
import { ChatSession, loadChatSessions, pushChatMessage, hydrateChatStorage } from "@/lib/chat-storage";
import { notifyMascotPageContext } from "@/lib/mascot-events";
import { loadChatAppCharacters as loadCharacters } from "@/lib/chat-app-characters";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import { kvGet } from "@/lib/kv-db";
import { formatXiaohongshuShareForPrompt, type ChatSharePayload } from "@/lib/chat-share";
import { CHAT_OPEN_SESSION_EVENT, CHAT_OPEN_ADD_CONTACT_EVENT } from "@/lib/chat-notification-events";
import { CHAT_SESSIONS_MERGED_EVENT, type ChatSessionsMergedDetail } from "@/lib/chat-session-merge";
import { getMascotSettingsSnapshot } from "@/lib/mascot-settings";
import { CHAT_BEAUTY_SCOPES, CHAT_BEAUTY_UPDATED_EVENT, loadChatBeauty, type ChatBeautyScope } from "@/lib/chat-beauty";
import { ChatBeautyDecoration } from "./chat-beauty-decoration";
import { ChatAccountGate } from "./chat-account-gate";
import { getAppVirtualLogin } from "@/lib/virtual-account-service";
import type { VirtualAccount } from "@/lib/social-types";

type TabKey = "messages" | "contacts" | "feeds" | "me";

export type PhoneChatAppProps = {
    onClose: () => void;
    initialSessionId?: string | null;
    feedsRequest?: number;
    sessionRequest?: number;
    onSessionChange?: (session: ChatSession | null) => void;
    sharePayload?: ChatSharePayload | null;
    onShareDone?: () => void;
    /** 剧情内嵌聊天：用户发出消息后的回调 */
    onUserMessageSent?: (message: import("@/lib/chat-storage").ChatMessage, session: import("@/lib/chat-storage").ChatSession) => void;
    /** 剧情内嵌聊天：角色发布动态后的回调 */
    onMomentPublished?: (post: import("@/lib/moments-types").MomentPost) => void;
};

export const PhoneChatApp = memo(function PhoneChatApp({ onClose, initialSessionId, feedsRequest, sessionRequest, onSessionChange, sharePayload, onShareDone }: PhoneChatAppProps) {
    const [activeTab, setActiveTab] = useState<TabKey>("messages");
    const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
    const [activeMascot, setActiveMascot] = useState(false);
    const [lyricQuote, setLyricQuote] = useState<{ sessionId: string; context: MusicListeningContext } | null>(null);
    // Chat app-level custom CSS (affects all chat pages, lower priority than per-session CSS)
    const [chatAppCSS, setChatAppCSS] = useState(() =>
        typeof window !== "undefined" ? kvGet("chat-app-custom-css") || "" : ""
    );
    // Cache all visited sessions so their ChatRoom stays mounted (hidden)
    const [visitedSessions, setVisitedSessions] = useState<Map<string, ChatSession>>(new Map());
    const [dbReady, setDbReady] = useState(false);
    const [accountReady, setAccountReady] = useState(false);
    const [chatAccount, setChatAccount] = useState<VirtualAccount | null>(null);
    const [accountGateOpen, setAccountGateOpen] = useState(false);
    const [hideTabBar, setHideTabBar] = useState(false);
    const [dockOpen, setDockOpen] = useState(false);
    const [beautyOpenRequest, setBeautyOpenRequest] = useState(0);
    const [beauty, setBeauty] = useState<Record<ChatBeautyScope, { css: string; html: string }>>(() =>
        Object.fromEntries(CHAT_BEAUTY_SCOPES.map(item => [item.id, loadChatBeauty(item.id)])) as Record<ChatBeautyScope, { css: string; html: string }>
    );

    useEffect(() => {
        if (!dbReady || !feedsRequest || initialSessionId) return;
        setActiveSession(null);
        setActiveMascot(false);
        setActiveTab("feeds");
    }, [dbReady, feedsRequest, initialSessionId]);

    // Hydrate IndexedDB → in-memory caches on mount
    useEffect(() => {
        hydrateChatStorage().then(() => {
            setDbReady(true);
            // Resolve initial session after hydration
            if (initialSessionId) {
                const s = loadChatSessions().find(s => s.id === initialSessionId);
                if (s) setActiveSession(s);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        void getAppVirtualLogin("chat").then(result => {
            setChatAccount(result?.account ?? null);
            setAccountReady(true);
        });
        const openManager = () => setAccountGateOpen(true);
        window.addEventListener("chat-open-account-gate", openManager);
        return () => window.removeEventListener("chat-open-account-gate", openManager);
    }, []);

    // React to external session navigation (e.g., incoming call acceptance)
    // Only fires when initialSessionId CHANGES after mount (mount case handled by hydration above)
    useEffect(() => {
        if (!dbReady) return;
        if (!initialSessionId) {
            setActiveSession(null);
            return;
        }
        const s = loadChatSessions().find(s => s.id === initialSessionId);
        if (s) setActiveSession(s);
    }, [initialSessionId, dbReady, sessionRequest]);

    // When sharePayload is set, switch to contacts tab (and close any open chat room)
    useEffect(() => {
        if (sharePayload) {
            setActiveSession(null);
            setActiveMascot(false);
            setActiveTab("contacts");
        }
    }, [sharePayload]);

    useEffect(() => {
        const handler = (e: Event) => {
            const sessionId = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
            if (!sessionId) return;
            const session = loadChatSessions().find(s => s.id === sessionId);
            if (!session) return;
            setActiveMascot(false);
            setActiveSession(session);
            setActiveTab("messages");
        };
        window.addEventListener(CHAT_OPEN_SESSION_EVENT, handler);
        return () => window.removeEventListener(CHAT_OPEN_SESSION_EVENT, handler);
    }, []);

    // 重复会话被合并：被删会话的聊天室缓存一并卸载
    useEffect(() => {
        const handler = (e: Event) => {
            const removed = (e as CustomEvent<ChatSessionsMergedDetail>).detail?.removedSessionIds;
            if (!removed?.length) return;
            const removedSet = new Set(removed);
            setVisitedSessions(prev => {
                if (![...prev.keys()].some(id => removedSet.has(id))) return prev;
                const next = new Map(prev);
                removedSet.forEach(id => next.delete(id));
                return next;
            });
            setActiveSession(prev => (prev && removedSet.has(prev.id) ? null : prev));
        };
        window.addEventListener(CHAT_SESSIONS_MERGED_EVENT, handler);
        return () => window.removeEventListener(CHAT_SESSIONS_MERGED_EVENT, handler);
    }, []);

    // 名片点击「加好友」：关会话、切联系人 tab，待添加角色经 prop 交给列表打开添加页
    const [pendingAddContactId, setPendingAddContactId] = useState<string | null>(null);
    // 名片来源的原聊天室：添加页按返回时回到这里
    const addContactReturnSessionRef = useRef<string | null>(null);
    const activeSessionIdRef = useRef<string | null>(null);
    activeSessionIdRef.current = activeSession?.id ?? null;
    useEffect(() => {
        const handler = (e: Event) => {
            const characterId = (e as CustomEvent<{ characterId?: string }>).detail?.characterId;
            if (!characterId) return;
            addContactReturnSessionRef.current = activeSessionIdRef.current;
            setActiveSession(null);
            setActiveMascot(false);
            setActiveTab("contacts");
            setPendingAddContactId(characterId);
        };
        window.addEventListener(CHAT_OPEN_ADD_CONTACT_EVENT, handler);
        return () => window.removeEventListener(CHAT_OPEN_ADD_CONTACT_EVENT, handler);
    }, []);

    // Notify parent of session changes + cache visited session + push mascot context
    useEffect(() => {
        onSessionChange?.(activeSession);
        if (activeSession) {
            setActiveMascot(false);
            setVisitedSessions(prev => {
                if (prev.has(activeSession.id)) return prev;
                const next = new Map(prev);
                next.set(activeSession.id, activeSession);
                return next;
            });
            // Push session info to mascot context so 小卷 can access sessionId
            const chars = loadCharacters();
            const char = chars.find(c => c.id === activeSession.contactId);
            notifyMascotPageContext({
                page: "chat",
                mode: "chatting",
                label: `聊天 · ${(activeSession as Record<string, unknown>).alias as string || char?.name || "对话"}`,
                fields: { sessionId: activeSession.id, contactId: activeSession.contactId },
            });
        }
    }, [activeSession]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!activeMascot) return;
        onSessionChange?.(null);
        notifyMascotPageContext({
            page: "chat",
            mode: "chatting",
            label: `聊天 · ${getMascotSettingsSnapshot().nickname || "AI助手"}`,
            fields: { sessionId: "mascot", contactId: "mascot" },
        });
    }, [activeMascot]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSelectContact = (sess: ChatSession | null) => {
        if (sharePayload && sess) {
            if (sharePayload.type === "music") {
                if (sharePayload.lyricMode === "quote" && sharePayload.listeningContext?.reference) {
                    setLyricQuote({ sessionId: sess.id, context: sharePayload.listeningContext });
                } else {
                    pushChatMessage({
                        sessionId: sess.id,
                        role: "user",
                        content: "",
                        mediaType: "music_share",
                        listeningContext: sharePayload.listeningContext,
                        mediaData: {
                            musicTitle: sharePayload.title,
                            musicArtist: sharePayload.artist,
                            label: `${sharePayload.title} - ${sharePayload.artist}`,
                        },
                    });
                }
            } else if (sharePayload.type === "music_lyric") {
                pushChatMessage({
                    sessionId: sess.id,
                    role: "user",
                    content: "",
                    mediaType: "music_share",
                    mediaData: {
                        musicTitle: sharePayload.title,
                        musicArtist: sharePayload.artist,
                        musicLyric: sharePayload.lyric,
                        label: `${sharePayload.title} - ${sharePayload.artist}`,
                    },
                });
            } else {
                const content = formatXiaohongshuShareForPrompt({
                    author: sharePayload.authorName,
                    title: sharePayload.title,
                    body: sharePayload.body,
                    description: sharePayload.description,
                });
                pushChatMessage({
                    sessionId: sess.id,
                    role: "user",
                    content,
                    mediaType: "xiaohongshu_note_share",
                    mediaData: {
                        xiaohongshuAuthor: sharePayload.authorName,
                        xiaohongshuTitle: sharePayload.title,
                        xiaohongshuBody: sharePayload.body,
                        xiaohongshuDescription: sharePayload.description,
                        xiaohongshuNoteType: sharePayload.noteType,
                        xiaohongshuTags: sharePayload.tags,
                        xiaohongshuImageAssetId: sharePayload.imageAssetId,
                        xiaohongshuCoverIcon: sharePayload.coverIcon,
                        xiaohongshuTone: sharePayload.tone,
                    },
                });
            }
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: sess.id } }));
            onShareDone?.();
        }
        setActiveMascot(false);
        setActiveSession(sess);
        setActiveTab("messages");
    };

    const handleSelectMascot = () => {
        setActiveSession(null);
        setActiveMascot(true);
        setActiveTab("messages");
    };

    // Listen for CSS updates from settings panel
    useEffect(() => {
        const onCSSUpdate = () => setChatAppCSS(kvGet("chat-app-custom-css") || "");
        window.addEventListener("chat-app-css-updated", onCSSUpdate);
        return () => window.removeEventListener("chat-app-css-updated", onCSSUpdate);
    }, []);

    useEffect(() => {
        const update = () => setBeauty(Object.fromEntries(CHAT_BEAUTY_SCOPES.map(item => [item.id, loadChatBeauty(item.id)])) as Record<ChatBeautyScope, { css: string; html: string }>);
        window.addEventListener(CHAT_BEAUTY_UPDATED_EVENT, update);
        return () => window.removeEventListener(CHAT_BEAUTY_UPDATED_EVENT, update);
    }, []);

    // Listen for tab bar hide/show from sub-pages (e.g. CSS editor)
    useEffect(() => {
        const onHide = (e: Event) => setHideTabBar((e as CustomEvent).detail);
        window.addEventListener("chat-hide-tabbar", onHide);
        return () => window.removeEventListener("chat-hide-tabbar", onHide);
    }, []);

    // Wait for IndexedDB hydration before rendering
    if (!dbReady || !accountReady) return null;

    if (!chatAccount || accountGateOpen) {
        return <ChatAccountGate
            manage={Boolean(chatAccount)}
            onClose={chatAccount ? () => setAccountGateOpen(false) : onClose}
            onAuthenticated={account => {
                setChatAccount(account);
                setAccountGateOpen(false);
            }}
        />;
    }

    return (
        <div
            className="chat-app absolute inset-0 flex flex-col overflow-hidden z-10"
            data-active-tab={activeTab}
            {...(activeSession || activeMascot ? { "data-room-active": "" } : {})}
            {...(hideTabBar ? { "data-tabbar-hidden": "" } : {})}
        >
            {/* Chat app-level custom CSS (lower priority than per-session CSS) */}
            {chatAppCSS && <SessionCustomCSS css={chatAppCSS} scope=".chat-app" />}
            {CHAT_BEAUTY_SCOPES.map(item => beauty[item.id].css ? (
                <SessionCustomCSS key={item.id} css={beauty[item.id].css} scope={item.id === "offline" ? ".chat-app[data-room-active] .chat-offline-body" : item.selector} />
            ) : null)}
            <ChatBeautyDecoration slot={activeSession || activeMascot ? "room" : activeTab} html={beauty[activeSession || activeMascot ? "room" : activeTab].html} />
            {/* The Main Content Area */}
            <div className="chat-main-content relative flex-1 flex flex-col overflow-hidden" {...(activeSession || activeMascot ? { "data-covered-by-room": "" } : {})}>
                {activeTab === "messages" && <ChatMessageList onCloseApp={onClose} activeSession={activeSession} onSelectSession={(session) => { setActiveMascot(false); setActiveSession(session); }} onSelectMascot={handleSelectMascot} />}
                {activeTab === "contacts" && (
                    <ChatContactsList
                        onCloseApp={onClose}
                        onSelectSession={handleSelectContact}
                        onSelectMascot={handleSelectMascot}
                        pendingAddContactId={pendingAddContactId}
                        onPendingAddContactConsumed={() => setPendingAddContactId(null)}
                        onPendingAddContactBack={() => {
                            const sessionId = addContactReturnSessionRef.current;
                            addContactReturnSessionRef.current = null;
                            if (!sessionId) return;
                            const session = loadChatSessions().find(s => s.id === sessionId);
                            if (!session) return;
                            setActiveSession(session);
                            setActiveTab("messages");
                        }}
                    />
                )}
                {activeTab === "feeds" && <MomentsFeed onCloseApp={onClose} />}
                {activeTab === "me" && <UserProfilePanel onClose={() => setActiveTab("messages")} openBeautyRequest={beautyOpenRequest} />}
            </div>

            {/* Bottom Navigation Bar — hide when inside a chat room */}
            <div className={`chat-dock-cluster ${dockOpen ? "is-open" : ""}`} style={{ display: activeSession || activeMascot || hideTabBar ? "none" : undefined }}>
            <div className="chat-dock-quick-panel" aria-hidden={!dockOpen}>
                {[
                    { label: "消息", icon: MessageCircle, run: () => setActiveTab("messages") },
                    { label: "联系人", icon: Users, run: () => setActiveTab("contacts") },
                    { label: "动态", icon: Aperture, run: () => setActiveTab("feeds") },
                    { label: "美化", icon: Palette, run: () => { setActiveTab("me"); setBeautyOpenRequest(value => value + 1); } },
                    { label: "我的", icon: UserRound, run: () => setActiveTab("me") },
                    { label: "退出", icon: LogOut, run: onClose },
                ].map(item => <button key={item.label} tabIndex={dockOpen ? 0 : -1} onClick={() => { item.run(); setDockOpen(false); }}><item.icon size={21} /><span>{item.label}</span></button>)}
            </div>
            <nav className="chat-tab-bar chat-bottom-glass-bar" data-ui="nav" data-active-tab={activeTab}>
                <button
                    className={`chat-tab ${activeTab === "messages" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("messages")}
                >
                    <MessageCircleIcon active={activeTab === "messages"} />
                    <span className="chat-tab-label">消息</span>
                </button>
                <button
                    className={`chat-tab ${activeTab === "contacts" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("contacts")}
                >
                    <UsersIcon active={activeTab === "contacts"} />
                    <span className="chat-tab-label">联系人</span>
                </button>
                <button
                    className={`chat-tab ${activeTab === "feeds" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("feeds")}
                >
                    <CompassIcon active={activeTab === "feeds"} />
                    <span className="chat-tab-label">动态</span>
                </button>
                <button
                    className={`chat-tab ${activeTab === "me" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("me")}
                >
                    <MeIcon active={activeTab === "me"} />
                    <span className="chat-tab-label">主页</span>
                </button>
            </nav>
            <button className="chat-dock-plus" aria-label={dockOpen ? "关闭快捷菜单" : "打开快捷菜单"} aria-expanded={dockOpen} onClick={() => setDockOpen(value => !value)}>
                {dockOpen ? <X size={27} /> : <Plus size={28} />}
            </button>
            </div>

            {/* Chat Rooms — all visited sessions stay mounted, only active one is visible */}
            {[...visitedSessions.values()].map(sess => (
                <div key={sess.id} style={{ display: activeSession?.id === sess.id ? undefined : 'none' }} className="chat-room-layer absolute inset-0">
                    <ChatRoom
                        session={sess}
                        lyricQuote={lyricQuote?.sessionId === sess.id ? lyricQuote.context : undefined}
                        onLyricQuoteConsumed={() => setLyricQuote(null)}
                        onBack={() => setActiveSession(null)}
                        onDeleted={() => {
                            // 会话已删除：把缓存的聊天室一并卸载，避免僵尸挂载
                            setVisitedSessions(prev => {
                                const next = new Map(prev);
                                next.delete(sess.id);
                                return next;
                            });
                            setActiveSession(null);
                        }}
                    />
                </div>
            ))}
            {activeMascot && (
                <div className="chat-room-layer absolute inset-0">
                    <MascotChatRoom
                        onBack={() => setActiveMascot(false)}
                        onDeleted={() => setActiveMascot(false)}
                    />
                </div>
            )}
        </div>
    );
});

// Refined Icons
function MessageCircleIcon({ active }: { active: boolean }) {
    return <MessageCircle fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function UsersIcon({ active }: { active: boolean }) {
    return <Users fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function CompassIcon({ active }: { active: boolean }) {
    return <Aperture fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1) rotate(25deg)" : "scale(1) rotate(0deg)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function MeIcon({ active }: { active: boolean }) {
    return <UserRound fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}
