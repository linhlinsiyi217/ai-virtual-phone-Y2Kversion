// lib/study-room/writing-styles-client.ts — 文风的客户端侧：只拿元信息与生成结果。
//
// 内置四套文风的完整规则保存在服务端（lib/server/writing-styles.ts），浏览器这里拿不到；
// 用户自建的文风存在本机，只在本地使用（那是用户自己的文字，不涉及内置规则保护）。

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { ApiConfig } from "@/lib/settings-types";

const USER_STYLES_KEY = "ai_phone_studyroom_user_styles_v1";
registerKvMigration(USER_STYLES_KEY);

export type StyleStrength = "light" | "standard" | "dense";

export const STRENGTH_LABEL: Record<StyleStrength, string> = {
  light: "轻度",
  standard: "标准",
  dense: "浓烈",
};

export type StyleMeta = {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  /** 署名：「AI 辅助创作」或「仪仪原创原创」 */
  origin?: string;
  /** 一句规则要点（只用于展示） */
  brief?: string;
};

/** 用户自建/导入的文风（只在本机使用，默认私人）。 */
export type UserStyle = {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  /** 用户自己的规则文本 */
  rules: string;
  createdAt: string;
};

export function loadUserStyles(): UserStyle[] {
  try {
    const raw = kvGet(USER_STYLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is UserStyle => Boolean(item) && typeof item.id === "string" && typeof item.rules === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveUserStyles(list: UserStyle[]): void {
  kvSet(USER_STYLES_KEY, JSON.stringify(list));
}

export function addUserStyle(input: { name: string; summary?: string; tags?: string[]; rules: string }): UserStyle[] {
  const now = new Date().toISOString();
  const entry: UserStyle = {
    id: `ustyle_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    name: input.name.trim().slice(0, 24) || "我的文风",
    summary: (input.summary ?? "").trim().slice(0, 60) || "自建文风",
    tags: (input.tags ?? []).slice(0, 5),
    rules: input.rules.trim().slice(0, 6000),
    createdAt: now,
  };
  const next = [entry, ...loadUserStyles()];
  saveUserStyles(next);
  return next;
}

export function removeUserStyle(id: string): UserStyle[] {
  const next = loadUserStyles().filter((item) => item.id !== id);
  saveUserStyles(next);
  return next;
}

/** 取内置文风清单（只有 id/名称/简介/标签，没有规则）。 */
export async function fetchBuiltinStyles(signal?: AbortSignal): Promise<StyleMeta[]> {
  try {
    const response = await fetch("/api/study-room/style", signal ? { signal } : undefined);
    if (!response.ok) return [];
    const data = (await response.json()) as { styles?: StyleMeta[] };
    return Array.isArray(data.styles) ? data.styles : [];
  } catch {
    return [];
  }
}

/** 让服务端用指定文风写一段试写（或写一章）。返回的只有正文。 */
export async function requestStyledText(params: {
  task: "preview" | "chapter";
  styleId: string;
  strength: StyleStrength;
  brief?: string;
  chapterNumber?: number;
  targetWords?: number;
  apiConfig: ApiConfig;
  signal?: AbortSignal;
}): Promise<{ text: string } | { error: string }> {
  try {
    const response = await fetch("/api/study-room/style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: params.task,
        styleId: params.styleId,
        strength: params.strength,
        brief: params.brief,
        chapterNumber: params.chapterNumber,
        targetWords: params.targetWords,
        apiConfig: params.apiConfig,
      }),
      signal: params.signal,
    });
    const data = (await response.json()) as { text?: string; error?: string };
    if (!response.ok || !data.text) return { error: data.error ?? "生成失败" };
    return { text: data.text };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { error: "已停止" };
    return { error: "生成失败，请稍后再试" };
  }
}

/** 用户自建文风在本机组合（用户自己的文字，不涉及内置规则保护）。 */
export function composeUserStyleBlock(style: UserStyle, strength: StyleStrength): string {
  const intensity =
    strength === "light"
      ? "强度：轻度。特征轻轻带过，优先保证叙述清楚。"
      : strength === "dense"
        ? "强度：浓烈。整套特征都要写足。"
        : "强度：标准。按这套特征正常写作。";
  return [`【文风：${style.name}】`, style.rules, intensity].join("\n");
}
