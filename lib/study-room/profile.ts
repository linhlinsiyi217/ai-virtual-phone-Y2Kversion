// lib/study-room/profile.ts — 书房里的「我」：昵称、签名、标签、头像与稳定 ID。
//
// 只保存书房自己需要的那几项；角色卡、账号等仍由宿主管理，这里不复制宿主的身份数据。
// 作用域：与钱包相同，一台设备上的书房一份资料（宿主没有多账号概念）。

import { kvGet, kvSet, kvSetAsync, registerKvMigration } from "@/lib/kv-db";
import { avatarFromKey, type NpcAvatar } from "./npc-avatar";

const KEY = "ai_phone_studyroom_profile_v1";
registerKvMigration(KEY);

/** 资料保存后广播，主页、书友圈署名、侧栏等同源刷新。 */
export const PROFILE_UPDATED_EVENT = "studyroom-profile-updated";

export type NameMode = "host" | "custom";

export type UserProfile = {
  /** 稳定 ID：第一次打开书房时生成，之后不变（帖子、钱包流水都靠它，不允许修改） */
  id: string;
  /** 昵称模式：跟随宿主的用户身份，或书房里独立的昵称 */
  nameMode: NameMode;
  /** 独立昵称；nameMode 为 host 时保留但不显示 */
  name: string;
  /** 展示 ID（别名），留空就显示稳定 ID；只在本机校验，没有服务器做全网唯一 */
  handle: string;
  signature: string;
  /** 常驻状态气泡（如「在读《简·爱》」），留空不显示 */
  status: string;
  /** 状态气泡底色（#RRGGBB）；没有就用原来的玻璃白 */
  statusColor?: string;
  tags: string[];
  /** 标签前小圆点的颜色，按标签文字记 */
  tagColors: Record<string, string>;
  /** 头像：生成式头像（可换） */
  avatar: NpcAvatar;
  /** 是否使用宿主用户身份的头像 */
  useHostAvatar: boolean;
  /** 自己上传的头像照片（压缩后的 data:image），优先于生成式头像与宿主头像；旧数据没有这一项 */
  avatarUrl?: string;
};

/** 状态气泡最多多少字（气泡安全区内两三行） */
export const STATUS_MAX = 30;
export const NAME_MAX = 20;
export const SIGNATURE_MAX = 200;
export const TAG_MAX = 8;
export const TAG_LEN_MAX = 8;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 16;

/** 标签建议：只是给个起点，可以自由输入。 */
export const TAG_SUGGESTIONS = ["夜读选手", "悬疑侦探", "灵感收集员", "慢热书友", "故事收藏家", "纸书党", "重读爱好者"];

/** 标签小圆点的默认配色（与主题的冷白黑灰相容的低饱和色）。 */
export const TAG_SWATCHES = [
  "#5B7DB1", "#7A8FA6", "#4F9D8F", "#8C7BB5", "#C27A8A", "#C99A45", "#6E8C5A", "#2F3540",
];

