"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileDown,
  Gift,
  Headphones,
  ImagePlus,
  Link2,
  Loader2,
  MessagesSquare,
  PenLine,
  Quote,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { loadAllAnnotations, loadBookmarks, loadChapters, loadNotes, loadProgress, updateBook } from "@/lib/reading-storage";
import type { Book, ReadingAnnotation, ReadingBookmark, ReadingNote, ReadingProgress } from "@/lib/reading-types";
import { loadCoreadRefs, type CoreadRef } from "@/lib/study-room-coread";
import { loadCharacters } from "@/lib/character-storage";
import { fileToCoverImage, UnsupportedBackgroundError } from "@/lib/study-room/background-image";
import { StudyRoomStageSummary } from "./study-room-stage-summary";
import { GiftSheet } from "./gift-sheet";
import { ShareSheet } from "./share-sheet";
import { shareItemFromBook } from "@/lib/study-room/share-to-chat";
import { StudyRoomReview } from "./study-room-review";
import { HelpTip } from "./help-tip";
import { exportBookAsEpub, safeFileName } from "@/lib/study-room/export-epub";

type StudyRoomBookDetailProps = {
  book: Book;
  onClose: () => void;
  /** 开始/继续阅读；带章节/段落时跳到原文位置 */
  onRead: (book: Book, chapterIndex?: number, paragraphIndex?: number) => void;
  /** 打开阅读器并直接弹出朗读面板 */
  onListen?: (book: Book) => void;
  /** 书的资料（如封面）改了之后通知父组件刷新 */
  onChanged?: (book: Book) => void;
  onOpenMessages: () => void;
  onRemove: (book: Book) => void;
  /** 手动排序时可左右移动 */
  onMove?: (delta: -1 | 1) => void;
  /** 额外入口（如赠书、送礼），由父组件提供 */
  extraActions?: ReactNode;
};

type DetailData = {
  chapterTitles: string[];
  progress: ReadingProgress | null;
  notes: ReadingNote[];
  bookmarks: ReadingBookmark[];
  /** 角色写的批注（只读，可跳回原文） */
  annotations: ReadingAnnotation[];
  coread: Array<CoreadRef & { name: string }>;
};

type DetailTab = "toc" | "notes" | "coread" | "tools";

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "toc", label: "目录" },
  { key: "notes", label: "笔记" },
  { key: "coread", label: "共读" },
  { key: "tools", label: "更多" },
];

const TOC_PREVIEW = 8;
/** 长目录一次只多渲染这么多章，避免上千章全进 DOM */
const TOC_STEP = 60;

