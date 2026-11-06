import type { ChangeType, UpdateApp, UpdateEntry } from "@/lib/update-log/journal";

export type TypeMeta = { label: string; cls: string; en: string; hint: string };

export const TYPE_META: Record<ChangeType, TypeMeta> = {
  new: { label: "新增", cls: "uui-c-new", en: "NEW", hint: "新加的东西" },
  improve: { label: "优化", cls: "uui-c-improve", en: "IMPROVED", hint: "变得更好的地方" },
  fix: { label: "修复", cls: "uui-c-fix", en: "FIXED", hint: "修好的问题" },
};

export const TYPE_ORDER: ChangeType[] = ["new", "improve", "fix"];

/** 2026-11-05 → 2026.11.05 */
export function fullDate(date: string): string {
  return String(date || "").replace(/-/g, ".");
}

/** 2026-11-05 → 11.05（日期滚轮上显示） */
export function shortDate(date: string): string {
  return String(date || "").slice(5).replace("-", ".");
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 更新弹窗里的短列表：优先用 brief，没有就从每条改动归纳，最多 4 条 */
export function briefOf(entry: UpdateEntry): { type: ChangeType; text: string }[] {
  if (entry.brief?.length) return entry.brief.slice(0, 4);
  const lines = (entry.apps || []).flatMap((group) =>
    (group.changes || []).map((change) => ({
      type: change.type,
      text: `${group.app}：${change.head || change.text}`,
    })),
  );
  return lines.length ? lines.slice(0, 4) : [{ type: "improve", text: "有新的内容和修复" }];
}

export type LogItem = { app: string; head: string; text: string };

export function itemsOf(entry: UpdateEntry, type: ChangeType): LogItem[] {
  return (entry.apps || []).flatMap((group: UpdateApp) =>
    (group.changes || [])
      .filter((change) => change.type === type)
      .map((change) => ({
        app: group.app,
        head: change.head || String(change.text || "").slice(0, 18),
        text: change.text,
      })),
  );
}

/** 更新公告只显示最新一版的每一条改动，一行一条 */
export function noticeLines(entry: UpdateEntry): { type: ChangeType; text: string; sub?: string }[] {
  const clip = (value: string) => {
    const flat = value.replace(/\s+/g, " ").trim();
    if (flat.length <= 46) return flat;
    return flat.slice(0, 45) + "…";
  };
  return (entry.apps || []).flatMap((group) =>
    (group.changes || []).map((change) => {
      const head = change.head || change.text;
      const sub = change.text && change.text !== head ? clip(change.text) : undefined;
      return { type: change.type, text: head, sub };
    }),
  );
}
