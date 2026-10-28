// lib/study-room/wishlist.ts — 想读的书（轻量收藏）。
//
// 书城里暂时读不到的书可以记在这里，之后自己导入或来源上线了再来找。
// 只保存书目信息与来源，不保存任何正文。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { BookCategory, BookSearchResult } from "./book-source";

const KEY = "ai_phone_studyroom_wishlist_v1";
registerKvMigration(KEY);

export type WishItem = {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  year?: string;
  language?: string;
  sourceLabel?: string;
  category?: BookCategory;
  externalUrl?: string;
  note?: string;
  addedAt: string;
};

export function loadWishlist(): WishItem[] {
  try {
    const raw = kvGet(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is WishItem => Boolean(item) && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

function save(list: WishItem[]): void {
  kvSet(KEY, JSON.stringify(list));
}

export function isWished(sourceId: string): boolean {
  return loadWishlist().some((item) => item.id === sourceId);
}

/** 加入想读：同一条只留一份。 */
export function addToWishlist(item: BookSearchResult, note?: string): WishItem[] {
  const list = loadWishlist();
  if (list.some((entry) => entry.id === item.id)) return list;
  const next: WishItem[] = [
    {
      id: item.id,
      title: item.title,
      author: item.authors[0],
      cover: item.cover,
      year: item.year,
      language: item.language,
      sourceLabel: item.sourceLabel,
      category: item.category,
      externalUrl: item.externalUrl,
      note: note?.trim() || undefined,
      addedAt: new Date().toISOString(),
    },
    ...list,
  ];
  save(next);
  return next;
}

export function removeFromWishlist(id: string): WishItem[] {
  const next = loadWishlist().filter((item) => item.id !== id);
  save(next);
  return next;
}
