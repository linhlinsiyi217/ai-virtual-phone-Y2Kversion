"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bookmark,
  ChevronRight,
  Clock3,
  Feather,
  LayoutTemplate,
  Lightbulb,
  PenLine,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import { loadWorldBooks } from "@/lib/settings-storage";
import { loadBooks } from "@/lib/reading-storage";
import { loadWishlist } from "@/lib/study-room/wishlist";
import type { ReadingBookmark } from "@/lib/reading-types";
import {
  WORK_KIND_LABEL,
  createDraft,
  draftNextStep,
  draftWordCount,
  loadDrafts,
  removeDraft,
  saveDrafts,
  todayWritingStats,
  upsertDraft,
  type CreativeDraft,
} from "@/lib/study-room/creative";
import {
  addInspiration,
  loadInspirations,
  removeInspiration,
  updateInspiration,
  type InspirationNote,
} from "@/lib/study-room/inspiration";
import { StudyRoomDeskStart, type DeskStartInitial } from "./study-room-desk-start";

type CreativePanelProps = {
  onOpenDraft: (draftId: string) => void;
  /** 打开「我的 → 笔记」看资料盒里的笔记 */
  onOpenNotes?: () => void;
  /** 打开想读书单 */
  onOpenWishlist?: () => void;
  /** 阅读留下的东西（书摘批注数、书签），由书桌页读好传进来 */
  reading?: {
    noteCount: number;
    bookmarks: ReadingBookmark[] | null;
    bookTitles: Record<string, string>;
  };
};

type Drawer = "note" | "world" | "outline" | "box" | "drafts" | "bookmarks" | null;

const DRAWER_TITLE: Record<Exclude<Drawer, null>, string> = {
  note: "灵感便签",
  world: "世界设定",
  outline: "大纲",
  box: "资料盒",
  drafts: "全部作品",
  bookmarks: "阅读书签",
};

/** 没记完的灵感便签先放在本次会话里：关掉面板、去别的页再回来都还在 */
const NOTE_DRAFT_KEY = "studyroom_desk_note_draft";

/**
 * 书桌：制书工作台。
 * 首页是「开始创作 / 继续创作 / 今日写作 / 模板 / 灵感抽屉 / 制书工具」，
 * 不是一个只有按钮的入口页；所有数字都来自真实草稿。
 */
