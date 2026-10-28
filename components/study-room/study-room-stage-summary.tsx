"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import { loadChapters, loadProgress } from "@/lib/reading-storage";
import type { Book, BookChapter } from "@/lib/reading-types";
import {
  MAX_STAGE_CHAPTERS,
  generateStageSummary,
  lastSummarizedChapter,
  loadStageSummaries,
  removeStageSummary,
  saveStageSummary,
  summariesForBook,
  type StageSummary,
} from "@/lib/study-room/reading-memory";

type StudyRoomStageSummaryProps = {
  book: Book;
  /** 跳到这条记录覆盖的章节（回到当时读到的地方） */
  onOpenChapter: (chapterIndex: number) => void;
};

/**
 * 书详情里的阶段阅读记忆：这本书每个角色读到哪、记了什么。
 * 「现在总结」只发送已读范围，且一次最多回溯 MAX_STAGE_CHAPTERS 章。
 */
export function StudyRoomStageSummary({ book, onOpenChapter }: StudyRoomStageSummaryProps) {
  const [summaries, setSummaries] = useState<StageSummary[]>([]);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [readChapter, setReadChapter] = useState<number | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const characters = useMemo(() => loadCharacters().map((c) => ({ id: c.id, name: c.name })), []);

  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    void (async () => {
      const [list, chs, progress] = await Promise.all([
        Promise.resolve(loadStageSummaries()),
        loadChapters(book.id).catch(() => []),
        loadProgress(book.id).catch(() => null),
      ]);
      if (cancelled) return;
      setSummaries(summariesForBook(list, book.id));
      setChapters(chs);
      setReadChapter(progress?.lastReadAt ? progress.chapterIndex : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => {
    if (!characterId && characters.length > 0) setCharacterId(characters[0].id);
  }, [characters, characterId]);

  const flash = (message: string, ms = 2600) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), ms);
  };

  const handleGenerate = async () => {
    const character = characters.find((c) => c.id === characterId);
    if (!character) {
      flash("先在「我的 → 角色」里创建一个角色");
      return;
    }
    if (readChapter === null) {
      flash("还没读过这本书，先读几章再总结");
      return;
    }
    if (chapters.length === 0) {
      flash("这本书还没有可总结的正文");
      return;
    }
    const last = lastSummarizedChapter(loadStageSummaries(), book.id, character.id);
    const fromChapter = Math.max(last + 1, readChapter - MAX_STAGE_CHAPTERS + 1, 0);
    if (fromChapter > readChapter) {
      flash(`${character.name} 已经记到第 ${readChapter + 1} 章了`);
      return;
    }
    setBusy(true);
    try {
      const result = await generateStageSummary({
        book,
        chapters,
        fromChapter,
        toChapter: readChapter,
        readParagraphOf: (index) =>
          index === readChapter
            ? (chapters[index]?.paragraphs.length ?? 1) - 1
            : (chapters[index]?.paragraphs.length ?? 1) - 1,
        characterId: character.id,
      });
      await saveStageSummary({
        book,
        characterId: character.id,
        characterName: character.name,
        fromChapter,
        toChapter: readChapter,
        summary: result.summary,
        detail: result.detail,
      });
      setSummaries(summariesForBook(loadStageSummaries(), book.id));
      flash(`${character.name} 已记下第 ${fromChapter + 1}–${readChapter + 1} 章`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "总结失败，请稍后重试", 3600);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item: StageSummary) => {
    if (!confirm(`删除 ${item.characterName} 记的第 ${item.fromChapter + 1}–${item.toChapter + 1} 章记录？`)) return;
    await removeStageSummary(item.id);
    setSummaries(summariesForBook(loadStageSummaries(), book.id));
    flash("已删除");
  };

  return (
    <>
      <h3 className="sr-detail-h">阶段阅读记录</h3>
      {notice && <p className="sr-note-meta" style={{ margin: "0 0 8px", lineHeight: 1.7 }}>{notice}</p>}
      {summaries.length === 0 ? (
        <p className="sr-detail-muted">
          还没有记录。读过几章后可以点下面的按钮，让角色记住这一段；也可以在「我的 → 阅读记忆」里设置自动记录的间隔。
        </p>
      ) : (
        <ul className="sr-detail-notes">
          {summaries.map((item) => (
            <li key={item.id} className="sr-stage-row">
              <button type="button" onClick={() => onJump(item)}>
                <Sparkles size={14} strokeWidth={1.8} />
                <span className="sr-detail-note-text">
                  <strong>{item.characterName}</strong> · 第 {item.fromChapter + 1}–{item.toChapter + 1} 章：{item.summary}
                </span>
              </button>
              <button
                type="button"
                className="sr-note-tool"
                title="删除这条记录"
                onClick={() => void handleDelete(item)}
              >
                <Trash2 size={15} strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {characters.length > 0 ? (
        <div className="sr-mark-foot" style={{ marginTop: 8 }}>
          <select
            className="sr-appear-select"
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            aria-label="选择记录的角色"
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="sr-btn" onClick={() => void handleGenerate()} disabled={busy}>
            {busy ? <Loader2 size={15} className="sr-spin" /> : <Sparkles size={15} strokeWidth={1.7} />}
            现在总结
          </button>
        </div>
      ) : (
        <p className="sr-detail-muted">还没有角色：创建角色后可以在这里让 TA 记住你读到的地方。</p>
      )}
      <p className="sr-note-meta" style={{ marginTop: 6, lineHeight: 1.7 }}>
        只把已经读到的章节发给总结用的辅助 API，一次最多回溯 {MAX_STAGE_CHAPTERS} 章；记录同时写进角色的记忆库。
      </p>
    </>
  );

  function onJump(item: StageSummary) {
    onOpenChapter(item.toChapter);
  }
}
