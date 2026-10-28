// lib/study-room/wikisource-text.ts — 维基文库页面 HTML → 纯文本，以及目录页的子篇解析。
//
// 服务端「联网导入」与内置书库整理脚本（scripts/study-room/build-library.mjs）共用。
// 这个文件不 import 其他模块：脚本用 Node 自带的 TypeScript 类型剥离直接运行它。
//
// 维基文库页面结构比较固定：页眉在 #headerContainer（上一篇/下一篇/作者），
// 许可声明、姊妹计划、注释列表等都有固定 class。正文就是剩下的段落。

const NOISE_CLASS = /\b(noprint|ws-noexport|licenseContainer|license-container|ws-license|navbox|reflist|references|mw-references-wrap|reference|metadata|catlinks|mw-empty-elt|ws-summary|sisitem|mw-editsection|toc|variant-tooltip)\b/;
const NAV_LINE = /^(?:原著第[一二三四五六七八九十百零〇]+回|高[续續]|(?:上一|下一|前一|后一|後一)[回卷篇章页頁]|回?目[录錄]|返回目[录錄]|[|｜·　\s])+$/;
const NOISE_ID = /^(headerContainer|footerContainer|plainSister|toc|headertemplate|footertemplate)$/;

/** 从 start 处的开标签开始，找到与它配对的闭标签末尾（同名标签按深度计数）。 */
function matchingClose(html: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[2] === "/") continue; // 自闭合
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return html.length;
}

/** 删掉页眉、许可、注释、表格等非正文块（按标签配对删除整块）。 */
function stripNoise(html: string): string {
  let out = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const open = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  open.lastIndex = 0;
  while ((m = open.exec(out))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const noisy = tag === "table" || tag === "sup" || NOISE_CLASS.test(cls) || NOISE_ID.test(id);
    if (!noisy || /\/>$/.test(m[0])) continue;
    const end = matchingClose(out, m.index, tag);
    out = out.slice(0, m.index) + out.slice(end);
    open.lastIndex = m.index;
  }
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

export type WikiSection = { heading: string | null; paragraphs: string[] };

/**
 * 解析后的页面 HTML → 按小标题分段的正文。
 * h2/h3 作为小节标题（如《聊斋志异》每卷里的各篇），其余块级元素各成一段。
 */
export function wikiHtmlToSections(html: string): WikiSection[] {
  const body = stripNoise(html)
    .replace(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _lv, inner) => `\n\u0001${inner.replace(/<[^>]+>/g, "")}\u0002\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|dd|dt|blockquote|pre|center)>/gi, "\n")
    .replace(/<(p|div|li|dd|dt|blockquote|pre|center)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const sections: WikiSection[] = [{ heading: null, paragraphs: [] }];
  for (const raw of decodeEntities(body).split("\n")) {
    const line = raw.replace(/[ \t　]+$/g, "").replace(/^[ \t]+/g, "");
    if (!line.trim()) continue;
    const head = /^\u0001([\s\S]*)\u0002$/.exec(line.trim());
    if (head) {
      const heading = head[1].replace(/\[\s*编辑\s*\]|\[\s*編輯\s*\]/g, "").trim();
      if (heading) sections.push({ heading, paragraphs: [] });
      continue;
    }
    // 正文里夹带的翻页导航（「上一回　回目录　下一回」）不是正文
    if (NAV_LINE.test(line.trim())) continue;
    sections[sections.length - 1].paragraphs.push(line.trim());
  }
  return sections.filter((s) => s.paragraphs.length > 0);
}

/** 整页正文（不分节），用于单篇导入。 */
export function wikiHtmlToText(html: string): string {
  return wikiHtmlToSections(html)
    .map((s) => (s.heading ? [s.heading, ...s.paragraphs] : s.paragraphs).join("\n"))
    .join("\n\n");
}

const NON_ARTICLE = /^(category|file|image|author|作者|分类|分類|wikisource|維基文庫|维基文库|portal|help|special|template|w|wikt|[a-z]{2,3}):/i;

/**
 * 从目录页的 wikitext 里按出现顺序取出正文篇目链接（「吶喊」→ 狂人日记、孔乙己…）。
 * 页眉里的上一部/下一部（previous/next）不算；只看 header 模板之后的链接。
 */
export function wikiIndexLinks(wikitext: string, pageTitle: string): Array<{ title: string; label: string }> {
  const headerEnd = (() => {
    const start = wikitext.search(/\{\{\s*(header|collection header)/i);
    if (start < 0) return 0;
    let depth = 0;
    for (let i = start; i < wikitext.length - 1; i += 1) {
      if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth += 1; i += 1; }
      else if (wikitext[i] === "}" && wikitext[i + 1] === "}") { depth -= 1; i += 1; if (depth === 0) return i + 1; }
    }
    return 0;
  })();
  const seen = new Set<string>();
  const out: Array<{ title: string; label: string }> = [];
  for (const m of wikitext.slice(headerEnd).matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    let target = m[1].trim();
    if (!target || target.startsWith("#") || target.startsWith(":") || NON_ARTICLE.test(target)) continue;
    target = target.replace(/#.*$/, "");
    if (target.startsWith("/")) target = `${pageTitle}${target}`;
    if (seen.has(target) || target === pageTitle) continue;
    seen.add(target);
    out.push({ title: target, label: (m[2] ?? m[1]).replace(/^\//, "").trim() });
  }
  return out;
}
