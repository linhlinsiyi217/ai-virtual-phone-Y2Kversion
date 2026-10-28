// lib/study-room/membership.ts — 书房 SVIP：只用小手机里现有的统一钱包余额（虚拟币），不接现实支付。
//
// 流程与「抽一本」相同的挂单方式，保证不重复扣费：
//  1. 先写「扣费中」挂单（带订单 id）；
//  2. 带订单 id 从统一钱包扣费；
//  3. 扣费成功 → 授予会员、记下起止时间与订单、结掉挂单。
// 中途关掉页面：下次读取时以钱包流水为准——扣过就补授予，没扣就作废挂单。
// 作用域：与钱包相同，一台设备一份。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { getWalletBalance, loadWalletState, payWithWalletBalance } from "@/lib/wallet-storage";

const KEY = "ai_phone_studyroom_membership_v1";
registerKvMigration(KEY);

export const MEMBERSHIP_UPDATED_EVENT = "studyroom-membership-updated";

/**
 * 首版价格与时长集中在这里，之后调整只改这一处。
 * 这是开发时设定的首版数值（不是用户确认过的定价），交付时已向用户列明。
 */
export const SVIP_PLAN = {
  /** 每次开通/续费扣多少（统一钱包余额单位） */
  price: 30,
  /** 每次开通/续费加多少天 */
  days: 30,
} as const;

/** 实际权益：只列真的做了的。普通标签、配色和资料编辑一直免费。 */
export const SVIP_BENEFITS = [
  "昵称旁显示 SVIP 徽章",
  "标签圆点多一组会员配色",
];

/** 会员专属配色（普通配色免费，这一组仅会员可选）。 */
export const SVIP_SWATCHES = ["#B08D57", "#8E6FB8", "#3E7C8C", "#B5566E"];

export type MembershipOrder = {
  id: string;
  price: number;
  days: number;
  paidAt: string;
  startAt: string;
  endAt: string;
};

type PendingOrder = { id: string; price: number; days: number; createdAt: string };

export type MembershipState = {
  /** 当前有效期止于何时（ISO）；从没开通过为 null */
  endAt: string | null;
  /** 第一次开通时间 */
  since: string | null;
  orders: MembershipOrder[];
  pending: PendingOrder | null;
};

const EMPTY: MembershipState = { endAt: null, since: null, orders: [], pending: null };

function chargedInWallet(orderId: string): boolean {
  return loadWalletState().transactions.some((item) => item.relatedOrderId === orderId);
}

function save(state: MembershipState): MembershipState {
  kvSet(KEY, JSON.stringify({ ...state, orders: state.orders.slice(0, 50) }));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MEMBERSHIP_UPDATED_EVENT));
  return state;
}

/** 把一笔已扣费的订单授予为会员时长（续费从「现在」与「当前到期」中较晚的那个往后加）。 */
function grant(state: MembershipState, order: PendingOrder): MembershipState {
  if (state.orders.some((item) => item.id === order.id)) return { ...state, pending: null };
  const now = Date.now();
  const currentEnd = state.endAt ? Date.parse(state.endAt) : 0;
  const start = Math.max(now, Number.isFinite(currentEnd) ? currentEnd : 0);
  const end = start + order.days * 24 * 60 * 60 * 1000;
  const record: MembershipOrder = {
    id: order.id,
    price: order.price,
    days: order.days,
    paidAt: new Date(now).toISOString(),
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  };
  return {
    endAt: record.endAt,
    since: state.since ?? record.paidAt,
    orders: [record, ...state.orders],
    pending: null,
  };
}

export function loadMembership(): MembershipState {
  let state: MembershipState = { ...EMPTY };
  try {
    const raw = kvGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MembershipState>;
      state = {
        endAt: typeof parsed.endAt === "string" ? parsed.endAt : null,
        since: typeof parsed.since === "string" ? parsed.since : null,
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        pending: parsed.pending && typeof parsed.pending.id === "string" ? parsed.pending : null,
      };
    }
  } catch {
    return { ...EMPTY };
  }
  // 上次停在扣费中：以钱包流水为准恢复一致
  if (state.pending) {
    state = chargedInWallet(state.pending.id) ? grant(state, state.pending) : { ...state, pending: null };
    save(state);
  }
  return state;
}

export function isMemberActive(state: MembershipState, now = Date.now()): boolean {
  if (!state.endAt) return false;
  const end = Date.parse(state.endAt);
  return Number.isFinite(end) && end > now;
}

export function membershipBalance(): number {
  return getWalletBalance(loadWalletState());
}

export type PurchaseResult = { ok: true; state: MembershipState } | { ok: false; state: MembershipState; error: string };

/** 开通 / 续费一次（幂等：有挂单就沿用，不会二次扣费）。 */
export function purchaseSvip(): PurchaseResult {
  let state = loadMembership();
  if (state.pending) {
    // loadMembership 已经处理过挂单；走到这里说明并发点击，直接返回当前状态
    return { ok: false, state, error: "上一笔还在处理，请稍候再试。" };
  }
  const order: PendingOrder = {
    id: `svip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    price: SVIP_PLAN.price,
    days: SVIP_PLAN.days,
    createdAt: new Date().toISOString(),
  };
  state = save({ ...state, pending: order });
  const result = payWithWalletBalance({
    amount: order.price,
    title: "书房 · SVIP",
    detail: `书房 SVIP ${order.days} 天`,
    category: "会员",
    relatedOrderId: order.id,
  });
  if (!result.ok) {
    state = save({ ...state, pending: null });
    return { ok: false, state, error: result.error ?? "余额不足，未开通。" };
  }
  state = save(grant(state, order));
  return { ok: true, state };
}

export function formatMemberDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
