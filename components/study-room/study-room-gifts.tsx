"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Gift, BookOpen, Trash2 } from "lucide-react";

import { GiftIcon } from "./gift-sheet";
import { giftDef, loadGiftState, saveGiftState, type BookGiftRecord, type GiftRecord } from "@/lib/study-room/gifts";
import { HelpFoot } from "./help-tip";

type StudyRoomGiftsProps = { onBack: () => void };

/** 送书与送礼记录：谁送的、送给谁、送了什么、多少个、什么时候，以及对方的回应。 */
export function StudyRoomGifts({ onBack }: StudyRoomGiftsProps) {
  const [state, setState] = useState(() => loadGiftState());

  useEffect(() => {
    setState(loadGiftState());
  }, []);

  const removeGift = (record: GiftRecord) => {
    if (!confirm("删除这条送礼记录？")) return;
    const next = { ...state, gifts: state.gifts.filter((item) => item.id !== record.id) };
    saveGiftState(next);
    setState(next);
  };

  const removeBookGift = (record: BookGiftRecord) => {
    if (!confirm("删除这条送书记录？")) return;
    const next = { ...state, bookGifts: state.bookGifts.filter((item) => item.id !== record.id) };
    saveGiftState(next);
    setState(next);
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
            <div className="sr-header-title">礼物与送书</div>
            <span className="sr-header-sub">
              {state.gifts.length} 次送礼 · {state.bookGifts.length} 次送书
            </span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          <div className="sr-section-label">送出的礼物</div>
          {state.gifts.length === 0 ? (
            <div className="sr-note-card">
              <div className="sr-note-meta" style={{ lineHeight: 1.8 }}>
                还没有送过礼物。可以在书详情、书友圈的帖子里送出鲜花、书签、咖啡、阅读台灯、钢笔、催更票或小礼盒。
              </div>
            </div>
          ) : (
            state.gifts.map((record) => {
              const gift = giftDef(record.giftId);
              return (
                <div key={record.id} className="sr-note-card">
                  <div className="sr-gift-row">
                    <GiftIcon id={record.giftId} size={30} />
                    <div className="sr-gift-row-main">
                      <div style={{ fontSize: 14, color: "var(--c-text-title)" }}>
                        {gift.name} × {record.count} → {record.toName}
                      </div>
                      <div className="sr-note-meta">
                        {new Date(record.createdAt).toLocaleString("zh-CN")}
                        {record.bookTitle ? ` · 关联《${record.bookTitle}》` : ""}
                      </div>
                      {record.message && <div className="sr-note-meta">留言：{record.message}</div>}
                    </div>
                    <button type="button" className="sr-note-tool" title="删除记录" onClick={() => removeGift(record)}>
                      <Trash2 size={15} strokeWidth={1.7} />
                    </button>
                  </div>
                  {record.reply && (
                    <div className="sr-gift-reply">
                      <span className="sr-forum-comment-author">{record.toName}</span>
                      <span className="sr-forum-comment-body">{record.reply.text}</span>
                    </div>
                  )}
                  {!record.reply && <div className="sr-note-meta" style={{ marginTop: 6 }}>对方暂时没有回应</div>}
                </div>
              );
            })
          )}

          <div className="sr-section-label">送出的书</div>
          {state.bookGifts.length === 0 ? (
            <div className="sr-note-card">
              <div className="sr-note-meta" style={{ lineHeight: 1.8 }}>
                还没有送过书。送书只送出书目与留言，不传送正文文件。
              </div>
            </div>
          ) : (
            state.bookGifts.map((record) => (
              <div key={record.id} className="sr-note-card">
                <div className="sr-gift-row">
                  <BookOpen size={24} strokeWidth={1.5} color="var(--c-icon)" />
                  <div className="sr-gift-row-main">
                    <div style={{ fontSize: 14, color: "var(--c-text-title)" }}>
                      《{record.bookTitle}》→ {record.toName}
                    </div>
                    <div className="sr-note-meta">{new Date(record.createdAt).toLocaleString("zh-CN")}</div>
                    {record.message && <div className="sr-note-meta">留言：{record.message}</div>}
                  </div>
                  <button type="button" className="sr-note-tool" title="删除记录" onClick={() => removeBookGift(record)}>
                    <Trash2 size={15} strokeWidth={1.7} />
                  </button>
                </div>
                {record.reply && (
                  <div className="sr-gift-reply">
                    <span className="sr-forum-comment-author">{record.toName}</span>
                    <span className="sr-forum-comment-body">{record.reply.text}</span>
                  </div>
                )}
              </div>
            ))
          )}

          <HelpFoot id="gifts-about" label="关于礼物">
            <Gift size={13} strokeWidth={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
            礼物是本机记录的虚拟心意：不涉及充值、支付或余额，也不会因为重复点击重复送出。
          </HelpFoot>
        </div>
      </div>
    </section>
  );
}
