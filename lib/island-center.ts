// lib/island-center.ts — 灵动岛的全局状态中心
//
// 应用状态 → 本中心 → 灵动岛（紧凑 / 展开 / 事件）。
// 页面不直接改灵动岛文字，只往这里登记：
//   - 持续活动（activity）：后台任务、Claude 工具调用、AI 正在回复、更新检查等，
//     按 key 登记与清除，同 key 覆盖；结束后自动回到之前的状态。
//   - 临时事件（event）：AI 消息、应用通知、更新提醒、工具失败等，
//     进队列逐条显示，同来源同目标在显示期间合并计数，显示完自动收回。
// 音乐、一起听、通话直接取各自已有的全局服务（music-context / listen-together /
// call-session-store），不在这里存第二份。
"use client";

export type IslandTarget = {
    /** 点进去打开的应用 id（desktop-shell 的 open-app） */
    appId: string;
    sessionId?: string;
    settingsPage?: string;
};

export type IslandAction = {
    label: string;
    run: () => void;
    tone?: "default" | "danger";
};

export type IslandActivityKind = "task" | "ai" | "tool" | "update";

export type IslandActivity = {
    key: string;
    kind: IslandActivityKind;
    /** 简短标题：紧凑态显示 */
    title: string;
    /** 展开后的说明：正在做什么 */
    detail?: string;
    status: "running" | "error";
    target?: IslandTarget;
    actions?: IslandAction[];
    startedAt: number;
    updatedAt: number;
};

export type IslandEventKind = "message" | "notice" | "update" | "tool" | "task";

export type IslandEvent = {
    id: string;
    kind: IslandEventKind;
    /** 来源：显示在标题位，如角色名、应用名 */
    source: string;
    text: string;
    avatar?: string;
    target?: IslandTarget;
    /** 同 mergeKey 的事件在队列里合并，只增加条数 */
    mergeKey: string;
    count: number;
    tone?: "default" | "error";
    ttl: number;
    createdAt: number;
};

/** 来电（响铃中）：由 desktop-shell 的来电状态同步进来，接听 / 拒接走同一套处理 */
export type IslandIncomingCall = {
    sessionId: string;
    name: string;
    avatar: string;
    kind: "voice" | "video";
    isGroup: boolean;
    accept: () => void;
    decline: () => void;
};

export type IslandCenterSnapshot = {
    incomingCall: IslandIncomingCall | null;
    activities: IslandActivity[];
    /** 当前正在显示的事件（队首） */
    event: IslandEvent | null;
    /** 排在后面的事件条数 */
    queued: number;
};

const DEFAULT_EVENT_TTL = 4200;
const MAX_QUEUE = 6;
/** 持续活动最长保留，防止发布方异常退出后永远挂在岛上 */
const ACTIVITY_STALE_MS = 10 * 60 * 1000;

const activities = new Map<string, IslandActivity>();
let queue: IslandEvent[] = [];
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let incoming: IslandIncomingCall | null = null;
let snapshot: IslandCenterSnapshot = { incomingCall: null, activities: [], event: null, queued: 0 };
const listeners = new Set<() => void>();

function rebuild() {
    const now = Date.now();
    for (const [key, item] of activities) {
        if (now - item.updatedAt > ACTIVITY_STALE_MS) activities.delete(key);
    }
    snapshot = {
        incomingCall: incoming,
        activities: [...activities.values()].sort((a, b) => b.updatedAt - a.updatedAt),
        event: queue[0] ?? null,
        queued: Math.max(0, queue.length - 1),
    };
    for (const listener of [...listeners]) {
        try { listener(); } catch { /* 单个订阅者出错不影响其余 */ }
    }
}

