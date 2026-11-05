"use client";

// components/chat/chat-memory-panel.tsx
// 回忆面板（G10 聊天增强）：相册 / 时间线 / 打卡 三个页签。
// - 相册、时间线完全派生自现有聊天消息与记忆库，不新增独立数据源；
// - 打卡记录存 kv（按会话一份），首次打卡会写一条系统消息让角色知晓，
//   与现有聊天的上下文自然衔接。
import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Camera, Clock, Heart, ImageOff, Milestone, Sparkles, X } from "lucide-react";
import { loadChatMessages, type ChatMessage, type ChatSession } from "@/lib/chat-storage";
import { loadMemoryEntries } from "@/lib/memory-storage";
import type { MemoryEntry } from "@/lib/memory-types";
import { kvGet, kvSet } from "@/lib/kv-db";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";

type CheckinRecord = { mood?: string; note?: string };
type CheckinMap = Record<string, CheckinRecord>; // key: YYYY-MM-DD（本地时区）

type MemoryPanelTab = "album" | "timeline" | "checkin";

export type ChatMemoryPanelProps = {
    session: ChatSession;
    characterName: string;
    onClose: () => void;
    /** 打卡成功后往会话里写一条系统消息（由 chat-room 提供落库与刷新） */
    onCheckInMessage: (content: string) => void;
};

function checkinKey(sessionId: string): string {
    return `chat.checkin.v1.${sessionId}`;
}

function localDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function loadCheckinMap(sessionId: string): CheckinMap {
    try {
        const raw = JSON.parse(kvGet(checkinKey(sessionId)) || "{}");
        return raw && typeof raw === "object" ? (raw as CheckinMap) : {};
    } catch {
        return {};
    }
}

function saveCheckinMap(sessionId: string, map: CheckinMap): void {
    kvSet(checkinKey(sessionId), JSON.stringify(map));
}

/** 连续打卡天数：从今天（或昨天，给深夜过 12 点留余地）往前数 */
function calcStreak(map: CheckinMap): number {
    const today = new Date();
    let streak = 0;
    const cursor = new Date(today);
    if (!map[localDateKey(cursor)]) {
        cursor.setDate(cursor.getDate() - 1);
        if (!map[localDateKey(cursor)]) return 0;
    }
    while (map[localDateKey(cursor)]) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

function formatDateLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDaysBetween(fromIso: string): number {
    const from = new Date(fromIso).getTime();
    if (Number.isNaN(from)) return 0;
    return Math.max(0, Math.floor((Date.now() - from) / 86400000));
}

// ── 单张照片格子：media-store:// 引用需要异步解析成 object URL ──
function AlbumPhotoTile({ msg, onOpen }: { msg: ChatMessage; onOpen: (url: string, msg: ChatMessage) => void }) {
    const rawUrl = msg.mediaUrl || "";
    const [url, setUrl] = useState<string>(() => (isMediaStoreRef(rawUrl) ? "" : rawUrl));
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!isMediaStoreRef(rawUrl)) {
            setUrl(rawUrl);
            return;
        }
        let revokeUrl = "";
        let alive = true;
        loadMediaObjectUrl(rawUrl).then(objUrl => {
            if (!alive) return;
            if (objUrl) {
                setUrl(objUrl);
                revokeUrl = objUrl;
            } else {
                setFailed(true);
            }
        });
        return () => {
            alive = false;
            if (revokeUrl) URL.revokeObjectURL(revokeUrl);
        };
    }, [rawUrl]);

    return (
        <button
            type="button"
            className="chat-memory-photo-tile"
            onClick={() => url && onOpen(url, msg)}
            aria-label={msg.mediaData?.label || "查看照片"}
            title={msg.mediaData?.label || undefined}
        >
            {failed || !url ? (
                <span className="chat-memory-photo-empty"><ImageOff size={18} strokeWidth={1.6} /></span>
            ) : (
                <img src={url} alt={msg.mediaData?.label || "聊天照片"} loading="lazy" draggable={false} />
            )}
        </button>
    );
}

