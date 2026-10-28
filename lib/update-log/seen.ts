// lib/update-log/seen.ts — 更新弹窗「已读」规则（纯函数，无运行时依赖，发布检查直接拿来模拟）。
//
// 已读按发布标识（releaseId）记录：
//  - 没确认过当前 releaseId → 弹；
//  - 用户点「知道了」才写入已读；只是显示、关掉、跳去看日志都不算；
//  - 同一 releaseId 确认后，刷新、重开都不再弹；
//  - 下一次发布换了 releaseId，旧的已读挡不住新版，会重新弹。

export type SeenMap = Record<string, string>;

export function parseSeen(raw: string | null | undefined): SeenMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

/** 这次发布要不要弹：只看当前 releaseId 有没有被确认过 */
export function shouldShowRelease(seen: SeenMap, releaseId: string): boolean {
  return !seen[releaseId];
}

/** 用户点了「知道了」：返回写入已读后的新记录（已确认过的不改时间） */
export function acknowledgeRelease(seen: SeenMap, releaseId: string, at: string): SeenMap {
  if (seen[releaseId]) return seen;
  return { ...seen, [releaseId]: at };
}
