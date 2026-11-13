/**
 * 应用切换时的滚动位置记忆。
 *
 * 应用每次退出都会被卸载，重新进入时自然回到顶部。这里在可见期间持续记录
 * 每个滚动容器（按容器身份归档）的位置，切换回来时**按同一容器**恢复，
 * 并且恢复时用瞬移（behavior:auto）而不是平滑滚动，避免从顶部一路滑下去。
 *
 * 恢复为什么以前会失效：
 * 1. 应用刚挂载时内容往往还没撑开，只试一帧就放弃，位置被钳成 0；
 * 2. 恢复时不看当初记的是哪个容器，现场挑「面积最大」的元素，容易张冠李戴；
 * 3. 用户主动滚回顶部再退出，会被拽回旧位置。这里逐条修掉。
 */

const PREFIX = "y2k:scroll:";

type Entry = { top: number; key: string };

/** 单个应用最多记多少个滚动容器（够覆盖列表 + 子页面 + 弹层） */
const MAX_ENTRIES = 32;
/** 恢复时最多重试多少帧（覆盖异步渲染的内容撑开） */
const RESTORE_TRIES = 20;
const RETRY_INTERVAL_MS = 60;

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

function visible(el: HTMLElement): boolean {
    return area(el) > 0;
}

/** 容器身份：优先用明确的 data-scroll-root 标记，否则用 DOM 结构路径兜底。 */
function domKey(el: HTMLElement): string {
    const marker = el.dataset.scrollRoot;
    if (marker) return `@${marker}`;
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    for (let i = 0; i < 4 && node; i += 1) {
        const cls = (node.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        parts.unshift(`${node.tagName.toLowerCase()}${cls ? "." + cls : ""}`);
        node = node.parentElement;
    }
    return parts.join(">");
}

/** 按 domKey 找回当初记录的那个容器：先查标记，再按结构路径比对。 */
function findScrollerByKey(key: string): HTMLElement | null {
    if (key.startsWith("@")) {
        const el = document.querySelector<HTMLElement>(`[data-scroll-root="${CSS.escape(key.slice(1))}"]`);
        if (el && isScrollable(el) && visible(el)) return el;
        return null;
    }
    let best: HTMLElement | null = null;
    let bestArea = 0;
    const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
    for (const el of all) {
        if (!isScrollable(el) || !visible(el)) continue;
        if (domKey(el) !== key) continue;
        const a = area(el);
        if (a > bestArea) { bestArea = a; best = el; }
    }
    return best;
}

/** 找到当前屏幕上最像「正文滚动区」的那个元素：带标记的优先，其次按面积。 */
export function findActiveScroller(): HTMLElement | null {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
        (el) => isScrollable(el) && visible(el),
    );
    if (!all.length) return null;
    let best: HTMLElement | null = null;
    let bestArea = 0;
    let bestMarked = false;
    for (const el of all) {
        const marked = Boolean(el.dataset.scrollRoot);
        const a = area(el);
        if (marked && !bestMarked) { best = el; bestArea = a; bestMarked = true; continue; }
        if (marked === bestMarked && a > bestArea) { bestArea = a; best = el; }
    }
    return best;
}

function setScrollTop(el: HTMLElement, target: number): boolean {
    const max = el.scrollHeight - el.clientHeight;
    const clamped = Math.min(Math.max(0, target), Math.max(0, max));
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = clamped;
    el.style.scrollBehavior = prev;
    return Math.abs(el.scrollTop - clamped) < 2;
}

/** 带重试地恢复：内容没撑开时多试几帧，成功或超时为止。 */
function restoreWithRetry(entries: Entry[]): void {
    let tries = 0;
    const attempt = () => {
        tries += 1;
        let pending = false;
        for (const entry of entries) {
            const el = findScrollerByKey(entry.key);
            if (!el) { pending = true; continue; }
            const applied = setScrollTop(el, entry.top);
            // 还没撑开时 scrollTop 会停在 0，下一帧再试
            if (!applied && entry.top > 0 && tries < RESTORE_TRIES) pending = true;
        }
        if (pending && tries < RESTORE_TRIES) window.setTimeout(attempt, RETRY_INTERVAL_MS);
    };
    requestAnimationFrame(() => attempt());
}

export function saveScroll(app: string): void {
    const el = findActiveScroller();
    if (!el || el.scrollTop <= 0) return;
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
    restoreWithRetry([entry]);
}

// ── 持续记录 ──────────────────────────────────────────────
// 只在切换时保存是不够的：旧应用已经被隐藏，容器 scrollTop 往往已经归零。
// 改成可见期间一直记（含滚回顶部的 0，尊重用户的选择），切换回来按容器逐一恢复。

const live = new Map<string, Map<string, number>>();
let tracking = false;

export function startScrollTracking(getApp: () => string | null): () => void {
    if (tracking) return () => {};
    tracking = true;
    let raf = 0;
    const onScroll = (event: Event) => {
        const app = getApp();
        if (!app) return;
        const el = event.target;
        if (!(el instanceof HTMLElement)) return;
        if (!isScrollable(el) || !visible(el)) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            let map = live.get(app);
            if (!map) { map = new Map(); live.set(app, map); }
            if (map.size >= MAX_ENTRIES && !map.has(domKey(el))) return;
            map.set(domKey(el), el.scrollTop);
        });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
        document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
        tracking = false;
    };
}

/** 切走前把当前可见的所有滚动位置记下来（按容器归档）。 */
export function saveScrollLive(app: string): void {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
        (el) => isScrollable(el) && visible(el),
    );
    if (!all.length) return;
    let map = live.get(app);
    if (!map) { map = new Map(); live.set(app, map); }
    // 面积大的优先保留，超出上限时丢弃小的
    const ranked = all
        .map((el) => ({ el, a: area(el) }))
        .sort((x, y) => y.a - x.a)
        .slice(0, MAX_ENTRIES);
    for (const { el } of ranked) map.set(domKey(el), el.scrollTop);
}

/** 切回时按容器逐一恢复；有记录就返回 true（不再走 sessionStorage 兜底）。 */
export function restoreScrollLive(app: string): boolean {
    const map = live.get(app);
    if (!map || !map.size) return false;
    const entries: Entry[] = Array.from(map.entries()).map(([key, top]) => ({ key, top }));
    restoreWithRetry(entries);
    return true;
}

/** 测试与调试用：清掉某个应用的记忆。 */
export function forgetScroll(app: string): void {
    live.delete(app);
    try { sessionStorage.removeItem(PREFIX + app); } catch { /* 忽略 */ }
}
