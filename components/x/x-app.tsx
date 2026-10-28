"use client";

// X 应用（仿 X/Twitter）—— 自 wanwan/js/x-page.js + css/x-page.css 完整迁移改写。
// 功能：身份账号选择/切换、时间线（为你推荐/正在跟随）、发帖、点赞、
//       个人主页、资料编辑、移动端左缘右滑返回、本地持久化（kv-db）。
// 账号来源：float 用户身份（UserIdentity），不再依赖 wanwan 的 characters(type=user)。

import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ImagePlus, PenLine } from "lucide-react";

import { loadUserIdentities } from "@/lib/settings-storage";
import type { UserIdentity } from "@/components/settings/user-identity";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { hydrateMomentsStorage, loadMomentPosts, loadAllMomentComments, loadMomentComments, addMomentComment, toggleMomentLike } from "@/lib/moments-storage";
import type { MomentComment, MomentPost } from "@/lib/moments-types";
import {
  defaultXHandle,
  formatXNumber,
  formatXTime,
  isPostBookmarkedBy,
  isPostLikedBy,
  loadXState,
  makeXPostId,
  normalizeXCount,
  normalizeXJoinMonth,
  normalizeXJoinYear,
  resolveXProfile,
  saveXState,
  stripXAt,
  togglePostBookmark,
  togglePostLike,
} from "@/lib/x-storage";
import type { XPost, XPostComment, XProfile, XState } from "@/lib/x-types";

type XAppProps = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type XPage = "feed" | "login" | "compose" | "profile" | "edit";

const USER_IDENTITIES_UPDATED_EVENT = "user-identities-updated";

function fileToDataUrl(file: File, maxSize = 400, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片格式无法读取"));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || maxSize, image.naturalHeight || maxSize));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.naturalWidth || maxSize) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || maxSize) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("图片处理失败"));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

/** 左缘右滑返回（wanwan：起点 x<25，位移 >80px 且纵向 <100px） */
function useEdgeSwipeBack(onBack: () => void) {
  const touch = useRef({ startX: 0, startY: 0, tracking: false });
  const onTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    if (t.clientX < 25) {
      touch.current = { startX: t.clientX, startY: t.clientY, tracking: true };
    }
  }, []);
  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!touch.current.tracking) return;
    touch.current.tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.startX;
    const dy = Math.abs(t.clientY - touch.current.startY);
    if (dx > 80 && dy < 100) onBack();
  }, [onBack]);
  return { onTouchStart, onTouchEnd };
}

function XLogoSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <g>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </g>
    </svg>
  );
}

function XVerifiedBadge() {
  return (
    <span className="x-post-verified">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <g>
          <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
        </g>
      </svg>
    </span>
  );
}

function XHeartSvg({ solid }: { solid: boolean }) {
  return solid ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" /></g></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" /></g></svg>
  );
}

const POST_ACTION_ICONS = {
  comment: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M1.751 10c0-4.42 3.584-8.005 8.005-8.005h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.005zm8.005-6.005c-3.317 0-6.005 2.69-6.005 6.005 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" /></g></svg>
  ),
  retweet: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.791-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.791 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" /></g></svg>
  ),
  views: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10H6v10H4zm9.248 0v-7h2v7h-2z" /></g></svg>
  ),
  bookmark: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" /></g></svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.29 3.3-1.42-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" /></g></svg>
  ),
} as const;

/** 正文渲染：#话题 高亮 + 换行（对应 wanwan formatXContent） */
function renderXContent(content: string) {
  return content.split("\n").map((line, lineIndex) => {
    const parts = line.split(/(#[A-Za-z0-9_\u4e00-\u9fa5]+)/g);
    return (
      <span key={lineIndex}>
        {lineIndex > 0 && <br />}
        {parts.map((part, partIndex) =>
          part.startsWith("#") && part.length > 1 ? (
            <span key={partIndex} className="x-hashtag">{part}</span>
          ) : (
            <span key={partIndex}>{part}</span>
          )
        )}
      </span>
    );
  });
}

/** G14 活人感：由最后聊天时间派生在线文案（纯派生，不落库） */
function charActiveLabel(updatedAtIso: string): string {
  const diff = Date.now() - new Date(updatedAtIso).getTime();
  if (diff < 2 * 60_000) return "刚刚活跃";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前活跃`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)} 小时前活跃`;
  return `${Math.floor(diff / 86_400_000)} 天前活跃`;
}

/** 朋友圈评论作者显示名（角色/用户/NPC 三种来源，名字落点不同） */
function momentCommentAuthorLabel(comment: MomentComment, charMeta: Record<string, { name: string }>): string {
  if (comment.authorType === "character") return charMeta[comment.authorId]?.name || "角色";
  if (comment.authorType === "npc") return comment.authorName || "路人";
  return comment.authorName || "我";
}

function XAvatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string; className?: string }) {
  if (avatarUrl) {
    return <img className={className} src={avatarUrl} alt={name} />;
  }
  return <span className={`x-avatar-placeholder ${className || ""}`}>{(name || "我").slice(0, 1)}</span>;
}

