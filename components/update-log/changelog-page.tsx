"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { Release, UpdateCategory } from "@/lib/update-log/types";
import { noticeOf, userText } from "@/lib/update-log/user-view";

/** 滚轮一行的高度，和 CSS 里的 .cl-wheel-item 必须一致 */
const ITEM_H = 46;

function chipOf(category: UpdateCategory): { label: string; cls: string } {
  if (category === "fix") return { label: "修复", cls: "is-fix" };
  if (category === "feat") return { label: "新增", cls: "is-new" };
  return { label: "优化", cls: "is-improve" };
}

function shortDate(date: string): string {
  return date.slice(5).replace("-", ".");
}

/**
 * 设置里的「更新日志」整页。
 *
 * 左边是竖向日期滚轮，只负责切换当前查看的版本；右边正文自己滚动。
 * 滚日期 → 正文跳到对应版本；滚正文 → 只同步高亮日期，不回写滚轮位置，
 * 避免两边互相带动。展开的版本按条目数量自动撑出左侧连接线。
 */
export function ChangelogPage({ releases }: { releases: Release[] }) {
  const [open, setOpen] = useState<string[]>(() => (releases[0] ? [releases[0].releaseId] : []));
  const [active, setActive] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const wheelTimer = useRef<number | null>(null);
  // 程序化滚动正文时先锁住高亮同步，免得一路上把每个中间版本都点亮
  const syncLockUntil = useRef(0);

  const items = useMemo(() => releases.map((release) => ({ release, headline: noticeOf(release).headline })), [releases]);

  const cards = useCallback(() => {
    const body = bodyRef.current;
    return body ? Array.from(body.querySelectorAll<HTMLElement>("[data-rel]")) : [];
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const body = bodyRef.current;
      const card = cards()[index];
      if (!body || !card) return;
      syncLockUntil.current = Date.now() + 520;
      setActive(index);
      body.scrollTo({ top: card.offsetTop - 4, behavior: "smooth" });
    },
    [cards],
  );

  // 滚轮停下后再切换，滚动过程中不反复跳动
  const handleWheelScroll = () => {
    if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      const wheel = wheelRef.current;
      if (!wheel) return;
      const index = Math.max(0, Math.min(items.length - 1, Math.round(wheel.scrollTop / ITEM_H)));
      if (Math.abs(wheel.scrollTop - index * ITEM_H) > 1) {
        wheel.scrollTo({ top: index * ITEM_H, behavior: "smooth" });
      }
      goTo(index);
    }, 120);
  };

  // 正文滚动只更新高亮，绝不移动滚轮
  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body || Date.now() < syncLockUntil.current) return;
    const marker = body.scrollTop + 12;
    let index = 0;
    cards().forEach((card, i) => {
      if (card.offsetTop <= marker) index = i;
    });
    setActive((prev) => (prev === index ? prev : index));
  };

  const pick = (index: number) => {
    const wheel = wheelRef.current;
    if (wheel) wheel.scrollTo({ top: index * ITEM_H, behavior: "smooth" });
    goTo(index);
  };

  const toggle = (releaseId: string) => {
    setOpen((prev) => (prev.includes(releaseId) ? prev.filter((id) => id !== releaseId) : [...prev, releaseId]));
  };

  return (
    <div className="cl-page">
      <div className="cl-wheel-wrap">
        <div className="cl-wheel-mid" aria-hidden />
        <div
          className="cl-wheel"
          ref={wheelRef}
          onScroll={handleWheelScroll}
          role="listbox"
          aria-label="按日期切换版本"
        >
          {items.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={item.release.releaseId}
              className={`cl-wheel-item ${index === active ? "on" : ""}`}
              onClick={() => pick(index)}
            >
              <span className="cl-wheel-date">{shortDate(item.release.date)}</span>
              <span className="cl-wheel-ver">v{item.release.version}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cl-body" ref={bodyRef} onScroll={handleBodyScroll}>
        {items.length === 0 ? (
          <p className="cl-empty">还没有更新记录</p>
        ) : (
          items.map(({ release, headline }, index) => {
            const expanded = open.includes(release.releaseId);
            return (
              <section className="cl-rel" data-rel key={release.releaseId}>
                <button type="button" className="cl-rel-head" onClick={() => toggle(release.releaseId)} aria-expanded={expanded}>
                  <span className="cl-rel-main">
                    <span className="cl-rel-top">
                      <span className="cl-ver">v{release.version}</span>
                      {index === 0 && <span className="cl-current">当前版本</span>}
                    </span>
                    <span className="cl-rel-sum">{headline}</span>
                  </span>
                  <span className="cl-rel-side">
                    <span className="cl-rel-date">{release.date}</span>
                    <ChevronDown size={16} strokeWidth={1.7} className={`cl-arrow ${expanded ? "open" : ""}`} aria-hidden />
                  </span>
                </button>

                {expanded && (
                  <div className="cl-entries">
                    {release.entries.map((entry) => {
                      const chip = chipOf(entry.category);
                      return (
                        <article className="cl-entry" key={entry.id}>
                          <span className="cl-entry-app">{userText(entry.app)}</span>
                          <div className="cl-entry-head">
                            <span className={`cl-chip ${chip.cls}`}>{chip.label}</span>
                            <span className="cl-entry-title">{userText(entry.title)}</span>
                          </div>
                          {entry.items.length > 0 && (
                            <ul className="cl-entry-items">
                              {entry.items.map((item, i) => (
                                <li key={i}>{userText(item)}</li>
                              ))}
                            </ul>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
