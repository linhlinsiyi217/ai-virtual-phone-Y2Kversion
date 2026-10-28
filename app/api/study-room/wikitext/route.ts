// app/api/study-room/wikitext/route.ts — 取中文维基文库某部作品的正文（简体纯文本），供书房导入阅读。
//
// 只在书房内部使用：维基文库是公有领域文本，这里把页面正文转成纯文本交给导入流程，
// 让「全文可读」名副其实，而不是只给一个外链。请求目标固定为 zh.wikisource.org。
//
// 两种页面：
//  - 单篇页面：直接取正文；
//  - 目录页（如《吶喊》）：页面本身只有篇目链接，逐篇取子页面正文，汇总成「## 篇名」分章的 TXT。
// 简体用维基文库自身的简繁转换（variant=zh-hans），不做改写。篇数太多的大部头不在这里现取，
// 给出明确提示（书房内置书库已整理好的作品直接读内置版本）。

import { NextResponse } from "next/server";

import { wikiHtmlToSections, wikiIndexLinks } from "@/lib/study-room/wikisource-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "LinH-Float-StudyRoom/1.0 (https://float-0217.vercel.app; book import)";
const MAX_SUBPAGES = 40;
const CONCURRENCY = 3;

type Parsed = { title: string; displayTitle: string; html: string; wikitext: string };

class SourceError extends Error {
  constructor(message: string, public status: number, public kind: string) {
    super(message);
  }
}

async function parsePage(title: string, withWikitext: boolean): Promise<Parsed> {
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: withWikitext ? "text|wikitext|displaytitle" : "text|displaytitle",
    redirects: "1",
    variant: "zh-hans",
    disableeditsection: "1",
    disablelimitreport: "1",
    format: "json",
    formatversion: "2",
  });
  let response: Response;
  try {
    response = await fetch(`https://zh.wikisource.org/w/api.php?${params}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new SourceError(timeout ? "维基文库响应超时，请稍后再试" : "连不上维基文库", 504, timeout ? "timeout" : "network");
  }
  if (response.status === 429) throw new SourceError("维基文库请求过多被限流，请稍后再试", 503, "rate_limit");
  if (!response.ok) throw new SourceError(`维基文库返回 ${response.status}`, 502, "http");
  const data = (await response.json().catch(() => null)) as {
    parse?: { title?: string; displaytitle?: string; text?: string; wikitext?: string };
    error?: { code?: string };
  } | null;
  if (!data) throw new SourceError("维基文库返回的内容无法解析", 502, "parse");
  if (data.error?.code === "missingtitle") throw new SourceError("维基文库没有这个页面", 404, "missing");
  if (!data.parse?.text) throw new SourceError("维基文库返回的内容无法解析", 502, "parse");
  return {
    title: data.parse.title ?? title,
    displayTitle: (data.parse.displaytitle ?? data.parse.title ?? title).replace(/<[^>]+>/g, ""),
    html: data.parse.text,
    wikitext: data.parse.wikitext ?? "",
  };
}

/** 篇名：取最后一段，去掉同名消歧义后缀（「傷逝 (魯迅)」→「傷逝」） */
const lastSegment = (title: string) => title.replace(/^.*\//, "").replace(/\s*[（(][^（）()]*[)）]$/, "").trim();

/** 页面正文 → 段落文本；单篇里的小节（一、二、三…）保留为独立的小标题行 */
function bodyText(html: string): string {
  return wikiHtmlToSections(html)
    .map((s) => (s.heading ? [s.heading, ...s.paragraphs] : s.paragraphs).join("\n"))
    .join("\n\n")
    .trim();
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

function textResponse(text: string) {
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "缺少页面标题" }, { status: 400 });
  }

  try {
    const page = await parsePage(title, true);
    // 只汇总本作品的篇目，不顺着链接跑到别的作品：
    // 有「作品名/篇名」子页面就只取子页面（紅樓夢/第001回）；
    // 没有时取目录列表项里的链接（《吶喊》的篇目是独立页面「狂人日記」），
    // 页眉模板里的上一部/下一部（墳、野草）不在列表项里，不会混进来
    const links = wikiIndexLinks(page.wikitext, page.title);
    const own = links.filter((l) => l.title.startsWith(`${page.title}/`));
    const listed = new Set(
      page.wikitext
        .split("\n")
        .filter((line) => /^\s*[*#]/.test(line))
        .flatMap((line) => Array.from(line.matchAll(/\[\[([^\]|#]+)/g), (m) => m[1].trim())),
    );
    const subpages = own.length > 0 ? own : links.filter((l) => listed.has(l.title));
    const ownText = bodyText(page.html);

    // 单篇页面（或正文本身就很完整的页面）：直接返回
    if (subpages.length === 0 || (ownText.length > 3000 && subpages.length < 3)) {
      if (ownText.length < 20) {
        return NextResponse.json({ error: "这个页面没有可直接导入的正文", kind: "empty" }, { status: 404 });
      }
      return textResponse(`${ownText}\n`);
    }

    if (subpages.length > MAX_SUBPAGES) {
      return NextResponse.json(
        {
          error: `这部作品共 ${subpages.length} 篇，联网一次导入太多。可以在维基文库原站阅读；书房内置书库里有的作品请直接读内置版本。`,
          kind: "too_large",
          pages: subpages.length,
        },
        { status: 422 },
      );
    }

    // 目录页上自带的正文小节（如《吶喊》的「自序」）放在最前面；篇目列表这种零碎短行不算正文
    const intro = wikiHtmlToSections(page.html)
      .filter((s) => s.heading && s.paragraphs.join("").length > 200)
      .map((s) => `## ${s.heading}\n\n${s.paragraphs.join("\n")}`);

    const chapters = await mapLimited(subpages, CONCURRENCY, async (link) => {
      const sub = await parsePage(link.title, false);
      const text = bodyText(sub.html);
      return text ? `## ${lastSegment(sub.displayTitle) || link.label}\n\n${text}` : "";
    });
    const body = [...intro, ...chapters.filter(Boolean)];
    if (body.length === 0) {
      return NextResponse.json({ error: "没有取到这部作品的正文", kind: "empty" }, { status: 404 });
    }
    return textResponse(`${body.join("\n\n")}\n`);
  } catch (error) {
    if (error instanceof SourceError) {
      return NextResponse.json({ error: error.message, kind: error.kind }, { status: error.status });
    }
    console.error("[study-room/wikitext]", error);
    return NextResponse.json({ error: "取正文失败，请稍后再试", kind: "unknown" }, { status: 502 });
  }
}
