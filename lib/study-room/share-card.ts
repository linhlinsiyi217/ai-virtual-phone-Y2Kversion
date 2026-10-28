// lib/study-room/share-card.ts — 书房分享卡片的结构化数据与角色上下文文字（纯函数，不读存储）。
//
// 分享卡片不是网页：没有可抓取的网址，角色只能看到这里写进去的、用户允许分享的内容。
// 聊天两条组装链路（llm-prompt-assembler / short-term-assembler）都从这里取文字，保持一致。

export const STUDYROOM_APP_ID = "studyroom";
export const STUDYROOM_SHARE_VERSION = 2;
/** 角色按需读取书房分享正文的内部工具名（挂在「本地资料库」能力下） */
export const STUDYROOM_READ_TOOL_NAME = "读取书房分享";

/** 帖子含剧透时，卡片和 AI 上下文里都只放这句，不带正文 */
export const SHARE_SPOILER_SUMMARY = "含剧透内容，进入书友圈后点开查看";

export type StudyRoomShareTarget =
  | { kind: "book"; bookId: string }
  | { kind: "post"; postId: string };

export type StudyRoomShareBookData = {
  /** 来源提供的简介；没有就不写，不用正文冒充 */
  description?: string;
  sourceLabel?: string;
  /** loaded：书房里导入了正文；none：只有书目信息 */
  text: "loaded" | "none";
  totalChapters: number;
  /** 章节目录（太长时只取前面若干章） */
  chapterTitles: string[];
  /** 用户读到的位置（1 起） */
  readTo?: { chapter: number; title: string };
  /** 分享时附上的片段：用户读到位置附近，不超过读到的段落 */
  excerpt?: { chapter: number; title: string; text: string; from?: "progress" | "opening" };
};

export type StudyRoomSharePostData = {
  kindLabel: string;
  bookTitle?: string;
  /** 剧透帖未经用户允许时不带正文 */
  body?: string;
  bodyTruncated?: boolean;
  commentCount: number;
  comments?: Array<{ author: string; body: string }>;
};

