// lib/update-log/system.ts — 全项目总日志（读取与已读状态）。
//
// 设置里的「更新日志」是全项目统一入口，全局更新弹窗也读这里，同一份数据、同一个发布标识。
// 系统发布记录在 ./system-data.ts，同批上线的书房条目通过 includes.studyroom 并入（见 ./global.ts）。
// 已读按 releaseId 记录，规则见 ./seen.ts。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { composeGlobalReleases } from "./global";
import { acknowledgeRelease, parseSeen, shouldShowRelease, type SeenMap } from "./seen";
import { STUDYROOM_RELEASES } from "./studyroom-data";
import { SYSTEM_RELEASES } from "./system-data";
import type { Release } from "./types";

const SEEN_KEY = "ai_phone_update_log_seen_v1";
registerKvMigration(SEEN_KEY);

export {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  popupEntries,
  releaseApps,
  releaseCounts,
  type Release,
  type UpdateCategory,
  type UpdateEntry,
} from "./types";

/** 总日志（设置页与全局弹窗共用） */
export const SYSTEM_RELEASE_LIST: Release[] = composeGlobalReleases(SYSTEM_RELEASES, STUDYROOM_RELEASES);

/** 当前发布：全局弹窗和设置日志的「当前版本」都取它 */
export function latestSystemRelease(): Release {
  return SYSTEM_RELEASE_LIST[0];
}

function loadSeen(): SeenMap {
  return parseSeen(kvGet(SEEN_KEY));
}

export function hasSeenSystemRelease(releaseId: string): boolean {
  return !shouldShowRelease(loadSeen(), releaseId);
}

/** 只在用户点「知道了」时调用 */
export function markSystemReleaseSeen(releaseId: string): void {
  const seen = loadSeen();
  const next = acknowledgeRelease(seen, releaseId, new Date().toISOString());
  if (next !== seen) kvSet(SEEN_KEY, JSON.stringify(next));
}

export function seenSystemReleases(): SeenMap {
  return loadSeen();
}
