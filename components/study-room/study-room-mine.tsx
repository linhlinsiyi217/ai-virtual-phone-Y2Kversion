"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Brain,
  ChevronRight,
  Crown,
  Database,
  Gift,
  Heart,
  MessagesSquare,
  Palette,
  PenLine,
  ScrollText,
  Settings2,
  Share2,
  StickyNote,
  X,
} from "lucide-react";

import { loadAllNotes, loadBooks } from "@/lib/reading-storage";
import type { Book } from "@/lib/reading-types";
import { loadUserIdentities } from "@/lib/settings-storage";
import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import { loadForum, saveForum, type ForumState } from "@/lib/study-room/forum";
import { deleteOwnComment, toggleCollect } from "@/lib/study-room/forum-social";
import {
  PROFILE_UPDATED_EVENT,
  STATUS_MAX,
  displayHandle,
  displayName,
  loadProfile,
  profileAvatarSrc,
  saveProfileAsync,
  type UserProfile,
} from "@/lib/study-room/profile";
import { MEMBERSHIP_UPDATED_EVENT, formatMemberDate, isMemberActive, loadMembership } from "@/lib/study-room/membership";
import { loadWishlist } from "@/lib/study-room/wishlist";
import { loadDrafts, draftWordCount } from "@/lib/study-room/creative";
import { useForumReplyEngine, useMeCard } from "./forum-reply-engine";
import { GiftSheet } from "./gift-sheet";
import { ColorSheet } from "./color-sheet";

/** 气泡底色常用色：浅色为主，深色时气泡里的字自动变白 */
const BUBBLE_SWATCHES = ["#e8f0fb", "#fde8ee", "#fff4d6", "#e6f4ea", "#efe8fb", "#2b313b"];
import { StudyRoomForumPostView } from "./study-room-forum-post";
import { ProfileEditSheet, SvipSheet } from "./study-room-profile-edit";
import {
  EntryGrid,
  PostStrip,
  ProfileEmpty,
  ProfileHero,
  ProfileTabs,
  TwoColumnGrid,
} from "./study-room-profile-parts";

type StudyRoomMineProps = {
  onOpenNotes: () => void;
  onOpenMessages: () => void;
  onOpenAppearance: () => void;
  onOpenBackup: () => void;
  onOpenReadingMemory: () => void;
  onOpenGifts: () => void;
  onOpenUpdateLog: () => void;
  onOpenWishlist: () => void;
  /** 打开某个创作草稿 */
  onOpenDraft: (draftId: string) => void;
  /** 在书友圈里打开原帖（浮层里点书友名字时用：要去书友主页） */
  onOpenPost: (postId: string) => void;
  /** 浮层里点「在书房读」 */
  onOpenBook: (book: Book) => void;
  /** 去书友圈发第一条动态 */
  onCompose: () => void;
  /** 去书桌开始写作品 */
  onOpenDesk: () => void;
};

type ContentTab = "posts" | "works" | "reviews" | "saves";

const STATUS_PRESETS = ["在读", "想找人共读", "书荒中", "在写东西", "今天不想说话", "(｡･ω･｡)"];
const DEFAULT_TAG_COLOR = "#7A8FA6";

/** 找到页面真正在滚动的那一层（书房内容区），浮层打开时锁住它，关掉后原位恢复。 */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * 我的主页（社交主页结构）：
 * 云朵气泡 → 头像 + 名字/ID/真实统计 → 签名与标签 → 编辑资料 / 分享
 * → 动态/作品（下划线分区，卡片横滑）→ 常用入口。低频的设置收进右上角齿轮。
 * 点动态卡在本页居中打开帖子浮层，不跳去书友圈，关掉回到原来的分区与位置。
 */
