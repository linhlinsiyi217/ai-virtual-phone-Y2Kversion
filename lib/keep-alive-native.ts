// 后台保护：状态桥接适配层。
//
// 优先使用新版 window.KeepAliveNative；如果安装包只有旧的 window.AndroidShell，
// 就把它的真实字段映射成同一套六项状态。两者都没有时返回 null，
// 页面据此显示“需更新安装包”，绝不假造“已完成”。

export type KeepAliveItemKey =
  | "login"
  | "service"
  | "notification"
  | "battery"
  | "exactAlarm"
  | "autostart";

export type KeepAliveItemState = "ok" | "pending" | "fail" | "unsupported";

export type KeepAliveItem = {
  key: KeepAliveItemKey;
  state: KeepAliveItemState;
  detail: string;
  checkedAt: number | null;
};

export type ShellVersion = {
  version: string;
  versionCode: number;
};

export type DiagEntry = {
  ts: number;
  key: string;
  result: "ok" | "fail" | "unsupported";
  code?: string;
  detail?: string;
  durationMs?: number;
};

export type TestResult = {
  testId: string;
  ok: boolean;
  deliveredAt: number | null;
  durationMs: number | null;
  detail: string;
};

type KeepAliveNativeBridge = {
  getShellVersion?: () => string;
  getStatus?: () => string;
  openSettings?: (type: string) => string;
  startService?: (config: string) => string;
  stopService?: () => string;
  scheduleLocalTest?: (delayMs: number) => string;
  getTestResult?: (testId: string) => string;
  getDiagLog?: () => string;
  appendDiag?: (entry: string) => string;
  clearDiagLog?: () => string;
  confirmManual?: (key: string, value: boolean) => string;
};

type AndroidShellStatus = {
  accountReady: boolean;
  serviceRunning: boolean;
  watchdogScheduled: boolean;
  batteryOptimizationIgnored: boolean;
  notificationsEnabled: boolean;
  exactAlarmAllowed: boolean;
  manufacturer: string;
  sdk: number;
  connectionState?: string;
  lastConnectedAt?: number;
  lastMessageAt?: number;
};

type AndroidShellBridge = {
  getVersion?: () => string;
  getBackgroundProtectionStatus?: () => string;
  requestIgnoreBatteryOptimization?: () => void;
  openNotificationSettings?: () => void;
  requestExactAlarmPermission?: () => void;
  openAutoStartSettings?: () => boolean;
};

declare global {
  interface Window {
    KeepAliveNative?: KeepAliveNativeBridge;
    AndroidShell?: AndroidShellBridge;
  }
}

const DIAG_KEY = "keep-alive-diag-v1";
const MAX_DIAG = 200;

function nativeBridge(): KeepAliveNativeBridge | null {
  if (typeof window === "undefined") return null;
  return window.KeepAliveNative ?? null;
}

function androidShell(): AndroidShellBridge | null {
  if (typeof window === "undefined") return null;
  return window.AndroidShell ?? null;
}

