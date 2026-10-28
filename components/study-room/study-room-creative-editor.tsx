"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  FileDown,
  ListChecks,
  Lightbulb,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import { loadApiConfigs } from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import { loadBooks } from "@/lib/reading-storage";
import { simpleLLMCall } from "@/lib/api-helpers";
import { fileToBackgroundImage, UnsupportedBackgroundError } from "@/lib/study-room/background-image";
import { addInspiration, loadInspirations, removeInspiration, type InspirationNote } from "@/lib/study-room/inspiration";
import { exportDraftAsEpub } from "@/lib/study-room/export-epub";
import {
  STRENGTH_LABEL as STYLE_STRENGTH_LABEL,
  addUserStyle,
  composeUserStyleBlock,
  fetchBuiltinStyles,
  loadUserStyles,
  removeUserStyle,
  requestStyledText,
  type StyleMeta,
  type StyleStrength,
  type UserStyle,
} from "@/lib/study-room/writing-styles-client";
import type { Book } from "@/lib/reading-types";
import {
  CREATIVE_TEMPLATES,
  WORK_KIND_LABEL,
  buildChapterBrief,
  buildChapterMemoryPrompt,
  buildChapterPrompt,
  buildContinuityReviewPrompt,
  draftNextStep,
  draftWordCount,
  generateChapter,
  generateOutline,
  loadDrafts,
  makeChapter,
  parseChapterMemory,
  parseChapterOutput,
  parseContinuityReview,
  publishDraft,
  resolveWriterApiConfig,
  resolveWriterConfig,
  toParagraphs,
  upsertDraft,
  wordCount,
  type CreativeChapter,
  type CreativeDraft,
  type WorkKind,
} from "@/lib/study-room/creative";
import { HelpFoot, HelpTip } from "./help-tip";
import { WorldBookPicker } from "./study-room-worldbook-picker";

type StudyRoomCreativeEditorProps = {
  draftId: string;
  onBack: () => void;
  onOpenBook: (book: Book) => void;
};

type Section = "overview" | "outline" | "write" | "setting" | "material" | "proof" | "layout" | "export";

type BusyState =
  | { kind: "idle" }
  | { kind: "outline" }
  | { kind: "chapter"; chapterNumber: number }
  | { kind: "memory"; chapterId: string }
  | { kind: "review"; chapterId: string }
  | { kind: "proof" }
  | { kind: "publish" }
  | { kind: "export" };

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "overview", label: "总览" },
  { key: "outline", label: "大纲" },
  { key: "write", label: "写作" },
  { key: "setting", label: "设定" },
  { key: "material", label: "素材" },
  { key: "proof", label: "校对" },
  { key: "layout", label: "排版" },
  { key: "export", label: "导出" },
];

/**
 * 创作工作台：总览 / 大纲 / 写作 / 设定 / 素材 / 校对 / 排版 / 导出。
 * 两条路线：角色卡创作（用宿主角色当作者）与专业写作助手（内部职责分工，界面上只有一位助手）。
 * 每章结束可生成结构化记忆，下一章只带需要的那部分，避免长篇失忆。
 */
