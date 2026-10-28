// lib/study-room/export-epub.ts — 把书房里的一本书导出成 EPUB（含封面与批注）。
//
// 由书房保存的正文重建，因此导出文件永远和你在书房看到的一致；
// 原书里内嵌的图片不在书房的正文数据里，不会出现在导出文件中（界面上会说明）。
// 批注用两种同时存在、常见阅读器都能看到的方式呈现：
//  1. 原文上的 <mark> 高亮（能高亮的阅读器直接看到位置）；
//  2. 末尾「批注」附录，逐条列出章节、原文片段、内容与作者（任何阅读器都能读）。

import JSZip from "jszip";

import { loadAllAnnotations, loadChapters, loadNotes } from "@/lib/reading-storage";
import type { Book, ReadingAnnotation } from "@/lib/reading-types";

export type EpubExportResult = {
  blob: Blob;
  chapters: number;
  notes: number;
  annotations: number;
  cover: boolean;
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 把原文里被批注覆盖的片段包进 <mark>，位置对不上就只在附录里列出。 */
function applyMarks(text: string, quotes: string[]): string {
  const tokens: string[] = [];
  let working = text;
  for (const quote of quotes) {
    if (!quote) continue;
    const index = working.indexOf(quote);
    if (index === -1) continue;
    const token = `\u0000MARK${tokens.length}\u0000`;
    working = working.slice(0, index) + token + working.slice(index + quote.length);
    tokens.push(quote);
  }
  let html = escapeHtml(working).replace(/\n/g, "<br/>");
  tokens.forEach((quote, i) => {
    html = html.replace(`\u0000MARK${i}\u0000`, `<mark class="sr-note">${escapeHtml(quote)}</mark>`);
  });
  return html;
}

type CoverAsset = { data: Uint8Array; mime: string; ext: string };

async function loadCover(url: string | undefined): Promise<CoverAsset | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
      if (!match) return null;
      const mime = match[1];
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
      const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return { data: bytes, mime, ext };
    }
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = blob.type || "image/jpeg";
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
    return { data: new Uint8Array(await blob.arrayBuffer()), mime, ext };
  } catch {
    return null;
  }
}

export function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh" lang="zh">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * 导出一本书：正文按章重建，封面尽量带上，批注以高亮 + 附录两种方式呈现。
 * 返回的文件可以直接保存到本地，也可以再导入到别的阅读器。
 */