function makeId(): string {
  return `uh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const COLOR_RE = /^(#[0-9a-f]{6}([0-9a-f]{2})?|rgba?\([\d\s.,]+\))$/i;

export function isValidColor(value: string): boolean {
  return COLOR_RE.test(value.trim());
}

const HEX6_RE = /^#[0-9a-f]{6}$/i;

/** 状态气泡底色只认 #RRGGBB，其他写法一律当作「没设置」 */
export function isStatusColor(value: unknown): value is string {
  return typeof value === "string" && HEX6_RE.test(value.trim());
}

/** 展示 ID 校验：3–16 位，字母、数字、下划线、点或中文。返回错误文字，合法返回 null。 */
export function validateHandle(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length < HANDLE_MIN || text.length > HANDLE_MAX) return `展示 ID 需要 ${HANDLE_MIN}–${HANDLE_MAX} 个字`;
  if (!/^[A-Za-z0-9_.一-龥]+$/.test(text)) return "只能用字母、数字、下划线、点或中文";
  if (/^uh_/i.test(text)) return "不能用 uh_ 开头（这是系统 ID 的格式）";
  return null;
}

function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, TAG_LEN_MAX);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= TAG_MAX) break;
  }
  return out;
}

function cleanColors(input: unknown, tags: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const tag of tags) {
    const color = (input as Record<string, unknown>)[tag];
    if (typeof color === "string" && isValidColor(color)) out[tag] = color.trim();
  }
  return out;
}

/** 把任意来源（旧数据、草稿）整理成合法资料。 */
export function normalizeProfile(parsed: Partial<UserProfile>, fallbackId?: string): UserProfile {
  const id = typeof parsed.id === "string" && parsed.id ? parsed.id : fallbackId ?? makeId();
  const name = typeof parsed.name === "string" ? parsed.name.slice(0, NAME_MAX) : "";
  // 旧数据没有 nameMode：填过名字就是独立昵称，没填就是跟随宿主
  const nameMode: NameMode = parsed.nameMode === "host" || parsed.nameMode === "custom"
    ? parsed.nameMode
    : name.trim() ? "custom" : "host";
  const tags = cleanTags(parsed.tags);
  const handle = typeof parsed.handle === "string" && !validateHandle(parsed.handle) ? parsed.handle.trim() : "";
  return {
    id,
    nameMode,
    name,
    handle,
    signature: typeof parsed.signature === "string" ? parsed.signature.slice(0, SIGNATURE_MAX) : "",
    status: typeof parsed.status === "string" ? parsed.status.slice(0, STATUS_MAX) : "",
    ...(isStatusColor(parsed.statusColor) ? { statusColor: parsed.statusColor.trim().toLowerCase() } : {}),
    tags,
    tagColors: cleanColors(parsed.tagColors, tags),
    avatar: parsed.avatar && typeof parsed.avatar === "object" ? (parsed.avatar as NpcAvatar) : avatarFromKey(id),
    useHostAvatar: parsed.useHostAvatar === true,
    ...(typeof parsed.avatarUrl === "string" && parsed.avatarUrl.startsWith("data:image/")
      ? { avatarUrl: parsed.avatarUrl }
      : {}),
  };
}

export function loadProfile(): UserProfile {
  try {
    const raw = kvGet(KEY);
    if (raw) return normalizeProfile(JSON.parse(raw) as Partial<UserProfile>);
  } catch {
    // 落到默认
  }
  const id = makeId();
  const profile = normalizeProfile({ id, useHostAvatar: true });
  kvSet(KEY, JSON.stringify(profile));
  return profile;
}

function broadcast(profile: UserProfile) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: profile }));
  }
}

/** 立即写入（写缓存 + 后台落盘），用于状态气泡这类小改动。 */
export function saveProfile(profile: UserProfile): void {
  kvSet(KEY, JSON.stringify(profile));
  broadcast(profile);
}

/** 等落盘完成再返回；写入失败会抛出真实错误，调用方保留草稿并提示。 */
export async function saveProfileAsync(profile: UserProfile): Promise<UserProfile> {
  const next = normalizeProfile(profile, profile.id);
  await kvSetAsync(KEY, JSON.stringify(next));
  broadcast(next);
  return next;
}

/** 头像地址：上传的照片 > 宿主头像（选了且有）> 生成式头像。 */
export function profileAvatarSrc(profile: UserProfile, hostAvatar: string | null | undefined, generated: string): string {
  if (profile.avatarUrl) return profile.avatarUrl;
  if (profile.useHostAvatar && hostAvatar) return hostAvatar;
  return generated;
}

/** 展示名：独立模式用书房里的昵称；跟随模式读宿主用户身份（只读，不回写宿主）。 */
export function displayName(profile: UserProfile, hostName?: string | null): string {
  if (profile.nameMode === "custom" && profile.name.trim()) return profile.name.trim();
  return hostName?.trim() || profile.name.trim() || "我";
}

/** 展示 ID：有别名用别名，否则用稳定 ID。 */
export function displayHandle(profile: UserProfile): string {
  return profile.handle.trim() || profile.id;
}
