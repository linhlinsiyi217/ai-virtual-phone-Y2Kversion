// lib/study-room/shelf-prefs.ts — 书架排序偏好（导入顺序 / 手动 / 最近阅读）。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { ShelfSort } from "./shelf-layout";

const KEY = "ai_phone_studyroom_shelf_prefs_v1";
registerKvMigration(KEY);

export type ShelfPrefs = {
  sort: ShelfSort;
  /** 手动排序时的书 id 顺序 */
  manualOrder: string[];
};

const DEFAULT_PREFS: ShelfPrefs = { sort: "import", manualOrder: [] };

export function loadShelfPrefs(): ShelfPrefs {
  try {
    const raw = kvGet(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ShelfPrefs>;
    const sort: ShelfSort = parsed.sort === "manual" || parsed.sort === "recent" ? parsed.sort : "import";
    const manualOrder = Array.isArray(parsed.manualOrder) ? parsed.manualOrder.filter((id): id is string => typeof id === "string") : [];
    return { sort, manualOrder };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveShelfPrefs(prefs: ShelfPrefs): void {
  kvSet(KEY, JSON.stringify(prefs));
}