export function StudyRoomCreativeEditor({ draftId, onBack, onOpenBook }: StudyRoomCreativeEditorProps) {
  const [, setDrafts] = useState<CreativeDraft[]>(() => loadDrafts());
  const [draft, setDraft] = useState<CreativeDraft | null>(
    () => loadDrafts().find((item) => item.id === draftId) ?? null,
  );
  const [section, setSection] = useState<Section>("overview");
  const [busy, setBusy] = useState<BusyState>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [openChapterId, setOpenChapterId] = useState<string | null>(null);
  const [proofLines, setProofLines] = useState<string[] | null>(null);
  const [inspirations, setInspirations] = useState<InspirationNote[]>(() => loadInspirations().filter((item) => item.draftId === draftId));
  const [noteDraft, setNoteDraft] = useState("");
  // 文风：内置四套（规则在服务端）与用户自建（规则存本机）
  const [builtinStyles, setBuiltinStyles] = useState<StyleMeta[]>([]);
  const [userStyles, setUserStyles] = useState<UserStyle[]>(() => loadUserStyles());
  const [stylePreview, setStylePreview] = useState<{ styleId: string; text: string } | null>(null);
  const [previewingStyle, setPreviewingStyle] = useState<string | null>(null);
  const [newStyle, setNewStyle] = useState({ name: "", summary: "", rules: "" });
  const abortRef = useRef<AbortController | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const characters = useMemo(() => loadCharacters().map((c) => ({ id: c.id, name: c.name })), []);
  const apiConfigs = useMemo(() => loadApiConfigs().map((c) => ({ id: c.id, name: c.name || c.defaultModel })), []);
  const shelf = useMemo(() => loadBooks(), []);

  const flash = useCallback((message: string, ms = 2400) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), ms);
  }, []);

  const update = useCallback((patch: Partial<CreativeDraft>, persist = true) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      if (persist) {
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          setDrafts((list) => upsertDraft(list, next));
        }, 500);
      }
      return next;
    });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBuiltinStyles(controller.signal).then((list) => {
      if (!controller.signal.aborted) setBuiltinStyles(list);
    });
    return () => controller.abort();
  }, []);

  const stopGeneration = () => abortRef.current?.abort();

  /** 生成一章正文；写完顺带生成该章的结构化记忆（模型不可用就留空，可手动补）。 */
  const runChapter = async (chapterNumber: number, replaceId?: string) => {
    if (!draft) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy({ kind: "chapter", chapterNumber });
    try {
      let result: { title: string; content: string };
      const styleBlock = activeStyleBlock();
      const activeConfig = resolveWriterApiConfig(draft);
      if (draft.styleId && !draft.userStyleId && activeConfig) {
        // 内置文风：交给服务端组词（完整规则不下发到浏览器）
        const styled = await requestStyledText({
          task: "chapter",
          styleId: draft.styleId,
          strength: draft.styleStrength ?? "standard",
          brief: buildChapterBrief(draft, chapterNumber),
          chapterNumber,
          targetWords: draft.targetWords,
          apiConfig: activeConfig,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if ("error" in styled) throw new Error(styled.error);
        result = parseChapterOutput(styled.text, chapterNumber);
      } else if (styleBlock && activeConfig) {
        // 自建文风：规则是用户自己的文字，本机组合后调用同一个模型
        const base = buildChapterPrompt(draft, chapterNumber);
        const response = await simpleLLMCall(
          activeConfig,
          [{ role: "user", content: `${styleBlock}\n\n${base}` }],
          { temperature: 0.85, max_tokens: Math.min(Math.max((draft.targetWords ?? 2000) * 2, 800), 8000), signal: controller.signal, label: "studyroom-chapter-styled-local" },
        );
        if (controller.signal.aborted) return;
        if (response.error || !response.content) throw new Error(response.error || "模型没有返回内容");
        result = parseChapterOutput(response.content, chapterNumber);
      } else {
        result = await generateChapter(draft, chapterNumber, controller.signal);
      }
      if (controller.signal.aborted) return;
      const chapter = makeChapter(result.title, result.content);
      const nextChapters = replaceId
        ? draft.chapters.map((item) => (item.id === replaceId ? { ...chapter, id: replaceId } : item))
        : [...draft.chapters, chapter];
      update({ chapters: nextChapters });
      setOpenChapterId(replaceId ?? chapter.id);
      flash(`第 ${chapterNumber} 章已写好，可以自己改`);
      // 章末记忆（失败不影响正文）
      void runChapterMemory(chapter);
    } catch (err) {
      if ((err as Error).name === "AbortError") flash("已停止生成，已完成的内容不受影响");
      else flash((err as Error).message || "生成失败，请重试", 3200);
    } finally {
      setBusy((prev) => (prev.kind === "chapter" ? { kind: "idle" } : prev));
    }
  };

  /** 章末结构化记忆：只发这一章，返回固定字段，存回该章。 */
  const runChapterMemory = async (chapter: CreativeChapter) => {
    if (!draft) return;
    // 以前作品没单独指定模型时会静默跳过，记忆永远生成不出来；现在跟正文生成用同一份配置
    const config = resolveWriterApiConfig(draft);
    if (!config) return;
    setBusy({ kind: "memory", chapterId: chapter.id });
    try {
      const result = await simpleLLMCall(config, [{ role: "user", content: buildChapterMemoryPrompt(draft, chapter) }], {
        temperature: 0.4,
        max_tokens: 700,
        label: "studyroom-chapter-memory",
      });
      const memory = result.content ? parseChapterMemory(result.content) : null;
      if (!memory) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          chapters: prev.chapters.map((item) => (item.id === chapter.id ? { ...item, memory } : item)),
        };
        setDrafts((list) => upsertDraft(list, next));
        return next;
      });
    } catch {
      // 记忆失败不打扰写作；界面上该章会显示「未生成记忆」
    } finally {
      setBusy((prev) => (prev.kind === "memory" && prev.chapterId === chapter.id ? { kind: "idle" } : prev));
    }
  };

  /** 连贯检查：对照大纲、前文记忆与上一章结尾，挑这一章的前后矛盾，结果存回该章。 */
  const runContinuityReview = async (chapter: CreativeChapter) => {
    if (!draft || busy.kind !== "idle") return;
    const config = resolveWriterApiConfig(draft);
    if (!config) {
      flash("还没有可用的模型：先在设置里绑定 API", 3200);
      return;
    }
    if (!chapter.content.trim()) {
      flash("这一章还没有正文，写完再检查");
      return;
    }
    setBusy({ kind: "review", chapterId: chapter.id });
    try {
      const result = await simpleLLMCall(config, [{ role: "user", content: buildContinuityReviewPrompt(draft, chapter.id) }], {
        temperature: 0.3,
        max_tokens: 800,
        label: "studyroom-continuity-review",
      });
      if (result.error || !result.content?.trim()) throw new Error(result.error || "没有返回内容");
      const review = parseContinuityReview(result.content);
      setDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev, chapters: prev.chapters.map((item) => (item.id === chapter.id ? { ...item, review } : item)) };
        setDrafts((list) => upsertDraft(list, next));
        return next;
      });
      flash(review.issues.length === 0 ? "没查出明显的前后矛盾" : `查出 ${review.issues.length} 处可以看看`);
    } catch (error) {
      flash(error instanceof Error && error.message ? `连贯检查没完成：${error.message}` : "连贯检查没完成，稍后再试", 3400);
    } finally {
      setBusy((prev) => (prev.kind === "review" ? { kind: "idle" } : prev));
    }
  };

  /** 校对：让助手挑一致性问题（只给建议，不自动改稿）。 */
  const runProofread = async () => {
    if (!draft) return;
    const config = resolveWriterApiConfig(draft);
    if (!config) {
      flash("还没有可用的模型：先在设置里绑定 API，或用「校对」里的手动清单自查", 3400);
      return;
    }
    setBusy({ kind: "proof" });
    setProofLines(null);
    try {
      const body = draft.chapters
        .slice(-4)
        .map((chapter) => `【${chapter.title}】\n${chapter.content.slice(0, 2000)}`)
        .join("\n\n");
      const result = await simpleLLMCall(
        config,
        [
          {
            role: "user",
            content: [
              "你是长篇写作的连续性校对。读下面几章，只挑「前后矛盾、人物状态跳变、时间地点冲突、伏笔断了」的问题。",
              "每行一条，格式：问题 → 建议。不要夸奖，不要重写正文，最多 8 条。",
              "",
              `书名：${draft.title || "（未定）"}`,
              draft.outline ? `大纲：${draft.outline.slice(0, 600)}` : "",
              "",
              body,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        { temperature: 0.4, max_tokens: 900, label: "studyroom-proofread" },
      );
      const text = result.content?.trim();
      if (!text) throw new Error("没有返回内容");
      setProofLines(text.split("\n").map((line) => line.replace(/^[-*\d.、\s]+/, "").trim()).filter(Boolean));
    } catch {
      flash("这次没检查出来（可能是模型不可用），稍后再试", 3200);
    } finally {
      setBusy({ kind: "idle" });
    }
  };

  const handlePublish = async () => {
    if (!draft) return;
    setBusy({ kind: "publish" });
    try {
      const book = await publishDraft(draft);
      update({ publishedBookId: book.id });
      flash(`《${book.title}》已加入书架`, 3000);
    } catch (err) {
      flash(err instanceof Error ? err.message : "发布失败", 3200);
    } finally {
      setBusy({ kind: "idle" });
    }
  };

  const handleExport = async () => {
    if (!draft) return;
    setBusy({ kind: "export" });
    try {
      const result = await exportDraftAsEpub(draft);
      flash(`已导出 ${result.chapters} 章${result.memories > 0 ? `、含 ${result.memories} 条章末记忆附录` : ""}`, 3600);
    } catch {
      flash("导出失败，请稍后重试", 3000);
    } finally {
      setBusy({ kind: "idle" });
    }
  };

  /** 当前写作要用的规则块：内置走服务端，自建在本机组合。 */
  const activeStyleBlock = (): string | null => {
    if (!draft) return null;
    const userStyle = userStyles.find((item) => item.id === draft.userStyleId);
    if (userStyle) return composeUserStyleBlock(userStyle, draft.styleStrength ?? "standard");
    return null;
  };

  /** 试写预览：内置文风交给服务端组词，返回的只有正文。 */
  const runStylePreview = async (styleId: string) => {
    if (!draft) return;
    const config = resolveWriterApiConfig(draft);
    const userStyle = userStyles.find((item) => item.id === styleId);
    if (!config) {
      flash("还没有可用的模型：先在设置里绑定 API", 3200);
      return;
    }
    setPreviewingStyle(styleId);
    try {
      const brief = [draft.genre, draft.world, draft.cast].filter(Boolean).join("\n").slice(0, 800);
      if (userStyle) {
        // 自建文风：规则是用户自己的文字，在本机组合后调用同一个模型
        const result = await simpleLLMCall(
          config,
          [{ role: "user", content: [composeUserStyleBlock(userStyle, draft.styleStrength ?? "standard"), "请用这套文风写一段 300–500 字的试写，只输出正文。", brief].join("\n") }],
          { temperature: 0.9, max_tokens: 900, label: "studyroom-style-preview-local" },
        );
        if (!result.content) throw new Error("没有返回内容");
        setStylePreview({ styleId, text: result.content.trim() });
      } else {
        const result = await requestStyledText({
          task: "preview",
          styleId,
          strength: draft.styleStrength ?? "standard",
          brief,
          apiConfig: config,
        });
        if ("error" in result) throw new Error(result.error);
        setStylePreview({ styleId, text: result.text.trim() });
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : "试写失败，稍后再试", 3200);
    } finally {
      setPreviewingStyle(null);
    }
  };

  /** 导入文风文件：TXT 直接读；DOCX 解出正文文本。 */
  const handleStyleFile = async (file: File) => {
    try {
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 24);
      if (/\.docx$/i.test(file.name)) {
        const { readDocxText } = await import("@/lib/study-room/docx");
        const text = await readDocxText(await file.arrayBuffer());
        setUserStyles(addUserStyle({ name, rules: text }));
      } else {
        const text = await file.text();
        if (!text.trim()) throw new Error("文件是空的");
        setUserStyles(addUserStyle({ name, rules: text }));
      }
      flash("已导入到我的文风（只在本机使用）", 3000);
    } catch (error) {
      flash(error instanceof Error ? error.message : "这个文件读不出来", 3200);
    }
  };

  const handleCover = async (file: File) => {
    try {
      const picked = await fileToBackgroundImage(file);
      update({ cover: picked.dataUrl });
      flash(picked.note ? `封面已设置（${picked.note}）` : "封面已设置");
    } catch (err) {
      flash(err instanceof UnsupportedBackgroundError ? err.message : "这张图读不出来", 3000);
    }
  };

  if (!draft) {
    return (
      <section className="sr-app">
        <header className="sr-header">
          <div className="sr-header-safe" />
          <div className="sr-header-row">
            <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
              <BookOpen size={22} strokeWidth={1.6} />
            </button>
            <div>
              <div className="sr-header-title">创作</div>
              <span className="sr-header-sub">草稿不存在</span>
            </div>
            <span style={{ width: 40 }} />
          </div>
        </header>
        <div className="sr-body">
          <div className="sr-empty">
            <p>这份草稿已经不在了，回书桌重新开始吧。</p>
            <button type="button" className="sr-btn" onClick={onBack} style={{ marginTop: 12 }}>
              返回书桌
            </button>
          </div>
        </div>
      </section>
    );
  }

  const words = draftWordCount(draft);
  const nextChapterNumber = draft.chapters.length + 1;
  const writer = resolveWriterConfig(draft);
  const nextStep = draftNextStep(draft);
  const generating = busy.kind === "chapter" || busy.kind === "outline";

  const field = (
    key: keyof CreativeDraft,
    label: string,
    rows = 3,
    placeholder?: string,
  ) => (
    <div key={String(key)} style={{ marginBottom: 10 }}>
      <div className="sr-note-meta" style={{ marginBottom: 4 }}>{label}</div>
      <textarea
        className="sr-css-editor"
        rows={rows}
        value={(draft[key] as string) ?? ""}
        placeholder={placeholder}
        onChange={(event) => update({ [key]: event.target.value } as Partial<CreativeDraft>)}
        aria-label={label}
      />
    </div>
  );

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回书桌">
            <ChevronRight size={22} strokeWidth={1.6} style={{ transform: "rotate(180deg)" }} />
          </button>
          <div>
            <div className="sr-header-title">{draft.title.trim() || "未命名作品"}</div>
            <span className="sr-header-sub">
              {WORK_KIND_LABEL[draft.kind ?? "custom"]} · {draft.chapters.length} 章 · {words} 字 · 自动保存
            </span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          <div className="sr-chip-row" style={{ marginBottom: 10 }}>
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="sr-chip"
                data-active={section === item.key ? "true" : undefined}
                onClick={() => setSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {notice && (
            <div className="sr-note-card">
              <div className="sr-note-meta">{notice}</div>
            </div>
          )}

          {/* ── 总览 ── */}
          {section === "overview" && (
            <>
              <div className="sr-desk-stats">
                <span><strong>{draft.chapters.length}</strong> 章</span>
                <span><strong>{words}</strong> 字</span>
                <span><strong>{draft.chapters.filter((c) => c.memory).length}</strong> 章有记忆</span>
                <span><strong>{draft.serialization === "finished" ? "完结" : "连载"}</strong></span>
              </div>
              <div className="sr-desk-nextcard">
                <span className="sr-desk-next">下一步：{nextStep.label}</span>
                <button type="button" className="sr-btn sr-btn-sm" onClick={() => setSection(nextStep.section)}>
                  去{nextStep.section === "outline" ? "大纲" : "写作"}
                </button>
                <HelpTip id="creative-progress-about" label="关于写作进度">
                  流程是「大纲 → 一章章写 → 章末记忆 → 连贯检查」。每一步都存在作品里，关掉再回来会从这里接着提示下一步。
                </HelpTip>
              </div>
              <div className="sr-css-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
                {generating ? (
                  <button type="button" className="sr-btn" onClick={stopGeneration}>
                    <Square size={15} strokeWidth={2} />
                    停止生成
                  </button>
                ) : (
                  <button type="button" className="sr-btn sr-btn-primary" onClick={() => void runChapter(nextChapterNumber)}>
                    <Sparkles size={16} strokeWidth={1.7} />
                    写第 {nextChapterNumber} 章
                  </button>
                )}
                <button type="button" className="sr-btn" onClick={() => setSection("outline")}>
                  看大纲
                </button>
                <button type="button" className="sr-btn" onClick={() => setSection("write")}>
                  去写作
                </button>
              </div>
              {draft.chapters.length > 0 && (
                <>
                  <div className="sr-section-label" style={{ marginTop: 12 }}>最近章节</div>
                  {draft.chapters.slice(-3).map((chapter) => (
                    <div key={chapter.id} className="sr-note-card">
                      <div className="sr-note-meta" style={{ fontWeight: 600, color: "var(--c-text-title)" }}>{chapter.title}</div>
                      <div className="sr-note-meta">
                        {wordCount(chapter.content)} 字 · {chapter.memory ? "已生成章末记忆" : "未生成记忆"}
                      </div>
                      {chapter.memory?.summary && <div className="sr-note-meta">记忆：{chapter.memory.summary.slice(0, 80)}</div>}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* ── 大纲 ── */}
          {section === "outline" && (
            <>
              <div className="sr-appear-row">
                <span className="sr-appear-label">书名</span>
                <input className="sr-appear-input" value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="可留空" aria-label="书名" />
              </div>
              <div className="sr-appear-row">
                <span className="sr-appear-label">署名</span>
                <input className="sr-appear-input" value={draft.author ?? ""} onChange={(e) => update({ author: e.target.value })} placeholder="笔名" aria-label="署名" />
              </div>
              <div className="sr-appear-row">
                <span className="sr-appear-label">形态</span>
                <div className="sr-chip-row">
                  {(Object.keys(WORK_KIND_LABEL) as WorkKind[]).map((key) => (
                    <button key={key} type="button" className="sr-chip" data-active={(draft.kind ?? "custom") === key ? "true" : undefined} onClick={() => update({ kind: key })}>
                      {WORK_KIND_LABEL[key]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sr-appear-row">
                <span className="sr-appear-label">每章字数</span>
                <input type="range" min={500} max={6000} step={100} value={draft.targetWords ?? 2000} onChange={(e) => update({ targetWords: Number(e.target.value) })} className="sr-slider" aria-label="每章目标字数" />
                <span className="sr-appear-value">{draft.targetWords ?? 2000}</span>
              </div>
              {field("outline", "大纲（分幕与推进）", 6, "一幕：……")}
              <div className="sr-css-actions">
                <button type="button" className="sr-btn" onClick={() => {
                  setBusy({ kind: "outline" });
                  void generateOutline(draft)
                    .then((text) => update({ outline: text }))
                    .catch((error: unknown) => flash(error instanceof Error && error.message ? error.message : "生成失败，请稍后再试", 3000))
                    .finally(() => setBusy((prev) => (prev.kind === "outline" ? { kind: "idle" } : prev)));
                }} disabled={generating}>
                  {busy.kind === "outline" ? <Loader2 size={15} className="sr-spin" /> : <RefreshCw size={15} strokeWidth={1.7} />}
                  让 AI 先给一版
                </button>
              </div>
              <HelpFoot id="creative-flow-about" label="关于创作流程">
                流程是「先方案大纲 → 你确认 → 试写 → 分章写 → 修订」。大纲与设定怎么写由你决定，不强制填满。
              </HelpFoot>
            </>
          )}

          {/* ── 写作 ── */}
          {section === "write" && (
            <>
              <div className="sr-section-label">谁来写</div>
              <div className="sr-chip-row">
                <button type="button" className="sr-chip" data-active={draft.writer.mode === "assistant" ? "true" : undefined} onClick={() => update({ writer: { ...draft.writer, mode: "assistant" } })}>
                  专业写作助手
                </button>
                <button type="button" className="sr-chip" data-active={draft.writer.mode === "character" ? "true" : undefined} onClick={() => update({ writer: { ...draft.writer, mode: "character" } })} disabled={characters.length === 0}>
                  角色卡创作
                </button>
                <button type="button" className="sr-chip" data-active={draft.writeMode === "hand" ? "true" : undefined} onClick={() => update({ writeMode: draft.writeMode === "hand" ? "ai" : "hand" })}>
                  {draft.writeMode === "hand" ? "手写：开" : "手写：关"}
                </button>
              </div>
              {draft.writer.mode === "assistant" ? (
                <div className="sr-appear-row">
                  <span className="sr-appear-label">写作模型</span>
                  <select className="sr-appear-select" value={draft.writer.apiConfigId ?? ""} onChange={(e) => update({ writer: { ...draft.writer, apiConfigId: e.target.value || undefined } })} aria-label="写作模型">
                    <option value="">跟随默认</option>
                    {apiConfigs.map((config) => (
                      <option key={config.id} value={config.id}>{config.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="sr-appear-row">
                  <span className="sr-appear-label">作者（角色卡）</span>
                  <select className="sr-appear-select" value={draft.writer.characterId ?? ""} onChange={(e) => update({ writer: { ...draft.writer, characterId: e.target.value || undefined, worldBookIds: undefined } })} aria-label="选择作者角色">
                    <option value="">选择角色</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>{character.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* 世界书在这里关联/调整；写书时自动带上，不在生成前另外要求选择 */}
              {(draft.writer.mode !== "character" || draft.writer.characterId) && (
                <WorldBookPicker
                  characterId={draft.writer.mode === "character" ? draft.writer.characterId : undefined}
                  value={draft.writer.worldBookIds}
                  onChange={(worldBookIds) => update({ writer: { ...draft.writer, worldBookIds } })}
                />
              )}
              <p className="sr-note-meta" style={{ display: "flex", alignItems: "center", gap: 2 }}>
                当前执笔：{writer.writerLabel}
                <HelpTip id="creative-writer-about" label="关于执笔">
                  {draft.writer.mode === "character"
                    ? "角色是以「作者」身份构思，书里的人不等同于 TA 自己，也不等同用户现实身份。"
                    : "助手内部会分头把关策划、人物一致性、伏笔与文风，界面上只有这一位助手。"}
                </HelpTip>
              </p>

              <div className="sr-css-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
                {generating ? (
                  <button type="button" className="sr-btn" onClick={stopGeneration}>
                    <Square size={15} strokeWidth={2} /> 停止生成
                  </button>
                ) : (
                  <button type="button" className="sr-btn sr-btn-primary" onClick={() => void runChapter(nextChapterNumber)} disabled={draft.writeMode === "hand"}>
                    <Sparkles size={16} strokeWidth={1.7} /> 写第 {nextChapterNumber} 章
                  </button>
                )}
                <button
                  type="button"
                  className="sr-btn"
                  disabled={generating}
                  onClick={() => {
                    const chapter = makeChapter(`第 ${nextChapterNumber} 章`, "");
                    update({ chapters: [...draft.chapters, chapter] });
                    setOpenChapterId(chapter.id);
                  }}
                >
                  <PenLine size={16} strokeWidth={1.7} /> 自己写一章
                </button>
              </div>

              <div className="sr-section-label">章节</div>
              {draft.chapters.length === 0 ? (
                <p className="sr-note-meta" style={{ lineHeight: 1.8 }}>还没有章节。可以先写大纲，再让助手起个头。</p>
              ) : (
                <ul className="sr-creative-chapters">
                  {draft.chapters.map((chapter, index) => (
                    <li key={chapter.id} className="sr-creative-chapter">
                      <button type="button" className="sr-creative-chapter-main" onClick={() => setOpenChapterId(openChapterId === chapter.id ? null : chapter.id)} aria-expanded={openChapterId === chapter.id}>
                        <span className="sr-creative-chapter-title">{chapter.title || `第 ${index + 1} 章`}</span>
                        <span className="sr-note-meta">
                          {wordCount(chapter.content)} 字{chapter.memory ? " · 有记忆" : ""}
                          {chapter.review ? (chapter.review.issues.length > 0 ? ` · ${chapter.review.issues.length} 处待看` : " · 已检查") : ""}
                        </span>
                        <ChevronRight size={16} strokeWidth={1.7} style={{ transform: openChapterId === chapter.id ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
                      </button>
                      {openChapterId === chapter.id && (
                        <div className="sr-creative-chapter-body">
                          <input className="sr-appear-input" value={chapter.title} onChange={(e) => update({ chapters: draft.chapters.map((item) => item.id === chapter.id ? { ...item, title: e.target.value, updatedAt: new Date().toISOString() } : item) })} aria-label="章节标题" />
                          <textarea className="sr-css-editor" rows={10} value={chapter.content} onChange={(e) => update({ chapters: draft.chapters.map((item) => item.id === chapter.id ? { ...item, content: e.target.value, updatedAt: new Date().toISOString() } : item) })} aria-label="章节正文" />
                          <div className="sr-css-actions" style={{ flexWrap: "wrap" }}>
                            <button type="button" className="sr-btn sr-btn-sm" disabled={generating} onClick={() => void runChapter(index + 1, chapter.id)}>
                              <RefreshCw size={13} strokeWidth={1.8} /> 重新生成这一章
                            </button>
                            <button type="button" className="sr-btn sr-btn-sm" disabled={busy.kind === "memory"} onClick={() => void runChapterMemory(chapter)}>
                              {busy.kind === "memory" && busy.chapterId === chapter.id ? <Loader2 size={13} className="sr-spin" /> : <Sparkles size={13} strokeWidth={1.8} />}
                              生成本章记忆
                            </button>
                            <button type="button" className="sr-btn sr-btn-sm" disabled={busy.kind !== "idle"} onClick={() => void runContinuityReview(chapter)}>
                              {busy.kind === "review" && busy.chapterId === chapter.id ? <Loader2 size={13} className="sr-spin" /> : <ListChecks size={13} strokeWidth={1.8} />}
                              连贯检查
                            </button>
                            <button type="button" className="sr-btn sr-btn-sm" onClick={() => {
                              if (!confirm(`删除「${chapter.title || `第 ${index + 1} 章`}」？`)) return;
                              update({ chapters: draft.chapters.filter((item) => item.id !== chapter.id) });
                              setOpenChapterId(null);
                            }}>
                              <Trash2 size={13} strokeWidth={1.8} /> 删除
                            </button>
                            <button type="button" className="sr-btn sr-btn-sm" onClick={() => {
                              const copy: CreativeChapter = { ...chapter, id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title: `${chapter.title}（副本）` };
                              const next = [...draft.chapters];
                              next.splice(index + 1, 0, copy);
                              update({ chapters: next });
                            }}>
                              <Plus size={13} strokeWidth={1.8} /> 复制一份
                            </button>
                          </div>
                          {chapter.review && (
                            <div className="sr-note-card">
                              <div className="sr-note-meta" style={{ fontWeight: 600, color: "var(--c-text-title)" }}>
                                连贯检查 · {new Date(chapter.review.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </div>
                              {chapter.review.issues.length === 0 ? (
                                <div className="sr-note-meta">没查出明显的前后矛盾。</div>
                              ) : (
                                <ul className="sr-desk-review">
                                  {chapter.review.issues.map((line, i) => (
                                    <li key={i} className="sr-note-meta">{line}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          {chapter.memory && (
                            <div className="sr-note-card">
                              <div className="sr-note-meta" style={{ fontWeight: 600, color: "var(--c-text-title)" }}>章末记忆</div>
                              <div className="sr-note-meta" style={{ lineHeight: 1.8 }}>
                                {chapter.memory.summary && <div>情节：{chapter.memory.summary}</div>}
                                {chapter.memory.characters && <div>人物：{chapter.memory.characters}</div>}
                                {chapter.memory.openConflicts && <div>未解决：{chapter.memory.openConflicts}</div>}
                                {chapter.memory.mustKeep && <div>必须保持：{chapter.memory.mustKeep}</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ── 设定 ── */}
          {section === "setting" && (
            <>
              {field("world", "世界观", 5, "时代、地理、规则、日常质感…")}
              {field("cast", "人物（一人一段）", 6, "姓名｜身份｜想要什么｜说话习惯")}
              <div className="sr-appear-row">
                <span className="sr-appear-label">题材 / 文风</span>
                <input className="sr-appear-input" value={draft.genre ?? ""} onChange={(e) => update({ genre: e.target.value })} placeholder="题材" aria-label="题材" />
                <input className="sr-appear-input" value={draft.style ?? ""} onChange={(e) => update({ style: e.target.value })} placeholder="文风" aria-label="文风" />
              </div>
              {field("extra", "补充要求", 3, "例如：不要写暴力细节、每章留一个钩子")}

              <div className="sr-section-label" style={{ marginTop: 12 }}>文风</div>
              <div className="sr-note-meta" style={{ marginBottom: 6, lineHeight: 1.7 }}>
                内置文风的完整规则在服务端组词、不会下发到浏览器，每套都标了出处；自建文风只存在本机。
                文风只管叙述与句法，不覆盖人物设定和已写剧情。另有一份书房写作规范（去套话、人物反应等），只在书房写书时自动带上，聊天和书友圈不用。
              </div>
              {builtinStyles.length === 0 ? (
                <p className="sr-note-meta">正在读取内置文风…</p>
              ) : (
                <div className="sr-style-list">
                  {builtinStyles.map((style) => {
                    const active = draft.styleId === style.id && !draft.userStyleId;
                    return (
                      <div key={style.id} className="sr-style-card" data-active={active ? "true" : undefined}>
                        <button
                          type="button"
                          className="sr-style-head"
                          onClick={() => update({ styleId: style.id, userStyleId: undefined })}
                          aria-pressed={active}
                        >
                          <span className="sr-style-name">{style.name}</span>
                          <span className="sr-style-origin">{style.origin ?? "仪仪原创原创"}</span>
                          <span className="sr-note-meta">{style.summary}</span>
                          {style.brief && <span className="sr-note-meta sr-style-brief">要点：{style.brief}</span>}
                          <span className="sr-chip-row" style={{ marginTop: 4 }}>
                            {style.tags.map((tag) => (
                              <span key={tag} className="sr-note-tag">{tag}</span>
                            ))}
                          </span>
                        </button>
                        {active && (
                          <div className="sr-style-actions">
                            <div className="sr-chip-row">
                              {(["light", "standard", "dense"] as StyleStrength[]).map((level) => (
                                <button
                                  key={level}
                                  type="button"
                                  className="sr-chip"
                                  data-active={(draft.styleStrength ?? "standard") === level ? "true" : undefined}
                                  onClick={() => update({ styleStrength: level })}
                                >
                                  {STYLE_STRENGTH_LABEL[level]}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="sr-btn sr-btn-sm"
                              disabled={previewingStyle !== null}
                              onClick={() => void runStylePreview(style.id)}
                            >
                              {previewingStyle === style.id ? <Loader2 size={13} className="sr-spin" /> : <Sparkles size={13} strokeWidth={1.8} />}
                              试写 300–500 字
                            </button>
                            {draft.styleId === style.id && (
                              <button type="button" className="sr-btn sr-btn-sm" onClick={() => update({ styleId: undefined })}>
                                清除文风
                              </button>
                            )}
                          </div>
                        )}
                        {stylePreview?.styleId === style.id && (
                          <div className="sr-style-preview">
                            <div className="sr-note-meta" style={{ marginBottom: 4 }}>试写预览（确认后再用于整书）</div>
                            <p className="sr-note-thought">{stylePreview.text}</p>
                            <div className="sr-css-actions">
                              <button
                                type="button"
                                className="sr-btn sr-btn-sm"
                                onClick={() => {
                                  update({ styleId: style.id, userStyleId: undefined });
                                  setStylePreview(null);
                                  flash(`已用「${style.name}」写作`, 2600);
                                }}
                              >
                                用这套文风
                              </button>
                              <button type="button" className="sr-btn-text" onClick={() => setStylePreview(null)}>
                                再看看别的
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="sr-section-label" style={{ marginTop: 12 }}>我的文风（只在本机）</div>
              {userStyles.length > 0 && (
                <div className="sr-chip-row">
                  {userStyles.map((style) => (
                    <span key={style.id} className="sr-chip" data-active={draft.userStyleId === style.id ? "true" : undefined}>
                      <button type="button" onClick={() => update({ userStyleId: style.id })} style={{ border: 0, background: "transparent", color: "inherit" }}>
                        {style.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`删除文风 ${style.name}`}
                        onClick={() => setUserStyles(removeUserStyle(style.id))}
                        style={{ border: 0, background: "transparent", color: "inherit", marginLeft: 4 }}
                      >
                        <Trash2 size={12} strokeWidth={1.8} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="sr-appear-row">
                <input
                  className="sr-appear-input"
                  value={newStyle.name}
                  onChange={(event) => setNewStyle((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="文风名称"
                  aria-label="文风名称"
                />
                <label className="sr-btn sr-btn-sm" style={{ cursor: "pointer" }}>
                  导入 TXT / DOCX
                  <input
                    type="file"
                    accept=".txt,.md,.docx"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void handleStyleFile(file);
                    }}
                  />
                </label>
              </div>
              <textarea
                className="sr-css-editor"
                rows={3}
                value={newStyle.rules}
                onChange={(event) => setNewStyle((prev) => ({ ...prev, rules: event.target.value }))}
                placeholder="粘贴或写下你自己的文风规则（只存本机）"
                aria-label="文风规则"
              />
              <div className="sr-css-actions">
                <button
                  type="button"
                  className="sr-btn sr-btn-sm"
                  disabled={!newStyle.name.trim() || !newStyle.rules.trim()}
                  onClick={() => {
                    setUserStyles(addUserStyle({ name: newStyle.name, rules: newStyle.rules }));
                    setNewStyle({ name: "", summary: "", rules: "" });
                    flash("已保存到我的文风", 2400);
                  }}
                >
                  <Plus size={13} strokeWidth={2} /> 保存为我的文风
                </button>
              </div>
              <p className="sr-note-meta">文风只管叙述与句法；人物行为、关系与对白由角色卡（或你写的人物表）决定，文风不会覆盖人设。</p>
            </>
          )}

          {/* ── 素材 ── */}
          {section === "material" && (
            <>
              <div className="sr-section-label">灵感便签（属于这个项目）</div>
              <div className="sr-appear-row">
                <input className="sr-appear-input" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="记一句灵感…" aria-label="灵感" />
                <button type="button" className="sr-btn sr-btn-sm" disabled={!noteDraft.trim()} onClick={() => {
                  setInspirations(addInspiration(noteDraft, draft.id).filter((item) => item.draftId === draft.id));
                  setNoteDraft("");
                }}>
                  <Plus size={13} strokeWidth={2} /> 记下
                </button>
              </div>
              {inspirations.length === 0 ? (
                <p className="sr-note-meta">还没有便签。</p>
              ) : (
                inspirations.map((item) => (
                  <div key={item.id} className="sr-inspiration-row">
                    <span className="sr-note-meta" style={{ flex: 1, lineHeight: 1.7 }}>
                      <Lightbulb size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 4 }} />
                      {item.text}
                    </span>
                    <button type="button" className="sr-note-tool" title="删除" onClick={() => setInspirations(removeInspiration(item.id).filter((entry) => entry.draftId === draft.id))}>
                      <Trash2 size={14} strokeWidth={1.7} />
                    </button>
                  </div>
                ))
              )}

              <div className="sr-section-label" style={{ marginTop: 12 }}>可引用的角色卡（只读）</div>
              {characters.length === 0 ? (
                <p className="sr-note-meta">宿主里还没有角色卡。</p>
              ) : (
                <div className="sr-chip-row">
                  {characters.slice(0, 12).map((character) => (
                    <span key={character.id} className="sr-chip">
                      <Users size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />
                      {character.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="sr-section-label" style={{ marginTop: 12 }}>可参考的书架藏书</div>
              <div className="sr-chip-row">
                {shelf.slice(0, 10).map((book) => (
                  <button key={book.id} type="button" className="sr-chip" onClick={() => update({ style: `${draft.style ?? ""} 参考《${book.title}》的节奏`.trim() })}>
                    《{book.title}》
                  </button>
                ))}
                {shelf.length === 0 && <span className="sr-note-meta">书架还是空的。</span>}
              </div>
              <p className="sr-note-meta">点一本书会把「参考它的节奏」写进文风里，可以再改；素材库不复制角色与世界书数据。</p>
            </>
          )}

          {/* ── 校对 ── */}
          {section === "proof" && (
            <>
              <div className="sr-css-actions">
                <button type="button" className="sr-btn" onClick={() => void runProofread()} disabled={busy.kind === "proof" || draft.chapters.length === 0}>
                  {busy.kind === "proof" ? <Loader2 size={15} className="sr-spin" /> : <Sparkles size={15} strokeWidth={1.7} />}
                  检查一致性问题
                </button>
              </div>
              {draft.chapters.length === 0 && <p className="sr-note-meta">还没有正文，先写几章再检查。</p>}
              {proofLines ? (
                proofLines.length === 0 ? (
                  <p className="sr-note-meta">这次没有发现明显的一致性问题。</p>
                ) : (
                  <ul className="sr-review-list">
                    {proofLines.map((line, index) => (
                      <li key={index}>
                        <span className="sr-detail-note-text">{line}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <HelpFoot id="proofread-about" label="关于校对">
                  校对只给建议，不会自动改你的正文；它会看最近几章、大纲与人物，挑出前后矛盾、状态跳变、时间地点冲突与断掉的伏笔。
                </HelpFoot>
              )}
              <div className="sr-section-label" style={{ marginTop: 12 }}>章末记忆（防长篇失忆）</div>
              {draft.chapters.filter((chapter) => !chapter.memory).length === 0 && draft.chapters.length > 0 ? (
                <p className="sr-note-meta">每一章都已生成记忆。</p>
              ) : (
                <>
                  <p className="sr-note-meta">{draft.chapters.filter((chapter) => !chapter.memory).length} 章还没有记忆，可到「写作」里逐章补。</p>
                  <div className="sr-css-actions">
                    <button
                      type="button"
                      className="sr-btn"
                      disabled={busy.kind !== "idle"}
                      onClick={async () => {
                        for (const chapter of draft.chapters.filter((item) => !item.memory)) {
                          await runChapterMemory(chapter);
                        }
                        flash("已补齐未生成的章末记忆", 3000);
                      }}
                    >
                      补齐全部记忆
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 排版 ── */}
          {section === "layout" && (
            <>
              <div className="sr-appear-row">
                <span className="sr-appear-label">封面</span>
                {draft.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.cover} alt="封面预览" className="sr-creative-cover" />
                )}
                <button type="button" className="sr-btn sr-btn-sm" onClick={() => coverInputRef.current?.click()}>
                  {draft.cover ? "换一张" : "选择图片"}
                </button>
                {draft.cover && (
                  <button type="button" className="sr-btn-text" onClick={() => update({ cover: undefined })}>
                    去掉
                  </button>
                )}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleCover(file);
                }}
              />
              <div className="sr-section-label">阅读效果预览</div>
              <div className="sr-reader" style={{ position: "static", inset: "auto", borderRadius: 12, overflow: "hidden" }}>
                <div className="sr-reader-body" style={{ padding: 14, maxHeight: 240 }}>
                  <h2 className="sr-chapter-title" style={{ marginTop: 0 }}>
                    {draft.chapters[0]?.title || "第一章"}
                  </h2>
                  {(toParagraphs(draft.chapters[0]?.content ?? "（还没有正文）").slice(0, 3)).map((para, index) => (
                    <p key={index} className="sr-para">{para}</p>
                  ))}
                </div>
              </div>
              <p className="sr-note-meta">预览用的是发布后的排版规则（与阅读器一致）；封面会随导出的 EPUB 一起带出。</p>
            </>
          )}

          {/* ── 导出 ── */}
          {section === "export" && (
            <>
              <div className="sr-css-actions" style={{ flexWrap: "wrap" }}>
                <button type="button" className="sr-btn sr-btn-primary" onClick={() => void handlePublish()} disabled={busy.kind === "publish" || draft.chapters.length === 0}>
                  {busy.kind === "publish" ? <Loader2 size={15} className="sr-spin" /> : <Upload size={15} strokeWidth={1.8} />}
                  {draft.publishedBookId ? "更新到书架" : "加入书架"}
                </button>
                <button type="button" className="sr-btn" onClick={() => void handleExport()} disabled={busy.kind === "export" || draft.chapters.length === 0}>
                  {busy.kind === "export" ? <Loader2 size={15} className="sr-spin" /> : <FileDown size={15} strokeWidth={1.8} />}
                  导出 EPUB
                </button>
                {draft.publishedBookId && (
                  <button
                    type="button"
                    className="sr-btn"
                    onClick={() => {
                      const book = loadBooks().find((item) => item.id === draft.publishedBookId);
                      if (book) onOpenBook(book);
                      else flash("这本书不在书架上了，重新发布即可", 2600);
                    }}
                  >
                    <BookOpen size={15} strokeWidth={1.8} /> 打开这本书
                  </button>
                )}
              </div>

              <div className="sr-section-label" style={{ marginTop: 12 }}>版本与修改</div>
              <ul className="sr-review-list">
                {draft.chapters.map((chapter, index) => (
                  <li key={chapter.id}>
                    <span className="sr-detail-note-text">
                      {chapter.title || `第 ${index + 1} 章`} · {wordCount(chapter.content)} 字 · 最后修改{" "}
                      {new Date(chapter.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
              <HelpFoot id="publish-about" label="关于加入书架与导出">
                草稿始终留在书桌；「加入书架」只是把它变成书架上的书，之后还能回来继续写并再次更新。
                导出的 EPUB 会带上封面与章末记忆附录。
              </HelpFoot>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export { CREATIVE_TEMPLATES };
