"use client";

// 深谈空间（G3）：深度聊天入口 + 会话总结 + 长期记忆 + RAG/向量召回 + 角色关系网。
// 全部复用统一数据源：chat-storage（会话/消息）、memory-storage（长期/核心记忆）、
// memory-summarizer（总结管线）、memory-embedding（向量召回）、character-world-storage（关系网）。
// 本组件只做聚合视图与入口跳转，不建第二套数据。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Brain,
    ChevronRight,
    FileText,
    MessagesSquare,
    Network,
    Search,
    Sparkles,
} from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Avatar } from "@/components/ui/primitives";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import {
    addChatContact,
    createOrGetSession,
    hydrateChatStorage,
    loadChatContacts,
} from "@/lib/chat-storage";
import type { MemoryEntry } from "@/lib/memory-types";
import { loadMemoryConfig } from "@/lib/memory-storage";
import {
    getLastSummarizedTimestamp,
    getMemoryCountByType,
    loadMemoryEntriesByType,
    memoryEntryInAccount,
    resolveMemoryAccountScope,
} from "@/lib/memory-storage";
import { runSummarizationPipeline } from "@/lib/memory-summarizer";
import { resolveEmbeddingModel, searchMemories } from "@/lib/memory-embedding";
import type { MemorySearchResult } from "@/lib/memory-types";
import {
    loadUserIdentities,
    resolveAuxiliaryApiConfig,
} from "@/lib/settings-storage";
import {
    getCharacterWorldGroup,
    getCharacterWorldUserIdentityId,
} from "@/lib/character-world-storage";

type DeepTalkView = "main" | "character";

type CharacterStat = {
    character: Character;
    longTermCount: number;
    coreCount: number;
};

type RelationRow = {
    id: string;
    fromName: string;
    toName: string;
    label: string;
};

type DeepTalkAppProps = {
    onClose: () => void;
    onNotice?: (msg: string) => void;
    /** 跳到统一聊天 App 并打开指定会话（由桌面壳注入，复用通知点开的同一条链路）。 */
    onOpenChatSession: (sessionId: string) => void;
};

