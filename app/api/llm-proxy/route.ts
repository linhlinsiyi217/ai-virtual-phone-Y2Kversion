import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * Same-origin fallback for providers that do not expose browser CORS.
 * The client only uses this route after a direct request fails; normal
 * requests still go straight to the configured provider.
 */
export const maxDuration = 120;
export const runtime = "nodejs";

function getProxyDispatcher(): Dispatcher | undefined {
    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
        || process.env.http_proxy || process.env.HTTP_PROXY;
    return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function isPrivateIpv4(host: string): boolean {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127);
}

function blockedUrlReason(rawUrl: string): string | null {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return "API 地址格式不合法"; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "只允许 http/https API 地址";
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv6 = host.includes(":");
    if (
        host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
        || host === "::1" || host === "0:0:0:0:0:0:0:1"
        || (ipv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")))
        || isPrivateIpv4(host)
    ) return "不允许代理访问本机或内网地址";
    return null;
}

function safeHeaders(input: unknown): Record<string, string> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const lower = key.toLowerCase();
        if (["host", "content-length", "connection", "transfer-encoding"].includes(lower)) continue;
        headers[key] = value;
    }
    return headers;
}

export async function POST(request: NextRequest) {
    let upstreamUrl = "";
    try {
        const payload = await request.json() as {
            url?: unknown;
            headers?: unknown;
            body?: unknown;
            timeoutMs?: unknown;
        };
        upstreamUrl = typeof payload.url === "string" ? payload.url : "";
        if (!upstreamUrl) return NextResponse.json({ error: "缺少 API 地址" }, { status: 400 });
        const blocked = blockedUrlReason(upstreamUrl);
        if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

        const headers = safeHeaders(payload.headers);
        const body = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body ?? {});
        if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";

        const requestedTimeout = Number(payload.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
            ? Math.min(Math.max(requestedTimeout, 1_000), 120_000)
            : 120_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const dispatcher = getProxyDispatcher();
            const upstream = await (dispatcher
                ? undiciFetch(upstreamUrl, { method: "POST", headers, body, signal: controller.signal, dispatcher }) as unknown as Response
                : fetch(upstreamUrl, { method: "POST", headers, body, signal: controller.signal }));
            const responseHeaders = new Headers();
            const contentType = upstream.headers.get("content-type");
            if (contentType) responseHeaders.set("content-type", contentType);
            const cacheControl = upstream.headers.get("cache-control");
            if (cacheControl) responseHeaders.set("cache-control", cacheControl);
            responseHeaders.set("x-ai-phone-llm-proxy", "1");
            return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isAbort = error instanceof Error && error.name === "AbortError";
        return NextResponse.json({
            error: isAbort ? "模型服务请求超时（120 秒）" : `模型代理连接失败：${message}`,
            url: upstreamUrl ? (() => { try { const u = new URL(upstreamUrl); return `${u.origin}${u.pathname}`; } catch { return undefined; } })() : undefined,
        }, { status: isAbort ? 504 : 502 });
    }
}
