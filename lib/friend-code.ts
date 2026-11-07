import type { FriendCodePayload, FriendOwnerType } from "./social-types";

const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const FRIEND_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

function securePick(alphabet: string, length: number): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("当前环境不支持安全随机数，无法生成好友码。");
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
}

export function generateFriendCode(): string {
  return securePick(FRIEND_CODE_ALPHABET, 8);
}

export function formatFriendCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}` : clean;
}

export function normalizeFriendCode(code: string): string {
  return code.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 8);
}

export function isValidFriendCode(code: string): boolean {
  return FRIEND_CODE_PATTERN.test(normalizeFriendCode(code));
}

export function buildFriendCodeUri(code: string, kind: FriendOwnerType): string {
  return `aiphone://friend/add?v=1&code=${encodeURIComponent(normalizeFriendCode(code))}&kind=${kind}`;
}

export function parseFriendCodePayload(raw: string): FriendCodePayload {
  const input = raw.trim();
  if (isValidFriendCode(input)) {
    return { version: 1, kind: "user", code: normalizeFriendCode(input) };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("不是有效的好友码或二维码内容。");
  }
  if (url.protocol !== "aiphone:" || url.host !== "friend" || url.pathname !== "/add") {
    throw new Error("这个二维码不是 AI 虚拟手机好友码。");
  }
  if (url.searchParams.get("v") !== "1") throw new Error("好友码版本暂不支持。");
  const kind = url.searchParams.get("kind");
  if (kind !== "user" && kind !== "ai") throw new Error("好友码身份类型不正确。");
  const code = normalizeFriendCode(url.searchParams.get("code") || "");
  if (!isValidFriendCode(code)) throw new Error("好友码格式不正确。");
  return { version: 1, kind, code };
}
