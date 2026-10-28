"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronLeft, Compass, Hash, Loader2, PenLine, RotateCw, Search, Square, X } from "lucide-react";

import { loadBooks } from "@/lib/reading-storage";
import type { Book } from "@/lib/reading-types";
import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import {
  collectHiddenContexts,
  generateForumPosts,
  pickParticipants,
  hidePost,
  loadForum,
  makeFriendFromNpc,
  resolveForumApiConfig,
  saveForum,
  unhidePost,
  unmuteNpc,
  type ForumNpc,
  type ForumState,
} from "@/lib/study-room/forum";
import {
  FEED_KIND_LABEL,
  FEED_SORT_LABEL,
  feedPosts,
  FEED_REFRESH_KEY,
  blockNpc,
  dedupePosts,
  deleteOwnComment,
  ensureSeeded,
  feedRefreshDue,
  forumHotBooks,
  forumHotTopics,
  normalizeRules,
  pickFeedTopic,
  isFollowing,
  markNotificationsRead,
  searchForum,
  toggleCollect,
  toggleFollowNpc,
  toggleStarNpc,
  isStarred,
  unreadNotifications,
  type FeedKind,
  type FeedScope,
  type FeedSort,
} from "@/lib/study-room/forum-social";
import { shortError, useForumReplyEngine, useMeCard } from "./forum-reply-engine";
import { PopMenu } from "./confirm-sheet";
import { GiftSheet } from "./gift-sheet";
import { StudyRoomForumCompose } from "./study-room-forum-compose";
import { StudyRoomForumDm } from "./study-room-forum-dm";
import { StudyRoomForumDrawer } from "./study-room-forum-drawer";
import { StudyRoomForumPostCard, StudyRoomForumPostView } from "./study-room-forum-post";
import { StudyRoomForumProfile } from "./study-room-forum-profile";
import { StudyRoomForumSettings } from "./study-room-forum-settings";
import { SpoilerGate, spoilerSafe } from "./spoiler";

type StudyRoomForumProps = {
  onOpenNpcPanel: () => void;
  onOpenBook: (book: Book) => void;
  /** 进入「我的」（用户主页复用书房既有的我的） */
  onOpenMine: () => void;
  /** 从「我的主页」点动态卡进来时直接打开原帖 */
  initialPostId?: string;
  /** 从「我的」点「发布第一条动态」进来时直接打开发帖 */
  initialCompose?: boolean;
  /** 剧透提示里选「不再观看」：这一次不进书友圈，回到进来之前的页面 */
  onLeave: () => void;
  /** 这次进入书房里是否已经确认过剧透提示（由书房外壳保存，退出书房才清空） */
  gateAccepted: boolean;
  onGateAccept: () => void;
};

/** 等待时如实显示已经等了几秒（只计时，不预估「还要多久」）。挂载即开始，卸载即停。 */
function ElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>已等 {seconds} 秒</span>;
}

/**
 * 书友圈：进来就是能读的信息流。
 * 普通用户不需要先写话题或提示词：书友与内容会自己生成和维护；
 * 想看什么就搜、想说什么就发，其余交给书友按人设回应。
 */