const BOTTOM_BAR_ITEMS = [
  {
    id: "home",
    defaultSvg: <svg viewBox="0 0 24 24"><g><path d="M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913h6.638c.511 0 .929-.41.929-.913v-7.075h3.008v7.075c0 .502.418.913.929.913h6.638c.511 0 .929-.41.929-.913V7.904c0-.301-.158-.584-.408-.758zM20 20l-4.5.01v-7.09c0-.5-.418-.91-.929-.91H9.43c-.511 0-.929.41-.929.91L8.5 20H4V8.773l8-5.27 8 5.271V20z" /></g></svg>,
    activeSvg: <svg viewBox="0 0 24 24"><g><path d="M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913H9.14c.511 0 .929-.41.929-.913v-7.075h3.862v7.075c0 .502.418.913.929.913h6.141c.511 0 .929-.41.929-.913V7.904c0-.301-.158-.584-.408-.758z" /></g></svg>,
  },
  {
    id: "search",
    defaultSvg: <svg viewBox="0 0 24 24"><g><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" /></g></svg>,
    activeSvg: null,
  },
  // G14：notifications/messages 是 wanwan 迁移残留的摆设按钮（点击只切高亮、
  // 没有真实页面与数据），按「所有按钮必须有真实点击逻辑」移除，底部栏只留首页与搜索。
] as const;

