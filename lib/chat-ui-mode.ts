import { kvSet } from "./kv-db";

export type ChatUiMode = "y2k" | "original";
export const CHAT_UI_MODE_KEY = "ai_phone_chat_ui_mode_v1";
export const CHAT_UI_MODE_EVENT = "chat-ui-mode-updated";

export function loadChatUiMode(): ChatUiMode {
  return "original";
}

export function saveChatUiMode(mode: ChatUiMode): void {
  if (typeof window === "undefined") return;
  // 聊天应用固定使用小笼包原版；保留函数只为兼容旧调用方和旧数据。
  void mode;
  kvSet(CHAT_UI_MODE_KEY, "original");
  window.dispatchEvent(new CustomEvent(CHAT_UI_MODE_EVENT, { detail: "original" }));
}
