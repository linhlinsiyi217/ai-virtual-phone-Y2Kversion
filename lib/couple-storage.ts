// lib/couple-storage.ts — 情侣绑定（G6）
// 只存「谁被绑定为恋人 + 从什么时候开始」这一条关系元数据（kv 持久化）。
// 不复制、不代理任何聊天数据：所有情侣互动都通过现有 chat-storage
// 写进对应会话，聊天、朋友圈、关系网看到的就是同一份真实数据。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const COUPLE_BINDING_KEY = "ai_phone_couple_binding_v1";
export const COUPLE_BINDING_UPDATED_EVENT = "couple-binding-updated";

registerKvMigration(COUPLE_BINDING_KEY);

export type CoupleBinding = {
    /** 被绑定为恋人的角色 id（对应 chat character） */
    characterId: string;
    /** 确定关系的时刻（ms 时间戳），纪念日按天展示 */
    since: number;
    /** 用户给这段关系写的备注（可空） */
    note?: string;
};

function isCoupleBinding(value: unknown): value is CoupleBinding {
    if (!value || typeof value !== "object") return false;
    const b = value as Partial<CoupleBinding>;
    return typeof b.characterId === "string" && typeof b.since === "number";
}

export function loadCoupleBinding(): CoupleBinding | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = kvGet(COUPLE_BINDING_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return isCoupleBinding(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function saveCoupleBinding(binding: CoupleBinding): void {
    if (typeof window === "undefined") return;
    kvSet(COUPLE_BINDING_KEY, JSON.stringify(binding));
    window.dispatchEvent(new Event(COUPLE_BINDING_UPDATED_EVENT));
}

export function clearCoupleBinding(): void {
    if (typeof window === "undefined") return;
    kvSet(COUPLE_BINDING_KEY, "");
    window.dispatchEvent(new Event(COUPLE_BINDING_UPDATED_EVENT));
}

/** 纪念日文案：在一起第 N 天（当天 = 第 1 天） */
export function coupleDaysSince(since: number, now = Date.now()): number {
    const day = Math.floor(now / 86_400_000) - Math.floor(since / 86_400_000);
    return Math.max(1, day + 1);
}
