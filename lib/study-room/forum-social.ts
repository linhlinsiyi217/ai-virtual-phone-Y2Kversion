// lib/study-room/forum-social.ts — 书友圈的互动层：频道、关注、通知、草稿、评论计划与生成规则。
//
// 原则：
//  - 所有互动都是真实状态并持久化（点赞、关注、收藏、通知、草稿、待回复计划）；
//  - 书友按人设持续发言，刷新只补充新内容，不推倒重来；
//  - 生成规则可编辑，但默认开箱可用；生成按需触发、可停止、带冷却。

import { simpleLLMCall } from "@/lib/api-helpers";
import { avatarFromKey } from "./npc-avatar";
import {
  buildForumCommentMessages,
  FORUM_COMMENT_TIMEOUT_MS,
  forumDeadline,
  forumRequestMeta,
  forumRuleFields,
  logForumRequest,
} from "./forum-prompt";
import {
  DEFAULT_FORUM_RULES,
  forumMessagesFor,
  generateNpc,
  npcHiddenContext,
  pickParticipants,
  resolveForumApiConfig,
  type ForumComment,
  type ForumDraft,
  type ForumNpc,
  type ForumNotification,
  type ForumPost,
  type ForumRules,
  type ForumState,
  type ForumTopic,
  type PendingReply,
} from "./forum";

const USER_ID = "user";

// ── 生成规则 ──

export function updateForumRules(state: ForumState, patch: Partial<ForumRules>): ForumState {
  return { ...state, rules: { ...state.rules, ...patch } };
}

export function singleDefaultRule<K extends keyof ForumRules>(key: K): ForumRules[K] {
  return DEFAULT_FORUM_RULES[key];
}

/** 规则里用户写得比较随意，这里做一次规整，避免空值把提示词弄坏。 */
export function normalizeRules(rules: ForumRules): ForumRules {
  const clamp = (value: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;
  return {
    ...rules,
    feedTypes: rules.feedTypes?.trim() || DEFAULT_FORUM_RULES.feedTypes,
    feedCount: clamp(Number(rules.feedCount), 1, 8),
    feedScope: rules.feedScope?.trim() || DEFAULT_FORUM_RULES.feedScope,
    searchScope: rules.searchScope?.trim() || DEFAULT_FORUM_RULES.searchScope,
    commentLength: rules.commentLength?.trim() || DEFAULT_FORUM_RULES.commentLength,
    commentTone: rules.commentTone?.trim() || DEFAULT_FORUM_RULES.commentTone,
    commentRelation: rules.commentRelation?.trim() || DEFAULT_FORUM_RULES.commentRelation,
    commentFollowUp: rules.commentFollowUp !== false,
    autoReply: rules.autoReply !== false,
    replyCount: clamp(Number(rules.replyCount ?? DEFAULT_FORUM_RULES.replyCount), 1, 5),
    dailyPosts: clamp(Number(rules.dailyPosts), 0, 12),
    dailyLikes: clamp(Number(rules.dailyLikes), 0, 40),
    dailyFollows: clamp(Number(rules.dailyFollows), 0, 10),
    dailyGifts: clamp(Number(rules.dailyGifts), 0, 10),
    dailyFriends: clamp(Number(rules.dailyFriends), 0, 5),
    hotTopics: rules.hotTopics?.trim() || DEFAULT_FORUM_RULES.hotTopics,
  };
}

// ── 首次进入：先有书友，再有内容 ──

/** 论坛为空时生成一批不同领域的书友（本地生成，不依赖 API）。 */
export function ensureSeeded(state: ForumState): { state: ForumState; created: number } {
  if (state.seeded && state.npcs.length > 0) return { state, created: 0 };
  const seeds = [11, 29, 47, 83, 101, 137, 173];
  const created: ForumNpc[] = [];
  const used = new Set(state.npcs.map((npc) => npc.nickname));
  for (const seed of seeds) {
    if (state.npcs.length + created.length >= 7) break;
    const npc = generateSeededNpc(seed, used);
    if (npc) {
      created.push(npc);
      used.add(npc.nickname);
    }
  }
  return {
    state: { ...state, npcs: [...state.npcs, ...created], seeded: true },
    created: created.length,
  };
}

/** 用给定种子生成人设：与「随机生成」同一套池子，结果稳定可复现。 */
function generateSeededNpc(seed: number, usedNames: Set<string>): ForumNpc | null {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const npc = generateNpc({ seed: seed + attempt * 7 });
    if (!usedNames.has(npc.nickname)) {
      npc.id = `npc_seed_${seed}`;
      // 头像按最终 id 重新算一次，保证同一批种子每次生成的头像一致
      npc.avatar = avatarFromKey(npc.id);
      return npc;
    }
  }
  return null;
}

