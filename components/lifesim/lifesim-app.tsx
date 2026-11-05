"use client";

// 生活模拟（G11）：Miya 故事与生活模拟的落地 App。
// 五个页签：小记（AI 生活叙事）/ 天气 / 行程 / 便利店 / 速配。
// 事件统一写进关联角色的聊天会话（系统消息），钱包走统一钱包。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Character } from "@/lib/character-types";
import { loadCharacters } from "@/lib/character-storage";
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";
import { formatWalletAmount, getWalletBalance, loadWalletState, payWithWalletBalance } from "@/lib/wallet-storage";
import { simpleLLMCall } from "@/lib/api-helpers";
import { resolveForumApiConfig } from "@/lib/study-room/forum";
import {
  SPEED_DATE_QUESTIONS,
  STORE_PRODUCTS,
  addNarrativeEntry,
  addPurchase,
  ensureTodaySchedule,
  getLinkedCharacterId,
  getWeatherForecast,
  getWeatherToday,
  loadNarrative,
  loadPurchases,
  loadSpeedDate,
  recordSpeedDateAnswer,
  setLinkedCharacterId,
  toggleScheduleItem,
  type LifesimNarrativeEntry,
  type LifesimProduct,
  type LifesimPurchase,
  type LifesimSchedule,
  type LifesimSpeedDateOption,
  type LifesimSpeedDateQuestion,
  type LifesimSpeedDateRecord,
  type LifesimSpeedDateState,
} from "@/lib/lifesim-storage";

type Tab = "narrative" | "weather" | "schedule" | "store" | "speeddate";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "narrative", label: "小记" },
  { id: "weather", label: "天气" },
  { id: "schedule", label: "行程" },
  { id: "store", label: "便利店" },
  { id: "speeddate", label: "速配" },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

// 本地模板小记：没配 API / 模型失败时的诚实降级（不假装 AI 成功）
function buildLocalNarrative(
  weatherText: string,
  schedule: LifesimSchedule,
  purchases: LifesimPurchase[],
  charName: string,
): string {
  const done = schedule.items.filter(i => i.done);
  const main = done[0] ?? schedule.items[0];
  const bought = purchases[0];
  return [
    `今天${weatherText}。`,
    main ? `${main.time} 那趟「${main.title}」${done[0] ? "办完了" : "还排在单子上"}，` : "这一天没排什么正事，",
    bought ? `顺路在便利店捎了${bought.item}。` : "",
    `傍晚和${charName}闲聊了几句，把这一天折好收进了口袋。`,
  ].join("");
}

