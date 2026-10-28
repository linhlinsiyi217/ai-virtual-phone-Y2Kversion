"use client";

import { useRef, useState } from "react";
import { BookOpen, Compass, Download, Eye, Heart, Loader2, Upload, X } from "lucide-react";

import type { Book } from "@/lib/reading-types";
import { importBookFromBlob, UnsupportedBookFormatError } from "@/lib/study-room/import";
import { importSearchResult, SourceImportError } from "@/lib/study-room/import-result";
import { announceImported } from "@/lib/study-room/events";
import {
  CATEGORY_LABEL,
  editionLanguageLabel,
  READABILITY_LABEL,
  type BookSearchResult,
} from "@/lib/study-room/book-source";
import { addToWishlist, isWished, removeFromWishlist } from "@/lib/study-room/wishlist";

type StudyRoomSourceDetailProps = {
  item: BookSearchResult;
  /** 同一本书的其它版本（来源 / 语言 / 年份不同） */
  versions?: BookSearchResult[];
  onClose: () => void;
  /** 导入或已在书架后打开阅读 */
  onRead: (book: Book) => void;
  /** 切换到另一个版本 */
  onSwitch?: (item: BookSearchResult) => void;
};

/**
 * 统一的来源书籍详情：无论从书城还是「抽一本」进来，都在这里看信息、选版本、
 * 再决定阅读 / 预览 / 导入 / 记下想读。只有真的能读的书才有「开始阅读」。
 */