/** 存在聊天消息 mediaData.studyRoomShare 里的分享内容 */
export type StudyRoomSharePayload = {
  v: number;
  kind: "book" | "post";
  id: string;
  /** 原始书名 / 帖子标题（不带书名号） */
  title: string;
  author?: string;
  cover?: string;
  /** 卡片上显示的安全摘要 */
  summary: string;
  spoiler?: boolean;
  /** 用户在发送前明确勾选「附上剧透正文」 */
  spoilerAllowed?: boolean;
  book?: StudyRoomShareBookData;
  post?: StudyRoomSharePostData;
  sharedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readStudyRoomTarget(value: unknown): StudyRoomShareTarget | null {
  if (!isRecord(value)) return null;
  const raw = value.studyRoomTarget;
  if (!isRecord(raw)) return null;
  if (raw.kind === "book" && typeof raw.bookId === "string" && raw.bookId) return { kind: "book", bookId: raw.bookId };
  if (raw.kind === "post" && typeof raw.postId === "string" && raw.postId) return { kind: "post", postId: raw.postId };
  return null;
}

export function readStudyRoomSharePayload(value: unknown): StudyRoomSharePayload | null {
  if (!isRecord(value)) return null;
  const raw = value.studyRoomShare;
  if (!isRecord(raw)) return null;
  if ((raw.kind !== "book" && raw.kind !== "post") || typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.title !== "string") return null;
  return raw as unknown as StudyRoomSharePayload;
}

/** 消息里的分享对象：新卡片读结构化数据，旧卡片读 appCardLayout.studyRoomTarget */
export function studyRoomTargetOfMessage(mediaData: unknown): StudyRoomShareTarget | null {
  const payload = readStudyRoomSharePayload(mediaData);
  if (payload) return payload.kind === "book" ? { kind: "book", bookId: payload.id } : { kind: "post", postId: payload.id };
  if (!isRecord(mediaData)) return null;
  return readStudyRoomTarget(mediaData.appCardLayout);
}

const NOT_WEB = "这是书房内部分享卡片，不是网页，没有网址；不要用「查看网页」或搜索工具去读它";

function readMore(kind: "book" | "post", id: string): string {
  const args = kind === "book" ? `{"type":"book","id":"${id}","chapter":1}` : `{"type":"post","id":"${id}"}`;
  return `需要更多原文时输出 [执行动作:${STUDYROOM_READ_TOOL_NAME}(${args})]${kind === "book" ? "（chapter 换成想读的章节序号，不填 chapter 返回目录）" : ""}，读到之前不要说自己看过。`;
}

/** 角色上下文里的分享卡片文字：写清楚角色实际读到了什么、没读到什么 */
export function formatStudyRoomShareForPrompt(mediaData: unknown): string | null {
  const payload = readStudyRoomSharePayload(mediaData);
  if (payload) return payload.kind === "book" ? formatBook(payload) : formatPost(payload);

  // 旧卡片：只有标题与摘要
  const target = studyRoomTargetOfMessage(mediaData);
  if (!target || !isRecord(mediaData)) return null;
  const title = typeof mediaData.appCardTitle === "string" ? mediaData.appCardTitle : "";
  const summary = typeof mediaData.appCardSummary === "string" ? mediaData.appCardSummary : "";
  const label = target.kind === "book" ? "书籍" : "书友圈帖子";
  const id = target.kind === "book" ? target.bookId : target.postId;
  return [
    `[书房分享·${label}]${title}（${NOT_WEB}）`,
    summary ? `卡片摘要：${summary}` : "",
    `这张卡片只带了标题和摘要，你没有读过正文，不要假装读过。${readMore(target.kind, id)}`,
  ].filter(Boolean).join("\n");
}

function formatBook(p: StudyRoomSharePayload): string {
  const book = p.book;
  const lines = [`[书房分享·书籍]《${p.title}》${p.author ? ` 作者：${p.author}` : ""}（${NOT_WEB}）`];
  if (book?.description) lines.push(`书籍简介${book.sourceLabel ? `（来自${book.sourceLabel}）` : ""}：${book.description}`);
  else lines.push("书籍简介：没有来源简介");
  if (!book || book.text === "none" || book.totalChapters === 0) {
    lines.push("正文：书房里没有这本书的正文，你只知道书名和简介，没有读过这本书，不要说自己读过。");
    return lines.join("\n");
  }
  lines.push(`正文：书房里导入了全文，共 ${book.totalChapters} 章。目录：${book.chapterTitles.join(" / ")}${book.chapterTitles.length < book.totalChapters ? " …" : ""}`);
  if (book.readTo) lines.push(`对方读到第 ${book.readTo.chapter} 章「${book.readTo.title}」，后面的情节聊的时候注意别剧透。`);
  if (book.excerpt) {
    lines.push(`分享时附上的正文片段（第 ${book.excerpt.chapter} 章「${book.excerpt.title}」，${book.excerpt.from === "opening" ? "这本书的开头" : "截到对方读到的位置"}）：`);
    lines.push(`「${book.excerpt.text}」`);
  }
  lines.push(`你只读过上面给出的简介${book.excerpt ? "和片段" : ""}，没有读过整本书，不要假装读完。${readMore("book", p.id)}`);
  return lines.join("\n");
}

function formatPost(p: StudyRoomSharePayload): string {
  const post = p.post;
  const head = `[书房分享·书友圈帖子]${p.title ? `「${p.title}」` : ""}${p.author ? ` 作者：${p.author}` : ""}${post?.bookTitle ? ` 关于《${post.bookTitle}》` : ""}（${NOT_WEB}）`;
  const lines = [head];
  if (p.spoiler && !p.spoilerAllowed) {
    lines.push("这条帖子含剧透，对方没有允许把正文给你。你只知道书名和「含剧透」，没看过正文，不要猜测或编造内容。");
    return lines.join("\n");
  }
  if (p.spoiler) lines.push("（含剧透，对方在分享时允许你看正文）");
  if (post?.body) {
    lines.push(`${post.kindLabel || "帖子"}正文${post.bodyTruncated ? "（较长，只附了前面一部分）" : ""}：`);
    lines.push(post.body);
  } else {
    lines.push("帖子正文没有附上，你没看过正文。");
  }
  if (post?.comments && post.comments.length > 0) {
    lines.push(`评论（共 ${post.commentCount} 条，附前 ${post.comments.length} 条）：${post.comments.map((c) => `${c.author}：${c.body}`).join("；")}`);
  } else if (post && post.commentCount > 0) {
    lines.push(`评论共 ${post.commentCount} 条，没有附上。`);
  }
  if (post?.bodyTruncated) lines.push(readMore("post", p.id));
  return lines.join("\n");
}
