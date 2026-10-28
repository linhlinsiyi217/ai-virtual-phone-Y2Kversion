"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Trash2, ChevronDown, ChevronRight, BookOpenText, Timer } from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import { loadBooks } from "@/lib/reading-storage";
import type { Book } from "@/lib/reading-types";
import { HelpTip } from "./help-tip";
import {
  DEFAULT_STAGE_CONFIG,
  loadStageConfig,
  loadStageSummaries,
  removeStageSummary,
  saveStageConfig,
  type StageConfig,
  type StageSummary,
  type StageTriggerMode,
} from "@/lib/study-room/reading-memory";

type StudyRoomReadingMemoryProps = {
  onBack: () => void;
  onOpenBook: (book: Book, chapterIndex?: number) => void;
};

const MODE_LABEL: Record<StageTriggerMode, { label: string; desc: string }> = {
  chapters: { label: "按章节数", desc: "每读够一定章数自动记一次" },
  progress: { label: "按阅读程度", desc: "阅读进度每前进一定比例记一次" },
  manual: { label: "仅手动", desc: "只在书详情里点「现在总结」时生成" },
};

export function StudyRoomReadingMemory({ onBack, onOpenBook }: StudyRoomReadingMemoryProps) {
  const [config, setConfig] = useState<StageConfig>(() => loadStageConfig());
  const [summaries, setSummaries] = useState<StageSummary[]>(() => loadStageSummaries());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const characters = useMemo(() => loadCharacters().map((c) => ({ id: c.id, name: c.name })), []);
  const books = useMemo(() => {
    const map: Record<string, Book> = {};
    for (const book of loadBooks()) map[book.id] = book;
    return map;
  }, []);

  useEffect(() => {
    saveStageConfig(config);
  }, [config]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 2000);
  };

  const toggleCharacter = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      characterIds: prev.characterIds.includes(id)
        ? prev.characterIds.filter((item) => item !== id)
        : [...prev.characterIds, id],
    }));
  };

  const grouped = useMemo(() => {
    const map = new Map<string, StageSummary[]>();
    for (const item of summaries) {
      const list = map.get(item.bookId) ?? [];
      list.push(item);
      map.set(item.bookId, list);
    }
    return Array.from(map.entries()).map(([bookId, list]) => ({
      bookId,
      list: [...list].sort((a, b) => b.toChapter - a.toChapter),
    }));
  }, [summaries]);

  const handleDelete = async (item: StageSummary) => {
    if (!confirm(`删除《${item.bookTitle}》由 ${item.characterName} 记的这一段阅读记录？记忆库里的对应条目也会一起清掉。`)) return;
    await removeStageSummary(item.id);
    setSummaries(loadStageSummaries());
    flash("已删除这条阅读记录");
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
            <div className="sr-header-title">阅读记忆</div>
            <span className="sr-header-sub">{summaries.length} 条阶段记录</span>
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

          <div className="sr-section-label">什么时候记录</div>
          {(["chapters", "progress", "manual"] as StageTriggerMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className="sr-btn"
              style={{ width: "100%", marginBottom: 10, justifyContent: "space-between" }}
              data-active={config.mode === mode ? "true" : undefined}
              onClick={() => setConfig((prev) => ({ ...prev, mode }))}
            >
              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span>{MODE_LABEL[mode].label}</span>
                <span className="sr-note-meta">{MODE_LABEL[mode].desc}</span>
              </span>
              {config.mode === mode && <span className="sr-note-meta">已选</span>}
            </button>
          ))}

          {config.mode === "chapters" && (
            <div className="sr-appear-row sr-appear-row--slider">
              <span className="sr-appear-label">每读多少章</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={config.chapterStep}
                onChange={(e) => setConfig((prev) => ({ ...prev, chapterStep: Number(e.target.value) }))}
                className="sr-slider"
                aria-label="每读多少章生成一次"
              />
              <span className="sr-appear-value">{config.chapterStep} 章</span>
            </div>
          )}
          {config.mode === "progress" && (
            <div className="sr-appear-row sr-appear-row--slider">
              <span className="sr-appear-label">每前进多少</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={config.progressStep}
                onChange={(e) => setConfig((prev) => ({ ...prev, progressStep: Number(e.target.value) }))}
                className="sr-slider"
                aria-label="阅读程度每前进多少生成一次"
              />
              <span className="sr-appear-value">{config.progressStep}%</span>
            </div>
          )}
          <p className="sr-note-meta" style={{ margin: "6px 2px 14px", lineHeight: 1.8 }}>
            不会每翻一页就调用一次：只有到达上面的间隔才会在后台总结一次，用设置里绑定的辅助 API，失败不会打断阅读。
            <HelpTip id="reading-memory" label="阅读记忆说明">
              到达间隔后，书房会把「你已经读到的那部分原文」发给辅助 API，生成一段精简小结写进这个角色的记忆库；
              角色聊天时按原有记忆规则被想起。只写已读范围，不会把整本书发出去。
            </HelpTip>
          </p>

          <div className="sr-section-label">哪些角色记录</div>
          {characters.length === 0 ? (
            <p className="sr-note-meta" style={{ margin: "2px 2px 14px", lineHeight: 1.8 }}>
              还没有角色。创建角色后，TA 会按上面的间隔记录自己和你一起读到的内容。
            </p>
          ) : (
            <>
              <div className="sr-chip-row">
                {characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className="sr-chip"
                    data-active={config.characterIds.includes(character.id) ? "true" : undefined}
                    onClick={() => toggleCharacter(character.id)}
                  >
                    {character.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="sr-chip"
                  onClick={() => setConfig((prev) => ({ ...prev, characterIds: [] }))}
                >
                  全部角色（默认）
                </button>
              </div>
              <p className="sr-note-meta" style={{ margin: "6px 2px 14px", lineHeight: 1.8 }}>
                不选就是所有角色都记录；每本书、每个角色各自记录读到哪里，互不影响。
              </p>
            </>
          )}

          <div className="sr-section-label">已有的阶段记录</div>
          {grouped.length === 0 ? (
            <div className="sr-empty">
              <BookOpenText size={40} strokeWidth={1} />
              <p>
                还没有阶段记录。
                <br />
                继续阅读（或到书详情里点「现在总结」）就会生成第一条。
              </p>
            </div>
          ) : (
            grouped.map(({ bookId, list }) => (
              <div key={bookId} className="sr-note-group">
                <div className="sr-note-group-head">
                  <span className="sr-note-group-title">{list[0]?.bookTitle ?? books[bookId]?.title ?? "未知书籍"}</span>
                  <span className="sr-note-group-count">{list.length}</span>
                </div>
                {list.map((item) => {
                  const open = expanded === item.id;
                  const book = books[item.bookId];
                  return (
                    <div key={item.id} className="sr-note-card" data-source="character">
                      <div className="sr-stage-head">
                        <span className="sr-mark-author">{item.characterName}</span>
                        <span className="sr-note-meta">
                          第 {item.fromChapter + 1}–{item.toChapter + 1} 章 ·{" "}
                          {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                      </div>
                      <p className="sr-note-thought">{item.summary}</p>
                      {open && item.detail && <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>{item.detail}</p>}
                      <div className="sr-note-foot">
                        <span className="sr-note-tools">
                          {item.detail && (
                            <button
                              type="button"
                              className="sr-note-tool"
                              title={open ? "收起详细记录" : "展开详细记录"}
                              onClick={() => setExpanded(open ? null : item.id)}
                            >
                              {open ? <ChevronDown size={15} strokeWidth={1.8} /> : <ChevronRight size={15} strokeWidth={1.8} />}
                            </button>
                          )}
                          <button
                            type="button"
                            className="sr-note-tool"
                            title="回到这本书"
                            disabled={!book}
                            onClick={() => book && onOpenBook(book, item.toChapter)}
                          >
                            <BookOpenText size={15} strokeWidth={1.7} />
                          </button>
                          <button type="button" className="sr-note-tool" title="删除" onClick={() => void handleDelete(item)}>
                            <Trash2 size={15} strokeWidth={1.7} />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          <p className="sr-note-meta" style={{ marginTop: 16, lineHeight: 1.8 }}>
            <Timer size={13} strokeWidth={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
            记录只包含你已读到的内容，角色不会提前知道后面的情节；这些记录写进角色已有的记忆库，聊天时按原有规则被想起。
            {config.mode === DEFAULT_STAGE_CONFIG.mode && config.chapterStep === DEFAULT_STAGE_CONFIG.chapterStep
              ? "（当前是默认设置：每 30 章一次。）"
              : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
