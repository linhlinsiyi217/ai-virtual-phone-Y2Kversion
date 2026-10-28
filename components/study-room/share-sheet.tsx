"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, Send, X } from "lucide-react";

import {
  loadShareContacts,
  sendStudyRoomShare,
  type ShareContact,
  type StudyRoomShareItem,
} from "@/lib/study-room/share-to-chat";

type ShareSheetProps = {
  item: StudyRoomShareItem;
  onClose: () => void;
};

/**
 * 「分享给」半屏面板：联系人来自小手机现有的聊天联系人。
 * 选人后先看卡片预览，点「发送」才真正写进聊天；关闭或取消都不发送。
 */
export function ShareSheet({ item, onClose }: ShareSheetProps) {
  const [contacts, setContacts] = useState<ShareContact[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ name: string; sessionId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 剧透帖：默认只发安全摘要，用户勾选后才把正文一起分享给角色
  const [includeSpoiler, setIncludeSpoiler] = useState(false);
  // 防重复：一次面板只发一次
  const sentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadShareContacts()
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const list = contacts ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((contact) => contact.name.toLowerCase().includes(q));
  }, [contacts, query]);

  const target = contacts?.find((contact) => contact.characterId === selected) ?? null;

  const handleSend = async () => {
    if (!target || sending || sentRef.current) return;
    // 先占位，避免连点在异步读取期间发出两张卡片
    sentRef.current = true;
    setSending(true);
    setError(null);
    try {
      const sessionId = await sendStudyRoomShare(target.characterId, item, { includeSpoiler: item.spoiler ? includeSpoiler : false });
      setSent({ name: target.name, sessionId });
    } catch {
      sentRef.current = false;
      setError("没有发出去，可以再点一次发送重试。");
    } finally {
      setSending(false);
    }
  };

  const openChat = () => {
    if (!sent) return;
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: sent.sessionId } }));
    onClose();
  };

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div
        className="sr-sheet sr-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="分享给"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sr-share-head">
          <span className="sr-share-title">分享给</span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        {sent ? (
          <div className="sr-share-done">
            <span className="sr-share-done-icon" aria-hidden>
              <Check size={20} strokeWidth={2} />
            </span>
            <p className="sr-share-done-text">已发送给 {sent.name}</p>
            <div className="sr-sheet-actions">
              <button type="button" className="sr-btn" onClick={onClose}>
                完成
              </button>
              <button type="button" className="sr-btn sr-btn-primary" onClick={openChat}>
                去聊天
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="sr-share-search">
              <Search size={15} strokeWidth={1.8} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索联系人"
                aria-label="搜索联系人"
              />
            </label>

            <div className="sr-share-list" role="listbox" aria-label="联系人">
              {contacts === null ? (
                <div className="sr-share-empty">
                  <Loader2 size={18} className="sr-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="sr-share-empty">
                  <p>聊天里还没有联系人</p>
                  <p className="sr-share-empty-sub">先在「聊天」里添加角色好友，再回来分享。</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="sr-share-empty">
                  <p>没有找到「{query.trim()}」</p>
                </div>
              ) : (
                filtered.map((contact) => (
                  <button
                    key={contact.characterId}
                    type="button"
                    role="option"
                    aria-selected={selected === contact.characterId}
                    className="sr-share-contact"
                    data-active={selected === contact.characterId ? "true" : undefined}
                    onClick={() => setSelected((prev) => (prev === contact.characterId ? null : contact.characterId))}
                  >
                    <span className="sr-share-avatar">
                      <img src={contact.avatar || "/images/default-moment-avatar.png"} alt="" draggable={false} />
                    </span>
                    <span className="sr-share-name">{contact.name}</span>
                    <span className="sr-share-check" aria-hidden>
                      {selected === contact.characterId ? <Check size={14} strokeWidth={2.4} /> : null}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="sr-share-foot">
              {target && (
                <div className="sr-share-preview" aria-label="分享预览">
                  {item.image ? <img className="sr-share-preview-img" src={item.image} alt="" /> : null}
                  <div className="sr-share-preview-text">
                    <span className="sr-share-preview-label">书房 · {item.label}</span>
                    <span className="sr-share-preview-title">{item.title}</span>
                    <span className="sr-share-preview-summary">{item.summary}</span>
                  </div>
                </div>
              )}
              {target && item.spoiler && (
                <label className="sr-share-spoiler">
                  <input
                    type="checkbox"
                    checked={includeSpoiler}
                    onChange={(event) => setIncludeSpoiler(event.target.checked)}
                  />
                  <span>
                    附上剧透正文
                    <span className="sr-share-spoiler-sub">
                      {includeSpoiler ? "对方能读到被遮住的正文" : "不勾选时，对方只知道这是含剧透的帖子"}
                    </span>
                  </span>
                </label>
              )}
              {error && <p className="sr-share-error">{error}</p>}
              <button
                type="button"
                className="sr-btn sr-btn-primary sr-share-send"
                onClick={handleSend}
                disabled={!target || sending}
              >
                {sending ? <Loader2 size={15} className="sr-spin" /> : <Send size={15} strokeWidth={1.8} />}
                {target ? `发送给 ${target.name}` : "选择联系人"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
