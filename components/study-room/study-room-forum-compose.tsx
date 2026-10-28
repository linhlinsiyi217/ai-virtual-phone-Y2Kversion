"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ImagePlus, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";

import { loadBooks } from "@/lib/reading-storage";
import { simpleLLMCall } from "@/lib/api-helpers";
import { fileToBackgroundImage, UnsupportedBackgroundError } from "@/lib/study-room/background-image";
import {
  KIND_TEXT,
  addPost,
  resolveForumApiConfig,
  type ForumDraft,
  type ForumPost,
  type ForumState,
} from "@/lib/study-room/forum";
import { deleteDraft, parseDraftField, saveDraft } from "@/lib/study-room/forum-social";
import { HelpFoot } from "./help-tip";

type StudyRoomForumComposeProps = {
  state: ForumState;
  draftId?: string;
  onClose: () => void;
  onMutate: (updater: (prev: ForumState) => ForumState) => void;
  onPublished: (postId: string) => void;
  onNotice: (message: string, ms?: number) => void;
  onOpenSettings: () => void;
};

/** 写帖子：文字、图片、关联书籍、类型、话题与标签，可存草稿，也可以让 AI 先润色一下。 */
export function StudyRoomForumCompose({
  state,
  draftId,
  onClose,
  onMutate,
  onPublished,
  onNotice,
  onOpenSettings,
}: StudyRoomForumComposeProps) {
  const draft = draftId ? state.drafts.find((item) => item.id === draftId) : undefined;
  const [kind, setKind] = useState<ForumPost["kind"]>(draft?.kind ?? "post");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [images, setImages] = useState<string[]>(draft?.images ?? []);
  const [bookTitle, setBookTitle] = useState(draft?.bookTitle ?? "");
  const [topics, setTopics] = useState((draft?.topics ?? []).join("、"));
  const [spoiler, setSpoiler] = useState(draft?.spoiler ?? false);
  const [busy, setBusy] = useState<"polish" | "image" | null>(null);
  const [showShelf, setShowShelf] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const shelf = loadBooks();

  // 保存草稿：编辑已有草稿时自动更新，新写的内容在离开时也留一份
  useEffect(() => {
    return () => {
      const text = body.trim();
      if (!text) return;
      const payload: Omit<ForumDraft, "updatedAt"> = {
        id: draft?.id ?? `draft_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        kind,
        title: title.trim() || undefined,
        body: text,
        bookTitle: bookTitle.trim() || undefined,
        images,
        topics: parseDraftField(topics),
        spoiler,
      };
      onMutate((prev) => saveDraft(prev, payload));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, title, kind, bookTitle, topics, spoiler, images]);

  const handleImage = async (file: File) => {
    if (images.length >= 3) {
      onNotice("一条帖子最多放 3 张图片");
      return;
    }
    setBusy("image");
    try {
      const picked = await fileToBackgroundImage(file);
      setImages((prev) => [...prev, picked.dataUrl]);
    } catch (error) {
      onNotice(error instanceof UnsupportedBackgroundError ? error.message : "这张图片读不出来，换一张试试", 3200);
    } finally {
      setBusy(null);
    }
  };

  const handlePolish = async () => {
    const text = body.trim();
    if (!text) {
      onNotice("先写点内容再润色");
      return;
    }
    const apiConfig = resolveForumApiConfig();
    if (!apiConfig) {
      onNotice("还没有配置 API：先在设置里绑定模型，或直接发布", 3200);
      return;
    }
    setBusy("polish");
    try {
      const result = await simpleLLMCall(
        apiConfig,
        [
          {
            role: "user",
            content: [
              "请把下面这条读书论坛的帖子润色一下：保持原意与口语感，去掉重复与病句，长度不要明显变长。",
              "只输出润色后的正文，不要解释。",
              "",
              text,
            ].join("\n"),
          },
        ],
        { temperature: 0.7, max_tokens: 800, label: "studyroom-forum-polish" },
      );
      if (result.error || !result.content) throw new Error(result.error || "润色失败");
      setBody(result.content.trim());
      onNotice("已润色，可以再改");
    } catch {
      onNotice("润色没成功，内容没变，可以直接发布", 3200);
    } finally {
      setBusy(null);
    }
  };

  const handlePublish = () => {
    const text = body.trim();
    if (!text) {
      onNotice("写点内容再发布");
      return;
    }
    const post: ForumPost = {
      id: `fp_user_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      authorId: "user",
      authorName: "我",
      authorKind: "user",
      kind,
      title: title.trim() || undefined,
      body: text,
      images: images.length > 0 ? images : undefined,
      topics: parseDraftField(topics),
      bookTitle: bookTitle.trim() || undefined,
      spoiler,
      likedBy: [],
      comments: [],
      collectedBy: [],
      generated: false,
      createdAt: new Date().toISOString(),
    };
    onMutate((prev) => {
      const withPost = addPost(prev, post);
      return draft ? deleteDraft(withPost, draft.id) : withPost;
    });
    onPublished(post.id);
  };

  return (
    <div className="sr-forum-sub">
      <div className="sr-forum-sub-head">
        <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="返回">
          <ChevronLeft size={22} strokeWidth={1.6} />
        </button>
        <span className="sr-forum-sub-title">写帖子</span>
        <button type="button" className="sr-icon-btn" onClick={onOpenSettings} aria-label="生成规则" title="生成规则">
          <Sparkles size={19} strokeWidth={1.7} />
        </button>
      </div>

      <div className="sr-forum-sub-body">
        <div className="sr-chip-row">
          {(["post", "review", "recommend", "creation"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className="sr-chip"
              data-active={kind === key ? "true" : undefined}
              onClick={() => setKind(key)}
            >
              {KIND_TEXT[key]}
            </button>
          ))}
          <button
            type="button"
            className="sr-chip"
            data-active={spoiler ? "true" : undefined}
            onClick={() => setSpoiler((value) => !value)}
          >
            含剧透
          </button>
        </div>

        <input
          className="sr-appear-input"
          style={{ width: "100%", marginBottom: 8 }}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="标题（可留空）"
          aria-label="标题"
        />

        <textarea
          className="sr-css-editor"
          rows={7}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="想说什么…（写一半可以存草稿）"
          aria-label="正文"
        />

        {images.length > 0 && (
          <div className="sr-forum-images">
            {images.map((image, index) => (
              <span key={index} className="sr-forum-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" />
                <button
                  type="button"
                  aria-label="移除这张图"
                  onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="sr-appear-row">
          <span className="sr-appear-label">关联书籍</span>
          <input
            className="sr-appear-input"
            value={bookTitle}
            onChange={(event) => setBookTitle(event.target.value)}
            placeholder="书名（可留空，书架以外的书也能写）"
            aria-label="关联书籍"
          />
          <button type="button" className="sr-btn sr-btn-sm" onClick={() => setShowShelf((value) => !value)}>
            从书架选
          </button>
        </div>
        {showShelf && (
          <div className="sr-chip-row" style={{ marginBottom: 8 }}>
            {shelf.length === 0 ? (
              <span className="sr-note-meta">书架上还没有书</span>
            ) : (
              shelf.slice(0, 12).map((book) => (
                <button
                  key={book.id}
                  type="button"
                  className="sr-chip"
                  onClick={() => {
                    setBookTitle(book.title);
                    setShowShelf(false);
                  }}
                >
                  {book.title}
                </button>
              ))
            )}
          </div>
        )}

        <div className="sr-appear-row">
          <span className="sr-appear-label">话题标签</span>
          <input
            className="sr-appear-input"
            value={topics}
            onChange={(event) => setTopics(event.target.value)}
            placeholder="用顿号分隔，例如 重读、科幻"
            aria-label="话题标签"
          />
        </div>

        <div className="sr-css-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="sr-btn sr-btn-sm" onClick={() => imageRef.current?.click()} disabled={busy === "image"}>
            {busy === "image" ? <Loader2 size={13} className="sr-spin" /> : <ImagePlus size={13} strokeWidth={1.8} />}
            加图片
          </button>
          <input
            ref={imageRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleImage(file);
            }}
          />
          <button type="button" className="sr-btn sr-btn-sm" onClick={() => void handlePolish()} disabled={busy === "polish"}>
            {busy === "polish" ? <Loader2 size={13} className="sr-spin" /> : <Sparkles size={13} strokeWidth={1.8} />}
            AI 润色
          </button>
          <button
            type="button"
            className="sr-btn sr-btn-sm"
            onClick={() => {
              const text = body.trim();
              if (!text) {
                onNotice("写点内容再存草稿");
                return;
              }
              onMutate((prev) =>
                saveDraft(prev, {
                  id: draft?.id ?? `draft_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                  kind,
                  title: title.trim() || undefined,
                  body: text,
                  bookTitle: bookTitle.trim() || undefined,
                  images,
                  topics: parseDraftField(topics),
                  spoiler,
                }),
              );
              onNotice("已存进草稿箱", 2000);
            }}
          >
            存草稿
          </button>
          {draft && (
            <button
              type="button"
              className="sr-btn sr-btn-sm"
              onClick={() => {
                onMutate((prev) => deleteDraft(prev, draft.id));
                onNotice("草稿已删除", 2000);
                onClose();
              }}
            >
              <Trash2 size={13} strokeWidth={1.8} />
              删除草稿
            </button>
          )}
          <button type="button" className="sr-btn sr-btn-primary" onClick={handlePublish} disabled={!body.trim()}>
            <Send size={15} strokeWidth={1.8} />
            发布
          </button>
        </div>

        <HelpFoot id="compose-about" label="关于发布">
          发布后会立刻出现在信息流顶部；书友们会在稍后陆续来评论（按人设，错时出现）。
          不写标签、不写标题都能发；AI 润色是可选的。
        </HelpFoot>
      </div>
    </div>
  );
}
