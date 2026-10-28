// lib/study-room/gifts.ts — 送书与虚拟赠礼（本轮没有真实支付或钱包）。
//
// 两件事分开：
//  - 送书：把书架上真实存在的作品连同留言送出去，只送书目与入口，不承诺传送正文文件；
//  - 赠礼：鲜花、书签、咖啡、阅读台灯、钢笔、催更票、小礼盒这七件统一系列，
//    记录发送者、接受者、数量、关联的书或帖子与时间。
// 礼物图标全部是本文件里的原创 SVG（不用 emoji），有名字也有可访问标签；
// 送礼不会重复送出：同一次点击只落一条记录，回应可单独重试。

import { simpleLLMCall } from "@/lib/api-helpers";
import { loadCharacters } from "@/lib/character-storage";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { loadApiConfigs, loadBindingConfig } from "@/lib/settings-storage";
import type { Book } from "@/lib/reading-types";
import { loadForum, type ForumState } from "./forum";

const GIFTS_KEY = "ai_phone_studyroom_gifts_v1";
registerKvMigration(GIFTS_KEY);

/** 礼物系列：统一尺寸、描边与配色，每件都有清楚的名称。 */
export type GiftId = "flower" | "bookmark" | "coffee" | "lamp" | "pen" | "updateTicket" | "giftBox";

export type GiftDef = {
  id: GiftId;
  name: string;
  desc: string;
  /** 主色（统一低饱和，贴合书房冷白基调） */
  color: string;
  /** 图形路径（24×24 视口，原创绘制） */
  paths: string;
};

export const GIFT_DEFS: GiftDef[] = [
  {
    id: "flower",
    name: "鲜花",
    desc: "读到好句子时，送一朵",
    color: "#C97C90",
    paths:
      "M12 10.5c-1.6-1.4-1.2-4.2 1-4.6 1-.2 1.8.3 2.2 1 .4-.7 1.2-1.2 2.2-1 2.2.4 2.6 3.2 1 4.6-1.2 1-3 1.8-3.2 3.4-.2-1.6-2-2.4-3.2-3.4Z M12 14.4v5.3 M9.4 17.2c1 .1 2.1.6 2.6 1.4 M14.6 17.2c-1 .1-2.1.6-2.6 1.4",
  },
  {
    id: "bookmark",
    name: "书签",
    desc: "替你记住这一页",
    color: "#6E86A8",
    paths: "M7.5 4.6h9a1 1 0 0 1 1 1v13.2l-5.5-3.2-5.5 3.2V5.6a1 1 0 0 1 1-1Z M12 7.6v4.2",
  },
  {
    id: "coffee",
    name: "咖啡",
    desc: "夜里读书，提个神",
    color: "#A87A52",
    paths:
      "M5.6 9h10.2v4.4a4 4 0 0 1-4 4h-2.2a4 4 0 0 1-4-4V9Z M15.8 10.2h1.8a2 2 0 0 1 0 4h-1.8 M8 4.4c-.8.8-.8 1.6 0 2.4 M11.6 4.4c-.8.8-.8 1.6 0 2.4",
  },
  {
    id: "lamp",
    name: "阅读台灯",
    desc: "给熬夜的人留一盏灯",
    color: "#C9A227",
    paths:
      "M8 4.4h8l2.4 6.2H5.6L8 4.4Z M12 10.6v7.2 M8.6 19.4h6.8 M9.4 17.8h5.2",
  },
  {
    id: "pen",
    name: "钢笔",
    desc: "写批注、写故事都用得上",
    color: "#5C7A9E",
    paths: "M15.4 3.8l4.8 4.8-9.6 9.6-5.4.6.6-5.4 9.6-9.6Z M13.4 5.8l4.8 4.8 M5.2 19.2l1.6-1.6",
  },
  {
    id: "updateTicket",
    name: "催更票",
    desc: "想看下一章的时候",
    color: "#8C7BB3",
    paths:
      "M4.6 7.4h14.8v3.2a2.4 2.4 0 0 0 0 4.8v3.2H4.6v-3.2a2.4 2.4 0 0 0 0-4.8V7.4Z M9.4 11.4l1.8 1.8 3.4-3.4",
  },
  {
    id: "giftBox",
    name: "小礼盒",
    desc: "不确定送什么，就送这个",
    color: "#B4736F",
    paths:
      "M4.4 10.6h15.2V19a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1v-8.4Z M3.6 7.6h16.8v3H3.6z M12 7.6V20 M12 7.6c-2.6 0-4-1-4-2.2S9 3.4 10.4 4c1.2.5 1.6 2 1.6 3.6Z M12 7.6c2.6 0 4-1 4-2.2S15 3.4 13.6 4C12.4 4.5 12 6 12 7.6Z",
  },
];

export function giftDef(id: GiftId): GiftDef {
  return GIFT_DEFS.find((gift) => gift.id === id) ?? GIFT_DEFS[0];
}

export type GiftRecord = {
  id: string;
  giftId: GiftId;
  count: number;
  /** 发送者 / 接受者 */
  fromId: string;
  fromName: string;
  fromKind: "user" | "npc";
  toId: string;
  toName: string;
  toKind: "user" | "npc";
  message?: string;
  /** 关联的书或帖子 */
  bookId?: string;
  bookTitle?: string;
  postId?: string;
  createdAt: string;
  /** 对方的回应（基于人设） */
  reply?: { text: string; at: string };
};

/** 送书记录：只送书目与留言，不送正文文件。 */
export type BookGiftRecord = {
  id: string;
  bookId: string;
  bookTitle: string;
  toId: string;
  toName: string;
  toKind: "user" | "npc";
  message?: string;
  createdAt: string;
  reply?: { text: string; at: string };
};

