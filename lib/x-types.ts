// X 应用（仿 X/Twitter）类型定义 —— 自 wanwan/js/x-page.js 迁移改写

export type XPost = {
  id: string;
  /** seed = 内置示例帖；identity = 用户身份发的帖 */
  authorKind: "seed" | "identity";
  authorIdentityId?: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  verified?: boolean;
  content: string;
  createdAt: number;
  comments: number;
  retweets: number;
  likes: number;
  views: number;
  /** 本机帖子的真实评论（G14：评论按钮真实可用后落在这里；旧帖没有该字段） */
  commentsData?: XPostComment[];
};

export type XPostComment = {
  id: string;
  /** 评论者显示名（当前 X 身份昵称） */
  name: string;
  text: string;
  createdAt: number;
};

export type XProfile = {
  name: string;
  handle: string;
  avatarUrl?: string;
  backgroundImage?: string;
  joinYear: string;
  joinMonth: string;
  following: string;
  followers: string;
};

export type XState = {
  version: 1;
  /** 当前登录的用户身份 id */
  sessionIdentityId: string | null;
  /** 时间线帖子（全局共享，本地持久化） */
  posts: XPost[];
  /** 每个身份各自点过赞的帖子 id */
  likes: Record<string, string[]>;
  /** 每个身份各自的资料卡（头像/背景/昵称/加入时间/关注数） */
  profiles: Record<string, XProfile>;
  /** 每个身份各自收藏的帖子 id（G14：收藏按钮真实化） */
  bookmarks: Record<string, string[]>;
};