function formatTime(iso: string | null): string {
    if (!iso) return "从未总结";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "从未总结";
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DeepTalkApp({ onClose, onNotice, onOpenChatSession }: DeepTalkAppProps) {
    const [view, setView] = useState<DeepTalkView>("main");
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [stats, setStats] = useState<CharacterStat[]>([]);
    const [listLoading, setListLoading] = useState(true);

    const loadList = useCallback(async (isCancelled?: () => boolean) => {
        setListLoading(true);
        const chars = loadCharacters();
        const scope = resolveMemoryAccountScope();
        const rows: CharacterStat[] = [];
        for (const character of chars) {
            let longTermCount = 0;
            let coreCount = 0;
            try {
                const [lt, core] = await Promise.all([
                    loadMemoryEntriesByType(character.id, "long_term"),
                    loadMemoryEntriesByType(character.id, "core"),
                ]);
                longTermCount = lt.filter(e => memoryEntryInAccount(e, scope)).length;
                coreCount = core.filter(e => memoryEntryInAccount(e, scope)).length;
            } catch { /* IndexedDB 不可用时按 0 显示 */ }
            rows.push({ character, longTermCount, coreCount });
            if (isCancelled?.()) return;
        }
        if (isCancelled?.()) return;
        setStats(rows);
        setListLoading(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void loadList(() => cancelled);
        return () => { cancelled = true; };
    }, [loadList]);

    const selectedChar = useMemo(
        () => stats.find(s => s.character.id === selectedCharId)?.character
            ?? (selectedCharId ? loadCharacters().find(c => c.id === selectedCharId) ?? null : null),
        [stats, selectedCharId],
    );

    const handleBack = () => {
        if (view === "character") {
            setView("main");
            setSelectedCharId(null);
            void loadList();
        } else {
            onClose();
        }
    };

    return (
        <PageShell
            title={view === "character" ? (selectedChar?.name || "深谈空间") : "深谈空间"}
            onBack={handleBack}
        >
            {view === "main" ? (
                <DeepTalkMain
                    stats={stats}
                    loading={listLoading}
                    onSelect={(charId) => { setSelectedCharId(charId); setView("character"); }}
                />
            ) : selectedChar ? (
                <DeepTalkCharacter
                    character={selectedChar}
                    onNotice={onNotice}
                    onOpenChatSession={onOpenChatSession}
                    onDataChanged={() => void loadList()}
                />
            ) : null}
        </PageShell>
    );
}

/* ── 主页：角色列表 ── */

function DeepTalkMain({
    stats,
    loading,
    onSelect,
}: {
    stats: CharacterStat[];
    loading: boolean;
    onSelect: (charId: string) => void;
}) {
    return (
        <div className="deep-talk-main">
            <p className="deep-talk-intro">
                选择一个角色进入深谈空间：这里聚合了与 TA 的深度聊天入口、会话总结、长期记忆、向量召回和关系网。
                聊天消息与会话完全来自统一聊天数据。
            </p>
            {loading && stats.length === 0 ? (
                <p className="deep-talk-empty">加载中…</p>
            ) : stats.length === 0 ? (
                <p className="deep-talk-empty">还没有角色。先到「角色」App 创建一个角色吧。</p>
            ) : (
                <div className="deep-talk-char-list">
                    {stats.map(({ character, longTermCount, coreCount }) => (
                        <button
                            key={character.id}
                            type="button"
                            className="deep-talk-char-row"
                            onClick={() => onSelect(character.id)}
                        >
                            <Avatar src={character.avatar ?? undefined} name={character.name} size="md" />
                            <span className="deep-talk-char-meta">
                                <span className="deep-talk-char-name">{character.name}</span>
                                <span className="deep-talk-char-sub">
                                    长期记忆 {longTermCount} 条 · 核心记忆 {coreCount} 条
                                </span>
                            </span>
                            <ChevronRight size={18} strokeWidth={1.6} className="deep-talk-char-chevron" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── 角色页：四块功能 ── */

function DeepTalkCharacter({
    character,
    onNotice,
    onOpenChatSession,
    onDataChanged,
}: {
    character: Character;
    onNotice?: (msg: string) => void;
    onOpenChatSession: (sessionId: string) => void;
    onDataChanged: () => void;
}) {
    const [entering, setEntering] = useState(false);
    const [summarizing, setSummarizing] = useState(false);
    const [lastSummarizedAt, setLastSummarizedAt] = useState<string | null>(null);
    const [longTermPreview, setLongTermPreview] = useState<MemoryEntry[]>([]);
    const [corePreview, setCorePreview] = useState<MemoryEntry[]>([]);
    const [memoryTotal, setMemoryTotal] = useState(0);
    const [coreTotal, setCoreTotal] = useState(0);
    const [relations, setRelations] = useState<RelationRow[]>([]);
    const [worldName, setWorldName] = useState<string | null>(null);
    const [recallQuery, setRecallQuery] = useState("");
    const [recallResults, setRecallResults] = useState<MemorySearchResult[] | null>(null);
    const [recallSearching, setRecallSearching] = useState(false);

    const recallConfig = loadMemoryConfig();
    const embeddingApiConfig = recallConfig.vectorRecallEnabled
        ? resolveAuxiliaryApiConfig("embeddingApiConfigId")
        : null;
    const vectorReady = Boolean(embeddingApiConfig && resolveEmbeddingModel(embeddingApiConfig));

    const reload = useCallback(async () => {
        const scope = resolveMemoryAccountScope();
        try {
            const [lt, core] = await Promise.all([
                loadMemoryEntriesByType(character.id, "long_term"),
                loadMemoryEntriesByType(character.id, "core"),
            ]);
            const ownedLt = lt.filter(e => memoryEntryInAccount(e, scope));
            const ownedCore = core.filter(e => memoryEntryInAccount(e, scope));
            setMemoryTotal(ownedLt.length);
            setCoreTotal(ownedCore.length);
            setLongTermPreview([...ownedLt].slice(-3).reverse());
            setCorePreview(ownedCore.slice(0, 2));
        } catch {
            setMemoryTotal(0);
            setCoreTotal(0);
            setLongTermPreview([]);
            setCorePreview([]);
        }
        setLastSummarizedAt(getLastSummarizedTimestamp(character.id));

        // 关系网：角色所在世界 + 涉及该角色的关系
        const group = getCharacterWorldGroup(character.id);
        if (!group) {
            setWorldName(null);
            setRelations([]);
            return;
        }
        setWorldName(group.name);
        const chars = loadCharacters();
        const identities = loadUserIdentities();
        const nameOf = (id: string): string => {
            const identityId = getCharacterWorldUserIdentityId(id);
            if (identityId) {
                const identity = identities.find(i => i.id === identityId);
                return `${identity?.name || "我"}（你）`;
            }
            return findCharacterName(chars, id);
        };
        setRelations(
            group.relations
                .filter(r => r.fromCharacterId === character.id || r.toCharacterId === character.id)
                .map(r => ({ id: r.id, fromName: nameOf(r.fromCharacterId), toName: nameOf(r.toCharacterId), label: r.label })),
        );
    }, [character.id]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // 深度聊天入口：复用统一聊天联系人与会话，跳转到聊天 App
    const handleEnterChat = async () => {
        if (entering) return;
        setEntering(true);
        try {
            await hydrateChatStorage();
            const existing = loadChatContacts().find(c => c.characterId === character.id);
            const contact = existing ?? addChatContact(character.id);
            if (!contact) {
                onNotice?.("未能创建聊天联系人");
                return;
            }
            const session = createOrGetSession(contact.id);
            onOpenChatSession(session.id);
        } finally {
            setEntering(false);
        }
    };

    // 会话总结：手动触发统一总结管线（与记忆库「立即总结」同一条链路）
    const handleSummarize = async () => {
        if (summarizing) return;
        setSummarizing(true);
        try {
            const result = await runSummarizationPipeline(character.id, character.name);
            if (result.success) {
                onNotice?.("会话总结完成，已写入长期记忆");
            } else {
                onNotice?.(result.error || "总结失败");
            }
            await reload();
            onDataChanged();
        } finally {
            setSummarizing(false);
        }
    };

    // RAG/向量召回：对已入库记忆做检索预览（向量优先，未配置时回退关键词）
    const handleRecallSearch = async () => {
        const query = recallQuery.trim();
        if (!query || recallSearching) return;
        setRecallSearching(true);
        try {
            const scope = resolveMemoryAccountScope();
            const all = (await loadMemoryEntriesByType(character.id, "long_term"))
                .concat(await loadMemoryEntriesByType(character.id, "core"))
                .filter(e => memoryEntryInAccount(e, scope));
            const results = await searchMemories(query, all, embeddingApiConfig ?? null, 5);
            setRecallResults(results);
        } catch {
            setRecallResults([]);
            onNotice?.("召回检索失败");
        } finally {
            setRecallSearching(false);
        }
    };

    return (
        <div className="deep-talk-detail">
            {/* 深度聊天入口 */}
            <section className="deep-talk-card">
                <div className="deep-talk-card-head">
                    <MessagesSquare size={18} strokeWidth={1.8} />
                    <h3>深度聊天</h3>
                </div>
                <p className="deep-talk-card-desc">
                    进入与 {character.name} 的统一聊天会话，消息记录与聊天 App 完全互通。
                </p>
                <button
                    type="button"
                    className="deep-talk-primary-btn"
                    onClick={() => void handleEnterChat()}
                    disabled={entering}
                >
                    {entering ? "正在打开…" : `进入与 ${character.name} 的深谈`}
                </button>
            </section>

            {/* 会话总结 */}
            <section className="deep-talk-card">
                <div className="deep-talk-card-head">
                    <FileText size={18} strokeWidth={1.8} />
                    <h3>会话总结</h3>
                    <span className="deep-talk-card-badge">{formatTime(lastSummarizedAt)}</span>
                </div>
                <p className="deep-talk-card-desc">
                    把最近的聊天与事件总结成长期记忆。自动总结按记忆设置的间隔触发，这里可以立即手动总结。
                </p>
                <button
                    type="button"
                    className="deep-talk-secondary-btn"
                    onClick={() => void handleSummarize()}
                    disabled={summarizing}
                >
                    {summarizing ? "正在总结…" : "立即总结会话"}
                </button>
            </section>

            {/* 长期记忆 */}
            <section className="deep-talk-card">
                <div className="deep-talk-card-head">
                    <Brain size={18} strokeWidth={1.8} />
                    <h3>长期记忆</h3>
                    <span className="deep-talk-card-badge">核心 {coreTotal} · 长期 {memoryTotal}</span>
                </div>
                {corePreview.length === 0 && longTermPreview.length === 0 ? (
                    <p className="deep-talk-card-desc">还没有记忆。多聊几轮或手动总结后会在这里沉淀。</p>
                ) : (
                    <ul className="deep-talk-memory-list">
                        {corePreview.map(entry => (
                            <li key={entry.id} className="deep-talk-memory-item">
                                <span className="deep-talk-memory-tag core">核心</span>
                                <span className="deep-talk-memory-text">{entry.content}</span>
                            </li>
                        ))}
                        {longTermPreview.map(entry => (
                            <li key={entry.id} className="deep-talk-memory-item">
                                <span className="deep-talk-memory-tag">{formatTime(entry.createdAt)}</span>
                                <span className="deep-talk-memory-text">{entry.content}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* RAG/向量召回 */}
            <section className="deep-talk-card">
                <div className="deep-talk-card-head">
                    <Sparkles size={18} strokeWidth={1.8} />
                    <h3>记忆召回</h3>
                    <span className="deep-talk-card-badge">{vectorReady ? "向量召回" : "关键词召回"}</span>
                </div>
                <p className="deep-talk-card-desc">
                    {vectorReady
                        ? "已配置向量模型，聊天时会按相关度召回记忆。输入一句话预览会召回哪些记忆。"
                        : "未配置向量模型，当前使用关键词召回。可在绑定配置 → 辅助API绑定中配置向量模型。"}
                </p>
                <div className="deep-talk-recall-bar">
                    <input
                        className="deep-talk-recall-input"
                        value={recallQuery}
                        onChange={e => setRecallQuery(e.target.value)}
                        placeholder="输入一句话，预览记忆召回"
                        onKeyDown={e => { if (e.key === "Enter") void handleRecallSearch(); }}
                    />
                    <button
                        type="button"
                        className="deep-talk-secondary-btn"
                        onClick={() => void handleRecallSearch()}
                        disabled={recallSearching || !recallQuery.trim()}
                        aria-label="检索记忆"
                    >
                        <Search size={16} strokeWidth={1.8} />
                    </button>
                </div>
                {recallSearching ? (
                    <p className="deep-talk-card-desc">检索中…</p>
                ) : recallResults ? (
                    recallResults.length === 0 ? (
                        <p className="deep-talk-card-desc">没有命中相关记忆。</p>
                    ) : (
                        <ul className="deep-talk-memory-list">
                            {recallResults.map(({ entry, score }) => (
                                <li key={entry.id} className="deep-talk-memory-item">
                                    <span className="deep-talk-memory-tag">
                                        {entry.type === "core" ? "核心" : "长期"} · {(score * 100).toFixed(0)}%
                                    </span>
                                    <span className="deep-talk-memory-text">{entry.content}</span>
                                </li>
                            ))}
                        </ul>
                    )
                ) : null}
            </section>

            {/* 角色关系网 */}
            <section className="deep-talk-card">
                <div className="deep-talk-card-head">
                    <Network size={18} strokeWidth={1.8} />
                    <h3>角色关系网</h3>
                    {worldName ? <span className="deep-talk-card-badge">{worldName}</span> : null}
                </div>
                {relations.length === 0 ? (
                    <p className="deep-talk-card-desc">
                        还没有为 {character.name} 建立关系。到「角色」App 的世界分页里添加关系后，会显示在这里并注入聊天上下文。
                    </p>
                ) : (
                    <ul className="deep-talk-relation-list">
                        {relations.map(rel => (
                            <li key={rel.id} className="deep-talk-relation-item">
                                <span className="deep-talk-relation-name">{rel.fromName}</span>
                                <span className="deep-talk-relation-label">{rel.label}</span>
                                <span className="deep-talk-relation-name">{rel.toName}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function findCharacterName(chars: Character[], id: string): string {
    return chars.find(c => c.id === id)?.name ?? "未知角色";
}