export function StudyRoomSourceDetail({ item, versions = [], onClose, onRead, onSwitch }: StudyRoomSourceDetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [wished, setWished] = useState(() => isWished(item.id));
  const fileRef = useRef<HTMLInputElement>(null);

  const importSource = async (): Promise<Book | null> => {
    if (!item.importFile) return null;
    setBusy("import");
    setNotice(null);
    try {
      const { book, existed } = await importSearchResult(item, (stage) => setNotice(stage));
      setNotice(existed ? `《${book.title}》已经在书架上，直接打开。` : `《${item.title}》已加入书架`);
      if (!existed) announceImported(book.title);
      return book;
    } catch (error) {
      setNotice(
        error instanceof UnsupportedBookFormatError || error instanceof SourceImportError
          ? error.message
          : "取正文失败，可能是来源暂时不可用，稍后再试。",
      );
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleRead = async () => {
    const book = await importSource();
    if (book) onRead(book);
  };

  const handleLocalFile = async (file: File) => {
    setBusy("local");
    setNotice(null);
    try {
      const book = await importBookFromBlob(file, file.name, undefined, item.cover);
      setNotice(`《${book.title}》已加入书架`);
      announceImported(book.title);
      onRead(book);
    } catch (error) {
      setNotice(error instanceof UnsupportedBookFormatError ? error.message : "这个文件读不了，请换一个试试。");
    } finally {
      setBusy(null);
    }
  };

  const toggleWish = () => {
    if (wished) {
      removeFromWishlist(item.id);
      setWished(false);
    } else {
      addToWishlist(item);
      setWished(true);
    }
  };

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div className="sr-sheet sr-sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sr-gift-head">
          <span className="sr-sheet-label" style={{ margin: 0 }}>
            {READABILITY_LABEL[item.readability]}
          </span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <div className="sr-src-head">
          <div className="sr-src-cover" data-fallback={item.cover ? undefined : "true"}>
            {item.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.cover} alt="" />
            ) : (
              <span>{(item.title || "书").slice(0, 1)}</span>
            )}
          </div>
          <div className="sr-src-main">
            <h3 className="sr-src-title">{item.title}</h3>
            <div className="sr-note-meta">{item.authors.join(" / ") || "佚名"}</div>
            <div className="sr-src-tags">
              <span className="sr-src-tag">{item.sourceLabel}</span>
              {item.category && <span className="sr-src-tag">{CATEGORY_LABEL[item.category]}</span>}
              {item.year && <span className="sr-src-tag">{item.year}</span>}
              {item.language && <span className="sr-src-tag">{editionLanguageLabel(item.language)}</span>}
            </div>
          </div>
        </div>

        {item.description && <p className="sr-src-desc">{item.description}</p>}

        <p className="sr-note-meta" style={{ lineHeight: 1.75 }}>
          {item.importFile?.format === "builtin"
            ? "书房内置的公版原文，随应用提供，不依赖联网来源。加入书架后可以全文阅读、批注与共读。"
            : item.readability === "readable"
            ? "来源提供可下载的正文，导入后可以在书房里全文阅读、批注与共读。"
            : item.readability === "preview"
              ? "来源提供在线预览。预览由来源决定能否在应用内显示；看不清时可以到原站查看。"
              : item.readability === "import"
                ? "书房拿不到这本书的正文，只有书目信息。如果你自己有文件，可以导入后阅读。"
                : "这是资料类条目（公告、判决、书目等），不提供正文阅读。"}
        </p>

        {notice && (
          <div className="sr-note-card">
            <div className="sr-note-meta">{notice}</div>
          </div>
        )}

        <div className="sr-css-actions" style={{ marginTop: 4 }}>
          {item.readability === "readable" && (
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => void handleRead()} disabled={busy !== null}>
              {busy === "import" ? <Loader2 size={15} className="sr-spin" /> : <BookOpen size={15} strokeWidth={1.8} />}
              开始阅读
            </button>
          )}
          {item.readability === "preview" && (
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => setPreview(true)}>
              <Eye size={15} strokeWidth={1.8} />
              应用内预览
            </button>
          )}
          {item.readability === "import" && (
            <>
              <button
                type="button"
                className="sr-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === "local" ? <Loader2 size={15} className="sr-spin" /> : <Upload size={15} strokeWidth={1.8} />}
                导入我的文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.epub,.pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleLocalFile(file);
                }}
              />
            </>
          )}
          <button type="button" className="sr-chip" onClick={toggleWish} data-active={wished ? "true" : undefined}>
            <Heart size={13} strokeWidth={1.8} fill={wished ? "currentColor" : "none"} />
            {wished ? "已记在想读" : "记下想读"}
          </button>
          <a className="sr-btn sr-btn-sm" href={item.externalUrl} target="_blank" rel="noopener noreferrer">
            <Compass size={13} strokeWidth={1.8} />
            前往原站
          </a>
        </div>

        {versions.length > 0 && (
          <>
            <div className="sr-section-label" style={{ marginTop: 12 }}>
              同一本书的其它版本（{versions.length}）
            </div>
            <ul className="sr-src-versions">
              {versions.map((version) => (
                <li key={version.id}>
                  <button type="button" onClick={() => onSwitch?.(version)}>
                    <span className="sr-src-version-title">{version.title}</span>
                    <span className="sr-note-meta">
                      {[version.sourceLabel, version.language && editionLanguageLabel(version.language), version.year, READABILITY_LABEL[version.readability]]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="sr-note-meta" style={{ marginTop: 8, lineHeight: 1.7 }}>
          <Download size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 4 }} />
          书房只保存来源公开提供的书目与公版正文；现代版权书不会伪造正文。
        </p>
      </div>

      {preview && (
        <div className="sr-sheet-mask sr-src-preview-mask" onClick={() => setPreview(false)}>
          <div className="sr-sheet sr-src-preview" onClick={(e) => e.stopPropagation()}>
            <div className="sr-gift-head">
              <span className="sr-sheet-label" style={{ margin: 0 }}>
                预览《{item.title}》
              </span>
              <a className="sr-btn sr-btn-sm" href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                在新窗口打开
              </a>
            </div>
            <p className="sr-note-meta" style={{ marginBottom: 6 }}>
              预览由来源提供，部分来源不允许在应用内显示；如果这里是空白，请点右上角到原站看。
            </p>
            <iframe className="sr-src-frame" src={item.externalUrl} title={`预览 ${item.title}`} loading="lazy" />
          </div>
        </div>
      )}
    </div>
  );
}
