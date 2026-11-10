/**
 * 票据 PNG：把数据写进 PNG 的 tEXt 块，图片本身就是二维码之外的第二条通道。
 * 读的时候先找 tEXt，找不到再让用户自己贴 JSON。
 */

const KEY = "y2k-ticket";

type TicketPayload = {
    format: "y2k-ticket";
    version: number;
    id: string;
    type: string;
    name: string;
    author: { name: string; note?: string; avatar?: string };
    createdAt: string;
    modules: string[];
    payload: unknown;
    checksum?: string;
};

/** 32 位 CRC（PNG 规范用） */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const body = concat([typeBytes, data]);
    return concat([u32(data.length), body, u32(crc32(body))]);
}

/** 在 IEND 之前插入一条 tEXt 块。 */
export function embedTicket(original: ArrayBuffer, json: string): Uint8Array {
    const src = new Uint8Array(original);
    const need = new TextEncoder().encode(`${KEY}\0${json}`);
    const chunk = makeChunk("tEXt", need);
    // IEND 固定是最后 12 字节
    const head = src.slice(0, src.length - 12);
    const tail = src.slice(src.length - 12);
    return concat([head, chunk, tail]);
}

/** 从 PNG 里读出票据 JSON。 */
export function readTicket(buffer: ArrayBuffer): TicketPayload | null {
    const bytes = new Uint8Array(buffer);
    let at = 8;
    while (at + 8 <= bytes.length) {
        const len = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
        if (type === "tEXt") {
            const data = bytes.slice(at + 8, at + 8 + len);
            const text = new TextDecoder().decode(data);
            const [key, ...rest] = text.split("\0");
            if (key === KEY) {
                try { return JSON.parse(rest.join("\0")) as TicketPayload; } catch { return null; }
            }
        }
        if (type === "IEND") break;
        at += 12 + len;
    }
    return null;
}

/** 画一张票据：左票根、中预览槽、右模块清单。 */
export async function drawTicket(payload: TicketPayload, previewHtml?: HTMLElement | null): Promise<Blob> {
    const W = 1200, H = 620;
    const canvas = document.createElement("canvas");
    canvas.width = W * 2; canvas.height = H * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.scale(2, 2);

    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#e6e6ea"; ctx.lineWidth = 1; ctx.strokeRect(16, 16, W - 32, H - 32);

    // 中间打孔虚线
    ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(430, 40); ctx.lineTo(430, H - 40); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(430, 40); ctx.lineTo(430, H - 40); ctx.stroke();

    // 左：票根
    ctx.fillStyle = "#0a0a0a"; ctx.font = "600 13px system-ui"; ctx.fillText("Y2K PHONE · 票根", 48, 70);
    ctx.font = "700 34px system-ui"; ctx.fillText(payload.name.slice(0, 10), 48, 130);
    ctx.font = "400 14px system-ui"; ctx.fillStyle = "#6e6e73";
    ctx.fillText("TYPE", 48, 180); ctx.fillText(payload.type, 48, 202);
    ctx.fillText("AUTHOR", 48, 246); ctx.fillText(payload.author?.name || "匿名", 48, 268);
    if (payload.author?.note) ctx.fillText(payload.author.note.slice(0, 22), 48, 306);
    // 条形码
    let x = 48; while (x < 380) { const w = 1 + Math.floor(Math.random() * 3); ctx.fillStyle = x % 7 === 0 ? "#0a0a0a" : "#3a3a3a"; ctx.fillRect(x, 420, w, 56); x += w + 3; }
    ctx.fillStyle = "#8a8a8e"; ctx.font = "400 12px system-ui"; ctx.fillText(payload.id, 48, 500);

    // 中：预览槽（放真实渲染的截图位置）
    ctx.fillStyle = "#f4f4f6"; roundRect(ctx, 462, 48, 430, 524, 20); ctx.fill();
    if (previewHtml) {
        ctx.fillStyle = "#6e6e73"; ctx.font = "400 13px system-ui";
        ctx.fillText("此处显示真实效果（页面内渲染）", 486, 96);
    }

    // 右：模块清单
    ctx.fillStyle = "#0a0a0a"; ctx.font = "600 15px system-ui"; ctx.fillText("包含模块", 924, 74);
    ctx.font = "400 13px system-ui"; ctx.fillStyle = "#4a4a4e";
    payload.modules.forEach((m, i) => {
        ctx.fillStyle = "#0a0a0a"; ctx.beginPath(); ctx.arc(930, 108 + i * 30, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4a4a4e"; ctx.fillText(m, 944, 113 + i * 30);
    });
    ctx.fillStyle = "#8a8a8e"; ctx.font = "400 12px system-ui";
    ctx.fillText("这张图里带着数据：", 924, 470);
    ctx.fillText("在小手机里选图即可导入。", 924, 490);
    ctx.fillText(`v${payload.version} · ${payload.createdAt.slice(0, 10)}`, 924, 560);

    return new Promise(resolve => canvas.toBlob(blob => resolve(blob as Blob), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export async function exportTicket(payload: TicketPayload): Promise<Blob> {
    const base = await drawTicket(payload);
    const buf = await base.arrayBuffer();
    const withData = embedTicket(buf, JSON.stringify(payload));
    return new Blob([withData.slice().buffer as ArrayBuffer], { type: "image/png" });
}
