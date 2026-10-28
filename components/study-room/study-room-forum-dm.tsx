"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Send } from "lucide-react";

import { simpleLLMCall } from "@/lib/api-helpers";
import { avatarDataUrl } from "@/lib/study-room/npc-avatar";
import { resolveForumApiConfig, type ForumNpc, type ForumState } from "@/lib/study-room/forum";
import {
  buildDmMessages,
  cleanDmReply,
  DM_CONTEXT_LIMIT,
  loadDm,
  makeMessageId,
  markThreadRead,
  npcProfileText,
  saveDm,
  setThreadDraft,
  threadIdFor,
  threadMessages,
  totalUnread,
  type DmMessage,
  type DmState,
} from "@/lib/study-room/dm";
import { useMeCard } from "./forum-reply-engine";

type StudyRoomForumDmProps = {
  state: ForumState;
  /** 打开时直接进这位书友的会话；不给就先看会话列表 */
  initialNpcId?: string;
  /** 从详情返回列表时调用，返回 false 表示不处理（如初次进入就是详情） */
  onBack: () => void;
  onNotice: (message: string, ms?: number) => void;
};

/** 把真实错误翻译成一句能看懂的话，不笼统写「发送失败」。 */
function shortError(message: string): string {
  const text = message.trim();
  if (/余额|欠费|quota|insufficient/i.test(text)) return "模型账户余额不足，充值后再试";
  if (/401|403|鉴权|unauthorized|invalid.*key|api.?key/i.test(text)) return "API 密钥无效或没有权限";
  if (/429|too many|rate.?limit/i.test(text)) return "请求太频繁，稍等一会儿再试";
  if (/timeout|超时|ETIMEDOUT/i.test(text)) return "等太久没有回应，可以重试";
  if (/Failed to fetch|NetworkError|网络/i.test(text)) return "网络不通，检查一下连接再试";
  return text.slice(0, 60) || "发送失败";
}

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabel(key: string): string {
  const today = new Date();
  if (key === `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`) return "今天";
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * 书房私信：书友圈侧栏的「私信」进到这里，全程在书房内，不会跳到宿主的聊天应用。
 * 会话 ID、消息和上下文都属于书房（lib/study-room/dm.ts），只复用公共 API 配置和书友身份。
 */
export function StudyRoomForumDm({ state, initialNpcId, onBack, onNotice }: StudyRoomForumDmProps) {
  const [dm, setDm] = useState<DmState>(() => loadDm());
  const [openNpcId, setOpenNpcId] = useState<string | null>(initialNpcId ?? null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const me = useMeCard();

  const refresh = useCallback(() => setDm(loadDm()), []);

  // 书友可能被删掉/屏蔽，列表按现有书友过滤，避免出现点不开的会话
  const known = useMemo(() => {
    const map: Record<string, ForumNpc> = {};
    for (const npc of state.npcs) map[npc.id] = npc;
    return map;
  }, [state.npcs]);

  const threads = useMemo(
    () =>
      dm.threads
        .filter((thread) => known[thread.npcId])
        .slice()
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [dm.threads, known],
  );

  const activeNpc = openNpcId ? known[openNpcId] ?? null : null;
  const activeThread = useMemo(
    () => (openNpcId ? dm.threads.find((thread) => thread.id === threadIdFor(openNpcId)) ?? null : null),
    [dm.threads, openNpcId],
  );
  const messages = useMemo(
    () => (activeThread ? threadMessages(dm, activeThread.id) : []),
    [dm, activeThread],
  );

  // 打开详情：清零未读、把之前存的草稿放回输入框
  useEffect(() => {
    if (!activeThread) return;
    setInput(activeThread.draft ?? "");
    const next = markThreadRead(loadDm(), activeThread.id);
    saveDm(next);
    setDm(next);
    // 只在切换会话时做一次
  }, [activeThread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages.length, sending, openNpcId]);

  // 离开私信：中断进行中的请求，起草内容存回会话
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const persistDraft = (text: string) => {
    if (!openNpcId) return;
    const next = setThreadDraft(loadDm(), threadIdFor(openNpcId), text);
    saveDm(next);
  };

  const runReply = async (npc: ForumNpc, history: DmMessage[], text: string) => {
    const config = resolveForumApiConfig();
    if (!config) throw new Error("还没有配置 API：在「设置 → API」里绑定模型后就能收到书友回信");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await simpleLLMCall(
        config,
        buildDmMessages({
          npcName: npc.nickname,
          npcProfile: npcProfileText(npc),
          meName: me.name,
          history: history.filter((message) => !message.failed).slice(-DM_CONTEXT_LIMIT),
          text,
          boundary: state.rules.feedScope,
        }),
        { temperature: 0.9, max_tokens: 500, signal: controller.signal, label: "studyroom-dm" },
      );
      if (result.error) throw new Error(result.error);
      const reply = cleanDmReply(result.content ?? "", npc.nickname);
      if (!reply) throw new Error("模型没有返回内容");
      return reply;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  /** 发送：先把用户这条落库（失败也保留，能重试），再请书友回。 */
  const send = async () => {
    const text = input.trim();
    if (!text || !activeNpc || !activeThread || sending) return;
    setInput("");
    setSending(true);
    const history = threadMessages(loadDm(), activeThread.id).filter((message) => !message.failed);
    let next = loadDm();
    const mine: DmMessage = {
      id: makeMessageId(),
      threadId: activeThread.id,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    next = { ...next, messages: [...next.messages, mine], threads: next.threads.map((t) => (t.id === activeThread.id ? { ...t, draft: "", updatedAt: mine.createdAt } : t)) };
    saveDm(next);
    setDm(next);
    try {
      const reply = await runReply(activeNpc, history, text);
      next = loadDm();
      const npcMessage: DmMessage = {
        id: makeMessageId(),
        threadId: activeThread.id,
        role: "npc",
        content: reply,
        createdAt: new Date().toISOString(),
      };
      next = { ...next, messages: [...next.messages, npcMessage], threads: next.threads.map((t) => (t.id === activeThread.id ? { ...t, updatedAt: npcMessage.createdAt, unread: 0 } : t)) };
      saveDm(next);
      setDm(next);
    } catch (error) {
      const reason = shortError(error instanceof Error ? error.message : String(error));
      onNotice(`书友没有回信：${reason}`, 3600);
      // 用户这条已经在库里；书友没回不算失败，重试按钮在输入框上方
      next = loadDm();
      const failed: DmMessage = {
        id: makeMessageId(),
        threadId: activeThread.id,
        role: "npc",
        content: "",
        createdAt: new Date().toISOString(),
        failed: true,
        error: reason,
      };
      next = { ...next, messages: [...next.messages, failed] };
      saveDm(next);
      setDm(next);
    } finally {
      setSending(false);
    }
  };

  /** 重试失败的那条：复用同一条记录，不重复入库、不重复插入已完成的内容。 */
  const retry = async (failed: DmMessage) => {
    if (!activeNpc || !activeThread || sending) return;
    setSending(true);
    const history = threadMessages(loadDm(), activeThread.id).filter((message) => !message.failed);
    const lastMine = [...history].reverse().find((message) => message.role === "user");
    if (!lastMine) {
      onNotice("这条消息找不到对应的提问，请重新输入", 3000);
      setSending(false);
      return;
    }
    try {
      const reply = await runReply(activeNpc, history, lastMine.content);
      let next = loadDm();
      next = { ...next, messages: next.messages.filter((message) => message.id !== failed.id) };
      const npcMessage: DmMessage = {
        id: makeMessageId(),
        threadId: activeThread.id,
        role: "npc",
        content: reply,
        createdAt: new Date().toISOString(),
      };
      next = { ...next, messages: [...next.messages, npcMessage], threads: next.threads.map((t) => (t.id === activeThread.id ? { ...t, updatedAt: npcMessage.createdAt, unread: 0 } : t)) };
      saveDm(next);
      setDm(next);
      onNotice("收到回信了", 2200);
    } catch (error) {
      const reason = shortError(error instanceof Error ? error.message : String(error));
      onNotice(`还是没有回信：${reason}`, 3600);
      const next = loadDm();
      saveDm({
        ...next,
        messages: next.messages.map((message) => (message.id === failed.id ? { ...message, error: reason } : message)),
      });
      setDm(loadDm());
    } finally {
      setSending(false);
    }
  };

  const backToList = () => {
    persistDraft(input);
    setInput("");
    setOpenNpcId(null);
    refresh();
  };

  // ── 会话详情 ──
  if (activeNpc && activeThread) {
    const visible = messages.filter((message) => !message.failed);
    const failedOne = messages.find((message) => message.failed) ?? null;
    return (
      <section className="sr-msg-app">
        <header className="sr-msg-header">
          <button type="button" className="sr-msg-back" onClick={backToList} aria-label="返回私信列表">
            <ChevronLeft size={26} strokeWidth={2} />
          </button>
          <div className="sr-msg-head-center">
            <span
              className="sr-msg-head-avatar"
              style={
                activeNpc.avatarUrl
                  ? { backgroundImage: `url("${activeNpc.avatarUrl}")` }
                  : { backgroundImage: `url("${avatarDataUrl(activeNpc.avatar)}")` }
              }
            />
            <span className="sr-msg-head-name">{activeNpc.nickname}</span>
          </div>
          <span style={{ width: 40 }} />
        </header>

        <div ref={bodyRef} className="sr-msg-body">
          {visible.length === 0 ? (
            <div className="sr-msg-empty">
              书房里的私信，只有你和「{activeNpc.nickname}」看得到。
              <br />
              这些消息不会出现在小手机的聊天应用里。
            </div>
          ) : (
            visible.map((message, index) => {
              const showDate = index === 0 || dayKeyOf(visible[index - 1].createdAt) !== dayKeyOf(message.createdAt);
              const mine = message.role === "user";
              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="sr-msg-date">
                      <b>{dayLabel(dayKeyOf(message.createdAt))}</b>
                    </div>
                  )}
                  <div className="sr-msg-row" data-mine={mine ? "true" : "false"} data-group-start="true" data-group-end="true">
                    <div className="sr-msg-bubble">{message.content}</div>
                  </div>
                  <div className="sr-msg-status" style={mine ? undefined : { alignSelf: "flex-start" }}>
                    {timeLabel(message.createdAt)}
                  </div>
                </div>
              );
            })
          )}
          {sending && <div className="sr-msg-date">正在等 {activeNpc.nickname} 回信…</div>}
          {failedOne && !sending && (
            <div className="sr-msg-status" data-failed="true" style={{ alignSelf: "center" }}>
              {failedOne.error ?? "没有回信"}
              <button type="button" onClick={() => void retry(failedOne)}>重试</button>
            </div>
          )}
        </div>

        <div className="sr-msg-inputbar">
          <div className="sr-msg-field">
            <textarea
              value={input}
              rows={1}
              placeholder={`给 ${activeNpc.nickname} 发私信`}
              onChange={(event) => setInput(event.target.value)}
              onBlur={() => persistDraft(input)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="sr-msg-send"
              onClick={() => void send()}
              disabled={!input.trim() || sending}
              aria-label="发送"
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
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
            <div className="sr-header-title">私信</div>
            <span className="sr-header-sub">
              {totalUnread(dm) > 0 ? `${totalUnread(dm)} 条未读` : "书房里的私信，不与其他聊天混在一起"}
            </span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane" style={{ paddingTop: 6 }}>
          {threads.length === 0 ? (
            <div className="sr-empty">
              <p>
                还没有私信。
                <br />
                在书友的个人主页点「私信」就能开始聊。
              </p>
            </div>
          ) : (
            threads.map((thread) => {
              const npc = known[thread.npcId];
              const last = messagesOf(dm, thread.id);
              return (
                <button
                  key={thread.id}
                  type="button"
                  className="sr-msg-list-item"
                  onClick={() => setOpenNpcId(thread.npcId)}
                >
                  <span
                    className="sr-msg-list-avatar"
                    style={
                      npc.avatarUrl
                        ? { backgroundImage: `url("${npc.avatarUrl}")` }
                        : { backgroundImage: `url("${avatarDataUrl(npc.avatar)}")` }
                    }
                  />
                  <span className="sr-msg-list-main">
                    <span className="sr-msg-list-name">
                      <span>{npc.nickname}</span>
                      {thread.updatedAt && (
                        <span className="sr-msg-list-time">
                          {new Date(thread.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                        </span>
                      )}
                    </span>
                    <span className="sr-msg-list-preview">
                      {thread.draft?.trim()
                        ? `草稿：${thread.draft.trim()}`
                        : last
                          ? `${last.role === "user" ? "我：" : ""}${last.content || "（没有回信）"}`
                          : "尚无消息"}
                    </span>
                  </span>
                  {thread.unread > 0 && <span className="sr-msg-list-unread">{thread.unread}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

/** 列表预览用：只取最后一条。 */
function messagesOf(dm: DmState, threadId: string): DmMessage | null {
  const list = threadMessages(dm, threadId).filter((message) => !message.failed);
  return list.length > 0 ? list[list.length - 1] : null;
}
