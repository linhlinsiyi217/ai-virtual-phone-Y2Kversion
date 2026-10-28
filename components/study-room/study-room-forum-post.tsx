"use client";

import { useState, type ReactNode } from "react";
import { Ban, BookOpen, ChevronDown, ChevronLeft, EyeOff, Gift, Heart, MessageSquare, MoreHorizontal, PenLine, Send, Star, Trash2, X } from "lucide-react";

import type { Book } from "@/lib/reading-types";
import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import { KIND_TEXT, type ForumPost, type ForumState } from "@/lib/study-room/forum";
import { normalizeForMatch } from "@/lib/study-room/book-source";
import { loadBooks } from "@/lib/reading-storage";
import { shareItemFromPost } from "@/lib/study-room/share-to-chat";
import { ShareSheet } from "./share-sheet";
import { ConfirmSheet, PopMenu, type MenuItem } from "./confirm-sheet";

/** 帖子关联的书：先看 bookId，再按书名匹配书架上的书。 */
export function findBookForPost(post: ForumPost): Book | undefined {
  if (post.bookId) {
    const byId = loadBooks().find((book) => book.id === post.bookId);
    if (byId) return byId;
  }
  if (!post.bookTitle) return undefined;
  const key = normalizeForMatch(post.bookTitle);
  return loadBooks().find((book) => normalizeForMatch(book.title) === key);
}
import { isCollected } from "@/lib/study-room/forum-social";
import { SpoilerBlock } from "./spoiler";

const ME = "user";

type CardProps = {
  post: ForumPost;
  state: ForumState;
  books: Record<string, Book>;
  busy: boolean;
  onOpen: () => void;
  onLike: () => void;
  onOpenBook: (book: Book) => void;
  onOpenAuthor: (npcId: string) => void;
  onGift: () => void;
  onHide: () => void;
  /** 屏蔽这位书友（只对书友的帖子出现） */
  onBlock?: () => void;
  /** 删除自己的帖子（只对用户自己的帖子出现） */
  onDelete?: () => void;
  /** 用户在书房里的名字与头像 */
  me?: { name: string; avatar: string };
};

function authorAvatar(post: ForumPost, state: ForumState, meAvatar?: string): string | null {
  if (post.authorKind === "user") return meAvatar || null;
  const npc = state.npcs.find((item) => item.id === post.authorId);
  if (!npc) return null;
  return npc.avatarUrl ?? avatarDataUrl(npc.avatar);
}

/** 信息流里的一条帖子：点头像去主页、点正文开详情，互动都在卡片上。 */
/** 列表里的时间：今天只写时分，今年写月日，跨年才写年份 */
function shortTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const hm = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return hm;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  return date.toLocaleDateString("zh-CN");
}

type ForumComment = ForumPost["comments"][number];

/**
 * 把评论整理成「一级评论 + 它下面的全部回复」：回复顺着 replyToId 找到最上层那条评论，
 * 找不到（被删了）就当一级评论。按时间顺序，不改原数据。
 */
export function threadComments(comments: ForumComment[]): { root: ForumComment; replies: ForumComment[] }[] {
  const byId = new Map(comments.map((item) => [item.id, item]));
  const rootOf = (item: ForumComment) => {
    let current = item;
    const seen = new Set<string>();
    while (current.replyToId && byId.has(current.replyToId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.replyToId)!;
    }
    return current;
  };
  const threads = new Map<string, { root: ForumComment; replies: ForumComment[] }>();
  for (const item of comments) {
    const root = rootOf(item);
    if (root.id === item.id) {
      if (!threads.has(item.id)) threads.set(item.id, { root: item, replies: [] });
    } else {
      const thread = threads.get(root.id) ?? { root, replies: [] };
      thread.replies.push(item);
      threads.set(root.id, thread);
    }
  }
  return [...threads.values()];
}

