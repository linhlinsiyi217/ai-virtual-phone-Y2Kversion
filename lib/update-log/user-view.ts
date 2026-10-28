// lib/update-log/user-view.ts — 更新公告与更新日志的「用户可见」视图（纯函数）。
//
// 同一份结构化发布记录（system-data.ts / studyroom-data.ts）派生两套内容：
//   - 公告（noticeOf）：版本、日期、一句话总结、按「新增 / 修复 / 优化」各列标题、影响的应用、
//     是否需要刷新或重装。只取标题，不放细节。
//   - 日志（logGroupsOf）：按八类用户分组列出每条记录的应用、标题和全部说明。
// 内部字段（releaseId、pending、includes、条目 id）只在开发模式显示，生产环境不渲染。
// 文本里漏写的文件名、代码标识在生产环境会被过滤掉（兜底，写日志时仍应写成大白话）。

import { normalizeUpdateCategory, normalizeUpdateScope, type Release, type UpdateEntry } from "./types";

export const SHOW_TECH_DETAILS = process.env.NODE_ENV !== "production";

export type UserGroup = "new" | "fix" | "improve" | "visual" | "content" | "global" | "prompt" | "important";

export const USER_GROUP_LABEL: Record<UserGroup, string> = {
  new: "新增",
  fix: "修复",
  improve: "优化",
  visual: "视觉调整",
  content: "应用内容更新",
  global: "全局功能更新",
  prompt: "提示词更新",
  important: "重要变更",
};

export const USER_GROUP_ORDER: UserGroup[] = ["important", "new", "fix", "improve", "visual", "content", "global", "prompt"];

export const USER_GROUP_COLOR: Record<UserGroup, string> = {
  new: "#00A86B",
  fix: "#F04438",
  improve: "#2563EB",
  visual: "#0E9F9A",
  content: "#34A853",
  global: "#7C5CFC",
  prompt: "#F59E0B",
  important: "#7C3AED",
};

const VISUAL_HINT = /外观|样式|视觉|配色|颜色|动画|动效|排版|布局|图标|圆角|间距|字号/;

/** 每条记录只归入一组：隐私安全 → 重要变更；提示词/AI → 提示词更新；修复 → 修复；
 *  新功能 → 新增；体验优化里纯外观的 → 视觉调整，影响全局的 → 全局功能更新，其余 → 优化。 */
export function userGroupOf(entry: UpdateEntry): UserGroup {
  const category = normalizeUpdateCategory(entry.category);
  const scope = entry.scope ? normalizeUpdateScope(entry.scope) : undefined;
  if (category === "privacy") return "important";
  if (scope === "ai") return "prompt";
  if (category === "fix") return "fix";
  if (category === "feat") return scope === "content" && /内容|书目|素材|题库|文案/.test(entry.title) ? "content" : "new";
  if (VISUAL_HINT.test(entry.title)) return "visual";
  if (scope === "global") return "global";
  return "improve";
}

