// 把「长按选词工具条 + 行内标记」需要的数据与定位规则集中在这里，纯函数便于验证。
//
// 定位模型（笔记 / 书签 / 批注 / 摘录 / 共读共用）：
//   书籍 id ＋ 书版本（格式:章数:导入时间）＋ 章节 ＋ 段落 ＋ 原文片段
// 排版变化（字号、行距、分页）不会让位置漂移；版本或片段对不上时提示用户确认，不盲目映射。

import type { ReadingNote } from "@/lib/reading-types";

/** 行内标记：高亮 / 下划线；不选任何一项时只做批注，不动正文。 */
export type InlineMark = "highlight" | "underline";

/** 高亮配色（低饱和，贴合书房冷白基调）。 */
export const MARK_COLORS: Array<{ key: string; label: string; color: string }> = [
  { key: "yellow", label: "暖黄", color: "#F2E3A0" },
  { key: "green", label: "浅绿", color: "#CFE3CB" },
  { key: "blue", label: "浅蓝", color: "#CBDDEC" },
  { key: "pink", label: "浅粉", color: "#EDD2D6" },
  { key: "purple", label: "浅紫", color: "#DCD2E8" },
];

export function markColor(colorKey: string | undefined): string {
  return MARK_COLORS.find((item) => item.key === colorKey)?.color ?? MARK_COLORS[0].color;
}

export type TextSegment =
  | { kind: "plain"; text: string }
  | { kind: "mark"; text: string; mark: InlineMark; color: string; noteId: string; hasNote: boolean };

/**
 * 把一段正文按「行内标记」切成若干段。同一段里多处标记按出现顺序切分，重叠时先出现的优先。
 * 返回 null 表示这段没有任何标记（调用方直接用纯文本渲染）。
 */
export function segmentParagraph(paragraph: string, notes: ReadingNote[]): TextSegment[] | null {
  const marks = notes
    .filter((note) => note.mark && note.quote)
    .map((note) => ({ note, index: paragraph.indexOf(note.quote) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index || b.note.quote.length - a.note.quote.length);
  if (marks.length === 0) return null;

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const { note, index } of marks) {
    if (index < cursor) continue; // 与前一个标记重叠，跳过
    if (index > cursor) segments.push({ kind: "plain", text: paragraph.slice(cursor, index) });
    segments.push({
      kind: "mark",
      text: note.quote,
      mark: note.mark as InlineMark,
      color: markColor(note.color),
      noteId: note.id,
      hasNote: Boolean(note.content || note.emoji),
    });
    cursor = index + note.quote.length;
  }
  if (cursor < paragraph.length) segments.push({ kind: "plain", text: paragraph.slice(cursor) });
  return segments;
}

/** 这条笔记在当前版本的书里还找得到原文吗？找不到时界面要提示，不静默乱跳。 */
export function quoteStillPresent(paragraph: string | undefined, quote: string | undefined): boolean {
  if (!quote) return true;
  if (!paragraph) return false;
  return paragraph.includes(quote);
}