export function StudyRoomForumPostCard({
  post,
  state,
  books,
  busy,
  onOpen,
  onLike,
  onOpenBook,
  onOpenAuthor,
  onGift,
  onHide,
  onBlock,
  onDelete,
  me,
}: CardProps) {
  const avatar = authorAvatar(post, state, me?.avatar);
  const liked = post.likedBy.includes(ME);
  const book = post.bookId ? books[post.bookId] : findBookForPost(post);
  const mine = post.authorId === ME;
  const [confirm, setConfirm] = useState<null | "block" | "delete">(null);
  const [sharing, setSharing] = useState(false);
  const bookTitle = post.bookTitle?.replace(/^《|》$/g, "");

  // 管理项收进「更多」：自己的帖子是删除，书友的帖子是不感兴趣 / 屏蔽
  const menu: MenuItem[] = mine
    ? onDelete
      ? [{ key: "delete", label: "删除帖子", icon: <Trash2 size={16} strokeWidth={1.7} />, danger: true, onSelect: () => setConfirm("delete") }]
      : []
    : [
        { key: "hide", label: "不感兴趣", icon: <EyeOff size={16} strokeWidth={1.7} />, onSelect: onHide },
        ...(onBlock && post.authorKind === "npc"
          ? [{ key: "block", label: `屏蔽 ${post.authorName}`, icon: <Ban size={16} strokeWidth={1.7} />, danger: true, onSelect: () => setConfirm("block") }]
          : []),
      ];

  return (
    <article className="sr-fpost" data-kind={post.kind}>
      <header className="sr-fpost-head">
        <button
          type="button"
          className="sr-forum-avatar sr-fpost-avatar"
          onClick={() => post.authorKind === "npc" && onOpenAuthor(post.authorId)}
          aria-label={`${post.authorName} 的主页`}
          disabled={post.authorKind === "user"}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" />
          ) : (
            <span>我</span>
          )}
        </button>
        <span className="sr-fpost-who">
          <span className="sr-fpost-name-row">
            <button
              type="button"
              className="sr-fpost-name"
              onClick={() => post.authorKind === "npc" && onOpenAuthor(post.authorId)}
            >
              {mine && me ? me.name : post.authorName}
            </button>
            {post.generated && <span className="sr-fpost-badge">AI</span>}
          </span>
          <span className="sr-fpost-meta">
            <time dateTime={post.createdAt}>{shortTime(post.createdAt)}</time>
            {post.kind !== "post" && <span className="sr-fpost-kind" data-kind={post.kind}>{KIND_TEXT[post.kind]}</span>}
          </span>
        </span>
        {menu.length > 0 && (
          <PopMenu
            label="更多操作"
            triggerClassName="sr-fpost-more"
            trigger={<MoreHorizontal size={18} strokeWidth={1.7} aria-hidden />}
            items={menu}
          />
        )}
      </header>

      {/* 标题、正文、图片一起遮：剧透帖的标题也不露 */}
      <SpoilerBlock spoiler={post.spoiler}>
        <button type="button" className="sr-forum-open sr-fpost-open" onClick={onOpen}>
          {post.title && <span className="sr-fpost-title">{post.title}</span>}
          <span className="sr-fpost-body">{post.body}</span>
          {post.images && post.images.length > 0 && (
            <span className="sr-forum-images">
              {post.images.slice(0, 3).map((image, index) => (
                <span key={index} className="sr-forum-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" />
                </span>
              ))}
            </span>
          )}
        </button>
      </SpoilerBlock>

      {bookTitle &&
        (book ? (
          <button type="button" className="sr-fpost-book" onClick={() => onOpenBook(book)}>
            {book.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={book.cover} alt="" className="sr-fpost-book-cover" />
            ) : (
              <BookOpen size={15} strokeWidth={1.7} aria-hidden />
            )}
            <span className="sr-fpost-book-title">《{bookTitle}》</span>
            {book.author && <span className="sr-fpost-book-author">{book.author}</span>}
          </button>
        ) : (
          <span className="sr-fpost-book" data-static="true">
            <BookOpen size={15} strokeWidth={1.7} aria-hidden />
            <span className="sr-fpost-book-title">《{bookTitle}》</span>
          </span>
        ))}
      {post.topics && post.topics.length > 0 && (
        <div className="sr-fpost-topics">{post.topics.slice(0, 3).map((topic) => `#${topic}`).join("  ")}</div>
      )}

      <footer className="sr-fpost-acts">
        <button type="button" className="sr-fpost-act" data-active={liked || undefined} aria-pressed={liked} onClick={onLike} disabled={busy}>
          <Heart size={16} strokeWidth={1.7} fill={liked ? "currentColor" : "none"} aria-hidden />
          <span>{post.likedBy.length > 0 ? post.likedBy.length : "赞同"}</span>
        </button>
        <button type="button" className="sr-fpost-act" onClick={onOpen}>
          <MessageSquare size={16} strokeWidth={1.7} aria-hidden />
          <span>{post.comments.length > 0 ? post.comments.length : "评论"}</span>
        </button>
        <button type="button" className="sr-fpost-act" onClick={() => setSharing(true)}>
          <Send size={16} strokeWidth={1.7} aria-hidden />
          <span>分享</span>
        </button>
        <button type="button" className="sr-fpost-act" onClick={onGift}>
          <Gift size={16} strokeWidth={1.7} aria-hidden />
          <span>礼物</span>
        </button>
      </footer>

      {sharing && <ShareSheet item={shareItemFromPost(post)} onClose={() => setSharing(false)} />}
      {confirm === "block" && onBlock && (
        <ConfirmSheet
          title={`屏蔽 ${post.authorName}？`}
          message="TA 的帖子不再出现，也不会再来回复。可以在「书友管理」里解除。"
          confirmLabel="屏蔽"
          onConfirm={onBlock}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "delete" && onDelete && (
        <ConfirmSheet
          title="删除这条帖子？"
          message="评论也会一起删除，删除后不能恢复。"
          onConfirm={onDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </article>
  );
}

type ViewProps = {
  post: ForumPost;
  state: ForumState;
  books: Record<string, Book>;
  onBack: () => void;
  onOpenBook: (book: Book) => void;
  onLike: () => void;
  onComment: (body: string, replyToId?: string, spoiler?: boolean) => void;
  onCollect: () => void;
  onGift: () => void;
  onOpenAuthor: (npcId: string) => void;
  onDelete: () => void;
  /** 编辑自己的帖子 */
  onEdit: (body: string) => void;
  /** 删除自己的评论 */
  onDeleteComment: (commentId: string) => void;
  /** 屏蔽楼主（楼主是书友时） */
  onBlockAuthor?: () => void;
  /** 书友回应的状态区：正在输入 / 停止 / 失败重试 / 生成评论 / 自动回复 */
  replyPanel?: ReactNode;
  /** 请书友回复某一条评论 */
  onAskReply?: (commentId: string) => void;
  /** 已经有书友在回复的评论 */
  pendingReplyIds?: Set<string>;
  /** 用户在书房里的名字与头像（与我的主页同一份） */
  me?: { name: string; avatar: string };
  /** page：书友圈里的整页；overlay：我的主页里居中的浮层 */
  variant?: "page" | "overlay";
};

/** 帖子详情：完整正文、图片、评论与回复；自己的帖子可以改或删。评论框固定在底部，键盘弹起时仍可见。 */
export function StudyRoomForumPostView({
  post,
  state,
  books,
  onBack,
  onOpenBook,
  onLike,
  onComment,
  onCollect,
  onGift,
  onOpenAuthor,
  onDelete,
  onEdit,
  onDeleteComment,
  onBlockAuthor,
  replyPanel,
  onAskReply,
  pendingReplyIds,
  me,
  variant = "page",
}: ViewProps) {
  const [comment, setComment] = useState("");
  const [commentSpoiler, setCommentSpoiler] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  // 应用内确认：删除评论 / 删除帖子 / 屏蔽楼主
  const [ask, setAsk] = useState<null | { kind: "comment"; id: string } | { kind: "post" } | { kind: "block" }>(null);
  const [draft, setDraft] = useState(post.body);
  // 回复默认折叠：只记录展开了哪几条一级评论
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  const toggleThread = (id: string) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const liked = post.likedBy.includes(ME);
  const collected = isCollected(post);
  const book = post.bookId ? books[post.bookId] : findBookForPost(post);
  const avatar = authorAvatar(post, state, me?.avatar);
  const nameOf = (authorId: string, fallback: string) => (authorId === ME && me ? me.name : fallback);
  const replyTarget = replyTo ? post.comments.find((item) => item.id === replyTo) : undefined;
  const overlay = variant === "overlay";

  const send = () => {
    if (!comment.trim()) return;
    // 回复某条评论后，把那条所在的楼展开，方便看到自己刚发的
    if (replyTo) {
      const root = threadComments(post.comments).find(
        (thread) => thread.root.id === replyTo || thread.replies.some((item) => item.id === replyTo),
      );
      if (root) setOpenThreads((prev) => new Set(prev).add(root.root.id));
    }
    onComment(comment, replyTo ?? undefined, commentSpoiler);
    setComment("");
    setCommentSpoiler(false);
    setReplyTo(null);
  };

  const renderComment = (item: ForumComment) => {
    const target = item.replyToId ? post.comments.find((entry) => entry.id === item.replyToId) : undefined;
    const asking = pendingReplyIds?.has(item.id) ?? false;
    return (
      <>
        <div className="sr-forum-comment-head">
          <button
            type="button"
            className="sr-forum-comment-author sr-forum-name--link"
            onClick={() => item.authorKind === "npc" && onOpenAuthor(item.authorId)}
          >
            {nameOf(item.authorId, item.authorName)}
          </button>
          {target && <span className="sr-note-meta">回复 {nameOf(target.authorId, target.authorName)}</span>}
          <span className="sr-note-meta" style={{ marginLeft: "auto" }}>
            {new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <SpoilerBlock spoiler={item.spoiler} compact>
          <p className="sr-forum-comment-body">{item.body}</p>
        </SpoilerBlock>
        <div className="sr-forum-comment-tools">
          <button type="button" className="sr-forum-reply" onClick={() => setReplyTo(item.id)}>
            回复
          </button>
          {onAskReply && (
            <button
              type="button"
              className="sr-forum-reply"
              onClick={() => onAskReply(item.id)}
              disabled={asking}
              aria-busy={asking || undefined}
            >
              {asking ? "书友回复中…" : "请书友回复这条"}
            </button>
          )}
          {item.authorId === ME && (
            <button
              type="button"
              className="sr-forum-reply"
              onClick={() => {
                setAsk({ kind: "comment", id: item.id });
              }}
            >
              删除
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <div className={overlay ? "sr-forum-sub sr-forum-sub--overlay" : "sr-forum-sub"}>
      <div className="sr-forum-sub-head">
        {!overlay && (
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
        )}
        <span className="sr-forum-sub-title">帖子</span>
        {post.authorId === ME && (
          <span className="sr-note-tools">
            <button
              type="button"
              className="sr-note-tool"
              title="编辑帖子"
              aria-label="编辑帖子"
              onClick={() => {
                setEditing((value) => !value);
                setDraft(post.body);
              }}
            >
              <PenLine size={16} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              className="sr-note-tool"
              title="删除帖子"
              aria-label="删除帖子"
              onClick={() => {
                setAsk({ kind: "post" });
              }}
            >
              <Trash2 size={16} strokeWidth={1.7} />
            </button>
          </span>
        )}
        {post.authorKind === "npc" && onBlockAuthor && (
          <span className="sr-note-tools">
            <button
              type="button"
              className="sr-note-tool"
              title="屏蔽楼主"
              aria-label={`屏蔽 ${post.authorName}`}
              onClick={() => {
                setAsk({ kind: "block" });
              }}
            >
              <Ban size={16} strokeWidth={1.7} />
            </button>
          </span>
        )}
        {overlay && (
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="关闭">
            <X size={20} strokeWidth={1.7} />
          </button>
        )}
      </div>

      <div className="sr-forum-sub-body">
        {/* 帖子上半部：作者、正文、操作。浮层里它单独滚，评论区另外滚，互不带动 */}
        <div className="sr-post-top">
        <div className="sr-forum-author">
          <span className="sr-forum-avatar" aria-hidden>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" />
            ) : (
              <span>我</span>
            )}
          </span>
          <span className="sr-forum-author-main">
            <button
              type="button"
              className="sr-forum-name sr-forum-name--link"
              onClick={() => post.authorKind === "npc" && onOpenAuthor(post.authorId)}
            >
              {nameOf(post.authorId, post.authorName)}
            </button>
            <span className="sr-note-meta">
              {KIND_TEXT[post.kind]} · {new Date(post.createdAt).toLocaleString("zh-CN")}
            </span>
          </span>
        </div>

        {editing ? (
          <>
            <textarea className="sr-css-editor" rows={7} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="帖子正文" />
            <div className="sr-css-actions">
              <button type="button" className="sr-btn" onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-primary"
                onClick={() => {
                  const text = draft.trim();
                  if (!text) return;
                  onEdit(text);
                  setEditing(false);
                }}
              >
                保存修改
              </button>
            </div>
          </>
        ) : (
          <SpoilerBlock spoiler={post.spoiler}>
            {post.title && <h2 className="sr-forum-detail-title">{post.title}</h2>}
            <p className="sr-forum-body sr-forum-detail-body">{post.body}</p>
            {post.images && post.images.length > 0 && (
              <div className="sr-forum-images">
                {post.images.map((image, index) => (
                  <span key={index} className="sr-forum-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" />
                  </span>
                ))}
              </div>
            )}
          </SpoilerBlock>
        )}

        {post.bookTitle && (
          <div className="sr-forum-book">
            <BookOpen size={13} strokeWidth={1.8} aria-hidden />
            {book ? (
              <button type="button" className="sr-forum-book-btn" onClick={() => onOpenBook(book)}>
                在书房读《{post.bookTitle}》
              </button>
            ) : (
              <span className="sr-note-meta">《{post.bookTitle}》· 不在书架上</span>
            )}
          </div>
        )}

        <div className="sr-forum-detail-actions">
          <button type="button" className="sr-forum-act" aria-pressed={liked} onClick={onLike}>
            <Heart size={16} strokeWidth={1.8} fill={liked ? "currentColor" : "none"} />
            赞同{post.likedBy.length > 0 ? ` ${post.likedBy.length}` : ""}
          </button>
          <button type="button" className="sr-forum-act" aria-pressed={collected} onClick={onCollect}>
            <Star size={16} strokeWidth={1.8} fill={collected ? "currentColor" : "none"} />
            {collected ? "已收藏" : "收藏"}
          </button>
          <button type="button" className="sr-forum-act" onClick={onGift}>
            <Gift size={16} strokeWidth={1.8} />
            送礼物
          </button>
          <button type="button" className="sr-forum-act" onClick={() => setSharing(true)}>
            <Send size={16} strokeWidth={1.8} />
            分享
          </button>
        </div>
        {sharing && <ShareSheet item={shareItemFromPost(post)} onClose={() => setSharing(false)} />}
        {ask?.kind === "comment" && (
          <ConfirmSheet
            title="删除这条评论？"
            message="删除后不能恢复。"
            onConfirm={() => onDeleteComment(ask.id)}
            onCancel={() => setAsk(null)}
          />
        )}
        {ask?.kind === "post" && (
          <ConfirmSheet
            title="删除这条帖子？"
            message="评论也会一起删除，删除后不能恢复。"
            onConfirm={onDelete}
            onCancel={() => setAsk(null)}
          />
        )}
        {ask?.kind === "block" && onBlockAuthor && (
          <ConfirmSheet
            title={`屏蔽 ${post.authorName}？`}
            message="TA 的帖子不再出现，也不会再来回复。可以在「书友管理」里解除。"
            confirmLabel="屏蔽"
            onConfirm={onBlockAuthor}
            onCancel={() => setAsk(null)}
          />
        )}

        </div>

        <div className="sr-post-replies">
        <div className="sr-forum-detail-label">评论 {post.comments.length > 0 ? post.comments.length : ""}</div>
        {replyPanel}
        {post.comments.length === 0 ? (
          <p className="sr-note-meta">还没有评论。说点什么，或点「生成评论」请书友来聊。</p>
        ) : (
          <ul className="sr-forum-comments">
            {threadComments(post.comments).map(({ root, replies }) => {
              const open = openThreads.has(root.id);
              return (
                <li key={root.id}>
                  {renderComment(root)}
                  {replies.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="sr-forum-thread-toggle"
                        aria-expanded={open}
                        onClick={() => toggleThread(root.id)}
                      >
                        <ChevronDown size={14} strokeWidth={1.8} aria-hidden data-open={open || undefined} />
                        {open ? "收起回复" : `展开回复 ${replies.length}`}
                      </button>
                      {open && (
                        <ul className="sr-forum-thread">
                          {replies.map((item) => (
                            <li key={item.id}>{renderComment(item)}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>

      <form
        className="sr-forum-sub-foot"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {replyTarget && (
          <div className="sr-forum-replying">
            <span>回复 {nameOf(replyTarget.authorId, replyTarget.authorName)}</span>
            <button type="button" className="sr-btn-text" onClick={() => setReplyTo(null)}>
              取消回复
            </button>
          </div>
        )}
        <div className="sr-forum-comment-box">
          <button
            type="button"
            className="sr-forum-comment-spoiler"
            aria-pressed={commentSpoiler}
            aria-label={commentSpoiler ? "已标记含剧透，点一下取消" : "标记这条评论含剧透"}
            title="含剧透"
            onClick={() => setCommentSpoiler((value) => !value)}
          >
            <EyeOff size={17} strokeWidth={1.8} aria-hidden />
          </button>
          <input
            className="sr-appear-input"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={replyTarget ? "回复这条评论…" : "写下评论…"}
            aria-label="评论"
            enterKeyHint="send"
          />
          <button type="submit" className="sr-btn sr-btn-sm sr-btn-primary" disabled={!comment.trim()}>
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
