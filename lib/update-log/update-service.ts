// lib/update-log/update-service.ts — 网页端实时检查更新。
//
// 拉 /api/release（服务端直接读当前部署的发布记录，和公告、日志是同一份数据），
// 每次请求都带时间戳并禁用缓存，不会读到旧的版本信息。
// 线上当前发布的 releaseId 与本机打包的不同 → 有新版本；内容取线上那一份，
// 公告和日志同时换成同一个新版本（见 useLatestRelease）。
// 检查时机：启动、从后台回到前台、用户手动刷新、进入更新中心（由调用方触发）。
// 失败只给用户一句「暂时无法获取最新更新信息」，不显示错误码、地址或异常内容。

import { useSyncExternalStore } from "react";

import { latestSystemRelease, SYSTEM_RELEASE_LIST } from "./system";
import type { Release } from "./types";

export type UpdateCheckState = "available" | "latest" | "failed";

export type UpdateCheckResult =
  | { state: "available"; release: Release }
  | { state: "latest"; release: Release }
  | { state: "failed"; release: null };

export const UPDATE_CHECK_FAILED_TEXT = "暂时无法获取最新更新信息";

const FETCH_TIMEOUT_MS = 8_000;
/** 回到前台时的最短检查间隔，避免来回切换时反复请求 */
const FOREGROUND_MIN_INTERVAL_MS = 60_000;

function isRelease(value: unknown): value is Release {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.version === "string" &&
    typeof item.releaseId === "string" &&
    typeof item.date === "string" &&
    typeof item.summary === "string" &&
    Array.isArray(item.entries)
  );
}

// ── 线上最新发布（公告与日志共用）──────────────────────────
let remoteLatest: Release | null = null;
let lastCheckAt = 0;
let inFlight: Promise<UpdateCheckResult> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** 发布列表：线上有比本机更新的一版时排在最前面，其余是本机打包的历史 */
function currentList(): Release[] {
  if (!remoteLatest || remoteLatest.releaseId === SYSTEM_RELEASE_LIST[0]?.releaseId) return SYSTEM_RELEASE_LIST;
  return [remoteLatest, ...SYSTEM_RELEASE_LIST.filter((item) => item.releaseId !== remoteLatest?.releaseId)];
}

let listSnapshot: Release[] = SYSTEM_RELEASE_LIST;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 公告和日志都用这个：线上新版本拉到后两边同时刷新 */
export function useReleaseList(): Release[] {
  return useSyncExternalStore(subscribe, () => listSnapshot, () => SYSTEM_RELEASE_LIST);
}

export function subscribeReleaseList(listener: () => void): () => void {
  return subscribe(listener);
}

export function getLatestRelease(): Release {
  return listSnapshot[0] ?? latestSystemRelease();
}

async function fetchRemoteLatest(): Promise<Release> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/release?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("bad status");
    const data = (await response.json()) as { latest?: unknown };
    if (!isRelease(data.latest)) throw new Error("bad data");
    return data.latest;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 检查一次；同时只跑一个请求。绝不 throw。 */
export function checkForUpdate(): Promise<UpdateCheckResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<UpdateCheckResult> => {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
      const release = await fetchRemoteLatest();
      lastCheckAt = Date.now();
      const changed = remoteLatest?.releaseId !== release.releaseId;
      remoteLatest = release;
      if (changed) {
        listSnapshot = currentList();
        emit();
      }
      const bundled = SYSTEM_RELEASE_LIST[0]?.releaseId;
      return release.releaseId !== bundled ? { state: "available", release } : { state: "latest", release };
    } catch {
      return { state: "failed", release: null };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** 回到前台：距上次检查超过一分钟才再查 */
export function shouldCheckOnForeground(): boolean {
  return Date.now() - lastCheckAt > FOREGROUND_MIN_INTERVAL_MS;
}

/** 有没有拉到比本机打包更新的版本（需要刷新页面才能用上新功能） */
export function hasNewerDeployment(): boolean {
  return !!remoteLatest && remoteLatest.releaseId !== SYSTEM_RELEASE_LIST[0]?.releaseId;
}
