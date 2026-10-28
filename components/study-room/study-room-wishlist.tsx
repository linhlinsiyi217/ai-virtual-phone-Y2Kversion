"use client";

import { useState } from "react";
import { ChevronLeft, Compass, Heart, Trash2 } from "lucide-react";

import { CATEGORY_LABEL } from "@/lib/study-room/book-source";
import { loadWishlist, removeFromWishlist, type WishItem } from "@/lib/study-room/wishlist";

type StudyRoomWishlistProps = { onBack: () => void };

/** 想读的书：书城里暂时读不到、先记下来的书目。只存书目信息，不存正文。 */
export function StudyRoomWishlist({ onBack }: StudyRoomWishlistProps) {
  const [items, setItems] = useState<WishItem[]>(() => loadWishlist());

  const handleRemove = (item: WishItem) => {
    setItems(removeFromWishlist(item.id));
  };

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">想读的书</div>
            <span className="sr-header-sub">{items.length} 本</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          {items.length === 0 ? (
            <div className="sr-empty">
              <Heart size={40} strokeWidth={1} />
              <p>
                还没有记下想读的书。
                <br />
                在书城搜索或「抽一本」里遇到暂时读不到的，可以点「想读」记在这里。
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="sr-res-card">
                <div className="sr-res-cover" style={item.cover ? { backgroundImage: `url("${item.cover}")` } : undefined}>
                  {!item.cover && item.title.slice(0, 1)}
                </div>
                <div className="sr-res-main">
                  <div className="sr-res-title">{item.title}</div>
                  <div className="sr-res-meta">
                    {[item.author, item.year, item.language].filter(Boolean).join(" · ") || "来源未标注"}
                  </div>
                  <div className="sr-res-tags">
                    {item.sourceLabel && <span className="sr-res-source">{item.sourceLabel}</span>}
                    {item.category && <span className="sr-res-kind">{CATEGORY_LABEL[item.category]}</span>}
                    <span className="sr-note-meta">{new Date(item.addedAt).toLocaleDateString("zh-CN")} 记下</span>
                  </div>
                </div>
                <div className="sr-res-actions">
                  {item.externalUrl && (
                    <a className="sr-res-btn" href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                      <Compass size={15} strokeWidth={1.8} />
                      原站
                    </a>
                  )}
                  <button type="button" className="sr-res-btn" onClick={() => handleRemove(item)}>
                    <Trash2 size={15} strokeWidth={1.8} />
                    移除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