export function hasBridge(): boolean {
  return !!nativeBridge()?.getStatus || !!androidShell()?.getBackgroundProtectionStatus;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function call<T>(method: keyof KeepAliveNativeBridge, ...args: unknown[]): T | null {
  const bridge = nativeBridge();
  if (!bridge) return null;
  const fn = bridge[method];
  if (typeof fn !== "function") return null;
  try {
    return parseJson<T | null>((fn as (...a: unknown[]) => string).apply(bridge, args), null);
  } catch {
    return null;
  }
}

function readAndroidStatus(): AndroidShellStatus | null {
  const shell = androidShell();
  if (!shell?.getBackgroundProtectionStatus) return null;
  try {
    return JSON.parse(shell.getBackgroundProtectionStatus()) as AndroidShellStatus;
  } catch {
    return null;
  }
}

export function getShellVersion(): ShellVersion | null {
  const native = call<ShellVersion>("getShellVersion");
  if (native) return native;
  const shell = androidShell();
  if (shell?.getVersion) {
    try {
      return { version: String(shell.getVersion()), versionCode: 0 };
    } catch {
      return null;
    }
  }
  return null;
}

export function unsupportedItems(): KeepAliveItem[] {
  return [
    { key: "login", state: "pending", detail: "还没有登录账号", checkedAt: null },
    { key: "service", state: "pending", detail: "登录后自动开启", checkedAt: null },
    { key: "notification", state: "unsupported", detail: "需要更新的安装包才能读取", checkedAt: null },
    { key: "battery", state: "unsupported", detail: "需要更新的安装包才能读取", checkedAt: null },
    { key: "exactAlarm", state: "unsupported", detail: "需要更新的安装包才能读取", checkedAt: null },
    { key: "autostart", state: "unsupported", detail: "系统不开放读取，需要手动确认", checkedAt: null },
  ];
}

function fromAndroidStatus(status: AndroidShellStatus): KeepAliveItem[] {
  const now = Date.now();
  const serviceOk = Boolean(status.accountReady && status.serviceRunning && status.watchdogScheduled);
  return [
    { key: "login", state: status.accountReady ? "ok" : "pending", detail: status.accountReady ? "已登录，消息通道已订阅" : "还没有登录账号", checkedAt: now },
    {
      key: "service",
      state: serviceOk ? "ok" : "pending",
      detail: serviceOk
        ? "后台消息服务与自检都在运行"
        : status.accountReady
          ? "已登录，后台服务正在恢复"
          : "登录后自动开启",
      checkedAt: now,
    },
    {
      key: "notification",
      state: status.notificationsEnabled ? "ok" : "fail",
      detail: status.notificationsEnabled ? "系统通知已允许" : "系统通知被关闭了",
      checkedAt: now,
    },
    {
      key: "battery",
      state: status.batteryOptimizationIgnored ? "ok" : "fail",
      detail: status.batteryOptimizationIgnored ? "电池已设为无限制" : "电池还在限制后台",
      checkedAt: now,
    },
    {
      key: "exactAlarm",
      state: status.exactAlarmAllowed ? "ok" : "fail",
      detail: status.exactAlarmAllowed ? "准时自检已允许" : "准时自检还没有允许",
      checkedAt: now,
    },
    {
      key: "autostart",
      state: "pending",
      detail: `${status.manufacturer || "这台手机"}不开放读取，需要去系统页面手动允许`,
      checkedAt: now,
    },
  ];
}

export function readStatus(): KeepAliveItem[] | null {
  const native = call<{ items?: KeepAliveItem[] }>("getStatus");
  if (native && Array.isArray(native.items)) {
    const byKey = new Map(native.items.map(item => [item.key, item]));
    return unsupportedItems().map(base => {
      const real = byKey.get(base.key);
      if (!real) return base;
      return {
        key: base.key,
        state: real.state,
        detail: real.detail || base.detail,
        checkedAt: typeof real.checkedAt === "number" ? real.checkedAt : null,
      };
    });
  }
  const shellStatus = readAndroidStatus();
  if (shellStatus) return fromAndroidStatus(shellStatus);
  return null;
}

export function getLastMessageAt(): number | null {
  const status = readAndroidStatus();
  return status?.lastMessageAt ?? null;
}

export function openSystemSettings(type: "notification" | "battery" | "autostart" | "exactAlarm" | "appDetail") {
  const native = call<{ opened: boolean; error?: string }>("openSettings", type);
  if (native) return native;
  const shell = androidShell();
  if (!shell) return null;
  try {
    if (type === "notification" && shell.openNotificationSettings) {
      shell.openNotificationSettings();
      return { opened: true };
    }
    if (type === "battery" && shell.requestIgnoreBatteryOptimization) {
      shell.requestIgnoreBatteryOptimization();
      return { opened: true };
    }
    if (type === "exactAlarm" && shell.requestExactAlarmPermission) {
      shell.requestExactAlarmPermission();
      return { opened: true };
    }
    if (type === "autostart" && shell.openAutoStartSettings) {
      const opened = shell.openAutoStartSettings();
      return { opened: opened !== false };
    }
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : "打开失败" };
  }
  return { opened: false, error: "这个安装包还不支持这一项" };
}

export function confirmManual(key: "autostart" | "lockTask", value: boolean) {
  return call<{ saved: boolean }>("confirmManual", key, value);
}

/** 发送一条真实的后台测试消息（走现有离线推送通道）。 */
export async function sendTestMessage(): Promise<{ ok: boolean; error?: string }> {
  try {
    const mod = await import("@/lib/push-client");
    return await mod.sendTestOfflinePush();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "测试发送失败" };
  }
}

export function scheduleLocalTest(delayMs = 6000): TestResult | null {
  return call<TestResult>("scheduleLocalTest", delayMs);
}

export function getTestResult(testId: string): TestResult | null {
  return call<TestResult>("getTestResult", testId);
}

export function getDiagLog(): DiagEntry[] {
  const native = call<DiagEntry[]>("getDiagLog");
  if (Array.isArray(native)) return native;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DIAG_KEY);
    const list = raw ? (JSON.parse(raw) as DiagEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function appendDiag(entry: DiagEntry) {
  const native = call<{ saved: boolean }>("appendDiag", JSON.stringify(entry));
  if (native) return;
  if (typeof window === "undefined") return;
  try {
    const list = getDiagLog();
    list.unshift(entry);
    window.localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(0, MAX_DIAG)));
  } catch {
    // 本地存储不可用时只影响记录，不影响主流程
  }
}

export function clearDiagLog() {
  const native = call<{ cleared: boolean }>("clearDiagLog");
  if (native) return;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DIAG_KEY);
  } catch {
    // 忽略
  }
}

export function formatClock(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatCheckedAgo(ts: number | null): string {
  if (!ts) return "尚未读取";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "系统实时读取 · 刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `系统实时读取 · ${min} 分钟前`;
  return `系统实时读取 · ${formatClock(ts)}`;
}