// ── 首页刷新：书友发新帖 ──

/** 刷新首页用的记录键（存在 generatedAt 里，和话题冷却同一处）。 */
export const FEED_REFRESH_KEY = "__feed_refresh";
/** 进入时自动刷新的间隔：太久没有新帖才自动补，不会每次进来都调用模型。 */
export const FEED_AUTO_REFRESH_MS = 3 * 60 * 60 * 1000;

/** 距上次刷新首页是否已经够久（没刷过也算）。 */
export function feedRefreshDue(state: ForumState, now = Date.now()): boolean {
  const at = state.generatedAt[FEED_REFRESH_KEY];
  if (!at) return true;
  return now - new Date(at).getTime() >= FEED_AUTO_REFRESH_MS;
}

/** 从「热门话题」里随机挑一个当这次的话头，避免每次都聊同一件事。 */
export function pickFeedTopic(state: ForumState): ForumTopic {
  const raw = state.rules.hotTopics.replace(/^[^：:]*[：:]/, "");
  const pieces = raw.split(/[、,，;；\n]+/).map((item) => item.trim()).filter(Boolean);
  const label = pieces.length > 0 ? pieces[Math.floor(Math.random() * pieces.length)] : "最近在读什么";
  return { key: `首页动态:${label}`, label, prompt: state.rules.feedTypes };
}

