// lib/study-room/read-range.ts — 共读送给 AI 的正文范围（纯函数，无副作用，便于验证）。
// 只包含用户已读到的段落，避免把后面章节送去造成剧透；选中文字单独作为本轮焦点。

export function buildReadRange(paragraphs: string[], readParagraphIndex: number, selectedText?: string): string {
  if (paragraphs.length === 0) return "";
  const upTo = Math.max(0, Math.min(readParagraphIndex, paragraphs.length - 1));
  const body = paragraphs
    .slice(0, upTo + 1)
    .map((p, i) => `[${i + 1}] ${p}`)
    .join("\n\n");
  const focus = selectedText?.trim() ? `\n\n[当前选中] ${selectedText.trim()}` : "";
  return body + focus;
}
