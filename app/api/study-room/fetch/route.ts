// app/api/study-room/fetch/route.ts — 代理下载公版书文件，供书房导入书架。
// 只允许已知公版书站点，避免被当作任意 URL 代理（SSRF）。

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST_SUFFIXES = [
  ".gutenberg.org",
  ".gutenberg.net",
  ".gutenberg.net.au",
  ".gutenberg.ca",
];

function isAllowed(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "缺少 url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "url 无效" }, { status: 400 });
  }
  if (!isAllowed(parsed)) {
    return NextResponse.json({ error: "该地址不在允许的来源范围内" }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(parsed, {
      signal: controller.signal,
      headers: { "User-Agent": "LinH-Float-StudyRoom/1.0 (book import)" },
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `上游返回 ${upstream.status}` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[study-room/fetch]", error);
    return NextResponse.json({ error: "下载失败" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