export function StudyRoomMine({
  onOpenNotes,
  onOpenMessages,
  onOpenAppearance,
  onOpenBackup,
  onOpenReadingMemory,
  onOpenGifts,
  onOpenUpdateLog,
  onOpenWishlist,
  onOpenDraft,
  onOpenBook,
  onCompose,
  onOpenDesk,
}: StudyRoomMineProps) {
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [membership, setMembership] = useState(() => loadMembership());
  const [forum, setForum] = useState<ForumState>(() => loadForum());
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [svipOpen, setSvipOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  // 气泡底色草稿：undefined = 默认玻璃白；只在点「保存」时写进资料
  const [colorDraft, setColorDraft] = useState<string | undefined>(undefined);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("posts");
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const drafts = useMemo(() => loadDrafts(), []);
  const wishCount = useMemo(() => loadWishlist().length, []);
  const hostName = useMemo(() => loadUserIdentities()[0]?.name ?? null, []);
  const identityAvatar = useMemo(() => loadUserIdentities()[0]?.avatarUrl ?? null, []);
  const member = isMemberActive(membership);

  useEffect(() => {
    let cancelled = false;
    loadAllNotes()
      .then((notes) => {
        if (!cancelled) setNoteCount(notes.length);
      })
      .catch(() => {
        // 读不到就不显示数字，不填假数
      });
    // 资料与会员在别处改了（编辑页、钱包），这里跟着刷新
    const onProfile = () => setProfile(loadProfile());
    const onMember = () => setMembership(loadMembership());
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfile);
    window.addEventListener(MEMBERSHIP_UPDATED_EVENT, onMember);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfile);
      window.removeEventListener(MEMBERSHIP_UPDATED_EVENT, onMember);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  // 帖子浮层打开时锁住背后的滚动；关掉后滚动位置不变
  useEffect(() => {
    if (!openPostId) return;
    const scroller = scrollParent(pageRef.current);
    if (!scroller) return;
    const previous = scroller.style.overflowY;
    scroller.style.overflowY = "hidden";
    return () => {
      scroller.style.overflowY = previous;
    };
  }, [openPostId]);

  const mutateForum = useCallback((updater: (prev: ForumState) => ForumState) => {
    setForum((prev) => {
      const next = updater(prev);
      saveForum(next);
      return next;
    });
  }, []);

  const flash = useCallback((message: string, ms = 2200) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const myPosts = forum.posts
    .filter((post) => post.authorId === "user")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const myDynamics = myPosts.filter((post) => post.kind !== "review");
  const myReviews = myPosts.filter((post) => post.kind === "review");
  const myLikes = myPosts.reduce((total, post) => total + post.likedBy.length, 0);
  const mySaves = forum.posts.filter((post) => (post.collectedBy ?? []).includes("user"));
  const followers = forum.npcs.filter((npc) => (npc.followers ?? []).includes("user")).length;
  const following = forum.following.length;

  const avatarSrc = profileAvatarSrc(profile, identityAvatar, avatarDataUrl(profile.avatar));
  const name = displayName(profile, hostName);
  const handle = displayHandle(profile);

  const tabs: Array<{ key: ContentTab; label: string; count?: number }> = [
    { key: "posts", label: "动态", count: myDynamics.length },
    { key: "works", label: "作品", count: drafts.length },
  ];
  if (myReviews.length > 0) tabs.push({ key: "reviews", label: "书评", count: myReviews.length });
  if (mySaves.length > 0) tabs.push({ key: "saves", label: "收藏", count: mySaves.length });
  const currentTab = tabs.some((tab) => tab.key === contentTab) ? contentTab : "posts";

  const openStatus = () => {
    setStatusDraft(profile.status);
    setColorDraft(profile.statusColor);
    setStatusError(null);
    setStatusOpen(true);
  };

  /** 气泡单独保存：真的写进存储才关；失败保留输入并说明原因。 */
  const saveStatus = async (value: string, color: string | undefined = colorDraft) => {
    setStatusSaving(true);
    setStatusError(null);
    try {
      const next = await saveProfileAsync({ ...profile, status: value.trim().slice(0, STATUS_MAX), statusColor: color });
      setProfile(next);
      setStatusOpen(false);
    } catch (error) {
      setStatusError(`没能保存：${error instanceof Error ? error.message : "存储暂时不可用"}`);
    } finally {
      setStatusSaving(false);
    }
  };

  // 分享：系统分享面板优先，不支持就复制到剪贴板；只分享名片文字，不带任何本地数据
  const shareProfile = async () => {
    const text = [`${name}（ID：${handle}）`, profile.status.trim(), profile.signature.trim()].filter(Boolean).join("\n");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `${name} 的书房主页`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      flash("主页名片已复制");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        flash("主页名片已复制");
      } catch {
        flash("这台设备暂时不能分享或复制");
      }
    }
  };

  const iconProps = { size: 18, strokeWidth: 1.7 } as const;
  const openPost = forum.posts.find((post) => post.id === openPostId) ?? null;
  const fromSettings = (action: () => void) => () => {
    setSettingsOpen(false);
    action();
  };

  return (
    <div className="sr-pf-page" ref={pageRef}>
      <ProfileHero
        avatarSrc={avatarSrc}
        name={name}
        nameExtra={member ? <span className="sr-pf-svip" title={`SVIP 到 ${formatMemberDate(membership.endAt)}`}>SVIP</span> : undefined}
        idText={handle}
        stats={[
          { label: "动态", value: myPosts.length },
          { label: "关注", value: following },
          { label: "粉丝", value: followers },
          { label: "获赞", value: myLikes },
        ]}
        bubble={profile.status}
        // 面板开着时，背后的气泡实时预览草稿颜色；关掉不保存就回到原来的颜色
        bubbleColor={statusOpen ? colorDraft : profile.statusColor}
        onEditBubble={openStatus}
        corner={
          <button type="button" className="sr-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="主页设置">
            <Settings2 size={20} strokeWidth={1.6} />
          </button>
        }
      />

      {(profile.signature.trim() || profile.tags.length > 0) && (
        <div className="sr-pf-intro">
          {profile.signature.trim() && <p className="sr-pf-sign">{profile.signature}</p>}
          {profile.tags.length > 0 && (
            <div className="sr-pf-tags">
              {profile.tags.map((tag) => (
                <span
                  key={tag}
                  className="sr-pf-tag"
                  style={{ "--sr-tag-color": profile.tagColors[tag] ?? DEFAULT_TAG_COLOR } as CSSProperties}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sr-pf-actions">
        <button type="button" className="sr-btn sr-btn-primary" onClick={() => setEditing(true)}>
          <PenLine size={16} strokeWidth={1.8} />
          编辑资料
        </button>
        <button type="button" className="sr-btn" onClick={() => void shareProfile()}>
          <Share2 size={16} strokeWidth={1.8} />
          分享
        </button>
      </div>

      <section className="sr-pf-section" aria-label="内容">
        <ProfileTabs tabs={tabs} active={currentTab} onChange={setContentTab} />
        <div className="sr-pf-tabpanel" role="tabpanel">
          {currentTab === "posts" && (
            <PostStrip
              posts={myDynamics}
              onOpen={setOpenPostId}
              empty={<ProfileEmpty text="还没有发过动态" action={{ label: "发布第一条动态", onClick: onCompose }} />}
            />
          )}
          {currentTab === "works" && (
            <TwoColumnGrid
              items={drafts.map((draft) => ({
                key: draft.id,
                title: draft.title.trim() || "未命名作品",
                meta: `${draft.chapters.length} 章 · ${draftWordCount(draft)} 字 · ${draft.publishedBookId ? "已发布" : "草稿"}`,
                onOpen: () => onOpenDraft(draft.id),
              }))}
              empty={<ProfileEmpty text="还没有作品" action={{ label: "去书桌写一篇", onClick: onOpenDesk }} />}
            />
          )}
          {currentTab === "reviews" && <PostStrip posts={myReviews} onOpen={setOpenPostId} empty={null} />}
          {currentTab === "saves" && <PostStrip posts={mySaves} onOpen={setOpenPostId} empty={null} />}
        </div>
      </section>

      <section className="sr-pf-section" aria-labelledby="sr-pf-common">
        <h3 className="sr-pf-section-title" id="sr-pf-common">常用</h3>
        <EntryGrid
          items={[
            { key: "notes", label: "笔记", icon: <StickyNote {...iconProps} />, value: noteCount ?? undefined, onOpen: onOpenNotes },
            { key: "wish", label: "想读", icon: <Heart {...iconProps} />, value: wishCount, onOpen: onOpenWishlist },
            { key: "memory", label: "阅读记忆", icon: <Brain {...iconProps} />, onOpen: onOpenReadingMemory },
            { key: "messages", label: "共读记录", icon: <MessagesSquare {...iconProps} />, onOpen: onOpenMessages },
          ]}
        />
      </section>

      {/* 主页设置：低频入口 */}
      {settingsOpen && (
        <div className="sr-sheet-mask" onClick={() => setSettingsOpen(false)}>
          <div className="sr-sheet" role="dialog" aria-label="主页设置" onClick={(event) => event.stopPropagation()}>
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>设置</span>
              <button type="button" className="sr-icon-btn" onClick={() => setSettingsOpen(false)} aria-label="关闭">
                <X size={18} strokeWidth={1.7} />
              </button>
            </div>
            <ul className="sr-pf-settings-list">
              {[
                { key: "svip", label: "SVIP 会员", icon: <Crown {...iconProps} />, extra: member ? `到 ${formatMemberDate(membership.endAt)}` : "未开通", onOpen: () => setSvipOpen(true) },
                { key: "appearance", label: "外观", icon: <Palette {...iconProps} />, onOpen: onOpenAppearance },
                { key: "gifts", label: "礼物与送书", icon: <Gift {...iconProps} />, onOpen: onOpenGifts },
                { key: "backup", label: "数据与备份", icon: <Database {...iconProps} />, onOpen: onOpenBackup },
                { key: "log", label: "更新日志", icon: <ScrollText {...iconProps} />, onOpen: onOpenUpdateLog },
              ].map((item) => (
                <li key={item.key}>
                  <button type="button" className="sr-pf-settings-row" onClick={fromSettings(item.onOpen)}>
                    {item.icon}
                    <span>{item.label}</span>
                    {"extra" in item && item.extra && <em>{item.extra}</em>}
                    <ChevronRight size={16} strokeWidth={1.7} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 状态气泡：点气泡快速改 */}
      {statusOpen && (
        <div className="sr-sheet-mask" onClick={() => !statusSaving && setStatusOpen(false)}>
          <div className="sr-sheet" role="dialog" aria-label="状态气泡" onClick={(event) => event.stopPropagation()}>
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>
                状态气泡
                <em className="sr-pf-count">
                  {statusDraft.length}/{STATUS_MAX}
                </em>
              </span>
              <button type="button" className="sr-icon-btn" onClick={() => setStatusOpen(false)} aria-label="关闭">
                <X size={18} strokeWidth={1.7} />
              </button>
            </div>
            <textarea
              className="sr-appear-input sr-pf-textarea"
              rows={2}
              value={statusDraft}
              maxLength={STATUS_MAX}
              onChange={(event) => setStatusDraft(event.target.value)}
              placeholder="文字、颜文字或表情都可以"
              aria-label="状态"
              autoFocus
            />
            <div className="sr-chip-row" style={{ marginTop: 10 }}>
              {STATUS_PRESETS.map((preset) => (
                <button key={preset} type="button" className="sr-chip" onClick={() => setStatusDraft(preset)}>
                  {preset}
                </button>
              ))}
            </div>
            <div className="sr-pf-bubble-color" role="group" aria-label="气泡底色">
              <span className="sr-pf-bubble-color-label">气泡底色</span>
              <button
                type="button"
                className="sr-chip"
                data-active={!colorDraft ? "true" : undefined}
                onClick={() => setColorDraft(undefined)}
              >
                默认
              </button>
              {BUBBLE_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className="sr-pf-bubble-swatch"
                  data-active={colorDraft === swatch ? "true" : undefined}
                  style={{ background: swatch }}
                  onClick={() => setColorDraft(swatch)}
                  aria-label={`气泡底色 ${swatch}`}
                />
              ))}
              <button type="button" className="sr-chip" onClick={() => setColorPickerOpen(true)}>
                {colorDraft && !BUBBLE_SWATCHES.includes(colorDraft) ? colorDraft.toUpperCase() : "自定义"}
              </button>
            </div>
            {statusError && <p className="sr-pf-form-error" role="alert" style={{ marginTop: 10 }}>{statusError}</p>}
            <div className="sr-sheet-actions">
              <button
                type="button"
                className="sr-btn"
                onClick={() => {
                  // 清空只清文字，底色保持已保存的值
                  void saveStatus("", profile.statusColor);
                }}
                disabled={!profile.status || statusSaving}
              >
                清空
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-primary"
                onClick={() => void saveStatus(statusDraft)}
                disabled={statusSaving}
                aria-busy={statusSaving || undefined}
              >
                {statusSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusOpen && colorPickerOpen && (
        <ColorSheet
          title="气泡底色"
          value={colorDraft ?? "#ffffff"}
          opaque
          onChange={(value) => setColorDraft(value)}
          onClose={() => setColorPickerOpen(false)}
        />
      )}

      {editing && (
        <ProfileEditSheet
          profile={profile}
          hostName={hostName}
          hostAvatar={identityAvatar}
          member={member}
          onSaved={(next) => {
            setProfile(next);
            setEditing(false);
            flash("资料已保存");
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {svipOpen && (
        <SvipSheet
          onClose={() => setSvipOpen(false)}
          onChanged={(state) => setMembership(state)}
        />
      )}

      {openPost && (
        <MinePostOverlay
          key={openPost.id}
          postId={openPost.id}
          state={forum}
          mutate={mutateForum}
          flash={flash}
          onClose={() => setOpenPostId(null)}
          onOpenBook={(book) => {
            setOpenPostId(null);
            onOpenBook(book);
          }}
        />
      )}

      {notice && (
        <div className="sr-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

/**
 * 我的主页里的帖子浮层：复用书友圈同一套帖子详情、点赞、收藏、评论与书友回应。
 * 书友回应只在浮层开着时生成，关掉即暂停（排队的保留）。
 */
function MinePostOverlay({
  postId,
  state,
  mutate,
  flash,
  onClose,
  onOpenBook,
}: {
  postId: string;
  state: ForumState;
  mutate: (updater: (prev: ForumState) => ForumState) => void;
  flash: (message: string, ms?: number) => void;
  onClose: () => void;
  onOpenBook: (book: Book) => void;
}) {
  const me = useMeCard();
  const engine = useForumReplyEngine({ state, mutate, flash, meName: me.name, where: "这条帖子" });
  const [gift, setGift] = useState(false);
  const books = useMemo(() => {
    const map: Record<string, Book> = {};
    for (const book of loadBooks()) map[book.id] = book;
    return map;
  }, []);
  const post = state.posts.find((item) => item.id === postId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!post) return null;
  const npc = post.authorKind === "npc" ? state.npcs.find((item) => item.id === post.authorId) : undefined;

  return (
    <div className="sr-post-overlay" role="dialog" aria-modal="true" aria-label="帖子详情" onClick={onClose}>
      <div style={{ display: "contents" }} onClick={(event) => event.stopPropagation()}>
        <StudyRoomForumPostView
          variant="overlay"
          post={post}
          state={state}
          books={books}
          me={me}
          onBack={onClose}
          onOpenBook={onOpenBook}
          onLike={() => engine.like(post)}
          onComment={(body, replyToId, spoiler) => engine.comment(post, body, replyToId, spoiler)}
          onCollect={() => mutate((prev) => toggleCollect(prev, post.id))}
          onGift={() => setGift(true)}
          // 在自己主页里看动态：留在浮层，不跳去书友圈
          onOpenAuthor={() => undefined}
          onEdit={(body) =>
            mutate((prev) => ({
              ...prev,
              posts: prev.posts.map((item) => (item.id === post.id ? { ...item, body } : item)),
            }))
          }
          onDelete={() => {
            mutate((prev) => ({ ...prev, posts: prev.posts.filter((item) => item.id !== post.id) }));
            onClose();
            flash("已删除这条帖子");
          }}
          onDeleteComment={(commentId) => {
            mutate((prev) => deleteOwnComment(prev, post.id, commentId));
            flash("已删除这条评论");
          }}
          replyPanel={engine.renderReplyPanel(post.id)}
          onAskReply={(commentId) => engine.requestCommentReply(post.id, commentId)}
          pendingReplyIds={engine.commentPending}
        />
      </div>
      {gift && (
        <div onClick={(event) => event.stopPropagation()}>
          <GiftSheet
            mode="gift"
            postId={post.id}
            presetRecipient={npc ? { id: npc.id, name: npc.nickname, kind: "npc" as const } : undefined}
            onClose={() => setGift(false)}
          />
        </div>
      )}
    </div>
  );
}
