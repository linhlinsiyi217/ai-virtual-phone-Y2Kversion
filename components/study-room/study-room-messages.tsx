"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Plus, Send } from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import {
  loadChatSessions,
  loadChatMessages,
  pushChatMessage,
  clearChatSessionMessages,
  type ChatMessage,
  type ChatSession,
} from "@/lib/chat-storage";
import { generateReadingChat, parseReadingDiscussResponse } from "@/lib/reading-engine";
import { loadCoreadRefs, type CoreadRef } from "@/lib/study-room-coread";
import { loadBooks } from "@/lib/reading-storage";
import type { Book } from "@/lib/reading-types";
import type { Character } from "@/lib/character-types";

type StudyRoomMessagesProps = {
  onBack: () => void;
};

type Row = {
  msg: ChatMessage;
  dayKey: string;
  groupStart: boolean;
  groupEnd: boolean;
};

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabel(key: string): string {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if (key === todayKey) return "今天";
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

const GROUP_GAP_MS = 5 * 60 * 1000;

function closeInTime(earlier: string | number | undefined, later: string | number | undefined): boolean {
  const t1 = earlier === undefined ? NaN : new Date(earlier).getTime();
  const t2 = later === undefined ? NaN : new Date(later).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return true;
  return Math.abs(t2 - t1) <= GROUP_GAP_MS;
}

export function StudyRoomMessages({ onBack }: StudyRoomMessagesProps) {
  const [refs, setRefs] = useState<CoreadRef[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [books, setBooks] = useState<Record<string, Book>>({});
  const [openRef, setOpenRef] = useState<CoreadRef | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showPlus, setShowPlus] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRefs(loadCoreadRefs());
    setSessions(loadChatSessions());
    setCharacters(loadCharacters());
    const map: Record<string, Book> = {};
    for (const book of loadBooks()) map[book.id] = book;
    setBooks(map);
  }, []);

  const activeSession = useMemo(
    () => (openRef ? sessions.find((s) => s.id === openRef.sessionId) ?? null : null),
    [openRef, sessions],
  );
  const activeCharacter = useMemo(
    () => (openRef ? characters.find((c) => c.id === openRef.characterId) ?? null : null),
    [openRef, characters],
  );
  const activeBook = useMemo(
    () => (openRef ? books[openRef.bookId] ?? null : null),
    [openRef, books],
  );

  const refreshMessages = useCallback((sessionId: string) => {
    setMessages(loadChatMessages(sessionId));
  }, []);

  useEffect(() => {
    if (activeSession) {
      refreshMessages(activeSession.id);
      setError(null);
    }
  }, [activeSession, refreshMessages]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages, sending]);

  const visible = useMemo(() => messages.filter((m) => m.content && m.role !== "system"), [messages]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = 0; i < visible.length; i += 1) {
      const msg = visible[i];
      const prev = visible[i - 1];
      const next = visible[i + 1];
      const dayKey = dayKeyOf(msg.createdAt);
      // 同一个人、同一天、前后相隔不超过 5 分钟才算一组（隔得久的另起一组，重新带尾巴）
      const sameAsPrev = !!prev && prev.role === msg.role && dayKeyOf(prev.createdAt) === dayKey && closeInTime(prev.createdAt, msg.createdAt);
      const sameAsNext = !!next && next.role === msg.role && dayKeyOf(next.createdAt) === dayKey && closeInTime(msg.createdAt, next.createdAt);
      out.push({ msg, dayKey, groupStart: !sameAsPrev, groupEnd: !sameAsNext });
    }
    return out;
  }, [visible]);

  const runReply = async (session: ChatSession, characterId: string, book: Book | null) => {
    if (!book) {
      setError("这本书已不在书架，无法继续共读。");
      return;
    }
    const raw = await generateReadingChat(
      session,
      book,
      { chapterTitle: "", chapterContent: "", annotations: [] },
      characterId,
    );
    if (raw == null) throw new Error("no-response");
    const { reply } = parseReadingDiscussResponse(raw);
    if (reply) {
      pushChatMessage({ sessionId: session.id, role: "assistant", content: reply, origin: "reading_discuss" });
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeSession || !openRef || sending) return;
    setInput("");
    setError(null);
    pushChatMessage({ sessionId: activeSession.id, role: "user", content: text, origin: "reading_discuss" });
    refreshMessages(activeSession.id);
    setSending(true);
    try {
      await runReply(activeSession, openRef.characterId, activeBook);
      refreshMessages(activeSession.id);
    } catch {
      setError("发送失败，请检查 API 配置后重试。");
    } finally {
      setSending(false);
    }
  };

  const handleRetry = async () => {
    if (!activeSession || !openRef || sending) return;
    setError(null);
    setSending(true);
    try {
      await runReply(activeSession, openRef.characterId, activeBook);
      refreshMessages(activeSession.id);
    } catch {
      setError("仍然失败，请检查 API 配置。");
    } finally {
      setSending(false);
    }
  };

  const handleClear = () => {
    if (!activeSession) return;
    if (!confirm("清空这段共读对话？只影响这本书与这个角色的共读记录。")) return;
    clearChatSessionMessages(activeSession.id);
    refreshMessages(activeSession.id);
    setShowPlus(false);
  };

  // ── 会话详情 ──
  if (openRef && activeSession) {
    return (
      <section className="sr-msg-app">
        <header className="sr-msg-header">
          <button type="button" className="sr-msg-back" onClick={() => setOpenRef(null)}>
            <ChevronLeft size={26} strokeWidth={2} />
          </button>
          <div className="sr-msg-head-center">
            <span
              className="sr-msg-head-avatar"
              style={
                activeCharacter?.avatar
                  ? { backgroundImage: `url("${activeCharacter.avatar}")` }
                  : undefined
              }
            >
              {activeCharacter?.avatar ? "" : (activeCharacter?.name ?? "?").slice(0, 1)}
            </span>
            <span className="sr-msg-head-name">{activeCharacter?.name ?? "未知角色"}</span>
          </div>
          <button type="button" className="sr-msg-info" onClick={() => setShowInfo(true)} aria-label="详情">
            <Info size={22} strokeWidth={1.6} />
          </button>
        </header>

        <div ref={bodyRef} className="sr-msg-body">
          {rows.length === 0 ? (
            <div className="sr-msg-empty">
              和「{activeCharacter?.name}」聊聊《{activeBook?.title ?? "这本书"}》。
              <br />
              共读只会看到你已读过的部分。
            </div>
          ) : (
            rows.map(({ msg, dayKey, groupStart, groupEnd }, index) => {
              const showDate = index === 0 || rows[index - 1].dayKey !== dayKey;
              const mine = msg.role === "user";
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="sr-msg-date">
                      <b>{dayLabel(dayKey)}</b>
                    </div>
                  )}
                  <div className="sr-msg-row" data-mine={mine ? "true" : "false"} data-group-start={groupStart ? "true" : undefined} data-group-end={groupEnd ? "true" : undefined}>
                    <div className="sr-msg-bubble">{msg.content}</div>
                  </div>
                </div>
              );
            })
          )}
          {sending && <div className="sr-msg-date">正在生成…</div>}
          {error && (
            <div className="sr-msg-status" data-failed="true" style={{ alignSelf: "center" }}>
              {error}
              <button type="button" onClick={handleRetry}>重试</button>
            </div>
          )}
        </div>

        <div className="sr-msg-inputbar">
          <button type="button" className="sr-msg-plus" onClick={() => setShowPlus((v) => !v)} aria-label="更多">
            <Plus size={20} strokeWidth={2} />
          </button>
          <div className="sr-msg-field">
            <textarea
              value={input}
              rows={1}
              placeholder="共读消息"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <button type="button" className="sr-msg-send" onClick={handleSend} disabled={!input.trim() || sending} aria-label="发送">
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {showPlus && (
          <div className="sr-sheet-mask" onClick={() => setShowPlus(false)}>
            <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="sr-btn" style={{ width: "100%" }} onClick={handleClear}>
                清空这段共读记录
              </button>
              <p className="sr-note-meta" style={{ marginTop: 12, textAlign: "center" }}>
                语音、图片等尚未接入，这里只提供实际可用的操作。
              </p>
            </div>
          </div>
        )}

        {showInfo && (
          <div className="sr-sheet-mask" onClick={() => setShowInfo(false)}>
            <div className="sr-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sr-note-card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{activeCharacter?.name ?? "未知角色"}</div>
                <div className="sr-note-meta" style={{ marginTop: 6 }}>
                  共读书籍：{activeBook?.title ?? "已不在书架"}
                </div>
                <div className="sr-note-meta" style={{ marginTop: 4 }}>
                  共读记录按「书 + 角色」隔离，不会串到其他书或其他角色的记忆。
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ── 会话列表 ──
  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">共读记录</div>
            <span className="sr-header-sub">按书与角色分开</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane" style={{ paddingTop: 6 }}>
          {refs.length === 0 ? (
            <div className="sr-empty">
              <p>
                还没有共读记录。
                <br />
                在阅读页打开「共读」和角色聊过后，会出现在这里。
              </p>
            </div>
          ) : (
            refs.map((ref) => {
              const session = sessions.find((s) => s.id === ref.sessionId);
              const character = characters.find((c) => c.id === ref.characterId);
              const book = books[ref.bookId];
              return (
                <button key={ref.sessionId} type="button" className="sr-msg-list-item" onClick={() => setOpenRef(ref)}>
                  <span
                    className="sr-msg-list-avatar"
                    style={character?.avatar ? { backgroundImage: `url("${character.avatar}")` } : undefined}
                  >
                    {character?.avatar ? "" : (character?.name ?? "?").slice(0, 1)}
                  </span>
                  <span className="sr-msg-list-main">
                    <span className="sr-msg-list-name">
                      <span>{character?.name ?? "未知角色"}</span>
                      {session?.updatedAt && (
                        <span className="sr-msg-list-time">
                          {new Date(session.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                        </span>
                      )}
                    </span>
                    <span className="sr-msg-list-preview">
                      {session?.lastMessagePreview || book?.title || "尚无消息"}
                    </span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.6} color="#c7c7cc" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
