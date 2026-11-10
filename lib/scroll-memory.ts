/**
 * 应用切换时的滚动位置记忆。
 *
 * 应用每次退出都会被卸载，重新进入时自然回到顶部。这里在切换前记下
 * 「当前最可能在被阅读的那个滚动容器」的位置，切换回来再原样恢复，
 * 并且恢复时用瞬移（behavior:auto）而不是平滑滚动，避免从顶部一路滑下去。
 */

const PREFIX = "y2k:scroll:";

type Entry = { top: number; key: string };

function area(el: Element): number {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) *
        Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
}

function isScrollable(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    if (el.scrollHeight <= el.clientHeight + 4) return false;
    const style = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.clientHeight > 80;
}

/** 找到当前屏幕上最像「正文滚动区」的那个元素。 */
export function findActiveScroller(): HTMLElement | null {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(isScrollable);
    if (!all.length) return null;
    let best: HTMLElement | null = null;
    let bestArea = 0;
    for (const el of all) {
        const a = area(el);
        if (a > bestArea) { bestArea = a; best = el; }
    }
    return best;
}

function domKey(el: HTMLElement): string {
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    for (let i = 0; i < 4 && node; i += 1) {
        const cls = (node.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        parts.unshift(`${node.tagName.toLowerCase()}${cls ? "." + cls : ""}`);
        node = node.parentElement;
    }
    return parts.join(">");
}

export function saveScroll(app: string): void {
    const el = findActiveScroller();
    if (!el) return;
    const entry: Entry = { top: el.scrollTop, key: domKey(el) };
    try { sessionStorage.setItem(PREFIX + app, JSON.stringify(entry)); } catch { /* 忽略存储失败 */ }
}

export function restoreScroll(app: string): void {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(PREFIX + app); } catch { return; }
    if (!raw) return;
    let entry: Entry;
    try { entry = JSON.parse(raw) as Entry; } catch { return; }
    if (!entry || !Number.isFinite(entry.top) || entry.top <= 0) return;

    const apply = () => {
        const el = findActiveScroller();
        if (!el) return false;
        const max = el.scrollHeight - el.clientHeight;
        const target = Math.min(entry.top, Math.max(0, max));
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = "auto";
        el.scrollTop = target;
        el.style.scrollBehavior = prev;
        return Math.abs(el.scrollTop - target) < 2;
    };

    // 首帧内容可能还没撑开，连续几帧内重试，但都用瞬移。
    requestAnimationFrame(() => {
        if (apply()) return;
        let tries = 0;
        const timer = window.setInterval(() => {
            tries += 1;
            if (apply() || tries > 8) window.clearInterval(timer);
        }, 60);
    });
}