function scheduleHead() {
    if (eventTimer) {
        clearTimeout(eventTimer);
        eventTimer = null;
    }
    const head = queue[0];
    if (!head) return;
    const remaining = Math.max(600, head.ttl - (Date.now() - head.createdAt));
    eventTimer = setTimeout(() => {
        eventTimer = null;
        queue = queue.slice(1);
        // 下一条从出场那一刻开始计时
        if (queue[0]) queue[0] = { ...queue[0], createdAt: Date.now() };
        scheduleHead();
        rebuild();
    }, remaining);
}

export function subscribeIslandCenter(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getIslandCenterSnapshot(): IslandCenterSnapshot {
    return snapshot;
}

const SERVER_SNAPSHOT: IslandCenterSnapshot = { incomingCall: null, activities: [], event: null, queued: 0 };
export function getIslandCenterServerSnapshot(): IslandCenterSnapshot {
    return SERVER_SNAPSHOT;
}

export function setIslandIncomingCall(call: IslandIncomingCall | null): void {
    if (incoming === call) return;
    incoming = call;
    rebuild();
}

/** 登记或更新一项持续活动（同 key 覆盖，保留最初开始时间） */
export function setIslandActivity(input: Omit<IslandActivity, "startedAt" | "updatedAt" | "status"> & { status?: IslandActivity["status"] }): void {
    const prev = activities.get(input.key);
    const now = Date.now();
    activities.set(input.key, {
        ...input,
        status: input.status ?? "running",
        startedAt: prev?.startedAt ?? now,
        updatedAt: now,
    });
    rebuild();
}

export function clearIslandActivity(key: string): void {
    if (!activities.delete(key)) return;
    rebuild();
}

/** 推一条临时事件；与正在显示或排队中的同 mergeKey 事件合并 */
export function pushIslandEvent(input: {
    kind: IslandEventKind;
    source: string;
    text: string;
    avatar?: string;
    target?: IslandTarget;
    mergeKey?: string;
    tone?: IslandEvent["tone"];
    ttl?: number;
}): string {
    const mergeKey = input.mergeKey ?? `${input.kind}:${input.target?.appId ?? ""}:${input.target?.sessionId ?? input.source}`;
    const index = queue.findIndex(item => item.mergeKey === mergeKey);
    if (index >= 0) {
        const merged = { ...queue[index], text: input.text, avatar: input.avatar ?? queue[index].avatar, count: queue[index].count + 1 };
        queue = queue.map((item, i) => (i === index ? merged : item));
        // 正在显示的那条被合并：重新计时，让新内容停留完整时长
        if (index === 0) {
            queue[0] = { ...queue[0], createdAt: Date.now() };
            scheduleHead();
        }
        rebuild();
        return merged.id;
    }
    const event: IslandEvent = {
        id: `isl_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        kind: input.kind,
        source: input.source,
        text: input.text,
        avatar: input.avatar,
        target: input.target,
        mergeKey,
        count: 1,
        tone: input.tone,
        ttl: input.ttl ?? DEFAULT_EVENT_TTL,
        createdAt: Date.now(),
    };
    const prevHead = queue[0];
    queue = [...queue, event].slice(-MAX_QUEUE);
    if (queue[0] !== prevHead) {
        queue[0] = { ...queue[0], createdAt: Date.now() };
        scheduleHead();
    }
    rebuild();
    return event.id;
}

/** 收回一条事件（点进去、上滑关闭）；id 不在队列里时忽略 */
export function dismissIslandEvent(id?: string): void {
    if (!queue.length) return;
    const index = id ? queue.findIndex(item => item.id === id) : 0;
    if (index < 0) return;
    queue = queue.filter((_, i) => i !== index);
    if (index === 0) {
        if (queue[0]) queue[0] = { ...queue[0], createdAt: Date.now() };
        scheduleHead();
    }
    rebuild();
}

/** 打开灵动岛关联的应用/会话 */
export function openIslandTarget(target: IslandTarget | undefined): void {
    if (!target || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("open-app", {
        detail: { appId: target.appId, sessionId: target.sessionId, settingsPage: target.settingsPage },
    }));
}
