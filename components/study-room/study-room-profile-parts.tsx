"use client";

import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import { ChevronRight, Heart, MessageCircle, Plus } from "lucide-react";

import { KIND_TEXT, type ForumPost } from "@/lib/study-room/forum";
import { SPOILER_SUMMARY } from "./spoiler";

/** 帖子时间的短格式：今天显示时刻，今年显示月日，更早显示年月日。 */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}


/**
 * 云朵状态气泡：轮廓取自用户指定素材（/study-room/bubble/bubble-mask.png、bubble-rim.png）。
 * 只显示素材的云朵主体和相连的尾巴，素材底部那颗独立小圆点用蒙版裁掉，不另画白球；
 * 按原比例缩放，不拉伸。文字只放在主体安全区内，尾巴不放字。
 */
/** 底色偏深就用白字，保证气泡里的字看得清 */
function bubbleTone(hex: string): "dark" | "light" {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l < 0.36 ? "dark" : "light";
}

function ThoughtBubble({ text, onEdit, color }: { text: string; onEdit?: () => void; color?: string }) {
  const colored = color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
  const look = colored
    ? {
        "data-colored": "true",
        "data-tone": bubbleTone(colored),
        style: { "--sr-pf-bubble-bg": colored } as CSSProperties,
      }
    : {};
  const inner = (
    <>
      <span className="sr-pf-bubble-shadow" aria-hidden />
      <span className="sr-pf-bubble-glass" aria-hidden />
      <span className="sr-pf-bubble-rim" aria-hidden />
      <span className="sr-pf-bubble-text">
        <span>{text}</span>
      </span>
    </>
  );
  if (onEdit) {
    return (
      <button type="button" className="sr-pf-bubble" onClick={onEdit} aria-label={`状态：${text}，点按修改`} {...look}>
        {inner}
      </button>
    );
  }
  return (
    <div className="sr-pf-bubble" role="note" aria-label={`状态：${text}`} {...look}>
      {inner}
    </div>
  );
}

/**
 * 主页身份区：头像在左、名字与真实统计在右。
 * 状态气泡小小地挂在头像左上方，尾巴只轻压头像边缘，不挡脸、名字和统计；
 * 自己的主页没写状态时只在头像左上角放一个小「＋」入口；他人主页没内容就不显示。
 */
