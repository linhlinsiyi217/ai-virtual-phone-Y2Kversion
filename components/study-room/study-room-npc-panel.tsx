"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Dices, Loader2, PenLine, Plus, RefreshCw, Sparkles, Square, Trash2, UserPlus, EyeOff, Check, MessageCircle } from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import { createOrGetSession, loadChatContacts } from "@/lib/chat-storage";
import { avatarDataUrl, AVATAR_CATEGORIES, nextVariant, type AvatarCategory } from "@/lib/study-room/npc-avatar";
import {
  blankNpc,
  findCharacterIdOf,
  generateNpc,
  isNpcFriend,
  makeFriendFromNpc,
  generateNpcWithAi,
  loadForum,
  npcFromCharacter,
  removeNpc,
  muteNpc,
  saveForum,
  unmuteNpc,
  upsertNpc,
  type ForumNpc,
  type ForumState,
} from "@/lib/study-room/forum";
import { HelpFoot } from "./help-tip";

type StudyRoomNpcPanelProps = {
  onBack: () => void;
};

export function StudyRoomNpcPanel({ onBack }: StudyRoomNpcPanelProps) {
  const [state, setState] = useState<ForumState>(() => loadForum());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [personalityHint, setPersonalityHint] = useState("");
  const [pickCharacter, setPickCharacter] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => loadForum().name);
  // 哪些书友已经成为聊天好友（改人设或加好友后重新算）
  const friends = useMemo(() => {
    const map: Record<string, string> = {};
    for (const npc of state.npcs) {
      const characterId = findCharacterIdOf(npc);
      if (characterId && isNpcFriend(npc)) map[npc.id] = characterId;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.npcs]);
  const abortRef = useRef<AbortController | null>(null);
  const characters = useMemo(() => loadCharacters().map((c) => ({ id: c.id, name: c.name })), []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const save = (next: ForumState) => {
    setState(next);
    saveForum(next);
  };

  /** 跳到宿主聊天应用里的这个会话（复用已有的 open-app 事件）。 */
  const openChatWith = (characterId: string) => {
    const contact = loadChatContacts().find((item) => item.characterId === characterId);
    if (!contact) {
      flash("聊天里还没有这位好友，先点「加为好友」", 2600);
      return;
    }
    // 会话按角色 id 归档（与聊天应用一致），不是联系人记录的 id
    const session = createOrGetSession(characterId);
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: session.id } }));
  };

  const flash = (message: string, ms = 2400) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), ms);
  };

  const updateNpc = (npc: ForumNpc, patch: Partial<ForumNpc>) => {
    const next = upsertNpc(state, { ...npc, ...patch, updatedAt: new Date().toISOString() });
    save(next);
  };

  const handleRandom = (seed?: number) => {
    const npc = generateNpc({ domain, personalityHint, seed });
    save(upsertNpc(state, npc));
    setEditingId(npc.id);
    flash(`已生成书友「${npc.nickname}」`);
  };

  const handleAi = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const npc = await generateNpcWithAi({ domain, personalityHint }, controller.signal);
      save(upsertNpc(state, npc));
      setEditingId(npc.id);
      flash(`AI 生成了「${npc.nickname}」，可以直接改`);
    } catch (err) {
      if ((err as Error).name === "AbortError") flash("已停止");
      else flash((err as Error).message || "生成失败", 3600);
    } finally {
      setBusy(false);
    }
  };

  const handleAddCharacter = (characterId: string) => {
    const npc = npcFromCharacter(characterId, state);
    if (!npc) return;
    if (state.npcs.some((item) => item.id === npc.id)) {
      flash("这位角色已经在书友圈里了");
      setPickCharacter(false);
      return;
    }
    save(upsertNpc(state, npc));
    setPickCharacter(false);
    flash(`已把「${npc.nickname}」接进书友圈（沿用同一身份，不复制）`);
  };

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回书友圈">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">书友管理</div>
            <span className="sr-header-sub">{state.npcs.length} 位书友</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          {notice && (
            <div className="sr-note-card">
              <div className="sr-note-meta">{notice}</div>
            </div>
          )}

          <div className="sr-section-label">论坛名称</div>
          <div className="sr-appear-row">
            <input
              className="sr-appear-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label="论坛名称"
            />
            <button
              type="button"
              className="sr-btn sr-btn-sm"
              disabled={!nameDraft.trim() || nameDraft.trim() === state.name}
              onClick={() => {
                save({ ...state, name: nameDraft.trim() });
                flash("名称已更新");
              }}
            >
              改名
            </button>
          </div>

          <div className="sr-section-label">新增书友</div>
          <div className="sr-appear-row">
            <input
              className="sr-appear-input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="领域，例如 植物 / 医学 / 木工（可留空）"
              aria-label="领域倾向"
            />
            <input
              className="sr-appear-input"
              value={personalityHint}
              onChange={(e) => setPersonalityHint(e.target.value)}
              placeholder="性格，例如 毒舌 / 温和"
              aria-label="性格倾向"
            />
          </div>
          <div className="sr-css-actions" style={{ marginBottom: 10 }}>
            <button type="button" className="sr-btn sr-btn-sm" onClick={() => handleRandom()}>
              <Dices size={13} strokeWidth={1.8} />随机生成
            </button>
            <button type="button" className="sr-btn sr-btn-sm" onClick={() => handleRandom(Math.floor(Math.random() * 100000))}>
              <RefreshCw size={13} strokeWidth={1.8} />再来一个
            </button>
            {busy ? (
              <button type="button" className="sr-btn sr-btn-sm" onClick={() => abortRef.current?.abort()}>
                <Square size={13} strokeWidth={2} />停止
              </button>
            ) : (
              <button type="button" className="sr-btn sr-btn-sm" onClick={() => void handleAi()}>
                <Sparkles size={13} strokeWidth={1.8} />用 AI 生成
              </button>
            )}
            <button
              type="button"
              className="sr-btn sr-btn-sm"
              onClick={() => {
                const npc = blankNpc();
                save(upsertNpc(state, npc));
                setEditingId(npc.id);
              }}
            >
              <Plus size={13} strokeWidth={1.8} />手动新建
            </button>
            <button
              type="button"
              className="sr-btn sr-btn-sm"
              onClick={() => setPickCharacter((v) => !v)}
              disabled={characters.length === 0}
            >
              <UserPlus size={13} strokeWidth={1.8} />从角色卡添加
            </button>
          </div>
          {busy && (
            <p className="sr-note-meta" style={{ marginBottom: 10 }}>
              <Loader2 size={12} className="sr-spin" /> 正在让模型写人设…
            </p>
          )}
          {pickCharacter && (
            <div className="sr-chip-row" style={{ marginBottom: 10 }}>
              {characters.map((character) => (
                <button key={character.id} type="button" className="sr-chip" onClick={() => handleAddCharacter(character.id)}>
                  {character.name}
                </button>
              ))}
            </div>
          )}

          <div className="sr-section-label">书友</div>
          {state.npcs.length === 0 ? (
            <div className="sr-empty" style={{ paddingTop: 20 }}>
              <p>
                还没有书友。可以随机生成，也可以让 AI 按领域与性格写一个人设；
                <br />
                已有角色卡也能直接接进来，沿用同一个身份。
              </p>
            </div>
          ) : (
            state.npcs.map((npc) => {
              const muted = state.mutedNpcIds.includes(npc.id);
              const editing = editingId === npc.id;
              return (
                <div key={npc.id} className="sr-note-card">
                  <div className="sr-forum-author">
                    <span className="sr-forum-avatar" aria-hidden>
                      {npc.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={npc.avatarUrl} alt="" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarDataUrl(npc.avatar)} alt="" />
                      )}
                    </span>
                    <span className="sr-forum-author-main">
                      <span className="sr-forum-name">{npc.nickname}</span>
                      <span className="sr-note-meta">
                        {npc.occupation || "未填职业"}
                        {npc.source === "character" ? " · 来自角色卡" : npc.source === "generated" ? " · 生成的人设" : ""}
                        {muted ? " · 已屏蔽" : ""}
                      </span>
                    </span>
                    <span className="sr-note-tools">
                      <button type="button" className="sr-note-tool" title="换一个头像" onClick={() => updateNpc(npc, { avatar: nextVariant(npc.avatar) })}>
                        <RefreshCw size={15} strokeWidth={1.7} />
                      </button>
                      <button
                        type="button"
                        className="sr-note-tool"
                        title={editing ? "收起编辑" : "编辑人设"}
                        data-active={editing ? "true" : undefined}
                        onClick={() => setEditingId(editing ? null : npc.id)}
                      >
                        <PenLine size={15} strokeWidth={1.7} />
                      </button>
                      <button
                        type="button"
                        className="sr-note-tool"
                        title={muted ? "取消屏蔽" : "屏蔽"}
                        onClick={() => {
                          save(muted ? unmuteNpc(state, npc.id) : muteNpc(state, npc.id));
                          flash(muted ? "已取消屏蔽" : `已屏蔽 ${npc.nickname}`);
                        }}
                      >
                        {muted ? <Check size={15} strokeWidth={1.7} /> : <EyeOff size={15} strokeWidth={1.7} />}
                      </button>
                      <button
                        type="button"
                        className="sr-note-tool"
                        title="删除书友"
                        onClick={() => {
                          if (!confirm(`删除书友「${npc.nickname}」？TA 已发的发言会保留。`)) return;
                          save(removeNpc(state, npc.id));
                        }}
                      >
                        <Trash2 size={15} strokeWidth={1.7} />
                      </button>
                    </span>
                  </div>

                  <div className="sr-note-foot">
                    <span className="sr-note-meta">
                      {friends[npc.id] ? "已在聊天好友里" : "还没有加好友"}
                    </span>
                    <span className="sr-note-tools">
                      {friends[npc.id] ? (
                        <button type="button" className="sr-btn sr-btn-sm" onClick={() => openChatWith(friends[npc.id])}>
                          <MessageCircle size={13} strokeWidth={1.8} style={{ marginRight: 4 }} />
                          去聊天
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sr-btn sr-btn-sm"
                          onClick={async () => {
                            const result = await makeFriendFromNpc(state, npc);
                            if (result.created) {
                              const next = upsertNpc(state, { ...npc, characterId: result.characterId, source: "character" });
                              save(next);
                            }
                            flash(
                              result.alreadyFriend
                                ? `${npc.nickname} 本来就在聊天好友里`
                                : `已把 ${npc.nickname} 加为好友，去聊天应用里就能找到 TA`,
                              3200,
                            );
                          }}
                        >
                          <UserPlus size={13} strokeWidth={1.8} style={{ marginRight: 4 }} />
                          加为好友
                        </button>
                      )}
                    </span>
                  </div>

                  {editing && (
                    <div style={{ marginTop: 10 }}>
                      <div className="sr-chip-row" style={{ marginBottom: 8 }}>
                        {AVATAR_CATEGORIES.map((category) => (
                          <button
                            key={category.key}
                            type="button"
                            className="sr-chip"
                            data-active={npc.avatar.category === category.key ? "true" : undefined}
                            onClick={() => updateNpc(npc, { avatar: { ...npc.avatar, category: category.key as AvatarCategory } })}
                          >
                            {category.label}
                          </button>
                        ))}
                      </div>
                      {(
                        [
                          ["nickname", "昵称"],
                          ["occupation", "职业 / 领域"],
                          ["background", "背景经历"],
                          ["personality", "性格"],
                          ["readingTaste", "阅读偏好"],
                          ["speechStyle", "语言习惯"],
                          ["relations", "关系"],
                        ] as Array<[keyof ForumNpc, string]>
                      ).map(([key, label]) => (
                        <div key={String(key)} style={{ marginBottom: 8 }}>
                          <div className="sr-note-meta" style={{ marginBottom: 4 }}>{label}</div>
                          <textarea
                            className="sr-css-editor"
                            rows={String(key) === "background" ? 3 : 2}
                            value={(npc[key] as string) ?? ""}
                            onChange={(e) => updateNpc(npc, { [key]: e.target.value } as Partial<ForumNpc>)}
                            aria-label={label}
                          />
                        </div>
                      ))}
                      <div style={{ marginBottom: 8 }}>
                        <div className="sr-note-meta" style={{ marginBottom: 4 }}>兴趣（用顿号分隔）</div>
                        <input
                          className="sr-appear-input"
                          style={{ width: "100%" }}
                          value={npc.interests.join("、")}
                          onChange={(e) =>
                            updateNpc(npc, { interests: e.target.value.split(/[、,，\s]+/).filter(Boolean).slice(0, 8) })
                          }
                          aria-label="兴趣"
                        />
                      </div>
                      <div className="sr-css-actions">
                        <button type="button" className="sr-btn" onClick={() => setEditingId(null)}>
                          收起
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <HelpFoot id="npc-about" label="关于书友人设">
            人设会先保存下来，论坛发言再按人设生成；头像使用书房内置的图形素材（动物、人物、天气、天空、风景），
            可以逐个换，也可以固定保存。
          </HelpFoot>
        </div>
      </div>
    </section>
  );
}
