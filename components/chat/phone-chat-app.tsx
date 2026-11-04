"use client";

import type { MusicListeningContext } from "@/lib/music-listening";
import { memo, useState, useEffect, useRef } from "react";
import { ChatMessageList } from "./chat-message-list";
import { ChatContactsList } from "./chat-contacts-list";
import { MomentsFeed } from "./moments-feed";
import { ChatRoom } from "./chat-room";
import { MascotChatRoom } from "./mascot-chat-room";
import { UserProfilePanel } from "./user-profile-panel";
import { MessageCircle, Users, Aperture } from "lucide-react";
import { ChatSession, loadChatSessions, pushChatMessage, hydrateChatStorage } from "@/lib/chat-storage";
import { notifyMascotPageContext } from "@/lib/mascot-events";
import { loadChatAppCharacters as loadCharacters } from "@/lib/chat-app-characters";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import { kvGet } from "@/lib/kv-db";
import { formatXiaohongshuShareForPrompt, type ChatSharePayload } from "@/lib/chat-share";
import { CHAT_OPEN_SESSION_EVENT, CHAT_OPEN_ADD_CONTACT_EVENT } from "@/lib/chat-notification-events";
import { CHAT_SESSIONS_MERGED_EVENT, type ChatSessionsMergedDetail } from "@/lib/chat-session-merge";
import { getMascotSettingsSnapshot } from "@/lib/mascot-settings";
import { CHAT_UI_MODE_EVENT, loadChatUiMode, type ChatUiMode } from "@/lib/chat-ui-mode";

type TabKey = "messages" | "contacts" | "feeds" | "me";

export type PhoneChatAppProps = {
    onClose: () => void;
    initialSessionId?: string | null;
    feedsRequest?: number;
    sessionRequest?: number;
    onSessionChange?: (session: ChatSession | null) => void;
    sharePayload?: ChatSharePayload | null;
    onShareDone?: () => void;
};

export const PhoneChatApp = memo(function PhoneChatApp({ onClose, initialSessionId, feedsRequest, sessionRequest, onSessionChange, sharePayload, onShareDone }: PhoneChatAppProps) {
    const sharePayloadRef = useRef(sharePayload);
    sharePayloadRef.current = sharePayload;
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
    const [hideTabBar, setHideTabBar] = useState(false);
    const [chatUiMode, setChatUiMode] = useState<ChatUiMode>(() => loadChatUiMode());
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
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply the latest destination after hydration, including repeat requests.
    useEffect(() => {
        if (!dbReady || sharePayloadRef.current) return;
        if (!initialSessionId) {
            setActiveSession(null);
            return;
        }
        const s = loadChatSessions().find(s => s.id === initialSessionId);
        if (s) { setActiveMascot(false); setActiveSession(s); setActiveTab("messages"); }
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
                } else pushChatMessage({
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
        const onMode = (event: Event) => {
            const mode = (event as CustomEvent<ChatUiMode>).detail;
            setChatUiMode(mode === "original" ? "original" : "y2k");
        };
        window.addEventListener(CHAT_UI_MODE_EVENT, onMode);
        return () => window.removeEventListener(CHAT_UI_MODE_EVENT, onMode);
    }, []);

    // Listen for tab bar hide/show from sub-pages (e.g. CSS editor)
    useEffect(() => {
        const onHide = (e: Event) => setHideTabBar((e as CustomEvent).detail);
        window.addEventListener("chat-hide-tabbar", onHide);
        return () => window.removeEventListener("chat-hide-tabbar", onHide);
    }, []);

    // Wait for IndexedDB hydration before rendering
    if (!dbReady) return null;

    return (
        <div
            className="chat-app absolute inset-0 flex flex-col overflow-hidden z-10"
            {...(activeSession || activeMascot ? { "data-room-active": "" } : {})}
            {...(hideTabBar ? { "data-tabbar-hidden": "" } : {})}
            data-chat-ui-mode={chatUiMode}
        >
            {/* Chat app-level custom CSS (lower priority than per-session CSS) */}
            {chatAppCSS && <SessionCustomCSS css={chatAppCSS} scope=".chat-app" />}
            {/* The Main Content Area */}
            <div className="chat-main-content relative flex-1 flex flex-col overflow-hidden" data-social-pages={activeTab === "feeds" || activeTab === "me" ? "" : undefined} {...(activeSession || activeMascot ? { "data-covered-by-room": "" } : {})}>
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
                {activeTab === "me" && <UserProfilePanel onClose={() => setActiveTab("messages")} />}
            </div>

            {/* Bottom Navigation Bar — hide when inside a chat room */}
            <nav
                className="chat-tab-bar chat-bottom-glass-bar"
                data-ui="nav"
                data-active-tab={activeTab}
                style={{ display: activeSession || activeMascot || hideTabBar ? "none" : undefined }}
            >
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

// Shared line icons keep the four slots visually consistent at small sizes.
function MessageCircleIcon({ active }: { active: boolean }) {
    return <MessageCircle fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} />;
}

function UsersIcon({ active }: { active: boolean }) {
    return <Users fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} />;
}

function CompassIcon({ active }: { active: boolean }) {
    return <Aperture fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} />;
}

function MeIcon({ active }: { active: boolean }) {
    return <svg className="chat-tab-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10s10-4.477 10-10S17.523 2 12 2" /><path d="M4.271 18.346S6.5 15.5 12 15.5s7.73 2.846 7.73 2.846M12 12a3 3 0 1 0 0-6a3 3 0 0 0 0 6" /></svg>;
}
