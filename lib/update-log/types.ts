// lib/update-log/types.ts — 两套更新日志共用的类型与分类定义。
//
// 分类用彩色语义标签：新功能=绿，体验优化=蓝，问题修复=橙，隐私与安全=紫。
// 颜色只用于小标签与圆点，并且始终和文字分类一起出现（不靠颜色单独表意）；
// 正文保持深黑与灰色。
// 兼容历史数据：perf / tweak 两个旧键在界面上一并显示为「体验优化」。

export type UpdateCategory = "feat" | "fix" | "perf" | "tweak" | "privacy";

export type UpdateEntry = {
  /** 稳定 id：同一条记录不要改 id */
  id: string;
  category: UpdateCategory;
  /**
   * 影响范围（与 category 是两个维度）：category 说「改动的性质」（新功能/修复…），
   * scope 说「改动影响哪里」。安卓壳弹窗与日志页按它分组；
   * 老数据没有这个字段时当作 content。
   */
  scope?: UpdateScope;
  /** 属于哪个应用或模块，例如「书房 · 书城」「桌面」 */
  app: string;
  /** 一句话说明这次改了什么 */
  title: string;
  /** 具体内容（弹窗只取前几条，日志页显示全部） */
  items: string[];
};

export type Release = {
  /** 对外看到的版本号；每次正式发布（推到 main）都换新的，和 releaseId 一起换 */
  version: string;
  /** 唯一发布 id：换版本号时必须换它 */
  releaseId: string;
  /** 发布日期（YYYY-MM-DD） */
  date: string;
  /** 版本名，例如「书房 v2」 */
  name?: string;
  /** 收起时显示的一句话概括 */
  summary: string;
  entries: UpdateEntry[];
  /** 这版还没完成或还没实测的事，如实写出来 */
  pending?: string[];
  /**
   * 只用于系统（总）日志：本次发布一起上线的书房版本 releaseId。
   * 设置里的总日志和全局更新弹窗会把那一版书房条目原样合并进来，
   * 书房条目只写在 studyroom-data.ts 一处，两边不会不一致。
   */
  includes?: { studyroom?: string };
};

export const CATEGORY_LABEL: Record<UpdateCategory, string> = {
  feat: "新功能",
  fix: "问题修复",
  perf: "体验优化",
  tweak: "体验优化",
  privacy: "隐私与安全",
};

export const CATEGORY_ORDER: UpdateCategory[] = ["feat", "perf", "fix", "privacy"];

/** 旧数据的 tweak 与 perf 都归到「体验优化」，避免同一条日志出现两组同名分类 */
export function normalizeUpdateCategory(category: UpdateCategory): UpdateCategory {
  return category === "tweak" ? "perf" : category;
}

/** 分类色只用于小标签文字与圆点；始终与文字分类同时出现 */
export const CATEGORY_COLOR: Record<UpdateCategory, string> = {
  feat: "#00A86B",
  fix: "#F04438",
  perf: "#2563EB",
  tweak: "#2563EB",
  privacy: "#7C3AED",
};

/** 分类标签的浅色底（纯白卡上的小色块，保持低饱和） */
export const CATEGORY_TINT: Record<UpdateCategory, string> = {
  feat: "#E7FFF4",
  fix: "#FFF0EE",
  perf: "#EEF4FF",
  tweak: "#EEF4FF",
  privacy: "#F3EEFF",
};

// ── 影响范围（scope）────────────────────────────────
// app      应用功能  = 安卓壳本身（安装包）改了什么，需要重新安装；默认色：蓝 #3478F6
// content  页面内容  = 里面的页面和功能（书/章节/消息/公告/媒体），刷新即生效；默认色：绿 #34C759
// global   全局系统  = 状态栏/锁屏/主题/导航等影响所有页面的东西；默认色：紫 #7C5CFC
// ai       AI 与提示词 = AI 行为、工具、提示词、角色写法的更新；默认色：橙 #FF9500
// fix      修复与兼容 = 修了什么问题、兼容性与迁移修复；默认色：红 #FF3B30
// prompt   旧数据的「提示词」键，界面上一并显示为「AI 与提示词」。
// 颜色遵守全局规范：只做小面积点缀（小圆点/小标签），始终和文字分类一起出现。