/** 新帖去重：和已有帖子正文一样的不要。 */
export function dedupePosts(existing: ForumPost[], created: ForumPost[]): ForumPost[] {
  const seen = new Set(existing.map((post) => commentKey(post.body)));
  return created.filter((post) => {
    const key = commentKey(post.body);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 频道 ──

export type ForumChannel = "recommend" | "following" | "latest" | "hot" | "review" | "discussion" | "creation";

export const CHANNEL_LABEL: Record<ForumChannel, string> = {
  recommend: "推荐",
  following: "关注",
  latest: "最新",
  hot: "热门",
  review: "书评",
  discussion: "讨论",
  creation: "创作",
};

/** 各频道的内容口径：推荐看互动与新鲜度，关注只看关注的作者，最新按时间，书评只看书评。 */
export function channelPosts(state: ForumState, channel: ForumChannel): ForumPost[] {
  // 不感兴趣的帖子与屏蔽书友的帖子都不进信息流
  const visible = state.posts.filter(
    (post) => !state.hiddenPostIds.includes(post.id) && !state.mutedNpcIds.includes(post.authorId),
  );
  const now = Date.now();
  const score = (post: ForumPost) => {
    const hours = Math.max((now - new Date(post.createdAt).getTime()) / 3600_000, 0.5);
    const engagement = post.likedBy.length * 2 + post.comments.length * 3;
    const followed = state.following.includes(post.authorId) ? 6 : 0;
    return engagement + followed + 12 / hours;
  };
  switch (channel) {
    case "following":
      return visible
        .filter((post) => state.following.includes(post.authorId) || post.authorId === USER_ID)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "latest":
      return [...visible].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "review":
      return visible.filter((post) => post.kind === "review").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "discussion":
      return visible.filter((post) => post.kind === "post").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "creation":
      return visible.filter((post) => post.kind === "creation").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "hot":
      // 热门只看互动（点赞 + 评论），不看新旧
      return [...visible].sort((a, b) => b.likedBy.length * 2 + b.comments.length - (a.likedBy.length * 2 + a.comments.length));
    default:
      return [...visible].sort((a, b) => score(b) - score(a));
  }
}

// ── 信息流三层：范围（推荐 / 关注）× 排序（默认 / 最新 / 热门）× 类型（全部 / 书评 / 讨论） ──

export type FeedScope = "recommend" | "following";
export type FeedSort = "default" | "latest" | "hot";
export type FeedKind = "all" | "review" | "discussion";

export const FEED_SORT_LABEL: Record<FeedSort, string> = { default: "默认", latest: "最新", hot: "热门" };
export const FEED_KIND_LABEL: Record<FeedKind, string> = { all: "全部", review: "书评", discussion: "讨论" };

export function feedPosts(state: ForumState, scope: FeedScope, sort: FeedSort, kind: FeedKind): ForumPost[] {
  // 范围先定好候选（推荐 = 全部可见，关注 = 关注的人 + 自己），再按类型筛、按排序排
  let list = channelPosts(state, scope === "following" ? "following" : "recommend");
  if (kind === "review") list = list.filter((post) => post.kind === "review");
  if (kind === "discussion") list = list.filter((post) => post.kind === "post");
  if (sort === "latest") return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (sort === "hot") {
    const heat = (post: ForumPost) => post.likedBy.length * 2 + post.comments.length;
    return [...list].sort((a, b) => heat(b) - heat(a));
  }
  return list;
}

// ── 互动：收藏 / 关注 / 通知 ──

export function toggleCollect(state: ForumState, postId: string, actorId = USER_ID): ForumState {
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return state;
  const list = post.collectedBy ?? [];
  const next = list.includes(actorId) ? list.filter((id) => id !== actorId) : [...list, actorId];
  return { ...state, posts: state.posts.map((item) => (item.id === postId ? { ...item, collectedBy: next } : item)) };
}

export function isCollected(post: ForumPost, actorId = USER_ID): boolean {
  return (post.collectedBy ?? []).includes(actorId);
}

export function toggleFollowNpc(state: ForumState, npcId: string): ForumState {
  const following = state.following.includes(npcId)
    ? state.following.filter((id) => id !== npcId)
    : [...state.following, npcId];
  // 书友的粉丝列表同步（真实状态，刷新后仍在）
  const npcs = state.npcs.map((npc) => {
    if (npc.id !== npcId) return npc;
    const followers = npc.followers ?? [];
    const nextFollowers = following.includes(npcId)
      ? Array.from(new Set([...followers, USER_ID]))
      : followers.filter((id) => id !== USER_ID);
    return { ...npc, followers: nextFollowers };
  });
  // 取消关注时特别关注一起取消
  const starred = following.includes(npcId) ? state.starred : state.starred.filter((id) => id !== npcId);
  return { ...state, following, npcs, starred };
}

export function isFollowing(state: ForumState, npcId: string): boolean {
  return state.following.includes(npcId);
}

/** 特别关注（星标）：没关注的会顺带关注上。 */
export function toggleStarNpc(state: ForumState, npcId: string): ForumState {
  if (state.starred.includes(npcId)) {
    return { ...state, starred: state.starred.filter((id) => id !== npcId) };
  }
  const followed = state.following.includes(npcId) ? state : toggleFollowNpc(state, npcId);
  return { ...followed, starred: [...followed.starred, npcId] };
}

export function isStarred(state: ForumState, npcId: string): boolean {
  return state.starred.includes(npcId);
}

export function followerCount(npc: ForumNpc): number {
  return (npc.followers ?? []).length;
}

export function followingCount(npc: ForumNpc): number {
  return (npc.following ?? []).length;
}

export function pushNotification(state: ForumState, notification: Omit<ForumNotification, "id" | "createdAt" | "read">): ForumState {
  const entry: ForumNotification = {
    ...notification,
    id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
  // 同一来源同一条帖子只留最近一条，避免刷屏
  const filtered = state.notifications.filter(
    (item) => !(item.kind === notification.kind && item.fromId === notification.fromId && item.postId === notification.postId),
  );
  return { ...state, notifications: [entry, ...filtered].slice(0, 120) };
}

export function unreadNotifications(state: ForumState): ForumNotification[] {
  return state.notifications.filter((item) => !item.read);
}

export function markNotificationsRead(state: ForumState, kinds?: ForumNotification["kind"][]): ForumState {
  return {
    ...state,
    notifications: state.notifications.map((item) =>
      !kinds || kinds.includes(item.kind) ? { ...item, read: true } : item,
    ),
  };
}

// ── 草稿箱 ──

export function saveDraft(state: ForumState, draft: Omit<ForumDraft, "updatedAt">): ForumState {
  const entry: ForumDraft = { ...draft, updatedAt: new Date().toISOString() };
  const exists = state.drafts.some((item) => item.id === draft.id);
  return {
    ...state,
    drafts: exists ? state.drafts.map((item) => (item.id === draft.id ? entry : item)) : [entry, ...state.drafts],
  };
}

export function deleteDraft(state: ForumState, draftId: string): ForumState {
  return { ...state, drafts: state.drafts.filter((item) => item.id !== draftId) };
}

// ── 评论：分批错时出现 ──

/** 同一条帖子里书友评论的上限：到了就不再安排，避免越回越多、来回循环。 */
export const MAX_NPC_COMMENTS_PER_POST = 12;
/** 同一位书友在同一条帖子里最多说几次。 */
export const MAX_COMMENTS_PER_NPC = 2;

/**
 * 安排书友回应。默认遵守「自动回复」开关与「回应人数」；
 * manual=true 表示用户主动点了「请书友回应」，此时不看开关，但人数与上限照旧。
 */
export function scheduleReplies(
  state: ForumState,
  postId: string,
  options: { manual?: boolean; soon?: boolean } = {},
): ForumState {
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return state;
  if (!options.manual && state.rules.autoReply === false) return state;

  const npcCommentCount = post.comments.filter((comment) => comment.authorKind === "npc").length;
  const pendingOnPost = state.pendingReplies.filter((item) => item.postId === postId);
  const room = MAX_NPC_COMMENTS_PER_POST - npcCommentCount - pendingOnPost.length;
  if (room <= 0) return state;

  const count = Math.min(Math.max(Number(state.rules.replyCount) || 2, 1), 5, room);
  const topic: ForumTopic = {
    key: post.topics?.[0] ?? post.bookTitle ?? post.title ?? "帖子",
    label: post.title ?? post.bookTitle ?? "这条帖子",
    bookTitle: post.bookTitle,
  };
  const spoken = (npcId: string) => post.comments.filter((comment) => comment.authorId === npcId).length;
  // 多挑几位候选，再排除：已在排队的、说够了的、楼主自己
  const candidates = pickParticipants(state, topic, count + 4).filter(
    (npc) =>
      npc.id !== post.authorId &&
      spoken(npc.id) < MAX_COMMENTS_PER_NPC &&
      !pendingOnPost.some((item) => item.npcId === npc.id),
  );
  const participants = candidates.slice(0, count);
  const now = Date.now();
  const planned: PendingReply[] = [];
  participants.forEach((npc, index) => {
    // 用户主动请回应时几秒内开始；自动回应在 20–110 秒内错开出现，避免刷出一排
    const delay = options.soon
      ? 1_500 + index * 6_000
      : 20_000 + index * 18_000 + Math.random() * 22_000;
    planned.push({
      id: `pr_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`,
      postId,
      npcId: npc.id,
      dueAt: new Date(now + delay).toISOString(),
    });
  });
  if (planned.length === 0) return state;
  return { ...state, pendingReplies: [...state.pendingReplies, ...planned] };
}

/**
 * 请书友回复某一条评论（用户主动点「请书友回复这条」，或用户回复了某位书友）。
 * 被回复的是书友且还能说话，就由 TA 接话；否则挑一位合适的书友。
 * 上限与去重照旧：同一条评论已经有人在排队就不再安排，避免来回循环。
 */
export function scheduleCommentReply(
  state: ForumState,
  postId: string,
  commentId: string,
  options: { soon?: boolean } = {},
): { state: ForumState; npcId: string | null; reason?: string } {
  const post = state.posts.find((item) => item.id === postId);
  const target = post?.comments.find((item) => item.id === commentId);
  if (!post || !target) return { state, npcId: null, reason: "这条评论已经不在了" };
  const npcCommentCount = post.comments.filter((comment) => comment.authorKind === "npc").length;
  const pendingOnPost = state.pendingReplies.filter((item) => item.postId === postId);
  if (MAX_NPC_COMMENTS_PER_POST - npcCommentCount - pendingOnPost.length <= 0) {
    return { state, npcId: null, reason: "这条帖子里书友已经聊得够多了" };
  }
  if (pendingOnPost.some((item) => item.replyToId === commentId)) {
    return { state, npcId: null, reason: "已经有书友准备回这条了" };
  }
  const spoken = (npcId: string) => post.comments.filter((comment) => comment.authorId === npcId).length;
  const usable = (npc: ForumNpc) =>
    !state.mutedNpcIds.includes(npc.id) &&
    spoken(npc.id) < MAX_COMMENTS_PER_NPC + 1 &&
    !pendingOnPost.some((item) => item.npcId === npc.id);

  let npc: ForumNpc | undefined;
  // 用户回复了某位书友：由那位书友接话；其余情况挑一位别的书友（书友不接自己的话）
  if (target.authorKind === "user" && target.replyToId) {
    const parent = post.comments.find((item) => item.id === target.replyToId);
    const author = parent?.authorKind === "npc" ? state.npcs.find((item) => item.id === parent.authorId) : undefined;
    if (author && usable(author)) npc = author;
  }
  if (!npc) {
    const topic: ForumTopic = {
      key: post.topics?.[0] ?? post.bookTitle ?? post.title ?? "帖子",
      label: post.title ?? post.bookTitle ?? "这条帖子",
      bookTitle: post.bookTitle,
    };
    npc = pickParticipants(state, topic, 6).find((item) => item.id !== target.authorId && usable(item));
  }
  if (!npc) return { state, npcId: null, reason: "暂时没有能接话的书友" };
  const delay = options.soon === false ? 20_000 + Math.random() * 30_000 : 1_500;
  const reply: PendingReply = {
    id: `pr_${Date.now()}_c_${Math.random().toString(36).slice(2, 5)}`,
    postId,
    npcId: npc.id,
    dueAt: new Date(Date.now() + delay).toISOString(),
    replyToId: commentId,
  };
  return { state: { ...state, pendingReplies: [...state.pendingReplies, reply] }, npcId: npc.id };
}

export function dueReplies(state: ForumState, now = Date.now()): PendingReply[] {
  return state.pendingReplies.filter((item) => new Date(item.dueAt).getTime() <= now);
}

export function consumeReply(state: ForumState, replyId: string): ForumState {
  return { ...state, pendingReplies: state.pendingReplies.filter((item) => item.id !== replyId) };
}

/** 停止某条帖子剩下的回应（用户点了「停止」）。 */
export function clearPostReplies(state: ForumState, postId: string): ForumState {
  return { ...state, pendingReplies: state.pendingReplies.filter((item) => item.postId !== postId) };
}

/** 屏蔽书友：不再出现在信息流，也不再来回复；已经排队的回应一并取消。 */
export function blockNpc(state: ForumState, npcId: string): ForumState {
  return {
    ...state,
    mutedNpcIds: state.mutedNpcIds.includes(npcId) ? state.mutedNpcIds : [...state.mutedNpcIds, npcId],
    following: state.following.filter((id) => id !== npcId),
    starred: state.starred.filter((id) => id !== npcId),
    pendingReplies: state.pendingReplies.filter((item) => item.npcId !== npcId),
  };
}

/** 删除自己的评论（只删用户本人写的，书友的评论不能删）。 */
export function deleteOwnComment(state: ForumState, postId: string, commentId: string): ForumState {
  return {
    ...state,
    posts: state.posts.map((post) =>
      post.id === postId
        ? { ...post, comments: post.comments.filter((comment) => !(comment.id === commentId && comment.authorId === USER_ID)) }
        : post,
    ),
  };
}

/** 去重用的比较形式：去标点空白、小写。 */
function commentKey(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

/** 新评论是否和这条帖子里已有的评论重复（同样的话，或同一人几乎一样的话）。 */
export function isDuplicateComment(post: ForumPost, npcId: string, body: string): boolean {
  const key = commentKey(body);
  if (!key) return true;
  return post.comments.some((comment) => {
    const other = commentKey(comment.body);
    if (other === key) return true;
    if (comment.authorId !== npcId) return false;
    // 同一位书友：一句包含另一句且长度相近，视为复读
    const shorter = Math.min(other.length, key.length);
    const longer = Math.max(other.length, key.length);
    return shorter > 0 && shorter / longer > 0.8 && (other.includes(key) || key.includes(other));
  });
}

export function cleanComment(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (!text) return null;
  // 模型偶尔会把昵称加在前面，去掉
  return text.replace(/^[一-龥A-Za-z0-9_]{1,12}[：:]\s*/, "").slice(0, 300);
}

/** 生成结果分开说清楚：成功 / 没配 API / 调用失败（失败要能重试，不能悄悄吞掉）。 */
export type CommentResult =
  | { status: "ok"; body: string; spoiler: boolean }
  | { status: "no-api" }
  | { status: "error"; message: string };

export async function generateComment(
  post: ForumPost,
  npc: ForumNpc,
  rules: ForumRules,
  signal?: AbortSignal,
  target?: ForumComment,
  /** 用户的显示名，只写进提示词让书友知道「楼主是 TA」；不传就不提。 */
  meName?: string,
): Promise<CommentResult> {
  const apiConfig = resolveForumApiConfig();
  if (!apiConfig) return { status: "no-api" };
  const background = npcHiddenContext(npc);
  const messages = forumMessagesFor(
    apiConfig,
    buildForumCommentMessages({ post, npc, rules, target, meName, background }),
  );
  const startedAt = Date.now();
  // 用户的「停止」+ 单条评论的总时长上限
  const deadline = forumDeadline(signal, FORUM_COMMENT_TIMEOUT_MS);
  const timeoutMessage = `等了 ${Math.round(FORUM_COMMENT_TIMEOUT_MS / 1000)} 秒还没回上来，已停止，可以重试`;
  let result: Awaited<ReturnType<typeof simpleLLMCall>>;
  try {
    result = await simpleLLMCall(apiConfig, messages, {
      temperature: 0.9,
      max_tokens: 400,
      signal: deadline.signal,
      label: "studyroom-forum-comment",
    });
  } catch (error) {
    if (deadline.timedOut()) return { status: "error", message: timeoutMessage };
    throw error;
  } finally {
    deadline.done();
  }
  if (deadline.timedOut()) return { status: "error", message: timeoutMessage };
  logForumRequest(
    forumRequestMeta(messages, target ? "comment-reply" : "comment", {
      npcCount: 1,
      backgroundCount: background ? 1 : 0,
      ruleFields: forumRuleFields(rules),
      elapsedMs: Date.now() - startedAt,
    }),
  );
  if (result.error) return { status: "error", message: result.error };
  const raw = result.content ? cleanComment(result.content) : null;
  if (!raw) return { status: "error", message: "模型返回了空内容" };
  // 模型按要求在开头加「[剧透]」：去掉标记，改成评论上的剧透开关
  const flagged = /^\s*[[【(（]\s*剧透\s*[\]】)）]\s*/.exec(raw);
  const body = flagged ? raw.slice(flagged[0].length).trim() : raw;
  if (!body) return { status: "error", message: "模型返回了空内容" };
  return { status: "ok", body, spoiler: !!flagged };
}

export function makeComment(npc: ForumNpc, body: string, replyToId?: string, spoiler?: boolean): ForumComment {
  return {
    id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    authorId: npc.id,
    authorName: npc.nickname,
    authorKind: "npc",
    body,
    replyToId,
    ...(spoiler ? { spoiler: true } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * 把一条待回复变成真正的评论：同时按生成规则里「NPC 日常活动」的节奏，
 * 顺带产生赞同 / 关注 / 好友申请（都是真实状态，刷新后仍在）。
 */
export function applyComment(state: ForumState, reply: PendingReply, body: string, spoiler = false): ForumState {
  const npc = state.npcs.find((item) => item.id === reply.npcId);
  const post = state.posts.find((item) => item.id === reply.postId);
  if (!npc || !post) return consumeReply(state, reply.id);
  // 重复的话、屏蔽后的书友：这条直接作废，不进评论区
  if (state.mutedNpcIds.includes(npc.id) || isDuplicateComment(post, npc.id, body)) return consumeReply(state, reply.id);

  let next: ForumState = {
    ...state,
    posts: state.posts.map((item) =>
      item.id === post.id ? { ...item, comments: [...item.comments, makeComment(npc, body, reply.replyToId, spoiler)] } : item,
    ),
  };

  // 书友回了用户的评论（不在用户自己的帖子里）：也通知一声
  const target = reply.replyToId ? post.comments.find((item) => item.id === reply.replyToId) : undefined;
  if (target?.authorId === USER_ID && post.authorId !== USER_ID) {
    next = pushNotification(next, {
      kind: "comment",
      fromId: npc.id,
      fromName: npc.nickname,
      postId: post.id,
      text: spoiler ? "回复含剧透，进书友圈后点开查看" : body.slice(0, 60),
    });
  }

  if (post.authorId === USER_ID) {
    next = pushNotification(next, {
      kind: "comment",
      fromId: npc.id,
      fromName: npc.nickname,
      postId: post.id,
      text: spoiler ? "回复含剧透，进书友圈后点开查看" : body.slice(0, 60),
    });

    // 按规则里的节奏顺带点赞
    if (state.rules.dailyLikes > 0 && Math.random() < Math.min(state.rules.dailyLikes / 12, 0.8)) {
      const target = next.posts.find((item) => item.id === post.id);
      if (target && !target.likedBy.includes(npc.id)) {
        next = {
          ...next,
          posts: next.posts.map((item) =>
            item.id === post.id ? { ...item, likedBy: [...item.likedBy, npc.id] } : item,
          ),
        };
      }
    }

    // 顺带关注（只记真实关注关系与通知）
    if (state.rules.dailyFollows > 0 && Math.random() < 0.25 && !state.following.includes(npc.id)) {
      next = { ...next, npcs: next.npcs.map((item) => (item.id === npc.id ? { ...item, followers: Array.from(new Set([...(item.followers ?? []), USER_ID])) } : item)) };
      next = pushNotification(next, { kind: "follow", fromId: npc.id, fromName: npc.nickname });
    }

    // 顺带发一条好友申请（对方还没有成为好友时）
    if (state.rules.dailyFriends > 0 && !npc.characterId && Math.random() < 0.15) {
      next = pushNotification(next, { kind: "friend", fromId: npc.id, fromName: npc.nickname });
    }
  }

  return consumeReply(next, reply.id);
}

// ── 搜索：帖子 / 书友 / 书籍 / 话题 ──

export type ForumSearchResult = {
  posts: ForumPost[];
  npcs: ForumNpc[];
  books: string[];
  topics: string[];
};

export function searchForum(state: ForumState, query: string): ForumSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { posts: [], npcs: [], books: [], topics: [] };
  const hit = (text: string | undefined) => (text ?? "").toLowerCase().includes(q);
  const posts = state.posts.filter(
    (post) => hit(post.title) || hit(post.body) || hit(post.bookTitle) || (post.topics ?? []).some(hit),
  );
  const npcs = state.npcs.filter(
    (npc) => hit(npc.nickname) || hit(npc.occupation) || hit(npc.readingTaste) || npc.interests.some(hit),
  );
  const books = Array.from(
    new Set(
      state.posts
        .map((post) => post.bookTitle)
        .filter((title): title is string => Boolean(title) && hit(title)),
    ),
  );
  const topics = Array.from(new Set(state.posts.flatMap((post) => post.topics ?? []).filter(hit)));
  return { posts, npcs, books, topics };
}

export function parseDraftField(text: string): string[] {
  return text
    .split(/[、,，\s]+/)
    .map((item) => item.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

// ── 热门：只按本机真实帖子计算，没有就如实为空 ──

export type ForumHotBook = { title: string; posts: number; people: number };
export type ForumHotTopic = { topic: string; posts: number };

/** 大家在聊的书：按关联这本书的可见帖子数排，参与人数 = 发帖人 + 评论人（去重） */
export function forumHotBooks(state: ForumState, limit = 5): ForumHotBook[] {
  const map = new Map<string, { posts: number; people: Set<string>; heat: number }>();
  for (const post of channelPosts(state, "recommend")) {
    const title = post.bookTitle?.trim();
    if (!title) continue;
    const entry = map.get(title) ?? { posts: 0, people: new Set<string>(), heat: 0 };
    entry.posts += 1;
    entry.people.add(post.authorId);
    for (const comment of post.comments) entry.people.add(comment.authorId);
    entry.heat += post.likedBy.length * 2 + post.comments.length;
    map.set(title, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].posts - a[1].posts || b[1].heat - a[1].heat)
    .slice(0, limit)
    .map(([title, entry]) => ({ title, posts: entry.posts, people: entry.people.size }));
}

/** 热门话题：只统计不含剧透的帖子，避免话题名本身泄露剧情 */
export function forumHotTopics(state: ForumState, limit = 6): ForumHotTopic[] {
  const map = new Map<string, number>();
  for (const post of channelPosts(state, "recommend")) {
    if (post.spoiler) continue;
    for (const raw of post.topics ?? []) {
      const topic = raw.replace(/^#/, "").trim();
      if (topic) map.set(topic, (map.get(topic) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, posts]) => ({ topic, posts }));
}
