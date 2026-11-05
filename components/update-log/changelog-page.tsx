"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchJournal } from "@/lib/update-log/journal";
import type { UpdateEntry } from "@/lib/update-log/journal";

import { Cat } from "./cat";
import { TYPE_META, TYPE_ORDER, fullDate, itemsOf, pad2, shortDate } from "./labels";

const ITEM_H = 44;

/**
 * ③ 更新日志：设置里的完整历史页。
 * 左边是竖向日期滚轮（只负责选版本），右边是大号版本号；下面按新增/优化/修复分组。
 */
export function ChangelogPage() {
  const [logs, setLogs] = useState<UpdateEntry[] | null>(null);
  const [active, setActive] = useState(0);
  const wheelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchJournal().then((list) => {
      if (!alive) return;
      setLogs(list && list.length ? list : []);
      setActive(0);
    });
    return () => {
      alive = false;
    };
  }, []);

  const count = logs?.length ?? 0;

  const select = useCallback((index: number) => {
    setActive(index);
    const wheel = wheelRef.current;
    if (wheel) wheel.scrollTo({ top: index * ITEM_H, behavior: "smooth" });
  }, []);

  const onScroll = useCallback(() => {
    const wheel = wheelRef.current;
    if (!wheel) return;
    const index = Math.max(0, Math.min(count - 1, Math.round(wheel.scrollTop / ITEM_H)));
    setActive((previous) => (previous === index ? previous : index));
  }, [count]);

  if (!logs) return <div className="uui-log" aria-busy="true" />;

  if (!count) {
    return (
      <div className="uui-log">
        <div className="uui-empty">
          <Cat pose="sleep" face="sleepy" />
          <div className="uui-hl">还没有更新记录</div>
          <div className="uui-meta">等下一次更新写进来</div>
        </div>
      </div>
    );
  }

  const entry = logs[active] ?? logs[0];
  const first = active === 0;
  const last = active === count - 1;
  const groups = TYPE_ORDER.map((type) => ({ type, items: itemsOf(entry, type) })).filter((group) => group.items.length);

  return (
    <div className="uui-log">
      <div className="uui-logcard">
        <div className="uui-strip">
          <div className="uui-wheel" ref={wheelRef} onScroll={onScroll} aria-label="选择更新版本">
            {logs.map((item, index) => (
              <div
                className={`uui-witem ${index === active ? "on" : ""}`}
                key={item.id}
                onClick={() => select(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") select(index);
                }}
              >
                <b>{shortDate(item.date)}</b>
                <i>v{item.version}</i>
              </div>
            ))}
          </div>
          <div className="uui-band" aria-hidden="true" />
        </div>

        <div className="uui-logmain" key={entry.id}>
          <div className="uui-daterow">
            <span className="uui-date">{fullDate(entry.date)}</span>
            <div className="uui-arrows">
              <button type="button" className="uui-arrow" aria-label="更早的版本" disabled={last} onClick={() => select(Math.min(count - 1, active + 1))}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5" /></svg>
              </button>
              <button type="button" className="uui-arrow" aria-label="更新的版本" disabled={first} onClick={() => select(Math.max(0, active - 1))}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3l-5 5 5 5" /></svg>
              </button>
            </div>
          </div>

          <h2 className="uui-vbig">v{entry.version}</h2>
          <div className="uui-logtitle">{entry.title}</div>

          <div className="uui-counts">
            {TYPE_ORDER.map((type) => (
              <div key={type}>
                <b>{pad2(itemsOf(entry, type).length)}</b>
                <span>{TYPE_META[type].label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="uui-cards">
        {groups.map((group) => (
          <section className="uui-catcard" key={group.type}>
            <div className="uui-cath">
              <div>
                <b>{TYPE_META[group.type].label}</b>
                <em>{TYPE_META[group.type].en}</em>
              </div>
              <span className="uui-catnum">{pad2(group.items.length)}</span>
            </div>
            <div className="uui-cathint">{TYPE_META[group.type].hint}</div>
            {group.items.map((item, index) => (
              <div className="uui-item" key={`${group.type}-${index}`}>
                <span className="uui-num2">{pad2(index + 1)}</span>
                <div className="uui-item-body">
                  <div className="uui-item-head">
                    <b>{item.head}</b>
                    <i className="uui-app">{item.app}</i>
                  </div>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <p className="uui-thanks">谢谢你一直在用</p>
    </div>
  );
}
