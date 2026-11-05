// lib/notice-history.ts — 通知气泡链历史（G5）
// 站内通知横幅/灵动岛是转瞬即逝的单槽气泡，错过就没了。这里把每一条
// 真实弹过的通知落一份到 kv（上限 50 条），供「桌宠 → 通知记录」回溯：
// 依次点开就是那条被错过 的气泡链。纯客户端存储，不引入第二个通知源——
// 记录动作挂在 desktop-shell 现有的 CHAT_MESSAGE_NOTICE_EVENT 监听器里，
// 横幅/岛/系统通知走哪条路照旧，只是多留一份底账。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const NOTICE_HISTORY_KEY = "ai_phone_notice_history_v1";
export const NOTICE_LAST_READ_KEY = "ai_phone_notice_last_read_v1";
export const NOTICE_HISTORY_UPDATED_EVENT = "notice-history-updated";

/** 历史上限：太久远的通知没有回溯价值，超了从头丢弃 */
const MAX_NOTICE_HISTORY = 50;

registerKvMigration(NOTICE_HISTORY_KEY);
registerKvMigration(NOTICE_LAST_READ_KEY);

export type NoticeHistoryItem = {
    id: string;
    /** 点击直达的会话 id */
    sessionId: string;
    /** 展示名（横幅标题同口径：会话备注/角色名/群名/固定标题） */
    senderName: string;
    /** 通知正文（预览关掉时是"收到一条新消息"，与用户当时看到的一致） */
    body: string;
    avatar?: string | null;
    isGroup?: boolean;
    createdAt: number;
};

export function loadNoticeHistory(): NoticeHistoryItem[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(NOTICE_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isNoticeHistoryItem);
    } catch {
        return [];
    }
}

function isNoticeHistoryItem(value: unknown): value is NoticeHistoryItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<NoticeHistoryItem>;
    return typeof item.id === "string"
        && typeof item.sessionId === "string"
        && typeof item.senderName === "string"
        && typeof item.body === "string"
        && typeof item.createdAt === "number";
}

function saveNoticeHistory(items: NoticeHistoryItem[]): void {
    if (typeof window === "undefined") return;
    kvSet(NOTICE_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_NOTICE_HISTORY)));
    window.dispatchEvent(new Event(NOTICE_HISTORY_UPDATED_EVENT));
}

/** 追加一条通知记录（desktop-shell 通知监听器调用）。同会话同正文 1.5s 内去重，
 *  防御上游意外重复派发；正常逐条错峰 800ms 的场景不受影响。 */
export function recordChatNotice(item: Omit<NoticeHistoryItem, "id" | "createdAt">): void {
    if (typeof window === "undefined" || !item.sessionId || !item.body) return;
    const existing = loadNoticeHistory();
    const head = existing[0];
    if (head && head.sessionId === item.sessionId && head.body === item.body
        && Date.now() - head.createdAt < 1500) {
        return;
    }
    const next: NoticeHistoryItem[] = [{
        ...item,
        id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
    }, ...existing];
    saveNoticeHistory(next);
}

export function clearNoticeHistory(): void {
    saveNoticeHistory([]);
}

/** 未读数：上次打开通知记录页之后新到的通知条数 */
export function getNoticeUnreadCount(): number {
    if (typeof window === "undefined") return 0;
    const raw = kvGet(NOTICE_LAST_READ_KEY);
    const lastReadAt = raw ? Number(raw) : 0;
    if (!Number.isFinite(lastReadAt) || lastReadAt <= 0) {
        return loadNoticeHistory().length;
    }
    return loadNoticeHistory().filter(item => item.createdAt > lastReadAt).length;
}

/** 打开通知记录页时调用：把当前时刻记为已读水位 */
export function markNoticesRead(): void {
    if (typeof window === "undefined") return;
    kvSet(NOTICE_LAST_READ_KEY, String(Date.now()));
    window.dispatchEvent(new Event(NOTICE_HISTORY_UPDATED_EVENT));
}

export function subscribeNoticeHistory(listener: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(NOTICE_HISTORY_UPDATED_EVENT, listener);
    return () => window.removeEventListener(NOTICE_HISTORY_UPDATED_EVENT, listener);
}