export function CreativePanel({ onOpenDraft, onOpenNotes, onOpenWishlist, reading }: CreativePanelProps) {
  const [drafts, setDrafts] = useState<CreativeDraft[]>(() => loadDrafts());
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [inspirations, setInspirations] = useState<InspirationNote[]>(() => loadInspirations());
  const [draftNote, setDraftNoteState] = useState(() => {
    try {
      return sessionStorage.getItem(NOTE_DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const setDraftNote = (value: string) => {
    setDraftNoteState(value);
    try {
      if (value) sessionStorage.setItem(NOTE_DRAFT_KEY, value);
      else sessionStorage.removeItem(NOTE_DRAFT_KEY);
    } catch {
      /* 存不了就只留在内存里 */
    }
  };
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState<DeskStartInitial | null>(null);

  const characters = useMemo(() => loadCharacters(), []);
  const worldBooks = useMemo(() => loadWorldBooks(), []);
  const wishlist = useMemo(() => loadWishlist(), []);
  const books = useMemo(() => loadBooks(), []);
  const stats = useMemo(() => todayWritingStats(drafts), [drafts]);
  const outlined = useMemo(() => drafts.filter((d) => d.outline?.trim()), [drafts]);

  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  const flash = (message: string, ms = 2400) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), ms);
  };

  const recent = useMemo(
    () => [...drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 1),
    [drafts],
  );

  /** 导入：txt / md / docx 读成一份手写草稿，失败时留在面板里提示 */
  const importFile = async (file: File) => {
    try {
      const text = /\.docx$/i.test(file.name)
        ? await (await import("@/lib/study-room/docx")).readDocxText(await file.arrayBuffer())
        : await file.text();
      if (!text.trim()) throw new Error("empty");
      const draft = { ...createDraft("blank"), writeMode: "hand" as const };
      draft.title = file.name.replace(/\.[^.]+$/, "");
      draft.chapters = [
        {
          id: `cc_${Date.now()}`,
          title: "导入的正文",
          content: text.slice(0, 400000),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      setDrafts(upsertDraft(drafts, draft));
      setStarting(null);
      onOpenDraft(draft.id);
    } catch {
      setStarting(null);
      flash("这个文件读不出来，换一个 txt / md / docx 试试", 3000);
    }
  };

  const handleDelete =(draft: CreativeDraft) => {
    if (!confirm(`删除草稿「${draft.title.trim() || "未命名作品"}」？已发布到书架的书不会被删掉。`)) return;
    const next = removeDraft(drafts, draft.id);
    saveDrafts(next);
    setDrafts(next);
  };

  const toolTile = (key: Exclude<Drawer, null>, label: string, meta: string, icon: React.ReactNode) => (
    <button type="button" className="sr-desk-tool" onClick={() => setDrawer(key)} aria-haspopup="dialog">
      {icon}
      <span className="sr-desk-tool-name">{label}</span>
      <span className="sr-desk-tool-meta">{meta}</span>
    </button>
  );

  const draftCard = (draft: CreativeDraft) => (
    <div key={draft.id} className="sr-note-card">
      <button type="button" className="sr-creative-item" onClick={() => onOpenDraft(draft.id)}>
        <span className="sr-creative-item-icon" aria-hidden>
          {draft.chapters.length > 0 ? <BookOpen size={18} strokeWidth={1.6} /> : <PenLine size={18} strokeWidth={1.6} />}
        </span>
        <span className="sr-creative-item-main">
          <span className="sr-creative-item-title">{draft.title.trim() || "未命名作品"}</span>
          <span className="sr-note-meta">
            {draft.kind ? `${WORK_KIND_LABEL[draft.kind]} · ` : ""}
            {draft.chapters.length} 章 · {draftWordCount(draft)} 字
            {draft.writeMode === "hand" ? " · 手写" : ""}
          </span>
          <span className="sr-desk-next">下一步：{draftNextStep(draft).label}</span>
          <span className="sr-note-meta">
            <Clock3 size={11} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 3 }} />
            {new Date(draft.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 编辑
          </span>
        </span>
        <ChevronRight size={17} strokeWidth={1.6} color="var(--c-icon)" />
      </button>
      <div className="sr-note-foot">
        <span className="sr-note-tools">
          <button type="button" className="sr-btn sr-btn-sm" onClick={() => onOpenDraft(draft.id)}>
            继续
          </button>
          <button type="button" className="sr-note-tool" title="删除草稿" onClick={() => handleDelete(draft)}>
            <Trash2 size={15} strokeWidth={1.7} />
          </button>
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* ① 顶部主操作：开始创作（五步：怎么开始 → 写成什么 → 写什么 → 怎么写 → 参考资料） */}
      <div className="sr-section-label">书桌</div>
      <div className="sr-desk-hero">
        <div className="sr-desk-hero-main">
          <Feather size={20} strokeWidth={1.6} />
          <div>
            <div className="sr-desk-hero-title">开始创作</div>
            <div className="sr-note-meta">选方式、形式、题材、文风和资料，开一本新书</div>
          </div>
        </div>
        <button type="button" className="sr-btn sr-btn-primary sr-desk-start-btn" onClick={() => setStarting({})} aria-haspopup="dialog">
          <Plus size={16} strokeWidth={2} />
          新作品
        </button>
      </div>

      {/* 角色作者：点一位角色，直接进入「开始创作」第二步，并已选好这位角色 */}
      {characters.length > 0 && (
        <>
          <div className="sr-section-label">角色写作</div>
          <div className="sr-desk-cast">
            {characters.map((character) => (
              <button
                key={character.id}
                type="button"
                className="sr-desk-cast-item"
                onClick={() => setStarting({ characterId: character.id })}
                aria-label={`让${character.name}来写`}
                aria-haspopup="dialog"
              >
                <span className="sr-desk-cast-avatar" aria-hidden>
                  {character.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={character.avatar} alt="" />
                  ) : (
                    character.name.slice(0, 1)
                  )}
                </span>
                <span className="sr-desk-cast-name">{character.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {starting && (
        <StudyRoomDeskStart
          characters={characters}
          worldBooks={worldBooks}
          inspirations={inspirations}
          initial={starting}
          onCreate={(draft) => {
            setDrafts(upsertDraft(drafts, draft));
            setStarting(null);
            onOpenDraft(draft.id);
          }}
          onImport={(file) => void importFile(file)}
          onClose={() => setStarting(null)}
        />
      )}

      {notice && (
        <div className="sr-note-card">
          <div className="sr-note-meta">{notice}</div>
        </div>
      )}

      {/* ② 继续创作：主页只放最近一本，其余在「全部作品」里 */}
      <div className="sr-section-label sr-desk-label-row">
        <span>继续创作</span>
        {drafts.length > 1 && (
          <button type="button" className="sr-desk-more" onClick={() => setDrawer("drafts")} aria-haspopup="dialog">
            全部作品 {drafts.length}
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {recent.length === 0 ? (
        <div className="sr-note-card">
          <div className="sr-note-meta">还没有作品，点上面「新作品」开始第一本。</div>
        </div>
      ) : (
        draftCard(recent[0])
      )}

      {/* ③ 今日写作（只有真实数据），压成一行 */}
      <div className="sr-desk-today" role="status">
        <span className="sr-desk-today-label">今日写作</span>
        {stats.hasData ? (
          <span>
            <strong>{stats.words}</strong> 字 · <strong>{stats.projects}</strong> 个项目 · <strong>{stats.chapters}</strong> 章
          </span>
        ) : (
          <span>今天还没写，写下的字会自动计入</span>
        )}
      </div>

      {/* ④ 工具：一屏内的入口格子，点开是底部面板，关掉回到书桌 */}
      <div className="sr-section-label">工具</div>
      <div className="sr-desk-tools">
        {toolTile("note", "灵感便签", inspirations.length > 0 ? `${inspirations.length} 条` : "随手记一句", <Lightbulb size={18} strokeWidth={1.7} />)}
        {toolTile("world", "世界设定", `${worldBooks.length} 本世界书`, <LayoutTemplate size={18} strokeWidth={1.7} />)}
        {toolTile("outline", "大纲", `${outlined.length} 个项目`, <PenLine size={18} strokeWidth={1.7} />)}
        {toolTile("box", "资料盒", `书架 ${books.length} · 想读 ${wishlist.length}`, <BookOpen size={18} strokeWidth={1.7} />)}
        {reading && (
          <button type="button" className="sr-desk-tool" onClick={onOpenNotes} disabled={!onOpenNotes}>
            <StickyNote size={18} strokeWidth={1.7} />
            <span className="sr-desk-tool-name">书摘与批注</span>
            <span className="sr-desk-tool-meta">{reading.noteCount} 条</span>
          </button>
        )}
        {reading && toolTile("bookmarks", "阅读书签", `${reading.bookmarks?.length ?? 0} 个`, <Bookmark size={18} strokeWidth={1.7} />)}
      </div>

      {drawer && (
        <div className="sr-sheet-mask" onClick={() => setDrawer(null)}>
          <div
            className="sr-sheet sr-desk-sheet"
            role="dialog"
            aria-label={DRAWER_TITLE[drawer]}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>{DRAWER_TITLE[drawer]}</span>
              <button type="button" className="sr-icon-btn" onClick={() => setDrawer(null)} aria-label="关闭">
                <X size={18} strokeWidth={1.7} />
              </button>
            </div>
            <div className="sr-desk-sheet-body">
              {drawer === "drafts" && [...drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((draft) => draftCard(draft))}

              {drawer === "note" && (
                <>
                  <div className="sr-appear-row">
                    <input
                      className="sr-appear-input"
                      value={draftNote}
                      onChange={(event) => setDraftNote(event.target.value)}
                      placeholder="记一句灵感…"
                      aria-label="灵感便签"
                    />
                    <button
                      type="button"
                      className="sr-btn sr-btn-sm"
                      disabled={!draftNote.trim()}
                      onClick={() => {
                        setInspirations(addInspiration(draftNote));
                        setDraftNote("");
                      }}
                    >
                      <Plus size={13} strokeWidth={2} />
                      记下
                    </button>
                  </div>
                  {inspirations.length === 0 ? (
                    <p className="sr-note-meta">还没有便签。</p>
                  ) : (
                    inspirations.map((item) => (
                      <div key={item.id} className="sr-inspiration-row">
                        <input
                          className="sr-appear-input"
                          defaultValue={item.text}
                          onBlur={(event) => setInspirations(updateInspiration(item.id, event.target.value))}
                          aria-label="灵感内容"
                        />
                        <button
                          type="button"
                          className="sr-note-tool"
                          title="删除"
                          onClick={() => setInspirations(removeInspiration(item.id))}
                        >
                          <Trash2 size={14} strokeWidth={1.7} />
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}

              {drawer === "world" &&
                (worldBooks.length === 0 ? (
                  <p className="sr-note-meta">宿主里还没有世界书。</p>
                ) : (
                  worldBooks.slice(0, 12).map((book) => (
                    <div key={book.id} className="sr-note-card" style={{ marginBottom: 6 }}>
                      <div className="sr-note-meta" style={{ fontWeight: 600, color: "var(--c-text-title)" }}>{book.name}</div>
                      <div className="sr-note-meta">{book.entries?.length ?? 0} 条设定</div>
                    </div>
                  ))
                ))}

              {drawer === "outline" &&
                (outlined.length === 0 ? (
                  <p className="sr-note-meta">还没有大纲。进项目后可以在「大纲」里写或让 AI 先给一版。</p>
                ) : (
                  outlined.map((d) => (
                    <button key={d.id} type="button" className="sr-drawer-item" onClick={() => onOpenDraft(d.id)}>
                      {d.title.trim() || "未命名作品"}
                      <ChevronRight size={14} strokeWidth={1.8} />
                    </button>
                  ))
                ))}

              {drawer === "box" && (
                <div className="sr-css-actions">
                  <button type="button" className="sr-btn sr-btn-sm" onClick={onOpenWishlist} disabled={!onOpenWishlist}>
                    想读的书（{wishlist.length}）
                  </button>
                  <button type="button" className="sr-btn sr-btn-sm" onClick={onOpenNotes} disabled={!onOpenNotes}>
                    我的笔记
                  </button>
                </div>
              )}

              {drawer === "bookmarks" && reading &&
                (!reading.bookmarks || reading.bookmarks.length === 0 ? (
                  <p className="sr-note-meta">还没有书签。读书时点阅读页顶部的书签按钮，就会出现在这里。</p>
                ) : (
                  reading.bookmarks.slice(0, 30).map((mark) => (
                    <div key={mark.id} className="sr-note-card">
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--c-text-title)" }}>
                        {reading.bookTitles[mark.bookId] ?? "未知书籍"} · 第 {mark.chapterIndex + 1} 章
                      </div>
                      <div className="sr-note-meta" style={{ marginTop: 4 }}>
                        {new Date(mark.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  ))
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