export type GiftState = {
  gifts: GiftRecord[];
  bookGifts: BookGiftRecord[];
};

export function loadGiftState(): GiftState {
  try {
    const raw = kvGet(GIFTS_KEY);
    if (!raw) return { gifts: [], bookGifts: [] };
    const parsed = JSON.parse(raw) as Partial<GiftState>;
    return {
      gifts: Array.isArray(parsed.gifts) ? parsed.gifts.filter((item) => item && typeof item.id === "string") : [],
      bookGifts: Array.isArray(parsed.bookGifts) ? parsed.bookGifts.filter((item) => item && typeof item.id === "string") : [],
    };
  } catch {
    return { gifts: [], bookGifts: [] };
  }
}

export function saveGiftState(state: GiftState): void {
  kvSet(GIFTS_KEY, JSON.stringify(state));
}

export type Recipient = { id: string; name: string; kind: "npc" | "user" };

/** 可送的对象：书友圈里的书友，加上宿主里的角色（已在聊天里的也算）。 */
export function loadRecipients(): Recipient[] {
  const forum = loadForum();
  const list: Recipient[] = forum.npcs.map((npc) => ({ id: npc.id, name: npc.nickname, kind: "npc" as const }));
  const seen = new Set(list.map((item) => item.name));
  for (const character of loadCharacters()) {
    if (character.id === "user" || seen.has(character.name)) continue;
    list.push({ id: character.id, name: character.name, kind: "npc" });
    seen.add(character.name);
  }
  return list;
}

export function sendGift(params: {
  giftId: GiftId;
  count: number;
  recipient: Recipient;
  message?: string;
  book?: Pick<Book, "id" | "title">;
  postId?: string;
}): { state: GiftState; record: GiftRecord } {
  const state = loadGiftState();
  const record: GiftRecord = {
    id: `gift_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    giftId: params.giftId,
    count: Math.max(1, Math.min(Math.round(params.count), 99)),
    fromId: "user",
    fromName: "我",
    fromKind: "user",
    toId: params.recipient.id,
    toName: params.recipient.name,
    toKind: params.recipient.kind,
    message: params.message?.trim() || undefined,
    bookId: params.book?.id,
    bookTitle: params.book?.title,
    postId: params.postId,
    createdAt: new Date().toISOString(),
  };
  const next = { ...state, gifts: [record, ...state.gifts] };
  saveGiftState(next);
  return { state: next, record };
}

export function sendBookGift(params: {
  book: Pick<Book, "id" | "title">;
  recipient: Recipient;
  message?: string;
}): { state: GiftState; record: BookGiftRecord } {
  const state = loadGiftState();
  const record: BookGiftRecord = {
    id: `bookgift_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    bookId: params.book.id,
    bookTitle: params.book.title,
    toId: params.recipient.id,
    toName: params.recipient.name,
    toKind: params.recipient.kind,
    message: params.message?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  const next = { ...state, bookGifts: [record, ...state.bookGifts] };
  saveGiftState(next);
  return { state: next, record };
}

/** 回应只写一次：已经有 reply 就返回 existing，避免重复送出与重复请求。 */
export function attachReply(
  kind: "gift" | "book",
  recordId: string,
  reply: { text: string; at: string },
): GiftState {
  const state = loadGiftState();
  const next: GiftState =
    kind === "gift"
      ? {
          ...state,
          gifts: state.gifts.map((item) => (item.id === recordId && !item.reply ? { ...item, reply } : item)),
        }
      : {
          ...state,
          bookGifts: state.bookGifts.map((item) => (item.id === recordId && !item.reply ? { ...item, reply } : item)),
        };
  saveGiftState(next);
  return next;
}

export function resolveNpcPersona(npcId: string, forum: ForumState): string {
  const npc = forum.npcs.find((item) => item.id === npcId);
  if (!npc) return "";
  return [
    `你是${npc.nickname}，一位读书论坛里的书友。`,
    npc.occupation ? `职业/领域：${npc.occupation}。` : "",
    npc.personality ? `性格：${npc.personality}。` : "",
    npc.speechStyle ? `说话习惯：${npc.speechStyle}。` : "",
    npc.readingTaste ? `阅读偏好：${npc.readingTaste}。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReplyPrompt(params: {
  persona: string;
  giftText: string;
  message?: string;
}): string {
  return [
    params.persona || "你是一位读书论坛里的书友。",
    "",
    `有人${params.giftText}。`,
    params.message ? `对方留言：「${params.message}」` : "",
    "",
    "请用一到两句话回个礼，符合你的性格与说话习惯，别客套过头，也别一次说太多。只输出回应本身。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 让角色/书友按人设回一句；没有配置 API 或调用失败就返回 null（记录仍然只存一条）。 */
export async function generateGiftReply(params: {
  persona: string;
  giftText: string;
  message?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const configs = loadApiConfigs();
  const defaultId = loadBindingConfig().globalDefaults.apiConfigId;
  const config = configs.find((c) => c.id === defaultId) ?? configs[0] ?? null;
  if (!config) return null;
  try {
    const result = await simpleLLMCall(config, [{ role: "user", content: buildReplyPrompt(params) }], {
      temperature: 0.8,
      max_tokens: 300,
      signal: params.signal,
      label: "studyroom-gift",
    });
    const text = result.content?.trim();
    return result.error || !text ? null : text.slice(0, 300);
  } catch {
    return null;
  }
}

/** 送礼时给模型看的动作描述（含数量与关联的书）。 */
export function giftActionText(record: GiftRecord): string {
  const gift = giftDef(record.giftId);
  const parts = [`送了你 ${record.count} 个「${gift.name}」`];
  if (record.bookTitle) parts.push(`（关联《${record.bookTitle}》）`);
  return parts.join("");
}