export function XApp({ onClose, onNotice }: XAppProps) {
  const [state, setState] = useState<XState>(() => loadXState());
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [page, setPage] = useState<XPage>("feed");
  const [loginReturnToProfile, setLoginReturnToProfile] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [bottomTab, setBottomTab] = useState<string>("home");
  const [draft, setDraft] = useState<{ backgroundImage: string; avatarUrl: string; name: string; handle: string; joinYear: string; joinMonth: string; following: string; followers: string } | null>(null);

  const persist = useCallback((next: XState) => {
    setState(next);
    saveXState(next);
  }, []);

  const sessionIdentity = useMemo(
    () => identities.find(identity => identity.id === state.sessionIdentityId) || null,
    [identities, state.sessionIdentityId]
  );

  const refreshIdentities = useCallback(() => {
    setIdentities(loadUserIdentities());
  }, []);

  useEffect(() => {
    refreshIdentities();
    const handler = () => refreshIdentities();
    window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, handler);
    return () => window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, handler);
  }, [refreshIdentities]);

  // 没有会话身份时进入登录页（首次打开、身份被删除后）
  useEffect(() => {
    if (!state.sessionIdentityId) setPage("login");
  }, [state.sessionIdentityId]);

  // 会话身份被删除时自动退回登录页
  useEffect(() => {
    if (state.sessionIdentityId && identities.length > 0 && !sessionIdentity) {
      persist({ ...state, sessionIdentityId: null });
      setPage("login");
    }
  }, [identities.length, persist, sessionIdentity, state]);

  const handleLogin = useCallback((identity: UserIdentity) => {
    persist({ ...state, sessionIdentityId: identity.id });
    if (loginReturnToProfile) {
      setPage("profile");
      setLoginReturnToProfile(false);
    } else {
      setPage("feed");
    }
  }, [loginReturnToProfile, persist, state]);

  const profile: XProfile | null = useMemo(
    () => resolveXProfile(state, sessionIdentity ? { id: sessionIdentity.id, name: sessionIdentity.name, nickname: sessionIdentity.name, avatarUrl: sessionIdentity.avatarUrl } : null),
    [sessionIdentity, state]
  );

  const posts = useMemo(
    () => [...state.posts].sort((a, b) => b.createdAt - a.createdAt),
    [state.posts]
  );

  const beginEdit = useCallback(() => {
    if (!profile || !sessionIdentity) return;
    setDraft({
      backgroundImage: profile.backgroundImage || "",
      avatarUrl: profile.avatarUrl || "",
      name: profile.name,
      handle: stripXAt(profile.handle),
      joinYear: profile.joinYear,
      joinMonth: profile.joinMonth,
      following: normalizeXCount(profile.following),
      followers: normalizeXCount(profile.followers),
    });
    setPage("edit");
  }, [profile, sessionIdentity]);

  const saveEdit = useCallback(() => {
    if (!draft || !sessionIdentity || !profile) return;
    const nextProfile: XProfile = {
      ...profile,
      backgroundImage: draft.backgroundImage.trim(),
      avatarUrl: draft.avatarUrl.trim(),
      name: draft.name.trim() || profile.name,
      handle: stripXAt(draft.handle.trim()) || stripXAt(profile.handle),
      joinYear: normalizeXJoinYear(draft.joinYear, profile.joinYear),
      joinMonth: normalizeXJoinMonth(draft.joinMonth, profile.joinMonth),
      following: normalizeXCount(draft.following),
      followers: normalizeXCount(draft.followers),
    };
    persist({
      ...state,
      profiles: { ...state.profiles, [sessionIdentity.id]: nextProfile },
      // 自己的头像/昵称变了，时间线里自己发的帖子同步更新
      posts: state.posts.map(post =>
        post.authorKind === "identity" && post.authorIdentityId === sessionIdentity.id
          ? { ...post, name: nextProfile.name, handle: nextProfile.handle, avatarUrl: nextProfile.avatarUrl }
          : post
      ),
    });
    setDraft(null);
    setPage("profile");
  }, [draft, persist, profile, sessionIdentity, state]);

  const publish = useCallback(() => {
    const content = composeText.trim();
    if (!content || !profile || !sessionIdentity) return;
    const post: XPost = {
      id: makeXPostId(),
      authorKind: "identity",
      authorIdentityId: sessionIdentity.id,
      name: profile.name,
      handle: profile.handle,
      avatarUrl: profile.avatarUrl || "",
      content,
      createdAt: Date.now(),
      comments: 0,
      retweets: 0,
      likes: 0,
      views: 0,
    };
    persist({ ...state, posts: [...state.posts, post] });
    setComposeText("");
    setPage("feed");
  }, [composeText, persist, profile, sessionIdentity, state]);

  const toggleLike = useCallback((post: XPost) => {
    if (!sessionIdentity) return;
    const liked = isPostLikedBy(state, sessionIdentity.id, post.id);
    const next = togglePostLike(state, sessionIdentity.id, post.id);
    persist({
      ...next,
      posts: next.posts.map(item =>
        item.id === post.id
          ? { ...item, likes: Math.max(0, item.likes + (liked ? -1 : 1)) }
          : item
      ),
    });
  }, [persist, sessionIdentity, state]);

  const pickImage = useCallback(async (kind: "backgroundImage" | "avatarUrl") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file, kind === "avatarUrl" ? 400 : 900, 0.8);
        setDraft(prev => (prev ? { ...prev, [kind]: dataUrl } : prev));
      } catch {
        onNotice?.("图片读取失败，请换一张试试");
      }
    };
    input.click();
  }, [onNotice]);

  const swipeBackToFeed = useEdgeSwipeBack(() => setPage("feed"));
  const feedSwipe = useEdgeSwipeBack(onClose);

  // ═══════════ G14：角色圈（活人感）═══════════
  // 数据全部只读复用统一数据源：动态来自朋友圈（moments-storage），在线状态从
  // 聊天会话的最后活跃时间纯派生，点赞/评论写回朋友圈同一份数据——不建第二套数据。

  const [activeTab, setActiveTab] = useState<"forYou" | "following" | "characters">("forYou");
  const [charPosts, setCharPosts] = useState<MomentPost[]>([]);
  const [charMeta, setCharMeta] = useState<Record<string, { name: string; avatarUrl: string; lastActiveIso: string | null }>>({});
  const [momentCommentLists, setMomentCommentLists] = useState<Record<string, MomentComment[]>>({});
  const [momentCommentCounts, setMomentCommentCounts] = useState<Record<string, number>>({});
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");

  const refreshCharPosts = useCallback(() => {
    void hydrateMomentsStorage().then(() => {
      setCharPosts(loadMomentPosts().filter(p => p.authorType === "character"));
      // 顺带把每条动态的评论数统计出来（评论和朋友圈共用同一数据源）
      const counts: Record<string, number> = {};
      for (const comment of loadAllMomentComments()) {
        counts[comment.postId] = (counts[comment.postId] || 0) + 1;
      }
      setMomentCommentCounts(counts);
    });
  }, []);

  const refreshCharMeta = useCallback(() => {
    // 每个角色最新会话时间 = 活人感的唯一数据源；没有会话就不显示在线状态
    const latestByContact = new Map<string, string>();
    for (const session of loadChatSessions()) {
      const prev = latestByContact.get(session.contactId);
      if (!prev || session.updatedAt > prev) latestByContact.set(session.contactId, session.updatedAt);
    }
    const meta: Record<string, { name: string; avatarUrl: string; lastActiveIso: string | null }> = {};
    for (const character of loadCharacters()) {
      meta[character.id] = {
        name: character.name,
        avatarUrl: character.avatar || "",
        lastActiveIso: latestByContact.get(character.id) || null,
      };
    }
    setCharMeta(meta);
  }, []);

  useEffect(() => {
    refreshCharPosts();
    refreshCharMeta();
  }, [refreshCharPosts, refreshCharMeta]);

  // 切到角色圈时刷新一次（聊天/朋友圈数据可能在 X 外发生了变化）
  useEffect(() => {
    if (activeTab === "characters") {
      refreshCharPosts();
      refreshCharMeta();
      setMomentCommentLists({});
      setOpenCommentId(null);
    }
  }, [activeTab, refreshCharPosts, refreshCharMeta]);

  const charPostsVisible = useMemo(
    () =>
      [...charPosts]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .filter(p => charMeta[p.authorId]),
    [charPosts, charMeta]
  );

  // ═══════════ G14：搜索真实化 + 两个时间线 tab 用真实数据区分 ═══════════
  // 「正在跟随」= 你创建的身份发的帖（authorKind === "identity"）；
  // 「为你推荐」= 全部帖子。搜索按关键词过滤当前 tab 的列表（空关键词 = 不过滤）。
  const keyword = searchText.trim().toLowerCase();
  const matchedPosts = useMemo(() => {
    const base = activeTab === "following" ? posts.filter(p => p.authorKind === "identity") : posts;
    if (!keyword) return base;
    return base.filter(p =>
      p.name.toLowerCase().includes(keyword) ||
      p.handle.toLowerCase().includes(keyword) ||
      p.content.toLowerCase().includes(keyword)
    );
  }, [activeTab, keyword, posts]);

  const matchedCharPosts = useMemo(() => {
    if (!keyword) return charPostsVisible;
    return charPostsVisible.filter(p =>
      (charMeta[p.authorId]?.name || "").toLowerCase().includes(keyword) ||
      p.content.toLowerCase().includes(keyword)
    );
  }, [charMeta, charPostsVisible, keyword]);

  const toggleCharLike = useCallback(
    (post: MomentPost) => {
      if (!sessionIdentity) return;
      // 写回朋友圈同一数据源：在 X 里点的赞，朋友圈里也看得见
      toggleMomentLike(post.id, "user", sessionIdentity.id);
      refreshCharPosts();
    },
    [refreshCharPosts, sessionIdentity]
  );

  const openMomentComments = useCallback(
    (postId: string) => {
      setMomentCommentLists(prev => ({ ...prev, [postId]: loadMomentComments(postId) }));
    },
    []
  );

  const sendMomentComment = useCallback(
    (postId: string, text: string) => {
      const content = text.trim();
      if (!content || !sessionIdentity) return;
      addMomentComment({
        postId,
        authorType: "user",
        authorId: sessionIdentity.id,
        authorName: profile?.name || sessionIdentity.name,
        content,
      });
      setMomentCommentLists(prev => ({ ...prev, [postId]: loadMomentComments(postId) }));
      setCommentDraft("");
    },
    [profile, sessionIdentity]
  );

  const retweetMoment = useCallback(
    (post: MomentPost) => {
      if (!profile || !sessionIdentity) return;
      const author = charMeta[post.authorId];
      const excerpt = post.content.length > 80 ? `${post.content.slice(0, 80)}…` : post.content;
      const quote: XPost = {
        id: makeXPostId(),
        authorKind: "identity",
        authorIdentityId: sessionIdentity.id,
        name: profile.name,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl || "",
        content: `转发 @${author?.name || "角色"}：${excerpt}`,
        createdAt: Date.now(),
        comments: 0,
        retweets: 0,
        likes: 0,
        views: 0,
      };
      persist({ ...state, posts: [...state.posts, quote] });
      onNotice?.(`已把 @${author?.name || "角色"} 的动态转发到时间线`);
    },
    [charMeta, onNotice, persist, profile, sessionIdentity, state]
  );

  // ═══════════ G14：本机帖子交互真实化 ═══════════
  const toggleBookmark = useCallback(
    (post: XPost) => {
      if (!sessionIdentity) return;
      const next = togglePostBookmark(state, sessionIdentity.id, post.id);
      persist(next);
      onNotice?.(isPostBookmarkedBy(next, sessionIdentity.id, post.id) ? "已收藏" : "已取消收藏");
    },
    [onNotice, persist, sessionIdentity, state]
  );

  const sendPostComment = useCallback(
    (post: XPost, text: string) => {
      const content = text.trim();
      if (!content || !profile) return;
      const comment: XPostComment = { id: makeXPostId(), name: profile.name, text: content, createdAt: Date.now() };
      persist({
        ...state,
        posts: state.posts.map(p =>
          p.id === post.id
            ? { ...p, commentsData: [...(p.commentsData || []), comment], comments: p.comments + 1 }
            : p
        ),
      });
      setCommentDraft("");
    },
    [persist, profile, state]
  );

  const retweetPost = useCallback(
    (post: XPost) => {
      if (!profile || !sessionIdentity) return;
      const excerpt = post.content.length > 80 ? `${post.content.slice(0, 80)}…` : post.content;
      const quote: XPost = {
        id: makeXPostId(),
        authorKind: "identity",
        authorIdentityId: sessionIdentity.id,
        name: profile.name,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl || "",
        content: `转发 @${post.name}：${excerpt}`,
        createdAt: Date.now(),
        comments: 0,
        retweets: 0,
        likes: 0,
        views: 0,
      };
      persist({
        ...state,
        posts: [...state.posts, quote, ...state.posts.map(p => (p.id === post.id ? { ...p, retweets: p.retweets + 1 } : p))],
      });
      onNotice?.(`已转发 @${post.name} 的帖子`);
    },
    [onNotice, persist, profile, sessionIdentity, state]
  );

  const sharePost = useCallback(
    async (post: XPost) => {
      const text = `${post.name}（@${post.handle}）：${post.content}`;
      try {
        if (navigator.share) {
          await navigator.share({ text });
        } else {
          await navigator.clipboard.writeText(text);
          onNotice?.("帖子内容已复制到剪贴板");
        }
      } catch {
        // 用户取消分享不算错误，静默即可
      }
    },
    [onNotice]
  );

  const formatXIsoTime = useCallback((iso: string) => formatXTime(new Date(iso).getTime() || 0), []);

  return (
    <div className="x-app-root">
      {/* ===== 登录/账号选择 ===== */}
      {page === "login" && (
        <div className="x-login-page">
          <button className="x-login-close" type="button" aria-label="返回" onClick={() => setPage(sessionIdentity ? (loginReturnToProfile ? "profile" : "feed") : "feed")}>
            <ChevronLeft size={23} />
          </button>
          <div className="x-login-shell">
            <div className="x-login-logo"><XLogoSvg /></div>
            <div className="x-login-title">登录 X</div>
            <div className="x-login-subtitle">选择用户身份继续</div>
            <button
              className="x-login-wechat"
              type="button"
              onClick={refreshIdentities}
            >
              <span>{identities.length > 0 ? "刷新身份列表" : "加载用户身份"}</span>
            </button>
            <div className="x-login-users" hidden={identities.length === 0}>
              {identities.map(identity => (
                <button
                  key={identity.id}
                  className="x-login-user"
                  type="button"
                  onClick={() => handleLogin(identity)}
                >
                  <span className="x-login-user-avatar">
                    <XAvatar name={identity.name} avatarUrl={identity.avatarUrl} />
                  </span>
                  <span className="x-login-user-main">
                    <span className="x-login-user-name">{identity.name}</span>
                    <span className="x-login-user-account">{identity.name}</span>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
            {identities.length === 0 && (
              <div className="x-login-empty">
                <div>暂无用户身份</div>
                <span>请先到「设置 → 用户身份」创建身份</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 主时间线 ===== */}
      {page === "feed" && sessionIdentity && profile && (
        <div className="x-page" {...feedSwipe}>
          <div className="x-topbar">
            <div className="x-topbar-main">
              <button
                className="x-topbar-avatar"
                type="button"
                aria-label="返回桌面（退出 X）"
                onClick={onClose}
              >
                <XAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
              </button>
              <div className="x-topbar-logo"><XLogoSvg /></div>
              <button className="x-topbar-right" type="button" aria-label="个人主页" onClick={() => setPage("profile")}>
                <PenLine size={20} />
              </button>
            </div>
            <div className="x-tabs">
              <button
                className={`x-tab ${activeTab === "forYou" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveTab("forYou")}
              >
                为你推荐
                <span className="x-tab-arrow">
                  <svg viewBox="0 0 24 24"><g><path d="M3.543 8.96l1.414-1.42L12 14.59l7.043-7.05 1.414 1.42L12 17.41 3.543 8.96z" /></g></svg>
                </span>
              </button>
              <button
                className={`x-tab ${activeTab === "following" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveTab("following")}
              >
                正在跟随
              </button>
              <button
                className={`x-tab ${activeTab === "characters" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveTab("characters")}
              >
                角色圈
              </button>
            </div>
          </div>

          {/* G14：搜索真实化——按关键词过滤当前 tab 的帖子/角色动态 */}
          {searchOpen && (
            <div className="x-searchbar">
              <input
                className="x-search-input"
                value={searchText}
                placeholder="搜索帖子、角色…"
                onChange={e => setSearchText(e.target.value)}
                autoFocus
              />
              <button
                className="x-search-cancel"
                type="button"
                onClick={() => { setSearchOpen(false); setSearchText(""); setBottomTab("home"); }}
              >
                取消
              </button>
            </div>
          )}

          <div className="x-feed">
            {/* ═══ G14：角色圈——朋友圈动态 + 活人感在线状态，数据全部复用统一数据源 ═══ */}
            {activeTab === "characters" ? (
              matchedCharPosts.length > 0 ? matchedCharPosts.map(post => {
                const meta = charMeta[post.authorId];
                if (!meta) return null;
                const liked = sessionIdentity
                  ? post.likes.some(l => l.authorType === "user" && l.authorId === sessionIdentity.id)
                  : false;
                const comments = momentCommentLists[post.id] || [];
                const isOpen = openCommentId === post.id;
                const online = meta.lastActiveIso
                  ? Date.now() - new Date(meta.lastActiveIso).getTime() < 5 * 60_000
                  : false;
                return (
                  <div className="x-post" key={post.id}>
                    <div className="x-post-avatar">
                      <XAvatar name={meta.name} avatarUrl={meta.avatarUrl} />
                      {online && <span className="x-char-online-dot" aria-label="在线" />}
                    </div>
                    <div className="x-post-body">
                      <div className="x-post-header">
                        <span className="x-post-name">{meta.name}</span>
                        <span className="x-post-handle">@{defaultXHandle(meta.name)}</span>
                        <span className="x-post-dot">·</span>
                        <span className="x-post-time">{formatXIsoTime(post.createdAt)}</span>
                        {meta.lastActiveIso && (
                          <span className={`x-char-active ${online ? "online" : ""}`}>
                            {online ? "在线" : charActiveLabel(meta.lastActiveIso)}
                          </span>
                        )}
                      </div>
                      <div className="x-post-content">{renderXContent(post.content)}</div>
                      {post.photoUrl && <img className="x-char-photo" src={post.photoUrl} alt="动态配图" />}
                      <div className="x-post-actions">
                        <button
                          className="x-post-action comment"
                          type="button"
                          aria-expanded={isOpen ? "true" : undefined}
                          onClick={() => {
                            if (isOpen) {
                              setOpenCommentId(null);
                            } else {
                              setOpenCommentId(post.id);
                              setCommentDraft("");
                              openMomentComments(post.id);
                            }
                          }}
                        >
                          {POST_ACTION_ICONS.comment}
                          <span>{formatXNumber(momentCommentCounts[post.id] || 0)}</span>
                        </button>
                        <button className="x-post-action retweet" type="button" onClick={() => retweetMoment(post)}>
                          {POST_ACTION_ICONS.retweet}
                          <span>转发</span>
                        </button>
                        <button
                          className={`x-post-action like ${liked ? "liked" : ""}`}
                          type="button"
                          onClick={() => toggleCharLike(post)}
                        >
                          <XHeartSvg solid={liked} />
                          <span>{formatXNumber(post.likes.length)}</span>
                        </button>
                      </div>
                      {isOpen && (
                        <div className="x-comment-panel">
                          <div className="x-comment-input-row">
                            <input
                              className="x-comment-input"
                              value={commentDraft}
                              placeholder={`评论 ${meta.name} 的动态…`}
                              onChange={e => setCommentDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") sendMomentComment(post.id, commentDraft);
                              }}
                            />
                            <button className="x-comment-send" type="button" onClick={() => sendMomentComment(post.id, commentDraft)}>
                              发送
                            </button>
                          </div>
                          {comments.length === 0 ? (
                            <div className="x-comment-empty">还没有评论，来说第一句</div>
                          ) : (
                            comments.map(comment => (
                              <div className="x-comment-item" key={comment.id}>
                                <span className="x-comment-author">{momentCommentAuthorLabel(comment, charMeta)}</span>
                                <span className="x-comment-text">{comment.content}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }) : (
                keyword ? (
                  <div className="x-feed-empty">没有匹配「{searchText.trim()}」的动态</div>
                ) : (
                  <div className="x-feed-empty">
                    角色还没有动态
                    <br />
                    <span>先陪 TA 聊聊天，或看看朋友圈</span>
                  </div>
                )
              )
            ) : matchedPosts.length > 0 ? matchedPosts.map(post => {
              const liked = isPostLikedBy(state, sessionIdentity.id, post.id);
              const bookmarked = isPostBookmarkedBy(state, sessionIdentity.id, post.id);
              const isOpen = openCommentId === post.id;
              return (
                <div className="x-post" key={post.id}>
                  <div className="x-post-avatar">
                    <XAvatar name={post.name} avatarUrl={post.avatarUrl} />
                  </div>
                  <div className="x-post-body">
                    <div className="x-post-header">
                      <span className="x-post-name">{post.name}</span>
                      {post.verified && <XVerifiedBadge />}
                      <span className="x-post-handle">@{post.handle}</span>
                      <span className="x-post-dot">·</span>
                      <span className="x-post-time">{formatXTime(post.createdAt)}</span>
                      <span className="x-post-more">
                        <svg viewBox="0 0 24 24"><g><path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" /></g></svg>
                      </span>
                    </div>
                    <div className="x-post-content">{renderXContent(post.content)}</div>
                    <div className="x-post-actions">
                      <button
                        className="x-post-action comment"
                        type="button"
                        aria-expanded={isOpen ? "true" : undefined}
                        onClick={() => {
                          setOpenCommentId(isOpen ? null : post.id);
                          if (!isOpen) setCommentDraft("");
                        }}
                      >
                        {POST_ACTION_ICONS.comment}
                        <span>{formatXNumber(post.comments)}</span>
                      </button>
                      <button className="x-post-action retweet" type="button" onClick={() => retweetPost(post)}>
                        {POST_ACTION_ICONS.retweet}
                        <span>{formatXNumber(post.retweets)}</span>
                      </button>
                      <button
                        className={`x-post-action like ${liked ? "liked" : ""}`}
                        type="button"
                        onClick={() => toggleLike(post)}
                      >
                        <XHeartSvg solid={liked} />
                        <span>{formatXNumber(post.likes)}</span>
                      </button>
                      {/* 浏览量是展示数据，不是操作——改成非按钮，避免假交互 */}
                      <span className="x-post-action views" title="浏览量">
                        {POST_ACTION_ICONS.views}
                        <span>{formatXNumber(post.views)}</span>
                      </span>
                      <button
                        className={`x-post-action bookmark ${bookmarked ? "bookmarked" : ""}`}
                        type="button"
                        aria-pressed={bookmarked ? "true" : undefined}
                        onClick={() => toggleBookmark(post)}
                      >
                        {POST_ACTION_ICONS.bookmark}
                      </button>
                      <button className="x-post-action share" type="button" onClick={() => void sharePost(post)}>
                        {POST_ACTION_ICONS.share}
                      </button>
                    </div>
                    {isOpen && (
                      <div className="x-comment-panel">
                        <div className="x-comment-input-row">
                          <input
                            className="x-comment-input"
                            value={commentDraft}
                            placeholder={`评论 @${post.handle}…`}
                            onChange={e => setCommentDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") sendPostComment(post, commentDraft);
                            }}
                          />
                          <button className="x-comment-send" type="button" onClick={() => sendPostComment(post, commentDraft)}>
                            发送
                          </button>
                        </div>
                        {(post.commentsData || []).length === 0 ? (
                          <div className="x-comment-empty">还没有评论，来说第一句</div>
                        ) : (
                          (post.commentsData || []).map(comment => (
                            <div className="x-comment-item" key={comment.id}>
                              <span className="x-comment-author">{comment.name}</span>
                              <span className="x-comment-text">{comment.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }) : (
              keyword ? (
                <div className="x-feed-empty">没有匹配「{searchText.trim()}」的帖子</div>
              ) : activeTab === "following" ? (
                <div className="x-feed-empty">
                  你关注的人还没有发帖
                  <br />
                  <span>点右下角，用你的身份发第一条</span>
                </div>
              ) : (
                <div className="x-feed-empty">还没有帖子，点右下角发一条</div>
              )
            )}
          </div>

          <button className="x-fab" type="button" aria-label="发帖" onClick={() => setPage("compose")}>
            <svg viewBox="0 0 24 24"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></svg>
          </button>

          <div className="x-bottombar">
            {BOTTOM_BAR_ITEMS.map(item => (
              <div
                key={item.id}
                className={`x-bottombar-item ${bottomTab === item.id ? "active" : ""}`}
                onClick={() => {
                  if (item.id === "search") {
                    // G14：搜索按钮打开搜索框并实时过滤当前 tab
                    setSearchOpen(true);
                    setBottomTab("search");
                  } else {
                    setSearchOpen(false);
                    setSearchText("");
                    setBottomTab("home");
                  }
                }}
              >
                <span className="icon-default">{item.defaultSvg}</span>
                {item.activeSvg && <span className="icon-active">{item.activeSvg}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== 发帖 ===== */}
      {page === "compose" && profile && (
        <div className="x-compose-page" {...swipeBackToFeed}>
          <div className="x-compose-header">
            <button className="x-compose-cancel" type="button" data-back aria-label="返回" onClick={() => { setComposeText(""); setPage("feed"); }}>取消</button>
            <button
              className="x-compose-publish"
              type="button"
              style={{ opacity: composeText.trim() ? 1 : 0.5 }}
              onClick={publish}
            >
              发布
            </button>
          </div>
          <div className="x-compose-body">
            <div className="x-compose-avatar">
              <XAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
            </div>
            <textarea
              className="x-compose-input"
              placeholder="有什么新鲜事？"
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              autoFocus
            />
          </div>
          <div className="x-compose-footer">
            <div className="x-compose-tools">
              <button className="x-compose-tool" type="button" aria-label="图片"><ImagePlus size={18} /></button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 个人主页 ===== */}
      {page === "profile" && profile && (
        <div className="x-profile-page" {...swipeBackToFeed}>
          <div
            className="x-profile-cover"
            style={profile.backgroundImage ? { backgroundImage: `url(${profile.backgroundImage})` } : undefined}
          >
            <button className="x-profile-circle-btn x-profile-back" type="button" aria-label="返回" onClick={() => setPage("feed")}>
              <ChevronLeft size={18} />
            </button>
            <button className="x-profile-circle-btn x-profile-switch" type="button" aria-label="切换账号" onClick={() => { setLoginReturnToProfile(true); setPage("login"); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 3 3 8l5 5v-3h8V6H8V3zm8 18 5-5-5-5v3H8v4h8v3z" /></svg>
            </button>
            <button className="x-profile-circle-btn x-profile-edit" type="button" aria-label="编辑个人资料" onClick={beginEdit}>
              <PenLine size={17} />
            </button>
          </div>
          <div className="x-profile-main">
            <div className="x-profile-avatar">
              <XAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
            </div>
            <div className="x-profile-name">{profile.name}</div>
            <div className="x-profile-handle">@{profile.handle}</div>
            <div className="x-profile-joined">
              <CalendarDays size={14} />
              <span>于 {profile.joinYear}年{profile.joinMonth}月加入</span>
              <ChevronRight size={15} />
            </div>
            <div className="x-profile-stats">
              <span><strong>{profile.following}</strong> 正在跟随</span>
              <span><strong>{profile.followers}</strong> 跟随者</span>
            </div>
          </div>
        </div>
      )}

      {/* ===== 资料编辑 ===== */}
      {page === "edit" && profile && draft && (
        <div className="x-profile-edit-page" {...swipeBackToFeed}>
          <div className="x-profile-edit-header">
            <button className="x-profile-edit-back" type="button" aria-label="返回" onClick={() => { setDraft(null); setPage("profile"); }}>
              <ChevronLeft size={18} />
            </button>
            <div className="x-profile-edit-title">编辑个人资料</div>
            <button className="x-profile-edit-save" type="button" onClick={saveEdit}>保存</button>
          </div>
          <div className="x-profile-edit-scroll">
            <button
              className="x-profile-edit-cover"
              type="button"
              style={draft.backgroundImage ? { backgroundImage: `url(${draft.backgroundImage})` } : undefined}
              onClick={() => pickImage("backgroundImage")}
            >
              <span><ImagePlus size={14} /> 背景图</span>
            </button>
            <button className="x-profile-edit-avatar" type="button" onClick={() => pickImage("avatarUrl")}>
              <XAvatar name={draft.name || profile.name} avatarUrl={draft.avatarUrl} />
            </button>
            <label className="x-profile-edit-field">
              昵称
              <input className="input-field" value={draft.name} placeholder="昵称" onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="x-profile-edit-field">
              用户名
              <input className="input-field" value={draft.handle} placeholder="用户名" onChange={e => setDraft({ ...draft, handle: e.target.value })} />
            </label>
            <div className="x-profile-edit-grid">
              <label className="x-profile-edit-field">
                加入年份
                <input className="input-field" inputMode="numeric" maxLength={4} value={draft.joinYear} onChange={e => setDraft({ ...draft, joinYear: e.target.value })} />
              </label>
              <label className="x-profile-edit-field">
                加入月份
                <input className="input-field" inputMode="numeric" maxLength={2} value={draft.joinMonth} onChange={e => setDraft({ ...draft, joinMonth: e.target.value })} />
              </label>
            </div>
            <div className="x-profile-edit-grid">
              <label className="x-profile-edit-field">
                正在跟随
                <input className="input-field" inputMode="numeric" value={draft.following} onChange={e => setDraft({ ...draft, following: e.target.value })} />
              </label>
              <label className="x-profile-edit-field">
                跟随者
                <input className="input-field" inputMode="numeric" value={draft.followers} onChange={e => setDraft({ ...draft, followers: e.target.value })} />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 无会话身份时兜底：直接展示登录页 */}
      {!sessionIdentity && page !== "login" && (
        <div className="x-login-page">
          <div className="x-login-shell">
            <div className="x-login-logo"><XLogoSvg /></div>
            <div className="x-login-title">登录 X</div>
            <div className="x-login-subtitle">选择用户身份继续</div>
            <button className="x-login-wechat" type="button" onClick={() => setPage("login")}>
              <span>选择身份登录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
