// lib/update-log/studyroom.ts — 书房应用自己的更新记录（读取与已读状态）。
//
// 书房日志页读这一份；同批的书房条目也并入设置里的总日志（../update-log/global.ts）。
// 在全局弹窗上点过「知道了」的书房版本会一起记为已读，进书房不再重复弹同样的内容。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { acknowledgeRelease, parseSeen, shouldShowRelease, type SeenMap } from "./seen";
import { STUDYROOM_RELEASES } from "./studyroom-data";
import type { Release } from "./types";

const SEEN_KEY = "ai_phone_studyroom_update_seen_v1";
registerKvMigration(SEEN_KEY);

export const STUDYROOM_RELEASE_LIST: Release[] = STUDYROOM_RELEASES;

export function latestStudyRoomRelease(): Release {
  return STUDYROOM_RELEASES[0];
}

function loadSeen(): SeenMap {
  return parseSeen(kvGet(SEEN_KEY));
}

export function hasSeenStudyRoomRelease(releaseId: string): boolean {
  return !shouldShowRelease(loadSeen(), releaseId);
}

/** 只在用户点「知道了」时调用（书房弹窗，或全局弹窗里包含这一版书房条目时） */
export function markStudyRoomReleaseSeen(releaseId: string): void {
  const seen = loadSeen();
  const next = acknowledgeRelease(seen, releaseId, new Date().toISOString());
  if (next !== seen) kvSet(SEEN_KEY, JSON.stringify(next));
}

export function seenStudyRoomReleases(): SeenMap {
  return loadSeen();
}