export function StudyRoomForum({ onOpenNpcPanel, onOpenBook, onOpenMine, initialPostId, initialCompose, onLeave, gateAccepted, onGateAccept }: StudyRoomForumProps) {
  const [state, setState] = useState<ForumState>(() => loadForum());
  // 剧透提示：每次进入书房后第一次打开书友圈时问一次；确认之前任何帖子都不渲染。
  // 书房内切到书架/书桌再回来不重复问，退出书房再进来才重新问。
  const gateOk = gateAccepted;
  const [scope, setScope] = useState<FeedScope>("recommend");
  const [sort, setSort] = useState<FeedSort>("default");
  const [kind, setKind] = useState<FeedKind>("all");
  const [view, setView] = useState<
    | { kind: "feed" }
    | { kind: "post"; postId: string }
    | { kind: "compose"; draftId?: string }
    | { kind: "profile"; npcId: string }
    | { kind: "search"; query: string }
    | { kind: "settings" }
    | { kind: "dm"; npcId?: string }
  >(() =>
    initialPostId ? { kind: "post", postId: initialPostId } : initialCompose ? { kind: "compose" } : { kind: "feed" },
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [giftTarget, setGiftTarget] = useState<{ postId: string; npcId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const feedAbortRef = useRef<AbortController | null>(null);
  const bootstrappedRef = useRef(false);
  const books = useMemo(() => {
    const map: Record<string, Book> = {};
    for (const book of loadBooks()) map[book.id] = book;
    return map;
  }, []);

  const mutate = useCallback((updater: (prev: ForumState) => ForumState) => {
    setState((prev) => {
      const next = updater(prev);
      saveForum(next);
      return next;
    });
  }, []);

  const flash = useCallback((message: string, ms = 2600) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), ms);
  }, []);

  const me = useMeCard();
  const engine = useForumReplyEngine({ state, mutate, flash, meName: me.name });
  const { typing, replyIssue, setReplyIssue, stopReplies, retryReply, afterUserActivity, noApiCard, renderReplyPanel } = engine;

  /**
   * 刷新首页：请几位书友按「热门话题」各发一条新帖。
   * 过程可见、可停止；没配模型就引导去设置，失败就如实说并给重试。
   */
  const refreshFeed = useCallback(
    async (auto: boolean) => {
      if (feedAbortRef.current) return;
      const current = loadForum();
      const active = current.npcs.filter((npc) => !current.mutedNpcIds.includes(npc.id));
      if (active.length === 0) {
        if (!auto) flash("书友圈里还没有能发帖的书友，先去「书友管理」请几位");
        return;
      }
      if (!resolveForumApiConfig()) {
        setReplyIssue({ kind: "no-api" });
        return;
      }
      const controller = new AbortController();
      feedAbortRef.current = controller;
      setBusy("feed");
      setFeedError(null);
      try {
        const rules = normalizeRules(current.rules);
        const topic = pickFeedTopic(current);
        const participants = pickParticipants(current, topic, Math.max(2, Math.min(rules.feedCount, 4)));
        const created = await generateForumPosts(current, topic, participants, controller.signal, {
          rules,
          backgrounds: collectHiddenContexts(participants),
          recentTitles: current.posts.slice(0, 12).map((post) => post.title ?? "").filter(Boolean),
        });
        if (controller.signal.aborted) return;
        const fresh = dedupePosts(loadForum().posts, created).slice(0, Math.max(1, rules.feedCount));
        const stamp = new Date().toISOString();
        mutate((prev) => ({
          ...prev,
          posts: [...dedupePosts(prev.posts, fresh), ...prev.posts],
          generatedAt: { ...prev.generatedAt, [FEED_REFRESH_KEY]: stamp },
        }));
        if (!auto || fresh.length === 0) {
          flash(fresh.length > 0 ? `书友们发了 ${fresh.length} 条新帖` : "这次的内容和已有帖子重复了，没有加进来");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFeedError(shortError(error instanceof Error ? error.message : String(error)));
        }
      } finally {
        if (feedAbortRef.current === controller) feedAbortRef.current = null;
        setBusy((value) => (value === "feed" ? null : value));
      }
    },
    [flash, mutate, setReplyIssue],
  );

  const stopFeed = () => {
    feedAbortRef.current?.abort();
    feedAbortRef.current = null;
    setBusy((value) => (value === "feed" ? null : value));
    flash("已停止，这次没有新帖");
  };

  // 首次进入：没有书友就先建一批（本地生成，不依赖 API）；
  // 没有帖子、或很久没刷新过，就请书友们发几条新帖（只在打开书友圈时进行）
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const { state: seeded, created } = ensureSeeded(loadForum());
    if (created > 0) {
      saveForum(seeded);
      setState(seeded);
    }
    if (initialPostId) return;
    if (seeded.posts.length === 0 || feedRefreshDue(seeded)) void refreshFeed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 离开书友圈：进行中的发帖请求中断（书友回应由回应引擎自己处理）
  useEffect(() => () => feedAbortRef.current?.abort(), []);

  const handleBlock = (npcId: string) => {
    const npc = state.npcs.find((item) => item.id === npcId);
    mutate((prev) => blockNpc(prev, npcId));
    flash(`已屏蔽 ${npc?.nickname ?? "这位书友"}，可以在「书友管理」里解除`);
  };

  const deletePost = (postId: string) => {
    mutate((prev) => ({ ...prev, posts: prev.posts.filter((item) => item.id !== postId) }));
    flash("已删除这条帖子");
  };

  const handleFollow = (npc: ForumNpc) => {
    const following = isFollowing(state, npc.id);
    mutate((prev) => toggleFollowNpc(prev, npc.id));
    flash(following ? `已取消关注 ${npc.nickname}` : `已关注 ${npc.nickname}`);
  };

  const handleAddFriend = async (npc: ForumNpc) => {
    setBusy(npc.id);
    try {
      const result = await makeFriendFromNpc(state, npc);
      if (result.created) {
        mutate((prev) => ({
          ...prev,
          npcs: prev.npcs.map((item) =>
            item.id === npc.id ? { ...item, characterId: result.characterId, source: "character" } : item,
          ),
        }));
      }
      flash(result.alreadyFriend ? `${npc.nickname} 本来就在聊天好友里` : `已把 ${npc.nickname} 加为好友，去聊天应用里找 TA`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * 私信：打开书房内部的私信界面，不跳到宿主的聊天应用。
   * 会话与消息都存在书房自己的数据里（lib/study-room/dm.ts），与聊天应用互不相通。
   */
  const handleOpenChat = (npc: ForumNpc) => {
    setDrawerOpen(false);
    setView({ kind: "dm", npcId: npc.id });
  };

  const posts = useMemo(() => feedPosts(state, scope, sort, kind), [state, scope, sort, kind]);

  const hiddenInFeed = useMemo(
    () => feedPosts({ ...state, hiddenPostIds: [] }, scope, sort, kind).filter((post) => state.hiddenPostIds.includes(post.id)),
    [state, scope, sort, kind],
  );

  const unread = unreadNotifications(state);

  // 大家在聊：只按本机真实帖子统计（书 = 关联帖子数 + 参与人数；话题 = 不含剧透的帖子数）
  const hotBooks = useMemo(() => forumHotBooks(state), [state]);
  const hotTopics = useMemo(() => forumHotTopics(state), [state]);

  if (!gateOk) {
    return (
      <div className="sr-forum sr-forum--gated">
        <SpoilerGate onContinue={onGateAccept} onLeave={onLeave} />
      </div>
    );
  }

  // ── 子视图 ──
  if (view.kind === "compose") {
    return (
      <StudyRoomForumCompose
        state={state}
        draftId={view.draftId}
        onClose={() => setView({ kind: "feed" })}
        onMutate={mutate}
        onPublished={(postId) => {
          setView({ kind: "feed" });
          afterUserActivity(postId, "已发布");
        }}
        onNotice={flash}
        onOpenSettings={() => setView({ kind: "settings" })}
      />
    );
  }

  if (view.kind === "dm") {
    return (
      <StudyRoomForumDm
        state={state}
        initialNpcId={view.npcId}
        // 详情 → 书房私信列表（组件内部处理）；列表的返回键回到书友圈首页
        onBack={() => setView({ kind: "feed" })}
        onNotice={flash}
      />
    );
  }

  if (view.kind === "settings") {
    return (
      <StudyRoomForumSettings
        state={state}
        onBack={() => setView({ kind: "feed" })}
        onMutate={mutate}
        onNotice={flash}
        onOpenNpcPanel={onOpenNpcPanel}
      />
    );
  }

  if (view.kind === "post") {
    const post = state.posts.find((item) => item.id === view.postId);
    if (!post) {
      return (
        <div className="sr-empty">
          <p>这条帖子已经不在了。</p>
          <button type="button" className="sr-btn" onClick={() => setView({ kind: "feed" })}>返回</button>
        </div>
      );
    }
    return (
      <StudyRoomForumPostView
        post={post}
        state={state}
        books={books}
        onBack={() => setView({ kind: "feed" })}
        onOpenBook={onOpenBook}
        onLike={() => engine.like(post)}
        onComment={(body, replyToId, spoiler) => engine.comment(post, body, replyToId, spoiler)}
        onCollect={() => mutate((prev) => toggleCollect(prev, post.id))}
        onGift={() => setGiftTarget({ postId: post.id, npcId: post.authorKind === "npc" ? post.authorId : undefined })}
        onOpenAuthor={(npcId) => setView({ kind: "profile", npcId })}
        onEdit={(body) =>
          mutate((prev) => ({
            ...prev,
            posts: prev.posts.map((item) => (item.id === post.id ? { ...item, body } : item)),
          }))
        }
        onDelete={() => {
          mutate((prev) => ({ ...prev, posts: prev.posts.filter((item) => item.id !== post.id) }));
          setView({ kind: "feed" });
          flash("已删除这条帖子");
        }}
        onDeleteComment={(commentId) => {
          mutate((prev) => deleteOwnComment(prev, post.id, commentId));
          flash("已删除这条评论");
        }}
        onBlockAuthor={
          post.authorKind === "npc"
            ? () => {
                handleBlock(post.authorId);
                setView({ kind: "feed" });
              }
            : undefined
        }
        replyPanel={renderReplyPanel(post.id)}
        onAskReply={(commentId) => engine.requestCommentReply(post.id, commentId)}
        pendingReplyIds={engine.commentPending}
        me={me}
      />
    );
  }

  if (view.kind === "profile") {
    const npc = state.npcs.find((item) => item.id === view.npcId);
    if (!npc) {
      return (
        <div className="sr-empty">
          <p>找不到这位书友。</p>
          <button type="button" className="sr-btn" onClick={() => setView({ kind: "feed" })}>返回</button>
        </div>
      );
    }
    return (
      <StudyRoomForumProfile
        npc={npc}
        state={state}
        onBack={() => setView({ kind: "feed" })}
        onFollow={() => handleFollow(npc)}
        onStar={() => {
          const was = isStarred(state, npc.id);
          mutate((prev) => toggleStarNpc(prev, npc.id));
          flash(was ? `已取消特别关注 ${npc.nickname}` : `已特别关注 ${npc.nickname}`);
        }}
        onAddFriend={() => void handleAddFriend(npc)}
        onChat={() => handleOpenChat(npc)}
        onOpenPost={(postId) => setView({ kind: "post", postId })}
        busy={busy === npc.id}
        onToggleBlock={() => {
          if (state.mutedNpcIds.includes(npc.id)) {
            mutate((prev) => unmuteNpc(prev, npc.id));
            flash(`已解除屏蔽 ${npc.nickname}`);
          } else {
            handleBlock(npc.id);
          }
        }}
      />
    );
  }

  if (view.kind === "search") {
    const result = searchForum(state, view.query);
    return (
      <div className="sr-forum-sub">
        <div className="sr-forum-sub-head">
          <button type="button" className="sr-icon-btn" onClick={() => setView({ kind: "feed" })} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <span className="sr-forum-sub-title">搜索「{view.query}」</span>
        </div>
        <div className="sr-forum-sub-body">
          {result.posts.length + result.npcs.length + result.books.length + result.topics.length === 0 ? (
            <div className="sr-empty">
              <Compass size={38} strokeWidth={1} />
              <p>没有找到相关内容。可以换个关键词，或直接发一条帖子问问书友们。</p>
            </div>
          ) : (
            <>
              {result.npcs.length > 0 && (
                <>
                  <div className="sr-section-label">书友</div>
                  {result.npcs.map((npc) => (
                    <button
                      key={npc.id}
                      type="button"
                      className="sr-forum-row"
                      onClick={() => setView({ kind: "profile", npcId: npc.id })}
                    >
                      <span className="sr-forum-avatar" aria-hidden>
                        {npc.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={npc.avatarUrl} alt="" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarDataUrl(npc.avatar)} alt="" />
                        )}
                      </span>
                      <span className="sr-forum-author-main">
                        <span className="sr-forum-name">{npc.nickname}</span>
                        <span className="sr-note-meta">{npc.occupation}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
              {result.books.length > 0 && (
                <>
                  <div className="sr-section-label">书籍</div>
                  <div className="sr-chip-row">
                    {result.books.map((title) => (
                      <span key={title} className="sr-chip">《{title}》</span>
                    ))}
                  </div>
                </>
              )}
              {result.topics.length > 0 && (
                <>
                  <div className="sr-section-label">话题</div>
                  <div className="sr-chip-row">
                    {result.topics.map((topic) => (
                      <span key={topic} className="sr-chip">#{topic}</span>
                    ))}
                  </div>
                </>
              )}
              {result.posts.length > 0 && (
                <>
                  <div className="sr-section-label">帖子</div>
                  {result.posts.map((post) => (
                    <StudyRoomForumPostCard
                      key={post.id}
                      post={post}
                      state={state}
                      books={books}
                      onOpen={() => setView({ kind: "post", postId: post.id })}
                      onLike={() => engine.like(post)}
                      onOpenBook={onOpenBook}
                      onOpenAuthor={(npcId) => setView({ kind: "profile", npcId })}
                      onGift={() => setGiftTarget({ postId: post.id, npcId: post.authorKind === "npc" ? post.authorId : undefined })}
                      onHide={() => mutate((prev) => hidePost(prev, post.id))}
                      onBlock={() => handleBlock(post.authorId)}
                      onDelete={() => deletePost(post.id)}
                      busy={false}
                      me={me}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 信息流 ──
  return (
    <div className="sr-forum">
      <div className="sr-forum-top">
      <div className="sr-forum-head">
        <button
          type="button"
          className="sr-forum-me"
          onClick={() => {
            setDrawerOpen(true);
            if (unread.length > 0) mutate((prev) => markNotificationsRead(prev, ["comment", "reply", "like", "mention"]));
          }}
          aria-label={`打开个人菜单${unread.length > 0 ? `（${unread.length} 条未读通知）` : ""}`}
        >
          <span className="sr-forum-avatar" aria-hidden>
            {me.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatar} alt="" />
            ) : (
              <span>我</span>
            )}
          </span>
          {unread.length > 0 && <i className="sr-forum-dot" aria-hidden />}
        </button>
        <form
          className="sr-forum-search"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const input = form.elements.namedItem("q") as HTMLInputElement | null;
            const value = input?.value.trim() ?? "";
            if (value) setView({ kind: "search", query: value });
          }}
        >
          <Search size={15} strokeWidth={1.8} aria-hidden />
          <input name="q" placeholder="搜帖子、书友、书或话题" aria-label="搜索书友圈" />
        </form>
        <button type="button" className="sr-forum-publish" onClick={() => setView({ kind: "compose" })} aria-label="发布帖子">
          <PenLine size={15} strokeWidth={1.9} aria-hidden />
          <span className="sr-forum-publish-text">发布</span>
        </button>
      </div>

      <div className="sr-forum-row2">
        <div className="sr-uline-tabs" role="tablist" aria-label="信息流范围">
          {(["recommend", "following"] as FeedScope[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="sr-uline-tab"
              aria-selected={scope === key}
              onClick={() => setScope(key)}
            >
              {key === "recommend" ? "推荐" : "关注"}
            </button>
          ))}
        </div>
        <PopMenu
          label={`排序：${FEED_SORT_LABEL[sort]}`}
          triggerClassName="sr-forum-sort"
          trigger={
            <>
              {FEED_SORT_LABEL[sort]}
              <ChevronDown size={14} strokeWidth={1.9} aria-hidden />
            </>
          }
          items={(Object.keys(FEED_SORT_LABEL) as FeedSort[]).map((key) => ({
            key,
            label: FEED_SORT_LABEL[key],
            checked: sort === key,
            onSelect: () => setSort(key),
          }))}
        />
      </div>

      <div className="sr-forum-row3">
        <div className="sr-forum-kinds" role="group" aria-label="内容类型">
          {(Object.keys(FEED_KIND_LABEL) as FeedKind[]).map((key) => (
            <button
              key={key}
              type="button"
              className="sr-forum-kind"
              data-kind={key}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {FEED_KIND_LABEL[key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="sr-icon-btn sr-forum-refresh"
          onClick={() => void refreshFeed(false)}
          disabled={busy === "feed"}
          aria-label="请书友们发新帖"
          title="请书友们发新帖"
        >
          <RotateCw size={17} strokeWidth={1.8} className={busy === "feed" ? "sr-spin" : undefined} />
        </button>
      </div>
      </div>

      {scope === "recommend" && state.posts.length > 0 && (
        <section className="sr-forum-hot" aria-label="大家在聊">
          <div className="sr-forum-hot-head">
            <span className="sr-forum-hot-title">大家在聊</span>
            <span className="sr-forum-hot-note">按书友圈里的真实帖子统计</span>
          </div>
          {hotBooks.length === 0 && hotTopics.length === 0 ? (
            <p className="sr-forum-hot-empty">还没有关联书籍或话题的帖子。发帖时选一本书、加个话题，就会出现在这里。</p>
          ) : (
            <div className="sr-forum-hot-row">
              {hotBooks.map((item, index) => (
                <button
                  key={`b-${item.title}`}
                  type="button"
                  className="sr-forum-hot-chip"
                  data-tone="book"
                  data-top={index === 0 ? "true" : undefined}
                  onClick={() => setView({ kind: "search", query: item.title })}
                  aria-label={`《${item.title}》，${item.posts} 条帖子，${item.people} 人参与，查看相关帖子`}
                >
                  <BookOpen size={14} strokeWidth={1.8} aria-hidden />
                  <span className="sr-forum-hot-name">《{item.title}》</span>
                  <span className="sr-forum-hot-count">{item.posts} 帖 · {item.people} 人</span>
                </button>
              ))}
              {hotTopics.map((item) => (
                <button
                  key={`t-${item.topic}`}
                  type="button"
                  className="sr-forum-hot-chip"
                  data-tone="topic"
                  onClick={() => setView({ kind: "search", query: item.topic })}
                  aria-label={`话题 ${item.topic}，${item.posts} 条帖子，查看相关帖子`}
                >
                  <Hash size={14} strokeWidth={1.8} aria-hidden />
                  <span className="sr-forum-hot-name">{item.topic}</span>
                  <span className="sr-forum-hot-count">{item.posts} 帖</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {notice && (
        <div className="sr-note-card">
          <div className="sr-note-meta">{notice}</div>
        </div>
      )}

      {noApiCard}

      {busy === "feed" && (
        <div className="sr-css-actions" style={{ alignItems: "center" }}>
          <span className="sr-note-meta" style={{ marginRight: "auto", lineHeight: 1.7 }}>
            <Loader2 size={13} className="sr-spin" /> 书友们正在写新帖… <ElapsedSeconds />
          </span>
          <button type="button" className="sr-btn sr-btn-sm" onClick={stopFeed}>
            <Square size={12} strokeWidth={1.8} />
            停止
          </button>
        </div>
      )}

      {feedError && busy !== "feed" && (
        <div className="sr-note-card">
          <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>新帖没生成出来：{feedError}</div>
          <div className="sr-css-actions">
            <button type="button" className="sr-btn-text" onClick={() => setFeedError(null)}>
              算了
            </button>
            <button type="button" className="sr-btn sr-btn-sm sr-btn-primary" onClick={() => void refreshFeed(false)}>
              <RotateCw size={13} strokeWidth={1.8} />
              重试
            </button>
          </div>
        </div>
      )}

      {typing && (
        <div className="sr-css-actions" style={{ alignItems: "center" }}>
          <span className="sr-note-meta" style={{ marginRight: "auto", lineHeight: 1.7 }}>
            <Loader2 size={12} className="sr-spin" /> {typing.npcName} 正在回应一条帖子…
          </span>
          <button type="button" className="sr-btn sr-btn-sm" onClick={() => stopReplies(typing.postId)}>
            <Square size={12} strokeWidth={1.8} />
            停止
          </button>
        </div>
      )}

      {replyIssue?.kind === "error" && (
        <div className="sr-note-card">
          <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>
            {replyIssue.npcName} 没回上来：{replyIssue.message}
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

      {posts.length === 0 ? (
        <div className="sr-forum-empty">
          {state.npcs.length === 0 ? (
            <>
              <Loader2 size={22} className="sr-spin" />
              <p>正在准备书友…</p>
            </>
          ) : (
            <>
              <PenLine size={24} strokeWidth={1.4} />
              <p>
                {scope === "following" && state.following.length === 0
                  ? "还没有关注的书友。在帖子里点头像进入主页，就能关注。"
                  : "这里还没有帖子。点右上角「发布」写一条，书友们会来回应。"}
              </p>
            </>
          )}
        </div>
      ) : (
        posts.map((post) => (
          <StudyRoomForumPostCard
            key={post.id}
            post={post}
            state={state}
            books={books}
            onOpen={() => setView({ kind: "post", postId: post.id })}
            onLike={() => engine.like(post)}
            onOpenBook={onOpenBook}
            onOpenAuthor={(npcId) => setView({ kind: "profile", npcId })}
            onGift={() => setGiftTarget({ postId: post.id, npcId: post.authorKind === "npc" ? post.authorId : undefined })}
            onHide={() => mutate((prev) => hidePost(prev, post.id))}
            onBlock={() => handleBlock(post.authorId)}
            onDelete={() => deletePost(post.id)}
            busy={false}
            me={me}
          />
        ))
      )}

      {hiddenInFeed.length > 0 && (
        <button
          type="button"
          className="sr-material-toggle"
          onClick={() => setShowHidden((value) => !value)}
        >
          <X size={14} strokeWidth={1.8} />
          {showHidden ? "隐藏已收起的内容" : `已收起 ${hiddenInFeed.length} 条不感兴趣的内容`}
        </button>
      )}
      {showHidden && hiddenInFeed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {hiddenInFeed.map((post) => (
            <div key={post.id} className="sr-note-card">
              <div className="sr-note-meta">{post.authorName}：{spoilerSafe(post.body.slice(0, 40) + "…", post.spoiler)}</div>
              <button type="button" className="sr-btn sr-btn-sm" onClick={() => mutate((prev) => unhidePost(prev, post.id))}>
                恢复显示
              </button>
            </div>
          ))}
        </div>
      )}

      {drawerOpen && (
        <StudyRoomForumDrawer
          state={state}
          unread={unread}
          onClose={() => setDrawerOpen(false)}
          onMutate={mutate}
          onOpenCompose={(draftId) => setView({ kind: "compose", draftId })}
          onOpenPost={(postId) => setView({ kind: "post", postId })}
          onOpenMine={() => {
            setDrawerOpen(false);
            onOpenMine();
          }}
          onOpenSettings={() => setView({ kind: "settings" })}
          onOpenProfile={(npcId) => {
            setDrawerOpen(false);
            setView({ kind: "profile", npcId });
          }}
          onOpenChat={() => {
            // 私信沿用宿主的聊天应用，不在书房另造一套
            setDrawerOpen(false);
            window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat" } }));
          }}
        />
      )}

      {giftTarget && (
        <GiftSheet
          mode="gift"
          postId={giftTarget.postId}
          presetRecipient={giftTarget.npcId ? (() => {
            const npc = state.npcs.find((item) => item.id === giftTarget.npcId);
            return npc ? { id: npc.id, name: npc.nickname, kind: "npc" as const } : undefined;
          })() : undefined}
          onClose={() => setGiftTarget(null)}
        />
      )}
    </div>
  );
}
