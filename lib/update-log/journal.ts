// lib/update-log/journal.ts — 更新界面用的数据读取与本地记录。
// 数据只有两份：public/update-log.json（每次更新的真实内容）和 public/version.json（构建时生成）。
// 这两份文件都用 no-store 读取，绕过页面缓存和旧的离线缓存。

export type ChangeType = "new" | "improve" | "fix";

export type UpdateChange = {
  type: ChangeType;
  head?: string;
  text: string;
};

export type UpdateApp = {
  app: string;
  changes: UpdateChange[];
};

export type UpdateEntry = {
  id: string;
  version: string;
  date: string;
  title: string;
  needsApk?: boolean;
  brief?: { type: ChangeType; text: string }[];
  apps: UpdateApp[];
};

export type VersionInfo = {
  buildId: string;
  version: string;
  logId: string;
  builtAt?: string;
};

const LOG_URL = "/update-log.json";
const VERSION_URL = "/version.json";

/** 和设计稿一致：点过稍后再说，30 分钟内不再重复弹出 */
const LATER_MS = 30 * 60 * 1000;
const KEY_BUILD = "uui.build";
const KEY_SEEN = "uui.seen";
const KEY_LATER = "uui.later";

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式或存储被禁用时静默跳过，不影响本次展示
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function fetchJournal(): Promise<UpdateEntry[] | null> {
  return getJson<UpdateEntry[]>(LOG_URL);
}

export function fetchVersion(): Promise<VersionInfo | null> {
  return getJson<VersionInfo>(VERSION_URL);
}

export type CheckResult =
  | { kind: "none" }
  | { kind: "sheet"; entry: UpdateEntry }
  | { kind: "notice"; entry: UpdateEntry; unseen: number };

/**
 * 启动时检查一次：
 * 1. buildId 和上次拉取的不一样 → 有更新，弹底部更新弹窗；
 * 2. 已经是最新，但最新一条没确认过 → 弹正中更新公告；
 * 3. 第一次使用只记住当前版本，不打扰。
 */
export async function checkForRelease(): Promise<CheckResult> {
  const [version, logs] = await Promise.all([fetchVersion(), fetchJournal()]);
  if (!version || !logs?.length) return { kind: "none" };

  const top = logs[0];
  const applied = readLocal(KEY_BUILD);

  // 第一次打开：记下当前构建和最新记录，什么都不弹
  if (!applied) {
    writeLocal(KEY_BUILD, version.buildId);
    writeLocal(KEY_SEEN, top.id);
    return { kind: "none" };
  }

  if (version.buildId !== applied) {
    const laterUntil = Number(readLocal(KEY_LATER) || 0);
    if (laterUntil > Date.now()) return { kind: "none" };
    return { kind: "sheet", entry: top };
  }

  writeLocal(KEY_BUILD, version.buildId);
  const seen = readLocal(KEY_SEEN);
  if (seen !== top.id) {
    const index = logs.findIndex((entry) => entry.id === seen);
    return { kind: "notice", entry: top, unseen: index > 0 ? index : 1 };
  }
  return { kind: "none" };
}

export function rememberSeen(entry: UpdateEntry): void {
  writeLocal(KEY_SEEN, entry.id);
}

export function deferForAWhile(): void {
  writeLocal(KEY_LATER, String(Date.now() + LATER_MS));
}

/**
 * 真实拉取：核对最新构建 → 重新下载页面与日志 → 注销旧 service worker、清掉旧缓存。
 * 不显示假进度：三个步骤对应三次真实动作，做完才允许重启。
 */
export async function pullLatest(entry: UpdateEntry, onStep: (index: number) => void): Promise<boolean> {
  onStep(0);
  const version = await fetchVersion();
  if (!version) return false;

  onStep(1);
  const [, page] = await Promise.all([
    fetchJournal(),
    fetch(window.location.href, { cache: "reload" }).catch(() => null),
  ]);
  if (!page) return false;

  onStep(2);
  const jobs: Promise<unknown>[] = [];
  if (navigator.serviceWorker?.getRegistrations) {
    jobs.push(
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      ),
    );
  }
  if (typeof caches !== "undefined") {
    jobs.push(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
  await Promise.all(jobs);

  // 只记下已拉取的构建；「已读」留到更新公告点「知道了」时再写，
  // 这样刷新后还能看到这次更新改了什么。
  writeLocal(KEY_BUILD, version.buildId);
  return true;
}
