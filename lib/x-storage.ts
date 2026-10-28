// X 应用存储层 —— 自 wanwan/js/x-page.js 迁移改写
// wanwan 原版用 IndexedDB characters(type=user) + localStorage；
// float 版统一用 kv-db + 用户身份（UserIdentity）作为账号来源。

import { kvGet, kvSet, kvRemove, registerKvMigration } from "./kv-db";
import type { XPost, XProfile, XState } from "./x-types";

export const X_STATE_KEY = "ai_phone_x_state_v1";

registerKvMigration(X_STATE_KEY);

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 内置示例帖（对应 wanwan 弯弯协会帖子，保证首屏时间线不为空） */
function seedPosts(): XPost[] {
  const now = Date.now();
  return [
    {
      id: "seed_wanwan_association",
      authorKind: "seed",
      name: "弯弯协会",
      handle: "Wanwan_Offical",
      verified: true,
      content: "产品上线请多多关注。#AI #Wanwan",
      createdAt: now - 2 * 60 * 60 * 1000,
      comments: 847,
      retweets: 203,
      likes: 3654,
      views: 286000,
    },
  ];
}

export function emptyXState(): XState {
  return {
    version: 1,
    sessionIdentityId: null,
    posts: seedPosts(),
    likes: {},
    profiles: {},
    bookmarks: {},
  };
}

export function loadXState(): XState {
  if (typeof window === "undefined") return emptyXState();
  try {
    const raw = kvGet(X_STATE_KEY);
    if (!raw) return emptyXState();
    const parsed = JSON.parse(raw) as Partial<XState>;
    const state: XState = {
      version: 1,
      sessionIdentityId: typeof parsed.sessionIdentityId === "string" ? parsed.sessionIdentityId : null,
      posts: Array.isArray(parsed.posts) && parsed.posts.length >= 0 ? parsed.posts : seedPosts(),
      likes: parsed.likes && typeof parsed.likes === "object" ? parsed.likes : {},
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
      // 旧存档没有收藏数据时补空表（G14 兼容）
      bookmarks: parsed.bookmarks && typeof parsed.bookmarks === "object" ? parsed.bookmarks : {},
    };
    if (!state.posts.length) state.posts = seedPosts();
    return state;
  } catch {
    return emptyXState();
  }
}

export function saveXState(state: XState): void {
  if (typeof window === "undefined") return;
  kvSet(X_STATE_KEY, JSON.stringify(state));
}

export function clearXState(): void {
  if (typeof window === "undefined") return;
  kvRemove(X_STATE_KEY);
}

export function makeXPostId(): string {
  return makeId("xpost");
}

export function stripXAt(value: unknown): string {
  return String(value == null ? "" : value).trim().replace(/^@+/, "");
}

/** 关注/粉丝数归一：允许纯数字，也保留用户手写的「1.2万」这类展示值 */
export function normalizeXCount(value: unknown): string {
  const str = String(value == null || value === "" ? "0" : value).trim();
  if (/^\d+$/.test(str)) return String(parseInt(str, 10));
  return str.replace(/[<>"'&]/g, "").slice(0, 12) || "0";
}

export function normalizeXJoinYear(value: unknown, fallback: string): string {
  const year = parseInt(String(value == null ? "" : value).replace(/\D/g, ""), 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2999) return fallback;
  return String(year);
}

export function normalizeXJoinMonth(value: unknown, fallback: string): string {
  const month = parseInt(String(value == null ? "" : value).replace(/\D/g, ""), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return fallback;
  return String(month);
}

export function defaultXHandle(name: string): string {
  return stripXAt(name).replace(/\s+/g, "_") || "User";
}

export function defaultXJoinParts(createdAt?: number): { year: string; month: string } {
  const date = createdAt ? new Date(createdAt) : new Date();
  if (isNaN(date.getTime())) return { year: "2026", month: "3" };
  return { year: String(date.getFullYear()), month: String(date.getMonth() + 1) };
}

/** 身份默认资料：昵称/头像取自 UserIdentity，其余字段走 X 默认值 */
export function defaultXProfile(identity: { id: string; name: string; nickname?: string; avatarUrl?: string }, createdAt?: number): XProfile {
  const name = identity.nickname || identity.name || "我";
  const join = defaultXJoinParts(createdAt);
  return {
    name,
    handle: defaultXHandle(name),
    avatarUrl: identity.avatarUrl || "",
    backgroundImage: "",
    joinYear: join.year,
    joinMonth: join.month,
    following: "0",
    followers: "0",
  };
}

/** 读取某身份的资料（无则给默认），不会写回存储 */
export function resolveXProfile(state: XState, identity: { id: string; name: string; nickname?: string; avatarUrl?: string } | null, createdAt?: number): XProfile | null {
  if (!identity) return null;
  const stored = state.profiles[identity.id];
  if (stored) {
    const base = defaultXProfile(identity, createdAt);
    return {
      ...base,
      ...stored,
      name: stored.name || base.name,
      handle: stripXAt(stored.handle || base.handle),
    };
  }
  return defaultXProfile(identity, createdAt);
}

/** G14：收藏切换——按身份记录；返回切换后的新 XState（调用方负责持久化） */
export function togglePostBookmark(state: XState, identityId: string | null, postId: string): XState {
  if (!identityId) return state;
  const current = state.bookmarks[identityId] || [];
  const next = current.includes(postId) ? current.filter(id => id !== postId) : [...current, postId];
  return { ...state, bookmarks: { ...state.bookmarks, [identityId]: next } };
}

export function isPostBookmarkedBy(state: XState, identityId: string | null, postId: string): boolean {
  if (!identityId) return false;
  return (state.bookmarks[identityId] || []).includes(postId);
}

export function isPostLikedBy(state: XState, identityId: string | null, postId: string): boolean {
  if (!identityId) return false;
  return (state.likes[identityId] || []).includes(postId);
}

export function togglePostLike(state: XState, identityId: string | null, postId: string): XState {
  if (!identityId) return state;
  const liked = state.likes[identityId] || [];
  const next = liked.includes(postId) ? liked.filter(id => id !== postId) : [...liked, postId];
  return { ...state, likes: { ...state.likes, [identityId]: next } };
}

export function formatXNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(n);
}

/** 相对时间展示（对应 wanwan 帖子卡「2小时」样式） */
export function formatXTime(createdAt: number): string {
  const diff = Date.now() - createdAt;
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时`;
  if (diff < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天`;
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
