import { kvGet, kvSet } from "./kv-db";

export type ChatUiMode = "y2k" | "original";
export const CHAT_UI_MODE_KEY = "ai_phone_chat_ui_mode_v1";
export const CHAT_UI_MODE_EVENT = "chat-ui-mode-updated";

export function loadChatUiMode(): ChatUiMode {
  if (typeof window === "undefined") return "y2k";
  return kvGet(CHAT_UI_MODE_KEY) === "original" ? "original" : "y2k";
}

export function saveChatUiMode(mode: ChatUiMode): void {
  if (typeof window === "undefined") return;
  kvSet(CHAT_UI_MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent(CHAT_UI_MODE_EVENT, { detail: mode }));
}