// 用户看不懂的技术片段：文件名、路径、驼峰标识、反引号、常见开发术语
const TECH_PATTERNS: RegExp[] = [
  /`[^`]*`/g,
  // 带扩展名的文件名或路径（lib/update-log/types.ts）；「5/15/30」「http/https」这类普通写法不动
  /(?:[\w.-]+\/)*[\w-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|kt|xml|apk)\b/gi,
  /\b(?:tsc|npm|git|github|vercel|supabase|commit|PR|branch|bundle|chunk|releaseId|commitSha|webVersion|versionCode|versionName|localStorage|IndexedDB|Service Worker|no-store|no-cache|AbortError|z-index|props?|hook)\b/gi,
  // 代码标识（fetchConfig、pendingIntent）；iMessage、iPhone 这类产品名不算
  /\b[a-z]{2,}[A-Z]\w*\b/g,
  // 类名 / 报错名（PushService、AbortError、UpdateManager）
  /\b[A-Z][a-z]+(?:[A-Z][a-z]+)*(?:Service|Error|Manager|Provider|Context|Store|Config|Intent|Scheduler|Exception|Handler)\b/g,
];

/** 生产环境兜底：去掉文本里的技术片段并收拾多余标点；开发模式原样返回 */
export function userText(text: string): string {
  if (SHOW_TECH_DETAILS) return text;
  let out = text;
  for (const pattern of TECH_PATTERNS) out = out.replace(pattern, "");
  return out
    .replace(/[（(]\s*[)）]/g, "")
    // 被删空的「动词 + 标点」：新增 ，修改 ，修复 。
    .replace(/(?:^|(?<=[，,；;。]))\s*(?:新增|修改|修复|删除|调整|更新|把|将|在)\s*(?=[，,；;。]|$)/g, "")
    .replace(/\s*[/／、，,；;]\s*(?=[/／、，,；;。）)]|$)/g, "")
    .replace(/^[\s:：、，,;；/。]+|[\s:：、，,;；/]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type NoticeLine = { group: UserGroup; app: string; title: string };

export type ReleaseNotice = {
  version: string;
  date: string;
  /** 一句话总结 */
  headline: string;
  lines: NoticeLine[];
  /** 涉及的应用（按出现顺序去重） */
  apps: string[];
  /** 是否需要重新安装安卓版（有「应用功能」条目时） */
  needsReinstall: boolean;
};

/** 一句话总结：取 summary 的第一句（到第一个句号/分号），过长时截断 */
function headlineOf(summary: string): string {
  const clean = userText(summary);
  const first = clean.split(/(?<=[。；;！!])/)[0]?.replace(/[；;]$/, "。") ?? clean;
  return first.length > 60 ? `${first.slice(0, 58)}…` : first;
}

/** 公告：每组最多列几条标题，总数受限，五秒内能看完 */
export function noticeOf(release: Release, maxLines = 6): ReleaseNotice {
  const groups: Partial<Record<UserGroup, NoticeLine[]>> = {};
  for (const entry of release.entries) {
    const group = userGroupOf(entry);
    (groups[group] ??= []).push({ group, app: userText(entry.app.split(" · ")[0]), title: userText(entry.title) });
  }
  // 轮流从各组取，保证每类至少露一条
  const ordered = USER_GROUP_ORDER.map((group) => groups[group] ?? []);
  const lines: NoticeLine[] = [];
  for (let round = 0; lines.length < maxLines && ordered.some((list) => list.length > round); round += 1) {
    for (const list of ordered) {
      if (lines.length >= maxLines) break;
      if (list[round]) lines.push(list[round]);
    }
  }
  lines.sort((a, b) => USER_GROUP_ORDER.indexOf(a.group) - USER_GROUP_ORDER.indexOf(b.group));
  const apps: string[] = [];
  for (const entry of release.entries) {
    const root = userText(entry.app.split(" · ")[0]);
    if (root && !apps.includes(root)) apps.push(root);
  }
  return {
    version: release.version,
    date: release.date,
    headline: headlineOf(release.summary),
    lines,
    apps,
    needsReinstall: release.entries.some((entry) => entry.scope === "app" && /安卓/.test(entry.app)),
  };
}

export type LogGroup = { group: UserGroup; entries: Array<{ id: string; app: string; title: string; items: string[] }> };

/** 日志：按八类用户分组，每条带应用、标题和全部说明 */
export function logGroupsOf(release: Release): LogGroup[] {
  return USER_GROUP_ORDER.map((group) => ({
    group,
    entries: release.entries
      .filter((entry) => userGroupOf(entry) === group)
      .map((entry) => ({
        id: entry.id,
        app: userText(entry.app),
        title: userText(entry.title),
        items: entry.items.map(userText).filter(Boolean),
      })),
  })).filter((item) => item.entries.length > 0);
}

/** 只保留用户可见字段的发布记录（给线上接口用，pending / includes 不出接口） */
export function publicRelease(release: Release): Release {
  return {
    version: release.version,
    releaseId: release.releaseId,
    date: release.date,
    name: release.name,
    summary: release.summary,
    entries: release.entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      scope: entry.scope,
      app: entry.app,
      title: entry.title,
      items: entry.items,
    })),
    // 只用于确认时把同批书房版本一起记为已读，界面不显示
    includes: release.includes,
  };
}