export function ChatMemoryPanel({ session, characterName, onClose, onCheckInMessage }: ChatMemoryPanelProps) {
    const [tab, setTab] = useState<MemoryPanelTab>("album");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [memories, setMemories] = useState<MemoryEntry[]>([]);
    const [checkinMap, setCheckinMap] = useState<CheckinMap>(() => loadCheckinMap(session.id));
    const [noteDraft, setNoteDraft] = useState("");
    const [preview, setPreview] = useState<{ url: string; label?: string } | null>(null);

    useEffect(() => {
        // 相册/时间线从当前会话消息派生；记忆来自长期记忆库
        setMessages(loadChatMessages(session.id));
        loadMemoryEntries(session.contactId).then(entries => {
            setMemories(entries.slice(-30).reverse());
        }).catch(() => setMemories([]));
    }, [session.id, session.contactId]);

    const photos = useMemo(
        () => messages.filter(m => m.mediaType === "image" && m.mediaUrl && !m.isRetracted).reverse(),
        [messages],
    );

    const firstMessage = messages.length > 0 ? messages[0] : null;
    const knownDays = firstMessage ? formatDaysBetween(firstMessage.createdAt) : 0;
    const firstPhoto = photos.length > 0 ? photos[photos.length - 1] : null;
    const streak = calcStreak(checkinMap);
    const todayKey = localDateKey(new Date());
    const checkedToday = Boolean(checkinMap[todayKey]);
    const totalCheckins = Object.keys(checkinMap).length;

    const handleCheckIn = () => {
        if (checkedToday) return;
        const note = noteDraft.trim();
        const next = { ...checkinMap, [todayKey]: note ? { note } : {} };
        setCheckinMap(next);
        saveCheckinMap(session.id, next);
        setNoteDraft("");
        const nextStreak = calcStreak(next);
        // 写一条系统消息进会话：角色在后续上下文里能感知到打卡这件事
        onCheckInMessage(
            `【打卡】用户刚刚完成了今日打卡（连续 ${nextStreak} 天，累计 ${Object.keys(next).length} 天）${note ? `，附言：「${note}」` : ""}。${characterName} 可以自然地回应这份心意，不必逐字复述本条。`,
        );
    };

    const timelineItems = useMemo(() => {
        const items: Array<{ icon: "heart" | "camera" | "sparkles" | "check"; date: string; text: string }> = [];
        if (firstMessage) {
            items.push({
                icon: "heart",
                date: firstMessage.createdAt,
                text: `与${characterName}的第一条消息，距今 ${knownDays} 天`,
            });
        }
        if (firstPhoto) {
            items.push({ icon: "camera", date: firstPhoto.createdAt, text: "第一张照片" });
        }
        if (memories.length > 0) {
            items.push({ icon: "sparkles", date: memories[0].createdAt, text: `已沉淀 ${memories.length} 条长期记忆` });
        }
        if (totalCheckins > 0) {
            items.push({ icon: "check", date: todayKey, text: `累计打卡 ${totalCheckins} 天，当前连续 ${streak} 天` });
        }
        if (firstMessage) {
            items.push({ icon: "heart", date: new Date().toISOString(), text: `一共聊了 ${messages.length} 条消息` });
        }
        return items;
    }, [characterName, firstMessage, firstPhoto, memories, messages.length, streak, todayKey, totalCheckins, knownDays]);

    const tabBtn = (id: MemoryPanelTab, label: string) => (
        <button
            type="button"
            className="chat-memory-tab-btn"
            {...(tab === id ? { "data-active": "" } : {})}
            onClick={() => setTab(id)}
        >{label}</button>
    );

    return (
        <div className="chat-memory-overlay" role="dialog" aria-modal="true" aria-label="回忆面板" onClick={onClose}>
            <section className="chat-memory-panel" onClick={e => e.stopPropagation()}>
                <header className="chat-memory-head">
                    <span className="chat-memory-title">
                        <Heart size={15} strokeWidth={1.8} aria-hidden />
                        与{characterName}的回忆
                    </span>
                    <button type="button" className="chat-memory-close" onClick={onClose} aria-label="关闭">
                        <X size={17} strokeWidth={2} />
                    </button>
                </header>
                <div className="chat-memory-tabs" role="tablist">
                    {tabBtn("album", "相册")}
                    {tabBtn("timeline", "时间线")}
                    {tabBtn("checkin", "打卡")}
                </div>
                <div className="chat-memory-body">
                    {tab === "album" && (
                        photos.length === 0 ? (
                            <div className="chat-memory-empty">
                                <Camera size={22} strokeWidth={1.5} />
                                <p>还没有照片</p>
                                <span>在 + 菜单里发一张照片，就会收进这里</span>
                            </div>
                        ) : (
                            <div className="chat-memory-photo-grid">
                                {photos.map(m => (
                                    <AlbumPhotoTile key={m.id} msg={m} onOpen={(url, msg) => setPreview({ url, label: msg.mediaData?.label })} />
                                ))}
                            </div>
                        )
                    )}
                    {tab === "timeline" && (
                        <ul className="chat-memory-timeline">
                            {timelineItems.length === 0 && (
                                <div className="chat-memory-empty">
                                    <Milestone size={22} strokeWidth={1.5} />
                                    <p>还没有回忆</p>
                                    <span>开始聊天后这里会自动记录</span>
                                </div>
                            )}
                            {timelineItems.map((item, i) => (
                                <li className="chat-memory-timeline-item" key={`${item.date}-${i}`} data-icon={item.icon}>
                                    <span className="chat-memory-timeline-dot" aria-hidden>
                                        {item.icon === "camera" ? <Camera size={11} strokeWidth={2} /> : item.icon === "sparkles" ? <Sparkles size={11} strokeWidth={2} /> : item.icon === "check" ? <CalendarCheck size={11} strokeWidth={2} /> : <Heart size={11} strokeWidth={2} />}
                                    </span>
                                    <div className="chat-memory-timeline-text">
                                        <span>{item.text}</span>
                                        <time>{formatDateLabel(item.date)}</time>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {tab === "checkin" && (
                        <div className="chat-memory-checkin">
                            <div className="chat-memory-checkin-stats">
                                <div><strong>{totalCheckins}</strong><span>累计打卡</span></div>
                                <div><strong>{streak}</strong><span>连续天数</span></div>
                                <div><strong>{knownDays}</strong><span>相识天数</span></div>
                            </div>
                            {checkedToday ? (
                                <div className="chat-memory-checkin-done" role="status">
                                    <CalendarCheck size={16} strokeWidth={1.8} aria-hidden />
                                    今天已经打过卡了，明天见
                                </div>
                            ) : (
                                <>
                                    <input
                                        className="chat-memory-checkin-note"
                                        value={noteDraft}
                                        onChange={e => setNoteDraft(e.target.value)}
                                        placeholder="想对TA说的一句话（可选）"
                                        maxLength={60}
                                    />
                                    <button type="button" className="ui-btn ui-btn-primary chat-memory-checkin-btn" onClick={handleCheckIn}>
                                        <Clock size={15} strokeWidth={1.8} aria-hidden />
                                        今日打卡
                                    </button>
                                    <p className="chat-memory-checkin-hint">
                                        打卡会作为一条系统提示进入聊天上下文，{characterName} 能感知到你的这份心意
                                    </p>
                                </>
                            )}
                            <ul className="chat-memory-checkin-list">
                                {Object.entries(checkinMap)
                                    .sort((a, b) => b[0].localeCompare(a[0]))
                                    .slice(0, 14)
                                    .map(([date, rec]) => (
                                        <li key={date}>
                                            <CalendarCheck size={13} strokeWidth={1.8} aria-hidden />
                                            <span>{date}</span>
                                            {rec.note && <em>{rec.note}</em>}
                                        </li>
                                    ))}
                            </ul>
                        </div>
                    )}
                </div>
            </section>
            {preview && (
                <div className="chat-memory-preview" role="dialog" aria-modal="true" aria-label="照片预览" onClick={() => setPreview(null)}>
                    <img src={preview.url} alt={preview.label || "照片预览"} onClick={e => e.stopPropagation()} />
                    <button type="button" className="chat-memory-close chat-memory-preview-close" onClick={() => setPreview(null)} aria-label="关闭">
                        <X size={20} strokeWidth={2} />
                    </button>
                </div>
            )}
        </div>
    );
}