export function ProfileHero({
  avatarSrc,
  name,
  nameExtra,
  idText,
  subText,
  stats,
  bubble,
  bubbleColor,
  onEditBubble,
  corner,
}: {
  avatarSrc: string;
  name: string;
  nameExtra?: ReactNode;
  idText: string;
  subText?: string;
  stats: Array<{ label: string; value: number }>;
  bubble: string;
  /** 气泡底色 #RRGGBB；不传保持原来的玻璃白 */
  bubbleColor?: string;
  /** 只有自己的主页可编辑气泡 */
  onEditBubble?: () => void;
  /** 右上角的小按钮（如设置） */
  corner?: ReactNode;
}) {
  const text = bubble.trim();

  return (
    <div className="sr-pf-hero" data-bubble={text ? "true" : undefined}>
      {corner && <div className="sr-pf-hero-corner">{corner}</div>}
      <div className="sr-pf-hero-row">
        <span className="sr-pf-avatar-wrap">
          <span className="sr-pf-avatar" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarSrc} alt="" />
          </span>
          {text ? (
            <ThoughtBubble text={text} onEdit={onEditBubble} color={bubbleColor} />
          ) : (
            onEditBubble && (
              <button type="button" className="sr-pf-status-add" onClick={onEditBubble} aria-label="设置状态">
                <Plus size={14} strokeWidth={2.2} aria-hidden />
              </button>
            )
          )}
        </span>
        <div className="sr-pf-id">
          <h2 className="sr-pf-name">
            <span className="sr-pf-name-text">{name}</span>
            {nameExtra}
          </h2>
          <div className="sr-pf-sub">ID {idText}</div>
          {subText && <div className="sr-pf-sub">{subText}</div>}
          {stats.length > 0 && (
            <div className="sr-pf-stats">
              {stats.map((item) => (
                <div key={item.label} className="sr-pf-stat">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 内容分区：下划线标签（语义上是 tablist），只放实际存在的几项。 */
export function ProfileTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: K; label: string; count?: number }>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="sr-pf-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          className="sr-pf-tab"
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {typeof tab.count === "number" && tab.count > 0 && <span className="sr-pf-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** 小插图：一摞纸与一支笔，跟随文字颜色，不用表情符号。 */
function EmptyArt() {
  return (
    <svg viewBox="0 0 96 64" width="96" height="64" aria-hidden>
      <rect x="22" y="14" width="40" height="44" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="30" y="8" width="40" height="44" rx="6" fill="#fff" stroke="currentColor" strokeOpacity="0.22" />
      <path d="M38 20h24M38 27h24M38 34h14" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
      <path d="M66 44l12-12 4 4-12 12-5 1z" fill="#fff" stroke="currentColor" strokeOpacity="0.45" strokeLinejoin="round" />
    </svg>
  );
}

/** 空状态：插图 + 一句话 + 真实入口（可选）。 */
export function ProfileEmpty({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="sr-pf-empty">
      <EmptyArt />
      <p>{text}</p>
      {action && (
        <button type="button" className="sr-btn sr-btn-primary sr-pf-empty-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * 动态横滑卡：一次一张、露出下一张一角，自然吸附。
 * 触摸用原生滚动；鼠标可按住拖动。拖动超过 6px 就不算点击，不会误开帖子。
 */
export function PostStrip({
  posts,
  empty,
  onOpen,
}: {
  posts: ForumPost[];
  empty: ReactNode;
  onOpen?: (postId: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; left: number; moved: boolean; id: number } | null>(null);
  const suppressRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  if (posts.length === 0) return <>{empty}</>;

  return (
    <div
      ref={stripRef}
      className="sr-pf-strip"
      role="list"
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        const el = stripRef.current;
        if (!el) return;
        suppressRef.current = false;
        dragRef.current = { x: event.clientX, left: el.scrollLeft, moved: false, id: event.pointerId };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const el = stripRef.current;
        if (!drag || !el || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 6) {
          drag.moved = true;
          setDragging(true);
          el.setPointerCapture(event.pointerId);
        }
        if (drag.moved) el.scrollLeft = drag.left - dx;
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        if (drag.moved) {
          suppressRef.current = true;
          stripRef.current?.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onClickCapture={(event) => {
        if (suppressRef.current) {
          suppressRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {posts.map((post) => {
        const cover = post.spoiler ? undefined : post.images?.[0];
        // 剧透帖：标题与正文都不露，只给安全摘要
        const heading = post.spoiler ? (post.bookTitle ? `《${post.bookTitle}》` : "") : post.title || (post.bookTitle ? `《${post.bookTitle}》` : "");
        return (
          <button
            key={post.id}
            type="button"
            role="listitem"
            className="sr-pf-card"
            data-text-only={cover ? undefined : "true"}
            onClick={() => onOpen?.(post.id)}
            disabled={!onOpen}
            draggable={false}
          >
            <span className="sr-pf-card-main">
              <span className="sr-pf-card-body">
                {heading && <span className="sr-pf-card-title">{heading}</span>}
                <span className="sr-pf-card-excerpt" data-lines={heading ? "2" : "3"}>{post.spoiler ? SPOILER_SUMMARY : post.body}</span>
              </span>
              {cover && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="sr-pf-card-img" src={cover} alt="" draggable={false} />
              )}
            </span>
            <span className="sr-pf-card-foot">
              <span className="sr-pf-card-kind">{KIND_TEXT[post.kind]}</span>
              <span className="sr-pf-card-time">{shortTime(post.createdAt)}</span>
              <span className="sr-pf-card-meta">
                <Heart size={12} strokeWidth={1.8} aria-label="赞" /> {post.likedBy.length}
                <MessageCircle size={12} strokeWidth={1.8} aria-label="评论" /> {post.comments.length}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 两列作品 / 书单：没有封面时用文字封面。 */
export function TwoColumnGrid({
  items,
  empty,
}: {
  items: Array<{ key: string; title: string; meta?: string; onOpen?: () => void }>;
  empty: ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="sr-pf-grid">
      {items.map((item) => (
        <button key={item.key} type="button" className="sr-pf-tile" onClick={item.onOpen} disabled={!item.onOpen}>
          <span className="sr-pf-tile-cover">{item.title.slice(0, 12)}</span>
          <span className="sr-pf-tile-title">{item.title}</span>
          {item.meta && <span className="sr-pf-tile-meta">{item.meta}</span>}
        </button>
      ))}
    </div>
  );
}

export type EntryItem = { key: string; label: string; icon: ReactNode; value?: number; onOpen: () => void };

/** 功能入口：两列块（图标 + 短名 + 可选数字）。 */
export function EntryGrid({ items }: { items: EntryItem[] }) {
  return (
    <div className="sr-pf-entries">
      {items.map((item) => (
        <button key={item.key} type="button" className="sr-pf-entry" onClick={item.onOpen}>
          <span className="sr-pf-entry-icon" aria-hidden>{item.icon}</span>
          <span className="sr-pf-entry-label">{item.label}</span>
          {typeof item.value === "number" && <span className="sr-pf-entry-value">{item.value}</span>}
        </button>
      ))}
    </div>
  );
}

/** 功能入口：带图标的列表行，一组一个白色圆角面。 */
export function EntryList({ items }: { items: EntryItem[] }) {
  return (
    <div className="sr-pf-list">
      {items.map((item) => (
        <button key={item.key} type="button" className="sr-pf-row" onClick={item.onOpen}>
          <span className="sr-pf-row-icon" aria-hidden>{item.icon}</span>
          <span className="sr-pf-row-label">{item.label}</span>
          {typeof item.value === "number" && <span className="sr-pf-row-value">{item.value}</span>}
          <ChevronRight size={16} strokeWidth={1.7} className="sr-pf-row-chevron" aria-hidden />
        </button>
      ))}
    </div>
  );
}