export type UpdateScope = "app" | "content" | "global" | "ai" | "prompt" | "fix";

export const SCOPE_LABEL: Record<UpdateScope, string> = {
  app: "应用功能",
  content: "页面内容",
  global: "全局系统",
  ai: "AI 与提示词",
  prompt: "AI 与提示词",
  fix: "修复与兼容",
};

export const SCOPE_ORDER: UpdateScope[] = ["app", "content", "global", "ai", "fix"];

export const SCOPE_COLOR: Record<UpdateScope, string> = {
  app: "#3478F6",
  content: "#34C759",
  global: "#7C5CFC",
  ai: "#FF9500",
  prompt: "#FF9500",
  fix: "#FF3B30",
};

/** 分类标签的底色：用主色的低透明度版本，浅色/深色背景上都能保持低饱和可读 */
export const SCOPE_TINT: Record<UpdateScope, string> = {
  app: "rgba(52, 120, 246, 0.14)",
  content: "rgba(52, 199, 89, 0.16)",
  global: "rgba(124, 92, 252, 0.14)",
  ai: "rgba(255, 149, 0, 0.16)",
  prompt: "rgba(255, 149, 0, 0.16)",
  fix: "rgba(255, 59, 48, 0.14)",
};

/** 老数据没有 scope 字段时当作「页面内容」；旧「提示词」键归入「AI 与提示词」 */
export function normalizeUpdateScope(scope?: UpdateScope): UpdateScope {
  if (!scope || !(scope in SCOPE_LABEL)) return "content";
  return scope === "prompt" ? "ai" : scope;
}

export type ScopeGroup = { scope: UpdateScope; entries: UpdateEntry[] };

/** 按影响范围分组（顺序固定：应用→页面内容→全局→提示词→修复），空组丢弃 */
export function scopeGroups(entries: UpdateEntry[]): ScopeGroup[] {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    entries: entries.filter((entry) => entry.scope === scope),
  })).filter((group) => group.entries.length > 0);
}

/** 这一版有没有任何条目标了影响范围（整版老数据 → 界面退回按性质分类展示） */
export function releaseHasScope(release: Release): boolean {
  return release.entries.some((entry) => typeof entry.scope === "string");
}

/** 一个版本涉及的应用名（收起时显示） */
export function releaseApps(release: Release): string[] {
  const seen: string[] = [];
  for (const entry of release.entries) {
    const root = entry.app.split(" · ")[0];
    if (!seen.includes(root)) seen.push(root);
  }
  return seen;
}

/** 各类型条目数量（收起时的「新增 3 · 修复 2」） */
export function releaseCounts(release: Release): Array<{ category: UpdateCategory; count: number }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    count: release.entries.filter((entry) => normalizeUpdateCategory(entry.category) === category).length,
  })).filter((item) => item.count > 0);
}

/**
 * 弹窗摘要条目：按分类轮流取，保证 3—5 条且各分类都露一条，
 * 五秒内能看完。完整条目在弹窗里折叠展开，或到更新日志页看。
 */
export function popupEntries(release: Release, max = 5): UpdateEntry[] {
  const buckets = CATEGORY_ORDER.map((category) =>
    release.entries.filter((entry) => normalizeUpdateCategory(entry.category) === category),
  );
  const out: UpdateEntry[] = [];
  let round = 0;
  // 轮流取：先每个分类各一条，再补第二条，直到够 max
  while (out.length < max && buckets.some((bucket) => bucket.length > round)) {
    for (const bucket of buckets) {
      if (out.length >= max) break;
      const entry = bucket[round];
      if (entry) out.push(entry);
    }
    round += 1;
  }
  return out;
}
