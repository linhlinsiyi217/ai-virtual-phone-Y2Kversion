"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Check, ChevronDown, ChevronLeft, Loader2, MessageCircle, MoreHorizontal, Star, UserPlus } from "lucide-react";

import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import type { ForumNpc, ForumState } from "@/lib/study-room/forum";
import { followerCount, followingCount, isFollowing, isStarred } from "@/lib/study-room/forum-social";
import { PostStrip, ProfileEmpty, ProfileHero, ProfileTabs, TwoColumnGrid } from "./study-room-profile-parts";

type StudyRoomForumProfileProps = {
  npc: ForumNpc;
  state: ForumState;
  busy: boolean;
  onBack: () => void;
  onFollow: () => void;
  onStar: () => void;
  onAddFriend: () => void;
  onChat: () => void;
  onOpenPost: (postId: string) => void;
  /** 屏蔽 / 解除屏蔽 */
  onToggleBlock: () => void;
};

type ContentTab = "posts" | "reviews" | "shelf" | "endorsed";

/** 点外面就关掉的小菜单 */
function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/**
 * 书友主页：与「我的」同一套结构。
 * 顶栏只放返回、TA 的名字和「更多」（屏蔽）；
 * 操作区两个宽按钮：关注/已关注▾（取消关注、特别关注），私信（好友）或加好友。
 */
