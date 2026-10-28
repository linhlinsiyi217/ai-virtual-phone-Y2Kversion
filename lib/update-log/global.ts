// lib/update-log/global.ts — 全项目总日志：系统发布记录 + 同批上线的书房条目（纯函数）。
//
// 设置里的「更新日志」和全局更新弹窗都读这里组出来的同一份数据。
// 系统发布用 includes.studyroom 指向同批的书房版本，书房条目原样并入（按应用分类显示），
// 书房自己的日志页仍然读 studyroom-data.ts，内容同源。

import type { Release } from "./types";

export function composeGlobalReleases(system: Release[], studyroom: Release[]): Release[] {
  const byId = new Map(studyroom.map((release) => [release.releaseId, release]));
  return system.map((release) => {
    const linked = release.includes?.studyroom ? byId.get(release.includes.studyroom) : undefined;
    if (!linked) return release;
    return {
      ...release,
      entries: [...release.entries, ...linked.entries],
      pending:
        release.pending || linked.pending
          ? [...(release.pending ?? []), ...(linked.pending ?? []).map((item) => `书房：${item}`)]
          : undefined,
    };
  });
}
