"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Heart,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  PenLine,
  Settings2,
  Star,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import type { ForumState } from "@/lib/study-room/forum";
import { deleteDraft, markNotificationsRead } from "@/lib/study-room/forum-social";
import { displayName, loadProfile } from "@/lib/study-room/profile";
import { loadUserIdentities } from "@/lib/settings-storage";
import { SPOILER_SUMMARY } from "./spoiler";

type StudyRoomForumDrawerProps = {
  state: ForumState;
  unread: ForumState["notifications"];
  onClose: () => void;
  onMutate: (updater: (prev: ForumState) => ForumState) => void;
  onOpenCompose: (draftId?: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenMine: () => void;
  onOpenSettings: () => void;
  /** 私信：打开宿主的聊天应用 */
  onOpenChat: () => void;
  /** 打开某位书友的主页 */
  onOpenProfile: (npcId: string) => void;
};

type Section = "mine" | "drafts" | "comments" | "likes" | "friends" | "following";

const ME = "user";

/**
 * 点头像打开的左侧菜单（不做屏幕边缘滑动，避免和手机的返回手势打架）。
 * 分四组：书友（主页、关注、好友申请）/ 内容（帖子、草稿）/ 互动（评论、获赞、私信）/ 设置。
 * 纯白底，分组块 + 统一图标块；未读数用蓝色小圆点数字，其余只显示总数。
 */
export function StudyRoomForumDrawer({
  state,
  unread,
  onClose,
  onMutate,
  onOpenCompose,
  onOpenPost,
  onOpenMine,
  onOpenSettings,
  onOpenChat,
  onOpenProfile,
}: StudyRoomForumDrawerProps) {
  const [open, setOpen] = useState<Section | null>(null);
  const me = useMemo(() => {
    const profile = loadProfile();
    const identity = loadUserIdentities()[0];
    return {
      name: displayName(profile, identity?.name),
      avatar: profile.useHostAvatar && identity?.avatarUrl ? identity.avatarUrl : avatarDataUrl(profile.avatar),
      status: profile.status.trim(),
    };
  }, []);

  const myPosts = state.posts.filter((post) => post.authorId === ME);
  const myComments = state.posts.flatMap((post) =>
    post.comments.filter((comment) => comment.authorId === ME).map((comment) => ({ comment, post })),
  );
  const likedNotices = unread.filter((item) => item.kind === "like" || item.kind === "mention");
  const friendRequests = unread.filter((item) => item.kind === "friend");
  const commentNotices = unread.filter((item) => item.kind === "comment" || item.kind === "reply");
  // 特别关注排在前面
  const followedNpcs = state.npcs
    .filter((npc) => state.following.includes(npc.id))
    .sort((a, b) => Number(state.starred.includes(b.id)) - Number(state.starred.includes(a.id)));

  const toggle = (section: Section) => {
    setOpen((current) => (current === section ? null : section));
    if (section === "comments" || section === "likes") {
      onMutate((prev) => markNotificationsRead(prev, ["comment", "reply", "like", "mention"]));
    }
    if (section === "friends") {
      onMutate((prev) => markNotificationsRead(prev, ["friend"]));
    }
  };

  const glyph = (Icon: typeof Users) => (
    <span className="sr-drawer-glyph" aria-hidden>
      <Icon size={16} strokeWidth={1.7} />
    </span>
  );

  const row = (section: Section, label: string, count: number, Icon: typeof Users, unreadCount = 0) => (
    <button
      type="button"
      className="sr-drawer-row"
      onClick={() => toggle(section)}
      aria-expanded={open === section}
      data-open={open === section ? "true" : undefined}
    >
      {glyph(Icon)}
      <span className="sr-drawer-label">{label}</span>
      {unreadCount > 0 ? (
        <span className="sr-drawer-badge" aria-label={`${unreadCount} 条新消息`}>{unreadCount}</span>
      ) : (
        count > 0 && <span className="sr-drawer-count">{count}</span>
      )}
      <ChevronDown size={15} strokeWidth={1.8} className="sr-drawer-caret" data-open={open === section ? "true" : undefined} />
    </button>
  );

  const link = (label: string, Icon: typeof Users, onClick: () => void) => (
    <button type="button" className="sr-drawer-row" onClick={onClick}>
      {glyph(Icon)}
      <span className="sr-drawer-label">{label}</span>
      <ChevronRight size={15} strokeWidth={1.8} className="sr-drawer-caret" />
    </button>
  );

  return (
    <div className="sr-drawer-mask" onClick={onClose}>
      <aside className="sr-drawer" onClick={(event) => event.stopPropagation()} aria-label="个人菜单">
        <header className="sr-drawer-head">
          <div className="sr-drawer-me">
            <span className="sr-drawer-me-avatar" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={me.avatar} alt="" />
            </span>
            <span className="sr-drawer-me-main">
              <span className="sr-drawer-me-name">{me.name}</span>
              {me.status && <span className="sr-drawer-me-status">{me.status}</span>}
            </span>
            <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭菜单">
              <X size={18} strokeWidth={1.7} />
            </button>
          </div>
          <dl className="sr-drawer-stats">
            <div>
              <dt>帖子</dt>
              <dd>{myPosts.length}</dd>
            </div>
            <div>
              <dt>评论</dt>
              <dd>{myComments.length}</dd>
            </div>
            <div>
              <dt>关注</dt>
              <dd>{followedNpcs.length}</dd>
            </div>
          </dl>
        </header>

        <div className="sr-drawer-body">
          <div className="sr-drawer-group-label">书友</div>
          <div className="sr-drawer-group">
            {link("我的主页", UserRound, onOpenMine)}

            {row("following", "关注的书友", followedNpcs.length, Users)}
            {open === "following" && (
              <div className="sr-drawer-panel">
                {followedNpcs.length === 0 ? (
                  <p className="sr-drawer-empty">还没有关注谁。</p>
                ) : (
                  followedNpcs.map((npc) => (
                    <button key={npc.id} type="button" className="sr-drawer-item sr-drawer-item--person" onClick={() => onOpenProfile(npc.id)}>
                      <span className="sr-drawer-avatar" aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={npc.avatarUrl ?? avatarDataUrl(npc.avatar)} alt="" />
                      </span>
                      <span className="sr-drawer-item-text">{npc.nickname}</span>
                      {state.starred.includes(npc.id) && <Star size={13} strokeWidth={1.8} className="sr-pf-star" aria-label="特别关注" />}
                    </button>
                  ))
                )}
              </div>
            )}

            {row("friends", "好友申请", 0, UserPlus, friendRequests.length)}
            {open === "friends" && (
              <div className="sr-drawer-panel">
                {friendRequests.length === 0 ? (
                  <p className="sr-drawer-empty">没有待处理的好友申请。</p>
                ) : (
                  friendRequests.map((notice) => (
                    <span key={notice.id} className="sr-drawer-item sr-drawer-item--row">
                      <span className="sr-drawer-item-text">{notice.fromName} 想加你为好友</span>
                      <button type="button" className="sr-btn" onClick={onOpenSettings}>
                        去确认
                      </button>
                    </span>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="sr-drawer-group-label">内容</div>
          <div className="sr-drawer-group">
            {row("mine", "我的帖子", myPosts.length, NotebookPen)}
            {open === "mine" && (
              <div className="sr-drawer-panel">
                {myPosts.length === 0 ? (
                  <p className="sr-drawer-empty">还没发过帖子。</p>
                ) : (
                  myPosts.map((post) => (
                    <button key={post.id} type="button" className="sr-drawer-item" onClick={() => onOpenPost(post.id)}>
                      <span className="sr-drawer-item-text">{post.spoiler ? SPOILER_SUMMARY : post.title || post.body.slice(0, 22)}</span>
                      <ChevronRight size={14} strokeWidth={1.8} />
                    </button>
                  ))
                )}
              </div>
            )}

            {row("drafts", "草稿箱", state.drafts.length, PenLine)}
            {open === "drafts" && (
              <div className="sr-drawer-panel">
                {state.drafts.length === 0 ? (
                  <p className="sr-drawer-empty">没有草稿。</p>
                ) : (
                  state.drafts.map((draft) => (
                    <span key={draft.id} className="sr-drawer-item sr-drawer-item--row">
                      <button type="button" className="sr-drawer-item-text" onClick={() => onOpenCompose(draft.id)}>
                        {draft.title || draft.body.slice(0, 20) || "未命名草稿"}
                      </button>
                      <button
                        type="button"
                        className="sr-note-tool"
                        aria-label="删除草稿"
                        onClick={() => onMutate((prev) => deleteDraft(prev, draft.id))}
                      >
                        <X size={14} strokeWidth={1.8} />
                      </button>
                    </span>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="sr-drawer-group-label">互动</div>
          <div className="sr-drawer-group">
            {row("comments", "评论与回复", myComments.length, MessageSquare, commentNotices.length)}
            {open === "comments" && (
              <div className="sr-drawer-panel">
                {myComments.length === 0 ? (
                  <p className="sr-drawer-empty">还没有评论。</p>
                ) : (
                  myComments.slice(0, 12).map(({ comment, post }) => (
                    <button key={comment.id} type="button" className="sr-drawer-item" onClick={() => onOpenPost(post.id)}>
                      <span className="sr-drawer-item-text">{comment.spoiler ? SPOILER_SUMMARY : comment.body.slice(0, 24)}</span>
                      <ChevronRight size={14} strokeWidth={1.8} />
                    </button>
                  ))
                )}
              </div>
            )}

            {row("likes", "获赞与提及", 0, Heart, likedNotices.length)}
            {open === "likes" && (
              <div className="sr-drawer-panel">
                {likedNotices.length === 0 ? (
                  <p className="sr-drawer-empty">还没有新的赞或提及。</p>
                ) : (
                  likedNotices.slice(0, 12).map((notice) => (
                    <button
                      key={notice.id}
                      type="button"
                      className="sr-drawer-item"
                      onClick={() => notice.postId && onOpenPost(notice.postId)}
                    >
                      <span className="sr-drawer-item-text">
                        {notice.fromName}
                        {notice.kind === "like" ? " 赞同了你的帖子" : " 提到了你"}
                      </span>
                      <ChevronRight size={14} strokeWidth={1.8} />
                    </button>
                  ))
                )}
              </div>
            )}

            {link("私信", MessagesSquare, onOpenChat)}
          </div>

          <div className="sr-drawer-group-label">设置</div>
          <div className="sr-drawer-group">{link("论坛设置", Settings2, onOpenSettings)}</div>

          {/* 底部小插画：贴底，让侧栏下半段不空落 */}
          <div className="sr-drawer-art" aria-hidden>
            <svg viewBox="0 0 120 44" role="img">
              <rect x="6" y="30" width="108" height="4" rx="2" fill="currentColor" opacity="0.25" />
              <rect x="14" y="12" width="9" height="18" rx="2" fill="currentColor" opacity="0.35" />
              <rect x="25" y="8" width="11" height="22" rx="2" fill="currentColor" opacity="0.28" />
              <rect x="38" y="14" width="8" height="16" rx="2" fill="currentColor" opacity="0.32" />
              <rect x="48" y="10" width="12" height="20" rx="2" fill="currentColor" opacity="0.26" />
              <rect x="62" y="16" width="9" height="14" rx="2" fill="currentColor" opacity="0.3" />
              <path d="M78 30 q10 -14 22 -2 v2 z" fill="currentColor" opacity="0.22" />
            </svg>
          </div>
        </div>
      </aside>
    </div>
  );
}