export function StudyRoomForumProfile({
  npc,
  state,
  busy,
  onBack,
  onFollow,
  onStar,
  onAddFriend,
  onChat,
  onOpenPost,
  onToggleBlock,
}: StudyRoomForumProfileProps) {
  const blocked = state.mutedNpcIds.includes(npc.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [contentTab, setContentTab] = useState<ContentTab>("posts");
  const menuRef = useOutsideClose(menuOpen, () => setMenuOpen(false));
  const moreRef = useOutsideClose(moreOpen, () => setMoreOpen(false));

  const posts = state.posts
    .filter((post) => post.authorId === npc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviews = posts.filter((post) => post.kind === "review");
  const others = posts.filter((post) => post.kind !== "review");
  const endorsed = state.posts.filter((post) => post.likedBy.includes(npc.id) && post.authorId !== npc.id).slice(0, 10);
  const shelf = npc.shelfTitles ?? [];
  const likes = posts.reduce((total, post) => total + post.likedBy.length, 0);
  const following = isFollowing(state, npc.id);
  const starred = isStarred(state, npc.id);
  const isFriend = Boolean(npc.characterId);
  const avatar = npc.avatarUrl ?? avatarDataUrl(npc.avatar);
  // 气泡只用 TA 自己的真实记录：最近一条带书名的帖子
  const recentBook = posts.find((post) => post.bookTitle)?.bookTitle;

  const tabs: Array<{ key: ContentTab; label: string; count?: number }> = [{ key: "posts", label: "动态", count: others.length }];
  if (reviews.length > 0) tabs.push({ key: "reviews", label: "书评", count: reviews.length });
  if (shelf.length > 0) tabs.push({ key: "shelf", label: "书架", count: shelf.length });
  if (endorsed.length > 0) tabs.push({ key: "endorsed", label: "赞同" });
  const currentTab = tabs.some((tab) => tab.key === contentTab) ? contentTab : "posts";

  return (
    <div className="sr-forum-sub sr-forum-sub--profile">
      <div className="sr-forum-sub-head">
        <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
          <ChevronLeft size={22} strokeWidth={1.6} />
        </button>
        <span className="sr-forum-sub-title">{npc.nickname}</span>
        <div className="sr-pf-menu-wrap" ref={moreRef}>
          <button
            type="button"
            className="sr-icon-btn"
            aria-label="更多"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={20} strokeWidth={1.7} />
          </button>
          {moreOpen && (
            <div className="sr-pf-menu sr-pf-menu--end" role="menu">
              <button
                type="button"
                role="menuitem"
                className={blocked ? undefined : "sr-pf-menu-danger"}
                onClick={() => {
                  setMoreOpen(false);
                  if (blocked) onToggleBlock();
                  else setConfirmBlock(true);
                }}
              >
                <Ban size={15} strokeWidth={1.8} />
                {blocked ? "解除屏蔽" : "屏蔽"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sr-forum-sub-body">
        <div className="sr-pf-page">
          {blocked && <p className="sr-pf-banner">已屏蔽：TA 的帖子不在信息流里出现，也不会来回复你。</p>}

          <ProfileHero
            avatarSrc={avatar}
            name={npc.nickname}
            nameExtra={starred ? <Star size={15} strokeWidth={1.8} className="sr-pf-star" aria-label="特别关注" /> : null}
            idText={npc.id}
            subText={[npc.occupation, npc.age, npc.region].filter(Boolean).join(" · ") || undefined}
            stats={[
              { label: "发帖", value: posts.length },
              { label: "关注", value: followingCount(npc) },
              { label: "粉丝", value: followerCount(npc) },
              { label: "获赞", value: likes },
            ]}
            bubble={recentBook ? `最近在聊《${recentBook}》` : ""}
          />

          {(npc.background || npc.interests.length > 0) && (
            <div className="sr-pf-intro">
              {npc.background && <p className="sr-pf-sign">{npc.background}</p>}
              {npc.interests.length > 0 && (
                <div className="sr-pf-tags">
                  {npc.interests.map((item) => (
                    <span key={item} className="sr-pf-tag">{item}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="sr-pf-actions">
            {following ? (
              <div className="sr-pf-menu-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="sr-btn"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  {starred ? <Star size={16} strokeWidth={1.8} className="sr-pf-star" /> : <Check size={16} strokeWidth={1.8} />}
                  {starred ? "特别关注" : "已关注"}
                  <ChevronDown size={15} strokeWidth={1.8} />
                </button>
                {menuOpen && (
                  <div className="sr-pf-menu" role="menu">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={starred}
                      onClick={() => {
                        setMenuOpen(false);
                        onStar();
                      }}
                    >
                      <Star size={15} strokeWidth={1.8} />
                      {starred ? "取消特别关注" : "设为特别关注"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="sr-pf-menu-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        onFollow();
                      }}
                    >
                      取消关注
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" className="sr-btn sr-btn-primary" onClick={onFollow}>
                <UserPlus size={16} strokeWidth={1.8} />
                关注
              </button>
            )}
            {isFriend ? (
              <button type="button" className="sr-btn" onClick={onChat}>
                <MessageCircle size={16} strokeWidth={1.8} />
                私信
              </button>
            ) : (
              <button type="button" className="sr-btn" onClick={onAddFriend} disabled={busy} aria-busy={busy || undefined}>
                {busy ? <Loader2 size={16} className="sr-spin" /> : <UserPlus size={16} strokeWidth={1.8} />}
                {busy ? "添加中" : "加好友"}
              </button>
            )}
          </div>

          <section className="sr-pf-section" aria-label="内容">
            <ProfileTabs tabs={tabs} active={currentTab} onChange={setContentTab} />
            <div className="sr-pf-tabpanel" role="tabpanel">
              {currentTab === "posts" && (
                <PostStrip posts={others} onOpen={onOpenPost} empty={<ProfileEmpty text="TA 还没有发过动态" />} />
              )}
              {currentTab === "reviews" && <PostStrip posts={reviews} onOpen={onOpenPost} empty={null} />}
              {currentTab === "shelf" && (
                <TwoColumnGrid items={shelf.map((title) => ({ key: title, title: `《${title}》` }))} empty={null} />
              )}
              {currentTab === "endorsed" && <PostStrip posts={endorsed} onOpen={onOpenPost} empty={null} />}
            </div>
          </section>

          {(npc.readingTaste || npc.personality) && (
            <section className="sr-pf-section" aria-labelledby="sr-pf-about">
              <h3 className="sr-pf-section-title" id="sr-pf-about">关于 TA</h3>
              <dl className="sr-pf-about">
                {npc.readingTaste && (
                  <>
                    <dt>读书口味</dt>
                    <dd>{npc.readingTaste}</dd>
                  </>
                )}
                {npc.personality && (
                  <>
                    <dt>性格</dt>
                    <dd>{npc.personality}</dd>
                  </>
                )}
              </dl>
            </section>
          )}
        </div>
      </div>

      {confirmBlock && (
        <div className="sr-sheet-mask" onClick={() => setConfirmBlock(false)}>
          <div className="sr-sheet" role="alertdialog" aria-label={`屏蔽 ${npc.nickname}`} onClick={(event) => event.stopPropagation()}>
            <span className="sr-sheet-label" style={{ margin: 0 }}>屏蔽 {npc.nickname}？</span>
            <p className="sr-pf-sheet-text">TA 的帖子不再出现在信息流里，也不会再来回复你。之后可以在这里解除。</p>
            <div className="sr-sheet-actions">
              <button type="button" className="sr-btn" onClick={() => setConfirmBlock(false)}>
                取消
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-danger"
                onClick={() => {
                  setConfirmBlock(false);
                  onToggleBlock();
                }}
              >
                屏蔽
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
