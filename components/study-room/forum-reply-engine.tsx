"use client";

// 书友回应引擎：书友圈与「我的主页」帖子浮层共用同一套点赞、评论、书友回应逻辑。
// 一次只跑一个请求，过程可见、可停止；失败的那条留给重试；没配模型就暂停（排队的回应保留）。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, MessageSquare, RotateCw, Square } from "lucide-react";

import { loadUserIdentities } from "@/lib/settings-storage";
import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import { addComment, findCharacterIdOf, loadForum, resolveForumApiConfig, toggleLike, type ForumPost, type ForumState, type PendingReply } from "@/lib/study-room/forum";
import { recordStudyRoomForumEvent } from "@/lib/study-room/forum-memory";
import {
  applyComment,
  clearPostReplies,
  consumeReply,
  dueReplies,
  generateComment,
  normalizeRules,
  pushNotification,
  scheduleCommentReply,
  scheduleReplies,
  type CommentResult,
} from "@/lib/study-room/forum-social";
import { PROFILE_UPDATED_EVENT, displayName, loadProfile, profileAvatarSrc } from "@/lib/study-room/profile";

const ME = "user";
/** 停留在这些页面时多久看一次排队的回应（离开就不再生成，回来后接着来）。 */
const REPLY_TICK_MS = 8_000;

/** 书友回应出的问题：没配模型（排队的回应保留），或某一条生成失败（可重试）。 */
export type ReplyIssue =
  | { kind: "no-api" }
  | { kind: "error"; postId: string; npcName: string; message: string; reply: PendingReply };

export function openApiSettings() {
  // 复用宿主的设置应用，直接打开「API 设置」页
  window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "settings", settingsPage: "api" } }));
}

export function shortError(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "未知原因";
}

/** 用户在书房里的名字与头像：与「我的主页」同一份资料（跟随宿主时只读宿主身份，不回写）。 */
export function useMeCard(): { name: string; avatar: string } {
  const read = () => {
    const identity = loadUserIdentities()[0];
    const profile = loadProfile();
    return {
      name: displayName(profile, identity?.name ?? null),
      avatar: profileAvatarSrc(profile, identity?.avatarUrl ?? null, avatarDataUrl(profile.avatar)),
    };
  };
  const [card, setCard] = useState(read);
  useEffect(() => {
    const refresh = () => setCard(read());
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, refresh);
  }, []);
  return card;
}