export async function exportBookAsEpub(book: Book): Promise<EpubExportResult> {
  const [chapters, notes, allAnnotations] = await Promise.all([
    loadChapters(book.id),
    loadNotes(book.id),
    loadAllAnnotations().catch(() => [] as ReadingAnnotation[]),
  ]);
  const annotations = allAnnotations.filter((item) => item.bookId === book.id);

  const zip = new JSZip();
  // EPUB 规范要求 mimetype 不压缩且在最前面
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file(
    "container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const oebps = zip.folder("OEBPS")!;
  oebps.file(
    "style.css",
    `body { font-family: serif; line-height: 1.8; margin: 0 1em; }
h1, h2 { font-family: sans-serif; font-weight: 600; margin: 1.4em 0 0.8em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 1em; text-indent: 2em; }
mark.sr-note { background: #fff3b0; padding: 0 2px; }
.note-list { margin: 0; padding: 0; list-style: none; }
.note-item { margin: 0 0 1em; padding-left: 0.6em; border-left: 3px solid #d9c37a; }
.note-meta { font-size: 0.85em; color: #666; }
.note-ref { font-size: 0.9em; color: #444; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100vh; }`,
  );

  const cover = await loadCover(book.cover);
  if (cover) {
    oebps.folder("images")!.file(`cover.${cover.ext}`, cover.data);
    oebps.file("cover.xhtml", xhtml("封面", `  <div class="cover"><img src="images/cover.${cover.ext}" alt="封面"/></div>`));
  }

  // 正文：按章生成，段落上的批注用 <mark> 标出来
  chapters.forEach((chapter, index) => {
    const paragraphs = chapter.paragraphs
      .map((text, paragraphIndex) => {
        const quotes = [
          ...notes.filter((n) => n.chapterIndex === index && n.paragraphIndex === paragraphIndex).map((n) => n.quote),
          ...annotations
            .filter((a) => a.chapterIndex === index && a.paragraphIndex === paragraphIndex && a.quote)
            .map((a) => a.quote as string),
        ].filter(Boolean);
        return `  <p>${applyMarks(text, quotes)}</p>`;
      })
      .join("\n");
    oebps.file(
      `ch-${String(index + 1).padStart(3, "0")}.xhtml`,
      xhtml(chapter.title || `第 ${index + 1} 章`, `  <h1>${escapeHtml(chapter.title || `第 ${index + 1} 章`)}</h1>\n${paragraphs}`),
    );
  });

  // 批注附录：阅读器不支持交互批注时，这里仍然能看到全部内容
  const noteItems = [
    ...notes.map((note) => ({
      chapterIndex: note.chapterIndex,
      paragraphIndex: note.paragraphIndex,
      author: "我",
      emoji: note.emoji,
      quote: note.quote,
      content: note.content,
      time: note.updatedAt,
    })),
    ...annotations.map((item) => ({
      chapterIndex: item.chapterIndex,
      paragraphIndex: item.paragraphIndex,
      author: item.characterName,
      emoji: item.emoji,
      quote: item.quote,
      content: item.content,
      time: item.createdAt,
    })),
  ].sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);

  if (noteItems.length > 0) {
    const list = noteItems
      .map((item) => {
        const chapterTitle = chapters[item.chapterIndex]?.title || `第 ${item.chapterIndex + 1} 章`;
        const parts = [
          `    <div class="note-ref">${escapeHtml(chapterTitle)} · 第 ${item.paragraphIndex + 1} 段</div>`,
          item.quote ? `    <div class="note-ref">原文：${escapeHtml(item.quote)}</div>` : "",
          `    <div>${item.emoji ? `${escapeHtml(item.emoji)} ` : ""}${escapeHtml(item.content ?? "（只加了表情）")}</div>`,
          `    <div class="note-meta">${escapeHtml(item.author)} · ${escapeHtml(new Date(item.time).toLocaleString("zh-CN"))}</div>`,
        ].filter(Boolean);
        return `  <li class="note-item">\n${parts.join("\n")}\n  </li>`;
      })
      .join("\n");
    oebps.file(
      "notes.xhtml",
      xhtml(
        "批注",
        `  <h1>批注</h1>\n  <p class="note-meta">这些批注来自书房。不同阅读器对批注的支持不一样：高亮位置可能显示、也可能只作为普通文字，编辑批注请在书房里进行。</p>\n  <ul class="note-list">\n${list}\n  </ul>`,
      ),
    );
  }

  // 目录
  const navItems = [
    ...chapters.map((chapter, index) => ({
      href: `ch-${String(index + 1).padStart(3, "0")}.xhtml`,
      title: chapter.title || `第 ${index + 1} 章`,
    })),
    ...(noteItems.length > 0 ? [{ href: "notes.xhtml", title: "批注" }] : []),
  ];
  oebps.file(
    "nav.xhtml",
    xhtml(
      "目录",
      `  <nav epub:type="toc" id="toc">\n    <h1>目录</h1>\n    <ol>\n${navItems
        .map((item) => `      <li><a href="${item.href}">${escapeHtml(item.title)}</a></li>`)
        .join("\n")}\n    </ol>\n  </nav>`,
    ),
  );

  // 包描述文件
  const manifestItems = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...chapters.map(
      (_, index) =>
        `    <item id="ch${index + 1}" href="ch-${String(index + 1).padStart(3, "0")}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
    ...(noteItems.length > 0 ? [`    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...(cover
      ? [
          `    <item id="cover-image" href="images/cover.${cover.ext}" media-type="${cover.mime}" properties="cover-image"/>`,
          `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
  ];
  const spineItems = [
    ...(cover ? [`    <itemref idref="cover"/>`] : []),
    ...chapters.map((_, index) => `    <itemref idref="ch${index + 1}"/>`),
    ...(noteItems.length > 0 ? [`    <itemref idref="notes"/>`] : []),
  ];
  oebps.file(
    "package.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator>${escapeXml(book.author || "佚名")}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
    ${cover ? `<meta name="cover" content="cover-image"/>` : ""}
  </metadata>
  <manifest>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`,
  );

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  return {
    blob,
    chapters: chapters.length,
    notes: notes.length,
    annotations: annotations.length,
    cover: Boolean(cover),
  };
}

/** 文件名里不能出现的字符统一换掉。 */
export function safeFileName(name: string): string {
  return (name || "book").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

/**
 * 把创作草稿导出成 EPUB：正文按章、封面带上，章末记忆作为附录（写作参考，不混进正文）。
 * 与「书详情导出」共用同一套 EPUB 结构与样式。
 */
export async function exportDraftAsEpub(draft: {
  title?: string;
  author?: string;
  synopsis?: string;
  tags?: string[];
  cover?: string;
  chapters: Array<{ id: string; title: string; content: string; memory?: Record<string, string> }>;
}): Promise<{ chapters: number; memories: number }> {
  const { default: JSZipLocal } = await import("jszip");
  const zip = new JSZipLocal();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file(
    "container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const oebps = zip.folder("OEBPS")!;
  oebps.file(
    "style.css",
    `body { font-family: serif; line-height: 1.8; margin: 0 1em; }
h1, h2 { font-family: sans-serif; font-weight: 600; margin: 1.4em 0 0.8em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 1em; text-indent: 2em; }
.memo { font-size: 0.92em; color: #444; }
.memo-title { font-weight: 600; margin-top: 1.4em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100vh; }`,
  );

  const cover = await loadCover(draft.cover);
  if (cover) {
    oebps.folder("images")!.file(`cover.${cover.ext}`, cover.data);
    oebps.file("cover.xhtml", xhtml("封面", `  <div class="cover"><img src="images/cover.${cover.ext}" alt="封面"/></div>`));
  }

  const chapters = draft.chapters.filter((chapter) => chapter.content.trim());
  chapters.forEach((chapter, index) => {
    const paragraphs = chapter.content
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `  <p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
    oebps.file(
      `ch-${String(index + 1).padStart(3, "0")}.xhtml`,
      xhtml(chapter.title || `第 ${index + 1} 章`, `  <h1>${escapeHtml(chapter.title || `第 ${index + 1} 章`)}</h1>\n${paragraphs}`),
    );
  });

  const memories = chapters.filter((chapter) => chapter.memory);
  if (memories.length > 0) {
    const body = memories
      .map((chapter) => {
        const memo = chapter.memory ?? {};
        const lines = Object.entries(memo)
          .filter(([key, value]) => key !== "createdAt" && typeof value === "string" && value.trim())
          .map(([key, value]) => {
            const label =
              key === "summary" ? "情节" :
              key === "characters" ? "人物状态" :
              key === "relations" ? "关系变化" :
              key === "whenWhere" ? "时间地点" :
              key === "threads" ? "伏笔" :
              key === "openConflicts" ? "未解决冲突" : "必须保持";
            return `    <p class="memo"><strong>${label}：</strong>${escapeHtml(String(value))}</p>`;
          })
          .join("\n");
        return `  <div class="memo-title">${escapeHtml(chapter.title || "未命名章节")}</div>\n${lines}`;
      })
      .join("\n");
    oebps.file("memory.xhtml", xhtml("写作记忆", `  <h1>写作记忆</h1>\n  <p class="memo">这些是写作时的章末记忆，供回顾与续写参考，不是正文内容。</p>\n${body}`));
  }

  const navItems = [
    ...chapters.map((chapter, index) => ({
      href: `ch-${String(index + 1).padStart(3, "0")}.xhtml`,
      title: chapter.title || `第 ${index + 1} 章`,
    })),
    ...(memories.length > 0 ? [{ href: "memory.xhtml", title: "写作记忆" }] : []),
  ];
  oebps.file(
    "nav.xhtml",
    xhtml(
      "目录",
      `  <nav epub:type="toc" id="toc">\n    <h1>目录</h1>\n    <ol>\n${navItems
        .map((item) => `      <li><a href="${item.href}">${escapeHtml(item.title)}</a></li>`)
        .join("\n")}\n    </ol>\n  </nav>`,
    ),
  );

  const manifestItems = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...chapters.map((_, index) => `    <item id="ch${index + 1}" href="ch-${String(index + 1).padStart(3, "0")}.xhtml" media-type="application/xhtml+xml"/>`),
    ...(memories.length > 0 ? [`    <item id="memory" href="memory.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...(cover
      ? [
          `    <item id="cover-image" href="images/cover.${cover.ext}" media-type="${cover.mime}" properties="cover-image"/>`,
          `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
  ];
  const spineItems = [
    ...(cover ? [`    <itemref idref="cover"/>`] : []),
    ...chapters.map((_, index) => `    <itemref idref="ch${index + 1}"/>`),
    ...(memories.length > 0 ? [`    <itemref idref="memory"/>`] : []),
  ];
  oebps.file(
    "package.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(draft.title?.trim() || "未命名作品")}</dc:title>
    <dc:creator>${escapeXml(draft.author?.trim() || "佚名")}</dc:creator>
    <dc:language>zh</dc:language>
    <dc:description>${escapeXml(draft.synopsis?.trim() || "")}</dc:description>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
    ${cover ? `<meta name="cover" content="cover-image"/>` : ""}
  </metadata>
  <manifest>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`,
  );

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(draft.title?.trim() || "未命名作品")}.epub`;
  anchor.click();
  URL.revokeObjectURL(url);
  return { chapters: chapters.length, memories: memories.length };
}