export function StudyRoomBookDetail({
  book,
  onClose,
  onRead,
  onListen,
  onChanged,
  onOpenMessages,
  onRemove,
  onMove,
  extraActions,
}: StudyRoomBookDetailProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [tab, setTab] = useState<DetailTab>("toc");
  const [tocLimit, setTocLimit] = useState(TOC_PREVIEW);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [gifting, setGifting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [review, setReview] = useState<"quick" | "fine" | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverUrlError, setCoverUrlError] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setTocLimit(TOC_PREVIEW);
    void (async () => {
      const [chapters, progress, notes, bookmarks, allAnnotations] = await Promise.all([
        loadChapters(book.id).catch(() => []),
        loadProgress(book.id).catch(() => null),
        loadNotes(book.id).catch(() => []),
        loadBookmarks(book.id).catch(() => []),
        loadAllAnnotations().catch(() => []),
      ]);
      if (cancelled) return;
      const characters = loadCharacters();
      const coread = loadCoreadRefs()
        .filter((ref) => ref.bookId === book.id)
        .map((ref) => ({ ...ref, name: characters.find((c) => c.id === ref.characterId)?.name ?? "未知角色" }));
      setData({
        chapterTitles: chapters.map((c) => c.title),
        progress,
        notes: [...notes].sort((a, b) => (a.chapterIndex - b.chapterIndex) || (a.paragraphIndex - b.paragraphIndex)),
        bookmarks,
        annotations: allAnnotations
          .filter((item) => item.bookId === book.id)
          .sort((a, b) => (a.chapterIndex - b.chapterIndex) || (a.paragraphIndex - b.paragraphIndex)),
        coread,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // 换了封面要重新尝试加载
  useEffect(() => {
    setCoverFailed(false);
  }, [book.cover]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = data?.chapterTitles.length ?? book.totalChapters;
  const progress = data?.progress ?? null;
  const started = Boolean(progress && progress.lastReadAt);
  // 真实进度：按「已读章节 + 本章滚动比例」折算，不估算阅读时长
  const percent = useMemo(() => {
    if (!progress || total <= 0) return 0;
    const inChapter = progress.readingMode === "scroll" ? Math.min(Math.max(progress.scrollPosition, 0), 1) : 0;
    return Math.min(100, Math.round(((progress.chapterIndex + inChapter) / total) * 100));
  }, [progress, total]);

  const saveBook = async (next: Book, message: string) => {
    try {
      await updateBook(next);
      onChanged?.(next);
      setNotice(message);
    } catch {
      setNotice("保存失败，请稍后重试。");
    }
  };

  /** 换封面：只压缩存在本机；第一次换时记下原封面，之后可以恢复 */
  const handleCoverFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCoverBusy(true);
    setNotice(null);
    try {
      const cover = await fileToCoverImage(file);
      setCoverFailed(false);
      await saveBook({ ...book, cover, originalCover: book.originalCover ?? book.cover ?? "" }, "封面已更换。");
      setCoverOpen(false);
    } catch (error) {
      setNotice(error instanceof UnsupportedBackgroundError ? error.message : "这张图片读不出来，换一张试试。");
    } finally {
      setCoverBusy(false);
    }
  };

  /** 用图片直链当封面：只接受 https，先确认真能加载成图片再保存 */
  const applyCoverUrl = async () => {
    setCoverUrlError(null);
    let parsed: URL;
    try {
      parsed = new URL(coverUrl.trim());
    } catch {
      setCoverUrlError("这不是有效的链接。");
      return;
    }
    if (parsed.protocol !== "https:") {
      setCoverUrlError("请用 https 开头的图片链接。");
      return;
    }
    setCoverBusy(true);
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => resolve(false), 10000);
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(img.naturalWidth > 0);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(false);
      };
      img.src = parsed.href;
    });
    if (!ok) {
      setCoverBusy(false);
      setCoverUrlError("这个链接打不开图片：可能不是图片直链，或对方不允许外链。");
      return;
    }
    setCoverFailed(false);
    await saveBook({ ...book, cover: parsed.href, originalCover: book.originalCover ?? book.cover ?? "" }, "封面已更换。");
    setCoverBusy(false);
    setCoverUrl("");
    setCoverOpen(false);
  };

  const restoreCover = () => {
    const next: Book = { ...book, cover: book.originalCover || undefined };
    delete next.originalCover;
    void saveBook(next, book.originalCover ? "已恢复原封面。" : "已改回文字封面。");
  };

  /** 导出这本为 EPUB：正文按章重建，批注用高亮＋附录两种方式带上。 */
  const handleExportEpub = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const result = await exportBookAsEpub(book);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFileName(book.title) + ".epub";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出 ${result.chapters} 章、${result.notes + result.annotations} 条批注${result.cover ? "，含封面" : ""}。`);
    } catch {
      setNotice("导出失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  };

  const toc = data ? data.chapterTitles.slice(0, tocLimit) : [];
  const cover = book.cover && !coverFailed ? book.cover : undefined;
  const noteCount = data ? data.notes.length + data.bookmarks.length + data.annotations.length : 0;

  return (
    <div className="sr-detail-mask" onClick={onClose}>
      <section
        className="sr-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`《${book.title}》详情`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sr-detail-grip" aria-hidden />
        <button type="button" className="sr-icon-btn sr-detail-close" onClick={onClose} aria-label="关闭详情，把书放回书架">
          <X size={20} strokeWidth={1.7} />
        </button>

        <div className="sr-detail-head">
          <div className="sr-detail-cover" data-fallback={cover ? undefined : "true"}>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={`《${book.title}》封面`} onError={() => setCoverFailed(true)} />
            ) : (
              // 没有封面：用书名和作者排一张文字封面
              <>
                <span className="sr-detail-cover-title">{book.title}</span>
                {book.author && <span className="sr-detail-cover-tag">{book.author}</span>}
              </>
            )}
          </div>
          <div className="sr-detail-info">
            <h2 className="sr-detail-title">{book.title}</h2>
            <div className="sr-detail-author">{book.author || "作者未知"}</div>
            <div className="sr-detail-meta">
              {book.format.toUpperCase()} · {total} 章
              {book.sourceLabel ? ` · 来自 ${book.sourceLabel}` : ""}
            </div>
            {book.tags && book.tags.length > 0 && (
              <div className="sr-detail-tags">
                {book.tags.slice(0, 6).map((tag) => <span key={tag} className="sr-detail-tag">{tag}</span>)}
              </div>
            )}
            <div className="sr-detail-progress" aria-label={`阅读进度 ${percent}%`}>
              <div className="sr-progress"><i style={{ width: `${percent}%` }} /></div>
              <span>{started ? `已读 ${percent}%` : "未开始"}</span>
            </div>
          </div>
        </div>

        {book.description?.trim() && (
          <div className="sr-detail-synopsis">
            <p className="sr-detail-desc" data-open={descOpen ? "true" : undefined}>
              {book.description.trim()}
            </p>
            {book.description.trim().length > 90 && (
              <button type="button" className="sr-btn-text sr-detail-desc-more" onClick={() => setDescOpen((v) => !v)} aria-expanded={descOpen}>
                {descOpen ? "收起" : "展开简介"}
              </button>
            )}
          </div>
        )}

        <div className="sr-detail-actions">
          <button type="button" className="sr-btn sr-btn-primary" onClick={() => onRead(book)}>
            <BookOpen size={18} strokeWidth={1.7} />
            {started ? `继续阅读${progress ? ` · 第 ${progress.chapterIndex + 1} 章` : ""}` : "开始阅读"}
          </button>
          {onListen && (
            <button type="button" className="sr-btn" onClick={() => onListen(book)}>
              <Headphones size={17} strokeWidth={1.7} />
              朗读
            </button>
          )}
          <button
            type="button"
            className="sr-btn"
            onClick={() => setCoverOpen((v) => !v)}
            aria-expanded={coverOpen}
            data-active={coverOpen ? "true" : undefined}
          >
            <ImagePlus size={17} strokeWidth={1.7} />
            封面
          </button>
        </div>

        {coverOpen && (
          <div className="sr-detail-cover-panel">
            <div className="sr-detail-cover-row">
              <button type="button" className="sr-btn" onClick={() => coverInputRef.current?.click()} disabled={coverBusy}>
                {coverBusy ? <Loader2 size={16} className="sr-spin" /> : <ImagePlus size={16} strokeWidth={1.8} />}
                从相册上传
              </button>
              {book.originalCover !== undefined && (
                <button type="button" className="sr-btn" onClick={restoreCover} disabled={coverBusy}>
                  <RotateCcw size={16} strokeWidth={1.8} />
                  {book.originalCover ? "恢复原封面" : "改回文字封面"}
                </button>
              )}
            </div>
            <form
              className="sr-detail-cover-url"
              onSubmit={(event) => {
                event.preventDefault();
                void applyCoverUrl();
              }}
            >
              <Link2 size={16} strokeWidth={1.8} aria-hidden />
              <input
                type="url"
                inputMode="url"
                value={coverUrl}
                onChange={(event) => {
                  setCoverUrl(event.target.value);
                  setCoverUrlError(null);
                }}
                placeholder="或粘贴图片直链（https）"
                aria-label="封面图片链接"
              />
              <button type="submit" className="sr-btn sr-btn-sm" disabled={!coverUrl.trim() || coverBusy}>
                使用
              </button>
            </form>
            {coverUrlError && <p className="sr-detail-cover-error" role="alert">{coverUrlError}</p>}
            <input ref={coverInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" hidden onChange={handleCoverFile} />
          </div>
        )}
        {extraActions && <div className="sr-detail-extra">{extraActions}</div>}
        {notice && (
          <p className="sr-detail-notice" role="status">
            {notice}
          </p>
        )}

        <div className="sr-sort sr-detail-tabs" role="tablist" aria-label="书籍详情分区">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              data-active={tab === item.key ? "true" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {item.key === "notes" && noteCount > 0 ? ` ${noteCount}` : ""}
            </button>
          ))}
        </div>

        <div className="sr-detail-scroll" role="tabpanel">
          {tab === "toc" && (
            <>
              <h3 className="sr-detail-h">目录</h3>
              {data === null ? (
                <div aria-label="正在读取目录">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="sr-skeleton sr-skeleton-line" style={{ margin: "12px 0", width: `${86 - i * 14}%` }} />
                  ))}
                </div>
              ) : data.chapterTitles.length === 0 ? (
                <p className="sr-detail-muted">这本书没有可识别的章节。</p>
              ) : (
                <ol className="sr-detail-toc">
                  {toc.map((title, index) => (
                    <li key={index}>
                      <button type="button" onClick={() => onRead(book, index, 0)} data-current={progress?.chapterIndex === index ? "true" : undefined}>
                        <span className="sr-detail-toc-no">{index + 1}</span>
                        <span className="sr-detail-toc-title">{title || `第 ${index + 1} 章`}</span>
                      </button>
                    </li>
                  ))}
                  {data.chapterTitles.length > TOC_PREVIEW && (
                    <li>
                      {tocLimit < data.chapterTitles.length ? (
                        <button
                          type="button"
                          className="sr-detail-more"
                          onClick={() => setTocLimit((limit) => Math.min(limit + TOC_STEP, data.chapterTitles.length))}
                        >
                          再看 {Math.min(TOC_STEP, data.chapterTitles.length - tocLimit)} 章（共 {data.chapterTitles.length} 章）
                        </button>
                      ) : (
                        <button type="button" className="sr-detail-more" onClick={() => setTocLimit(TOC_PREVIEW)}>
                          收起目录
                        </button>
                      )}
                    </li>
                  )}
                </ol>
              )}
            </>
          )}

          {tab === "notes" && (
            <>
              <h3 className="sr-detail-h">
                我的笔记与划线
                <HelpTip id="detail-notes" label="怎么记笔记">
                  阅读时选中文字，就能划线、书摘或写批注；点这里的条目会跳回原文位置。
                </HelpTip>
              </h3>
              {data === null ? null : data.notes.length === 0 && data.bookmarks.length === 0 ? (
                <p className="sr-detail-muted">还没有笔记。</p>
              ) : (
                <ul className="sr-detail-notes">
                  {data.bookmarks.map((mark) => (
                    <li key={mark.id}>
                      <button type="button" onClick={() => onRead(book, mark.chapterIndex, mark.paragraphIndex)}>
                        <Bookmark size={14} strokeWidth={1.8} />
                        <span className="sr-detail-note-text">书签 · {data.chapterTitles[mark.chapterIndex] || `第 ${mark.chapterIndex + 1} 章`}</span>
                      </button>
                    </li>
                  ))}
                  {data.notes.map((note) => (
                    <li key={note.id}>
                      <button type="button" onClick={() => onRead(book, note.chapterIndex, note.paragraphIndex)}>
                        {note.kind === "note" ? <PenLine size={14} strokeWidth={1.8} /> : <Quote size={14} strokeWidth={1.8} />}
                        <span className="sr-detail-note-text">
                          {note.emoji ? `${note.emoji} ` : null}
                          「{note.quote.length > 40 ? `${note.quote.slice(0, 40)}…` : note.quote}」
                          {note.content ? <em> {note.content}</em> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {data !== null && data.annotations.length > 0 && (
                <>
                  <h3 className="sr-detail-h">角色批注</h3>
                  <ul className="sr-detail-notes">
                    {data.annotations.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => onRead(book, item.chapterIndex, item.paragraphIndex)}>
                          <MessagesSquare size={14} strokeWidth={1.8} />
                          <span className="sr-detail-note-text">
                            {item.emoji ? `${item.emoji} ` : null}
                            <strong>{item.characterName}</strong>：{item.content.length > 46 ? `${item.content.slice(0, 46)}…` : item.content}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === "coread" && (
            <>
              <h3 className="sr-detail-h">
                共读记录
                <HelpTip id="detail-coread" label="怎么共读">
                  阅读时点右上角的共读按钮，选一位角色一起读；记录会出现在这里。
                </HelpTip>
              </h3>
              {data === null ? null : data.coread.length === 0 ? (
                <p className="sr-detail-muted">还没有和角色共读这本书。</p>
              ) : (
                <ul className="sr-detail-notes">
                  {data.coread.map((ref) => (
                    <li key={ref.sessionId}>
                      <button type="button" onClick={onOpenMessages}>
                        <MessagesSquare size={14} strokeWidth={1.8} />
                        <span className="sr-detail-note-text">与 {ref.name} 共读 · {new Date(ref.updatedAt).toLocaleDateString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <StudyRoomStageSummary book={book} onOpenChapter={(chapterIndex) => onRead(book, chapterIndex, 0)} />

              <div className="sr-detail-footer">
                <button type="button" className="sr-btn" onClick={() => setReview("quick")}>
                  快速回顾
                </button>
                <button type="button" className="sr-btn" onClick={() => setReview("fine")}>
                  精细回顾
                </button>
              </div>
            </>
          )}

          {tab === "tools" && (
            <>
              <h3 className="sr-detail-h">分享与导出</h3>
              <div className="sr-detail-footer" style={{ marginTop: 0 }}>
                <button type="button" className="sr-btn" onClick={() => setSharing(true)}>
                  <Send size={16} strokeWidth={1.8} />
                  分享给好友
                </button>
                <button type="button" className="sr-btn" onClick={() => setGifting(true)}>
                  <Gift size={16} strokeWidth={1.7} />
                  赠书 / 送礼
                </button>
                <button type="button" className="sr-btn" onClick={() => void handleExportEpub()} disabled={exporting}>
                  {exporting ? <Loader2 size={16} className="sr-spin" /> : <FileDown size={16} strokeWidth={1.8} />}
                  导出 EPUB
                </button>
                <HelpTip id="export-epub" label="导出说明">
                  导出会用书房保存的正文重建一本 EPUB，带上封面与批注（批注以高亮加末尾附录呈现），
                  文件直接下载到你的设备，不上传。原书里内嵌的插图不在书房正文数据里，导出文件里不会出现。
                </HelpTip>
                {book.sourceUrl && (
                  <a className="sr-btn" href={book.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={16} strokeWidth={1.8} /> 来源页
                  </a>
                )}
              </div>

              <h3 className="sr-detail-h">书架</h3>
              <div className="sr-detail-footer" style={{ marginTop: 0 }}>
                {onMove && (
                  <>
                    <button type="button" className="sr-btn" onClick={() => onMove(-1)} aria-label="在书架上左移一格">
                      <ChevronLeft size={16} strokeWidth={1.8} /> 左移
                    </button>
                    <button type="button" className="sr-btn" onClick={() => onMove(1)} aria-label="在书架上右移一格">
                      右移 <ChevronRight size={16} strokeWidth={1.8} />
                    </button>
                  </>
                )}
                <button type="button" className="sr-btn sr-btn-danger" onClick={() => onRemove(book)}>
                  <Trash2 size={16} strokeWidth={1.8} /> 移出书架
                </button>
              </div>
            </>
          )}
        </div>

        {review && (
          <StudyRoomReview book={book} onRead={onRead} onClose={() => setReview(null)} />
        )}

        {sharing && <ShareSheet item={shareItemFromBook(book)} onClose={() => setSharing(false)} />}

        {gifting && (
          <GiftSheet
            mode="both"
            book={{ id: book.id, title: book.title }}
            onClose={() => setGifting(false)}
          />
        )}
      </section>
    </div>
  );
}