export function useForumReplyEngine({
  state,
  mutate,
  flash,
  meName,
  where = "书友圈",
}: {
  state: ForumState;
  mutate: (updater: (prev: ForumState) => ForumState) => void;
  flash: (message: string, ms?: number) => void;
  meName: string;
  /** 用在提示里：回应只在停留于此处时生成 */
  where?: string;
}) {
  /** 正在「打字」的书友：真实的进行中请求，停止即中断 */
  const [typing, setTyping] = useState<{ postId: string; npcName: string; replyToId?: string } | null>(null);
  const [replyIssue, setReplyIssue] = useState<ReplyIssue | null>(null);
  const replyAbortRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);

  const processDueReplies = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      for (let round = 0; round < 2; round += 1) {
        const current = loadForum();
        const reply = dueReplies(current)[0];
        if (!reply) return;
        const post = current.posts.find((item) => item.id === reply.postId);
        const npc = current.npcs.find((item) => item.id === reply.npcId);
        if (!post || !npc || current.mutedNpcIds.includes(npc.id)) {
          mutate((prev) => consumeReply(prev, reply.id));
          continue;
        }
        if (!resolveForumApiConfig()) {
          setReplyIssue({ kind: "no-api" });
          return;
        }
        const target = reply.replyToId ? post.comments.find((item) => item.id === reply.replyToId) : undefined;
        const controller = new AbortController();
        replyAbortRef.current = controller;
        setTyping({ postId: post.id, npcName: npc.nickname, replyToId: reply.replyToId });
        let result: CommentResult;
        try {
          result = await generateComment(post, npc, normalizeRules(current.rules), controller.signal, target, meName);
        } catch (error) {
          result = { status: "error", message: error instanceof Error ? error.message : String(error) };
        } finally {
          setTyping(null);
          if (replyAbortRef.current === controller) replyAbortRef.current = null;
        }
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          const { body, spoiler } = result;
          mutate((prev) => applyComment(prev, reply, body, spoiler));
          // G15「书房点评—角色记忆」：这位书友关联真实角色时，把这次回帖写进角色的
          // 记忆投影；生成失败不记，未关联角色的普通书友不记。
          const characterId = findCharacterIdOf(npc);
          if (characterId) {
            recordStudyRoomForumEvent({
              characterId,
              replyId: reply.id,
              postId: post.id,
              postKind: post.kind,
              postTitle: post.title || post.bookTitle || "",
              npcId: npc.id,
              npcName: npc.nickname,
              replyText: body,
            });
          }
          setReplyIssue((issue) => (issue?.kind === "no-api" ? null : issue));
        } else if (result.status === "no-api") {
          setReplyIssue({ kind: "no-api" });
          return;
        } else {
          // 失败的这条先移出队列（避免一直重复失败），保留下来给用户手动重试
          mutate((prev) => consumeReply(prev, reply.id));
          setReplyIssue({ kind: "error", postId: post.id, npcName: npc.nickname, message: shortError(result.message), reply });
          return;
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [mutate]);

  useEffect(() => {
    const timer = window.setInterval(() => void processDueReplies(), REPLY_TICK_MS);
    const initial = window.setTimeout(() => void processDueReplies(), 2500);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [processDueReplies]);

  // 离开页面：进行中的请求中断（排队的回应留着，回来后接着生成）
  useEffect(() => () => replyAbortRef.current?.abort(), []);

  /** 停止某条帖子的回应：中断正在输入的那位，并取消剩下排队的。 */
  const stopReplies = (postId: string) => {
    if (typing?.postId === postId) replyAbortRef.current?.abort();
    setTyping((value) => (value?.postId === postId ? null : value));
    mutate((prev) => clearPostReplies(prev, postId));
    flash("已停止，这条帖子剩下的回应不再生成");
  };

  const retryReply = () => {
    if (replyIssue?.kind !== "error") return;
    const reply: PendingReply = { ...replyIssue.reply, dueAt: new Date().toISOString() };
    mutate((prev) => ({
      ...prev,
      pendingReplies: [...prev.pendingReplies.filter((item) => item.id !== reply.id), reply],
    }));
    setReplyIssue(null);
    window.setTimeout(() => void processDueReplies(), 300);
  };

  /** 「生成评论」：用户主动请书友评论（不受自动回复开关影响，人数与上限照旧）。 */
  const requestReplies = (postId: string) => {
    if (!resolveForumApiConfig()) {
      setReplyIssue({ kind: "no-api" });
      return;
    }
    const before = loadForum();
    const planned = scheduleReplies(before, postId, { manual: true, soon: true });
    if (planned.pendingReplies.length === before.pendingReplies.length) {
      flash("这条帖子里书友已经聊得够多了，换一条试试");
      return;
    }
    mutate((prev) => scheduleReplies(prev, postId, { manual: true, soon: true }));
    window.setTimeout(() => void processDueReplies(), 1800);
  };

  /** 「请书友回复这条」：针对某一条评论生成回复。 */
  const requestCommentReply = (postId: string, commentId: string) => {
    if (!resolveForumApiConfig()) {
      setReplyIssue({ kind: "no-api" });
      return;
    }
    const result = scheduleCommentReply(loadForum(), postId, commentId);
    if (!result.npcId) {
      flash(result.reason ?? "暂时没有能接话的书友");
      return;
    }
    mutate((prev) => scheduleCommentReply(prev, postId, commentId).state);
    window.setTimeout(() => void processDueReplies(), 1200);
  };

  /** 发帖或评论后：按「自动回复」设置安排书友回应，并如实说明什么时候会出现。 */
  const afterUserActivity = (postId: string, done: string, commentId?: string) => {
    const current = loadForum();
    if (current.rules.autoReply === false) {
      flash(`${done}。自动回复已关闭，想听书友说什么可以点「生成评论」`, 3600);
      return;
    }
    if (!resolveForumApiConfig()) {
      setReplyIssue({ kind: "no-api" });
      flash(done);
      return;
    }
    if (commentId) {
      // 回复了某位书友：由 TA 接话；不是回复书友时按人数安排
      const comment = current.posts.find((item) => item.id === postId)?.comments.find((item) => item.id === commentId);
      if (comment?.replyToId) {
        mutate((prev) => {
          const result = scheduleCommentReply(prev, postId, commentId, { soon: false });
          return result.npcId ? result.state : scheduleReplies(prev, postId);
        });
        flash(`${done}。停留在${where}时，书友会接着回；离开后暂停`, 3600);
        return;
      }
    }
    mutate((prev) => scheduleReplies(prev, postId));
    flash(`${done}。停留在${where}时，书友会陆续回应；离开后暂停，回来接着来`, 3600);
  };

  const like = (post: ForumPost) => {
    const liked = post.likedBy.includes(ME);
    mutate((prev) => toggleLike(prev, post.id, ME));
    if (!liked && post.authorId !== ME) {
      mutate((prev) =>
        pushNotification(prev, {
          kind: "like",
          fromId: post.authorId,
          fromName: post.authorName,
          postId: post.id,
        }),
      );
    }
  };

  const comment = (post: ForumPost, body: string, replyToId?: string, spoiler?: boolean) => {
    const text = body.trim();
    if (!text) return;
    const id = `fc_user_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    mutate((prev) =>
      addComment(prev, post.id, {
        id,
        authorId: ME,
        authorName: meName,
        authorKind: "user",
        body: text,
        replyToId,
        ...(spoiler ? { spoiler: true } : {}),
        createdAt: new Date().toISOString(),
      }),
    );
    afterUserActivity(post.id, replyToId ? "已回复" : "已评论", id);
  };

  /** 没配模型时的提示：如实说明，并给出去设置的入口。 */
  const noApiCard =
    replyIssue?.kind === "no-api" ? (
      <div className="sr-note-card" role="status">
        <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>
          还没有配置模型 API，书友暂时没法发帖和回应。配置好后回到这里，排队的回应会接着出现。
        </div>
        <div className="sr-css-actions">
          <button type="button" className="sr-btn-text" onClick={() => setReplyIssue(null)}>
            知道了
          </button>
          <button type="button" className="sr-btn sr-btn-sm sr-btn-primary" onClick={openApiSettings}>
            去设置模型
          </button>
        </div>
      </div>
    ) : null;

  /** 帖子详情里的书友回应状态：正在输入 / 排队中 / 失败重试 / 生成评论 + 自动回复开关。 */
  const renderReplyPanel = (postId: string): ReactNode => {
    const queued = state.pendingReplies.filter((item) => item.postId === postId).length;
    const typingHere = typing?.postId === postId ? typing : null;
    const failed = replyIssue?.kind === "error" && replyIssue.postId === postId ? replyIssue : null;
    const autoReply = state.rules.autoReply !== false;
    return (
      <div className="sr-forum-reply-panel">
        {noApiCard}
        {failed && (
          <div className="sr-note-card" role="alert">
            <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>
              {failed.npcName} 没回上来：{failed.message}
            </div>
            <div className="sr-css-actions">
              <button type="button" className="sr-btn-text" onClick={() => setReplyIssue(null)}>
                算了
              </button>
              <button type="button" className="sr-btn sr-btn-sm sr-btn-primary" onClick={retryReply}>
                <RotateCw size={13} strokeWidth={1.8} />
                重试
              </button>
            </div>
          </div>
        )}
        <div className="sr-forum-reply-row">
          {typingHere || queued > 0 ? (
            <>
              <span className="sr-forum-reply-status" role="status">
                {typingHere ? (
                  <>
                    <Loader2 size={13} className="sr-spin" aria-hidden /> {typingHere.npcName} 正在输入…
                  </>
                ) : (
                  `还有 ${queued} 位书友准备回应`
                )}
              </span>
              <button type="button" className="sr-btn sr-btn-sm" onClick={() => stopReplies(postId)}>
                <Square size={12} strokeWidth={1.8} />
                停止
              </button>
            </>
          ) : (
            <button type="button" className="sr-btn sr-btn-sm" onClick={() => requestReplies(postId)} disabled={Boolean(failed)}>
              <MessageSquare size={13} strokeWidth={1.8} />
              生成评论
            </button>
          )}
          <label className="sr-forum-auto">
            <span>自动回复</span>
            <input
              type="checkbox"
              role="switch"
              className="sr-switch"
              checked={autoReply}
              onChange={(event) => {
                const on = event.target.checked;
                mutate((prev) => ({ ...prev, rules: { ...prev.rules, autoReply: on } }));
                flash(on ? "已打开自动回复：你发言后书友会陆续回应" : "已关闭自动回复：需要时点「生成评论」");
              }}
            />
          </label>
        </div>
      </div>
    );
  };

  /** 某条评论是否已经有书友在排队 / 正在回复 */
  const commentPending = useMemo(() => {
    const set = new Set<string>();
    for (const item of state.pendingReplies) if (item.replyToId) set.add(item.replyToId);
    if (typing?.replyToId) set.add(typing.replyToId);
    return set;
  }, [state.pendingReplies, typing]);

  return {
    typing,
    replyIssue,
    setReplyIssue,
    processDueReplies,
    stopReplies,
    retryReply,
    requestReplies,
    requestCommentReply,
    afterUserActivity,
    like,
    comment,
    noApiCard,
    renderReplyPanel,
    commentPending,
  };
}
