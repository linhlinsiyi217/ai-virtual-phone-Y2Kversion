// lib/study-room/inspiration.ts — 书桌「灵感抽屉」里属于书房自己的那一部分。
//
// 抽屉里放：灵感便签（本文件）、人物卡与世界书（复用宿主已有数据，只读引用）、大纲（各项目自带）。
// 这里不新建第二套角色/世界资料库。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

const KEY = "ai_phone_studyroom_inspiration_v1";
registerKvMigration(KEY);

export type InspirationNote = {
  id: string;
  text: string;
  /** 可选：归属某个创作项目 */
  draftId?: string;
  createdAt: string;
  updatedAt: string;
};

export function loadInspirations(): InspirationNote[] {
  try {
    const raw = kvGet(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is InspirationNote => Boolean(item) && typeof item.id === "string" && typeof item.text === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveInspirations(list: InspirationNote[]): void {
  kvSet(KEY, JSON.stringify(list));
}

export function addInspiration(text: string, draftId?: string): InspirationNote[] {
  const value = text.trim();
  if (!value) return loadInspirations();
  const now = new Date().toISOString();
  const entry: InspirationNote = {
    id: `insp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    text: value.slice(0, 800),
    draftId,
    createdAt: now,
    updatedAt: now,
  };
  const next = [entry, ...loadInspirations()];
  saveInspirations(next);
  return next;
}

export function updateInspiration(id: string, text: string): InspirationNote[] {
  const next = loadInspirations().map((item) =>
    item.id === id ? { ...item, text: text.trim().slice(0, 800), updatedAt: new Date().toISOString() } : item,
  );
  saveInspirations(next);
  return next;
}

export function removeInspiration(id: string): InspirationNote[] {
  const next = loadInspirations().filter((item) => item.id !== id);
  saveInspirations(next);
  return next;
}