export default function LifesimApp({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("narrative");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const characters = useMemo(() => loadCharacters(), []);
  const [linkedId, setLinkedId] = useState<string | null>(() => getLinkedCharacterId());
  const linkedCharacter = useMemo(() => characters.find(c => c.id === linkedId) ?? null, [characters, linkedId]);

  const weatherToday = useMemo(() => getWeatherToday(), []);
  const weatherForecast = useMemo(() => getWeatherForecast(3), []);

  const [schedule, setSchedule] = useState<LifesimSchedule>(() => ensureTodaySchedule());

  const [narrative, setNarrative] = useState<LifesimNarrativeEntry[]>(() => loadNarrative());
  const [writing, setWriting] = useState(false);

  const [purchases, setPurchases] = useState<LifesimPurchase[]>(() => loadPurchases());
  const [walletBalance, setWalletBalance] = useState(() => getWalletBalance(loadWalletState()));

  const [speedDate, setSpeedDate] = useState<LifesimSpeedDateState>(() => loadSpeedDate());
  const [candidates, setCandidates] = useState<Character[]>([]);
  const [picked, setPicked] = useState<Character | null>(null);
  const [question, setQuestion] = useState<LifesimSpeedDateQuestion | null>(null);
  const [lastAnswer, setLastAnswer] = useState<{ record: LifesimSpeedDateRecord; favor: number } | null>(null);

  // 把事件写进角色会话（系统消息）。失败不阻塞主流程，但如实提示。
  const pushSystem = useCallback((characterId: string, text: string): boolean => {
    try {
      const session = createOrGetSession(characterId);
      pushChatMessage({ sessionId: session.id, role: "system", content: text });
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── 小记 ──
  const writeNarrative = useCallback(async () => {
    if (writing) return;
    if (characters.length === 0) {
      showToast("还没有角色：去「角色」App 建一个，再回来写小记");
      return;
    }
    if (!linkedCharacter) {
      showToast("先在上方选一位关联角色");
      return;
    }
    setWriting(true);
    try {
      const doneCount = schedule.items.filter(i => i.done).length;
      const recentNames = characters.filter(c => speedDate.favors[c.id] !== undefined)
        .map(c => `${c.name}（好感 ${speedDate.favors[c.id]}）`)
        .slice(0, 4);
      const context = [
        `天气：${weatherToday.kind}，${weatherToday.tempLow}~${weatherToday.tempHigh}℃（${weatherToday.note}）`,
        `今日行程（${doneCount}/${schedule.items.length} 完成）：${schedule.items.map(i => `${i.time} ${i.title}${i.done ? "（已完成）" : ""}`).join("、") || "无"}`,
        `最近在便利店买了：${purchases.slice(0, 5).map(p => `${p.item}×${p.qty}`).join("、") || "还没有"}`,
        `最近的速配对象：${recentNames.join("、") || "还没有"}`,
      ].join("\n");

      let text = "";
      let source: LifesimNarrativeEntry["source"] = "local";
      const apiConfig = resolveForumApiConfig();
      if (apiConfig) {
        const result = await simpleLLMCall(apiConfig, [{
          role: "user",
          content: `你是生活记录助手。根据下面的素材写一段 90~140 字的中文生活小记：主角是「我」和「${linkedCharacter.name}」的日常片段，语气温暖自然，有具体细节。不要标题，不要 markdown，直接输出正文。\n\n素材：\n${context}`,
        }], { temperature: 0.9, max_tokens: 420, label: "lifesim-narrative" });
        if (result.content && result.content.trim() && !result.error) {
          text = result.content.trim();
          source = "ai";
        } else {
          showToast(`模型没接上（${result.error || "空响应"}），这篇用本地模板写了`);
        }
      } else {
        showToast("还没配置模型 API（设置 → API 绑定），这篇用本地模板写了");
      }
      if (!text) {
        text = buildLocalNarrative(
          `${weatherToday.note}，${weatherToday.tempLow}~${weatherToday.tempHigh}℃`,
          schedule,
          purchases,
          linkedCharacter.name,
        );
      }
      setNarrative(addNarrativeEntry(text, source));
      const pushed = pushSystem(linkedCharacter.id, `【生活小记】${text}`);
      if (!pushed) showToast("小记已保存，但没能写进会话（聊天数据未就绪）");
      else if (source === "ai") showToast("已写好今天的生活小记，并同步进了会话");
    } finally {
      setWriting(false);
    }
  }, [writing, characters, linkedCharacter, schedule, purchases, speedDate.favors, weatherToday, pushSystem, showToast]);

  // ── 便利店 ──
  const buyProduct = useCallback((p: LifesimProduct) => {
    const result = payWithWalletBalance({
      amount: p.price,
      title: "便利店购物",
      detail: `生活模拟·便利店：${p.name}`,
      category: "便利店",
    });
    if (!result.ok) {
      showToast(result.error || "支付失败，稍后再试");
      return;
    }
    setPurchases(addPurchase(p.name, 1, p.price));
    setWalletBalance(getWalletBalance(result.state));
    showToast(`已买下「${p.name}」，花了 ${formatWalletAmount(p.price)}`);
  }, [showToast]);

  // ── 速配 ──
  const drawCandidates = useCallback(() => {
    const pool = [...characters];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setCandidates(pool.slice(0, Math.min(3, pool.length)));
    setPicked(null);
    setQuestion(null);
    setLastAnswer(null);
  }, [characters]);

  useEffect(() => {
    if (tab === "speeddate" && candidates.length === 0 && characters.length > 0) drawCandidates();
  }, [tab, candidates.length, characters.length, drawCandidates]);

  const startSpeedDate = useCallback((c: Character) => {
    setPicked(c);
    setQuestion(SPEED_DATE_QUESTIONS[Math.floor(Math.random() * SPEED_DATE_QUESTIONS.length)]);
    setLastAnswer(null);
  }, []);

  const answerSpeedDate = useCallback((option: LifesimSpeedDateOption) => {
    if (!picked || !question) return;
    const record: LifesimSpeedDateRecord = {
      ts: new Date().toISOString(),
      characterId: picked.id,
      characterName: picked.name,
      question: question.q,
      choice: option.text,
      tone: option.tone,
      delta: option.delta,
    };
    const next = recordSpeedDateAnswer(record);
    setSpeedDate(next);
    setLastAnswer({ record, favor: next.favors[picked.id] ?? 0 });
    const pushed = pushSystem(picked.id, `【速配】速配问答——"${question.q}" 我选了「${option.text}」（${option.tone}）。`);
    if (!pushed) showToast("答案已记录，但没能写进会话（聊天数据未就绪）");
    showToast(`已记录：${picked.name} 好感 ${option.delta >= 0 ? "+" : ""}${option.delta}`);
  }, [picked, question, pushSystem, showToast]);

  const favorList = useMemo(() => {
    return Object.entries(speedDate.favors)
      .map(([id, favor]) => ({ character: characters.find(c => c.id === id), favor }))
      .filter((x): x is { character: Character; favor: number } => Boolean(x.character))
      .sort((a, b) => b.favor - a.favor)
      .slice(0, 5);
  }, [speedDate.favors, characters]);

  const scheduleDone = schedule.items.filter(i => i.done).length;

  return (
    <div className="ls-app">
      <header className="ls-head">
        <button className="ls-back" onClick={onClose} aria-label="返回">‹</button>
        <span className="ls-title">生活模拟</span>
        <span className="ls-head-sub">
          {linkedCharacter ? `与 ${linkedCharacter.name}` : characters.length > 0 ? "未关联角色" : "暂无角色"}
        </span>
      </header>

      <div className="ls-body">
        {tab === "narrative" && (
          <div className="ls-pane">
            <div className="ls-card ls-link-card">
              <div className="ls-card-title">关联角色</div>
              {characters.length === 0 ? (
                <div className="ls-hint">还没有角色：去「角色」App 建一个，小记和速配的事件才有去处。</div>
              ) : (
                <div className="ls-chips">
                  {characters.slice(0, 12).map(c => (
                    <button
                      key={c.id}
                      className={`ls-chip ${linkedId === c.id ? "ls-chip-on" : ""}`}
                      onClick={() => {
                        setLinkedCharacterId(c.id);
                        setLinkedId(c.id);
                      }}
                    >
                      {c.avatar ? <img src={c.avatar} alt="" /> : <span className="ls-chip-fallback">{c.name.slice(0, 1)}</span>}
                      <i>{c.name}</i>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="ls-btn ls-btn-primary" onClick={writeNarrative} disabled={writing}>
              {writing ? "正在写…" : "写今天的生活小记"}
            </button>

            {narrative.length === 0 ? (
              <div className="ls-card">
                <div className="ls-hint">
                  还没有写过小记。小记会把今天的天气、行程、便利店和速配串成一段日常，
                  写好后同步进关联角色的会话，让 TA 知道你今天过了怎样的一天。
                </div>
              </div>
            ) : (
              <div className="ls-narratives">
                {narrative.map((entry, idx) => (
                  <div className="ls-card ls-narrative" key={`${entry.ts}-${idx}`}>
                    <div className="ls-narrative-meta">
                      <span>{fmtTime(entry.ts)}</span>
                      <span className={`ls-badge ${entry.source === "ai" ? "ls-badge-ai" : "ls-badge-local"}`}>
                        {entry.source === "ai" ? "AI" : "本地模板"}
                      </span>
                    </div>
                    <p>{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "weather" && (
          <div className="ls-pane">
            <div className="ls-card ls-weather-today">
              <div className="ls-weather-glyph">{weatherToday.glyph}</div>
              <div className="ls-weather-main">
                <div className="ls-weather-kind">今天 · {weatherToday.kind}</div>
                <div className="ls-weather-temp">{weatherToday.tempLow}~{weatherToday.tempHigh}℃</div>
                <div className="ls-weather-note">{weatherToday.note}</div>
              </div>
            </div>
            <div className="ls-forecast">
              {weatherForecast.map(w => (
                <div className="ls-card ls-forecast-item" key={w.dateKey}>
                  <div className="ls-forecast-date">{w.dateKey.slice(5)}</div>
                  <div className="ls-forecast-glyph">{w.glyph}</div>
                  <div className="ls-forecast-kind">{w.kind}</div>
                  <div className="ls-forecast-temp">{w.tempLow}~{w.tempHigh}℃</div>
                </div>
              ))}
            </div>
            <div className="ls-hint ls-hint-block">本地模拟天气：每天固定一版，跨天自动换新，给小记和行程当氛围背景。</div>
          </div>
        )}

        {tab === "schedule" && (
          <div className="ls-pane">
            <div className="ls-card ls-sched-summary">
              <span>{schedule.dateKey} 的行程</span>
              <b>{scheduleDone}/{schedule.items.length} 完成</b>
            </div>
            <div className="ls-sched-list">
              {schedule.items.map(item => (
                <button
                  key={item.id}
                  className={`ls-sched-item ${item.done ? "ls-sched-done" : ""}`}
                  onClick={() => setSchedule(toggleScheduleItem(schedule, item.id))}
                >
                  <span className="ls-sched-check">{item.done ? "✓" : ""}</span>
                  <span className="ls-sched-time">{item.time}</span>
                  <span className="ls-sched-title">{item.title}</span>
                </button>
              ))}
            </div>
            <div className="ls-hint ls-hint-block">行程每天一换，点一条就能勾掉；完成的进度会被写小记时记进去。</div>
          </div>
        )}

        {tab === "store" && (
          <div className="ls-pane">
            <div className="ls-card ls-wallet-card">
              <span>钱包余额</span>
              <b>{formatWalletAmount(walletBalance)}</b>
            </div>
            <div className="ls-product-grid">
              {STORE_PRODUCTS.map(p => (
                <div className="ls-card ls-product" key={p.id}>
                  <div className="ls-product-glyph">{p.glyph}</div>
                  <div className="ls-product-name">{p.name}</div>
                  <div className="ls-product-desc">{p.desc}</div>
                  <div className="ls-product-foot">
                    <span className="ls-product-price">{formatWalletAmount(p.price)}</span>
                    <button className="ls-buy" onClick={() => buyProduct(p)}>买</button>
                  </div>
                </div>
              ))}
            </div>
            {purchases.length > 0 && (
              <div className="ls-card">
                <div className="ls-card-title">最近买的</div>
                <div className="ls-purchase-list">
                  {purchases.slice(0, 6).map((p, idx) => (
                    <div className="ls-purchase-row" key={`${p.ts}-${idx}`}>
                      <span>{fmtTime(p.ts)}</span>
                      <span className="ls-purchase-item">{p.item}×{p.qty}</span>
                      <span>{formatWalletAmount(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "speeddate" && (
          <div className="ls-pane">
            {characters.length === 0 ? (
              <div className="ls-card">
                <div className="ls-hint">还没有角色可以速配：去「角色」App 建一个再来。</div>
              </div>
            ) : (
              <>
                {favorList.length > 0 && (
                  <div className="ls-card">
                    <div className="ls-card-title">好感榜</div>
                    <div className="ls-favors">
                      {favorList.map(({ character, favor }) => (
                        <span className="ls-favor" key={character.id}>
                          {character.name} ♥ {favor}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {picked && question ? (
                  <div className="ls-card">
                    <div className="ls-date-head">
                      {picked.avatar ? <img src={picked.avatar} alt="" /> : <span className="ls-chip-fallback">{picked.name.slice(0, 1)}</span>}
                      <b>{picked.name}</b>
                    </div>
                    <div className="ls-question">{question.q}</div>
                    <div className="ls-options">
                      {question.options.map((opt, idx) => (
                        <button
                          key={idx}
                          className={`ls-opt ${lastAnswer?.record.choice === opt.text ? "ls-opt-on" : ""}`}
                          disabled={Boolean(lastAnswer)}
                          onClick={() => answerSpeedDate(opt)}
                        >
                          {opt.text}
                        </button>
                      ))}
                    </div>
                    {lastAnswer && (
                      <div className="ls-answer-note">
                        已记录：「{lastAnswer.record.choice}」（{lastAnswer.record.tone}），好感 {lastAnswer.record.delta >= 0 ? "+" : ""}{lastAnswer.record.delta}
                        ，{lastAnswer.record.characterName} 现在 ♥ {lastAnswer.favor}。
                        <button className="ls-link-btn" onClick={drawCandidates}>下一轮</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="ls-cand-grid">
                    {candidates.map(c => (
                      <button className="ls-card ls-cand" key={c.id} onClick={() => startSpeedDate(c)}>
                        {c.avatar ? <img src={c.avatar} alt="" /> : <span className="ls-chip-fallback ls-cand-fallback">{c.name.slice(0, 1)}</span>}
                        <div className="ls-cand-name">{c.name}</div>
                        <div className="ls-cand-hint">♥ {speedDate.favors[c.id] ?? 0} · 约聊一题</div>
                      </button>
                    ))}
                  </div>
                )}

                {picked && !question && <div className="ls-hint ls-hint-block">正在出题…</div>}
                {speedDate.records.length > 0 && (
                  <div className="ls-card">
                    <div className="ls-card-title">往期速配</div>
                    <div className="ls-purchase-list">
                      {speedDate.records.slice(0, 6).map((r, idx) => (
                        <div className="ls-purchase-row" key={`${r.ts}-${idx}`}>
                          <span>{fmtTime(r.ts)}</span>
                          <span className="ls-purchase-item">{r.characterName}：{r.choice}</span>
                          <span>{r.delta >= 0 ? `+${r.delta}` : r.delta}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <nav className="ls-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ls-tab ${tab === t.id ? "ls-tab-on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {toast && <div className="ls-toast">{toast}</div>}
    </div>
  );
}
