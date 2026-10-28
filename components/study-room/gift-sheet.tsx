"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Send, X } from "lucide-react";

import type { Book } from "@/lib/reading-types";
import {
  GIFT_DEFS,
  attachReply,
  giftActionText,
  giftDef,
  generateGiftReply,
  loadRecipients,
  resolveNpcPersona,
  sendBookGift,
  sendGift,
  type GiftId,
  type GiftRecord,
  type Recipient,
} from "@/lib/study-room/gifts";
import { loadForum } from "@/lib/study-room/forum";
import { loadCharacters } from "@/lib/character-storage";
import { HelpFoot, HelpTip } from "./help-tip";

/** 礼物图标：原创 SVG，统一 24×24 视口与自己画的路径。 */
export function GiftIcon({ id, size = 26, className }: { id: GiftId; size?: number; className?: string }) {
  const gift = giftDef(id);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role="img"
      aria-label={gift.name}
    >
      <path
        d={gift.paths}
        stroke={gift.color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type GiftSheetProps = {
  /** 预设接收人（送书时先选好书，再选人） */
  presetRecipient?: Recipient;
  /** 关联的书 / 帖子 */
  book?: Pick<Book, "id" | "title">;
  postId?: string;
  /** "gift" 只送虚拟礼物；"book" 只送书 */
  mode?: "gift" | "book" | "both";
  onClose: () => void;
  onSent?: (record: GiftRecord | null, reply: string | null) => void;
};

export function GiftSheet({ presetRecipient, book, postId, mode = "gift", onClose, onSent }: GiftSheetProps) {
  const recipients = useMemo(() => loadRecipients(), []);
  const [recipientId, setRecipientId] = useState(presetRecipient?.id ?? recipients[0]?.id ?? "");
  const [kind, setKind] = useState<"gift" | "book">(mode === "book" ? "book" : "gift");
  const [giftId, setGiftId] = useState<GiftId>("flower");
  const [count, setCount] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (mode !== "both") setKind(mode);
  }, [mode]);

  const recipient = recipients.find((item) => item.id === recipientId) ?? presetRecipient ?? null;

  const handleSend = async () => {
    if (!recipient) return;
    setBusy(true);
    setResult(null);
    try {
      if (kind === "book") {
        if (!book) {
          setResult("先选一本要送的书");
          return;
        }
        const { record } = sendBookGift({ book, recipient, message });
        const persona = resolveNpcPersona(recipient.id, loadForum()) || characterPersona(recipient.id);
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const reply = await generateGiftReply({
          persona,
          giftText: `送了你《${record.bookTitle}》（只送书目与入口，不传正文文件）`,
          message: record.message,
          signal: controller.signal,
        });
        if (reply) attachReply("book", record.id, { text: reply, at: new Date().toISOString() });
        setResult(reply ? `${recipient.name}：${reply}` : `《${record.bookTitle}》已送出（对方暂时没有回应）`);
      } else {
        const { record } = sendGift({ giftId, count, recipient, message, book, postId });
        const persona = resolveNpcPersona(recipient.id, loadForum()) || characterPersona(recipient.id);
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const reply = await generateGiftReply({
          persona,
          giftText: giftActionText(record),
          message: record.message,
          signal: controller.signal,
        });
        if (reply) attachReply("gift", record.id, { text: reply, at: new Date().toISOString() });
        setResult(reply ? `${recipient.name}：${reply}` : `已送出 ${record.count} 个「${giftDef(record.giftId).name}」（对方暂时没有回应）`);
        onSent?.(record, reply);
      }
      setMessage("");
    } catch {
      setResult("没能送出，请稍后再试（记录不会重复生成）");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sr-gift-head">
          <span className="sr-sheet-label" style={{ margin: 0 }}>
            {kind === "book" ? "送这本书" : "送一份心意"}
            <HelpTip id="gift" label="送礼说明">
              礼物是本机记录的虚拟心意：不涉及充值、支付或余额。送出后会存一条记录（谁送的、送给谁、数量与时间），
              对方可以按人设回一句；重复点击不会重复送出。
            </HelpTip>
            {book ? ` · 《${book.title}》` : ""}
          </span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        {mode === "both" && (
          <div className="sr-chip-row" style={{ marginBottom: 8 }}>
            <button type="button" className="sr-chip" data-active={kind === "gift" ? "true" : undefined} onClick={() => setKind("gift")}>
              送礼物
            </button>
            <button type="button" className="sr-chip" data-active={kind === "book" ? "true" : undefined} onClick={() => setKind("book")}>
              送书
            </button>
          </div>
        )}

        {recipients.length === 0 ? (
          <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>
            还没有可以送的对象：先去「书友圈 → 书友管理」生成几位书友，或在宿主里创建角色。
          </p>
        ) : (
          <>
            <div className="sr-appear-row">
              <span className="sr-appear-label">送给</span>
              <select
                className="sr-appear-select"
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                aria-label="选择接收人"
              >
                {recipients.map((item) => (
                  <option key={`${item.kind}_${item.id}`} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            {kind === "gift" ? (
              <>
                <div className="sr-gift-grid">
                  {GIFT_DEFS.map((gift) => (
                    <button
                      key={gift.id}
                      type="button"
                      className="sr-gift-item"
                      data-active={giftId === gift.id ? "true" : undefined}
                      onClick={() => setGiftId(gift.id)}
                      title={gift.desc}
                      aria-pressed={giftId === gift.id}
                    >
                      <GiftIcon id={gift.id} />
                      <span className="sr-gift-name">{gift.name}</span>
                      <span className="sr-gift-desc">{gift.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="sr-appear-row">
                  <span className="sr-appear-label">数量</span>
                  <button type="button" className="sr-btn sr-btn-sm" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="减少数量">
                    <Minus size={13} strokeWidth={2} />
                  </button>
                  <span className="sr-appear-value" style={{ minWidth: 28 }}>{count}</span>
                  <button type="button" className="sr-btn sr-btn-sm" onClick={() => setCount((c) => Math.min(99, c + 1))} aria-label="增加数量">
                    <Plus size={13} strokeWidth={2} />
                  </button>
                </div>
              </>
            ) : (
              <HelpFoot id="gift-book-about" label="关于送书">
                送书只送出书目、入口与留言，不会传送正文文件；对方能不能读到取决于 TA 自己的权限。
              </HelpFoot>
            )}

            <textarea
              className="sr-css-editor"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="留一句（可留空）"
              aria-label="留言"
            />

            {result && (
              <div className="sr-note-card sr-gift-result">
                <div className="sr-note-meta" style={{ lineHeight: 1.7 }}>{result}</div>
              </div>
            )}

            <div className="sr-sheet-actions">
              <button type="button" className="sr-btn" onClick={onClose}>
                关闭
              </button>
              <button type="button" className="sr-btn sr-btn-primary" onClick={() => void handleSend()} disabled={busy || !recipient}>
                {busy ? <Loader2 size={15} className="sr-spin" /> : <Send size={15} strokeWidth={1.8} />}
                送出
              </button>
            </div>
            <p className="sr-note-meta" style={{ marginTop: 6, textAlign: "center" }}>
              虚拟礼物，不涉及真实支付与余额；重复点击不会重复送出。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function characterPersona(id: string): string {
  const character = loadCharacters().find((item) => item.id === id);
  if (!character) return "";
  return [`你是${character.name}。`, character.persona?.slice(0, 300) ?? "", character.personality ? `性格：${character.personality}。` : ""]
    .filter(Boolean)
    .join("\n");
}
