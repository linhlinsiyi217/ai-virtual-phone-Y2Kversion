import { kvGet, kvRemove, kvSet } from "@/lib/kv-db";

export type ChatBeautyScope = "messages" | "contacts" | "feeds" | "me" | "room" | "offline";

export const CHAT_BEAUTY_UPDATED_EVENT = "chat-beauty-updated";

export const CHAT_BEAUTY_SCOPES: Array<{
  id: ChatBeautyScope;
  title: string;
  subtitle: string;
  group: "online" | "social";
  selector: string;
}> = [
  { id: "room", title: "在线聊天室", subtitle: "顶栏、消息气泡、输入栏与附件面板", group: "online", selector: ".chat-app[data-room-active]" },
  { id: "offline", title: "线下模式", subtitle: "线下页、状态栏、楼层与互动卡片", group: "online", selector: ".chat-app[data-room-active]" },
  { id: "messages", title: "消息", subtitle: "会话列表、搜索、未读与消息页装饰", group: "social", selector: ".chat-app[data-active-tab=\"messages\"]" },
  { id: "contacts", title: "联系人", subtitle: "联系人列表、分组与好友入口", group: "social", selector: ".chat-app[data-active-tab=\"contacts\"]" },
  { id: "feeds", title: "动态", subtitle: "朋友圈信息流、卡片与评论区", group: "social", selector: ".chat-app[data-active-tab=\"feeds\"]" },
  { id: "me", title: "我的", subtitle: "个人主页、功能卡与设置列表", group: "social", selector: ".chat-app[data-active-tab=\"me\"]" },
];

export const CHAT_BEAUTY_PRESETS: Record<ChatBeautyScope, Array<{ name: string; css: string }>> = {
  messages: [
    { name: "极简灰白", css: `.chat-main-content { background: #f3f3f3 !important; }\n.chat-message-list-page .menu-item { border-radius: 22px !important; background: rgba(255,255,255,.9) !important; }` },
    { name: "柔雾玻璃", css: `.chat-main-content { background: linear-gradient(145deg,#f7f7f5,#ececeb) !important; }\n.chat-message-list-page .menu-item { background: rgba(255,255,255,.62) !important; backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,.8); }` },
  ],
  contacts: [{ name: "留白名录", css: `.chat-contacts-page .menu-item { border-radius: 20px !important; margin: 6px 12px !important; background:#fff !important; }` }],
  feeds: [{ name: "画册动态", css: `.moments-feed-page { background:#f4f4f2 !important; }\n.moments-post-card { border-radius:24px !important; background:#fff !important; margin:12px !important; }` }],
  me: [{ name: "黑白主页", css: `.user-profile-page-root { background:#f5f5f5 !important; }\n.user-profile-page-root button { border-color:rgba(0,0,0,.08) !important; }` }],
  room: [
    { name: "极简黑白", css: `.chat-bubble-role-user { background:#171719 !important; color:#fff !important; border-radius:22px 22px 6px 22px !important; }\n.chat-bubble-role-assistant { background:#fff !important; color:#111 !important; border-radius:22px 22px 22px 6px !important; }` },
    { name: "雾面卡片", css: `.chat-room-wrapper { background:#f1f1ef !important; }\n.chat-msg-wrapper { filter:drop-shadow(0 8px 18px rgba(0,0,0,.05)); }` },
  ],
  offline: [{ name: "纸页线下", css: `.chat-offline-body { background:#f4f3ef !important; }\n[class*=\"chat-offline\"] { border-radius:22px !important; }` }],
};

export const CHAT_BEAUTY_CLASS_GROUPS = [
  { title: "应用与悬浮 Dock", rows: [["整个聊天应用", ".chat-app"], ["页面内容", ".chat-main-content"], ["底部 Dock", ".chat-dock-cluster、.chat-tab-bar"], ["Dock 按钮", ".chat-tab、.chat-dock-plus"], ["快捷面板", ".chat-dock-quick-panel"]] },
  { title: "消息与联系人", rows: [["消息页", ".chat-message-list-page"], ["联系人页", ".chat-contacts-page"], ["列表卡片", ".menu-item"], ["头像", ".chat-avatar、.chat-msg-avatar"]] },
  { title: "聊天室", rows: [["聊天室", ".chat-room-wrapper"], ["消息滚动区", ".chat-scroll-anchored"], ["一整行消息", ".chat-msg-wrapper"], ["我的气泡", ".chat-bubble-role-user"], ["角色气泡", ".chat-bubble-role-assistant"], ["输入栏", ".chat-input-bar"], ["文字框", ".chat-input-textarea"], ["附件面板", ".chat-plus-menu、.emoji-panel、.sticker-panel"]] },
  { title: "动态与我的", rows: [["动态页", ".moments-feed-page"], ["动态卡片", ".moments-post-card"], ["我的页面", ".user-profile-page-root"], ["HTML 装饰层", ".chat-html-decoration、[data-beauty-slot]"]] },
];

export function beautyCSSKey(scope: ChatBeautyScope) { return `chat-beauty-css:${scope}`; }
export function beautyHTMLKey(scope: ChatBeautyScope) { return `chat-beauty-html:${scope}`; }

export function loadChatBeauty(scope: ChatBeautyScope) {
  return { css: kvGet(beautyCSSKey(scope)) || "", html: kvGet(beautyHTMLKey(scope)) || "" };
}

export function saveChatBeauty(scope: ChatBeautyScope, css: string, html: string) {
  const trimmedCSS = css.trim();
  const trimmedHTML = html.trim();
  if (trimmedCSS) kvSet(beautyCSSKey(scope), trimmedCSS); else kvRemove(beautyCSSKey(scope));
  if (trimmedHTML) kvSet(beautyHTMLKey(scope), trimmedHTML); else kvRemove(beautyHTMLKey(scope));
  window.dispatchEvent(new CustomEvent(CHAT_BEAUTY_UPDATED_EVENT, { detail: { scope } }));
}

