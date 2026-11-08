import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewScreen, SCREEN_NAMES } from "./screens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const screen = new URL(request.url).searchParams.get("screen") || "library";
  if (!(SCREEN_NAMES as readonly string[]).includes(screen)) {
    return new Response(`未知画面：${screen}\n可选：${SCREEN_NAMES.join("、")}`, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const css = await readFile(path.join(process.cwd(), "styles", "character-archive.css"), "utf8");
  const markup = renderToStaticMarkup(createElement(PreviewScreen, { screen }));

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>角色档案 · ${screen}</title>
<style>${css}</style>
<style>body{background:#d9d9dd;padding:56px 24px 80px;color:#111;font-family:var(--sans)}</style>
</head>
<body>
<div class="board"><div class="it">${markup}</div></div>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
