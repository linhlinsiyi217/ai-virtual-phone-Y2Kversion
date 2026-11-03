"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly";
import { AppWindow, BrushCleaning, Check, ChevronRight, Copy, Drama, Gamepad2, Github, Loader2, Pencil, Pin, PinOff, Play, Trash2, X } from "lucide-react";
import { getQaApiLogs, clearQaApiLogs, type DebugInfo } from "@/lib/api-log-store";
import { QaFileCard } from "@/components/qa-file-card";
import { parseQaFileMarker } from "@/lib/qa-computer-tools";
import { CustomAppRunner } from "@/components/app-market/custom-app-runner";
import { CustomAppForegroundBoundary } from "@/components/app-market/custom-app-failure";
import { GameHubApp } from "@/components/game/game-hub-app";
import { BlackMarketApp } from "@/components/shopping/black-market-app";
import { getInstalledCustomApp } from "@/lib/custom-app-storage";
import { loadApiConfigs, loadBindingConfig, saveBindingConfig, resolveUserIdentity, loadWorldBooks, saveWorldBooks, createWorldBook, getCharacterBinding, setCharacterBinding } from "@/lib/settings-storage";
import type { BindingConfig, WorldBookConfig, WorldBookEntry } from "@/lib/settings-types";
import { loadCharacters, saveCharacters, createCharacter } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { hydrateChatStorage, loadChatContacts, loadChatMessages, loadChatSessions, saveChatSessions, type ChatContact, type ChatSession } from "@/lib/chat-storage";
import { loadBubbleColors, saveBubbleColors } from "@/lib/chat-bubble-color-store";
import { resolveBubbleColors, ink, mix, rgb, hex, type BubbleColors } from "@/lib/chat-bubble-colors";
import { getQaErrorEntries } from "@/lib/qa-error-log";
import { simpleLLMCall } from "@/lib/api-helpers";
import { loadChatOfflineTurns } from "@/lib/chat-offline-storage";
import { fetchShareIndex, loadResourceHubSource } from "@/lib/resource-hub-client";
import type { ShareIndex } from "@/lib/resource-hub-types";
import { commitQaFiles } from "@/lib/qa-github-write";
import { captureScreenshot, hasScreenshotBridge } from "@/lib/screenshot/bridge";
import type { QaCreatedContent } from "@/lib/qa-agent-tools";
import {
  applyQaCommit,
  cancelQaCommit,
  carryOverQaSession,
  clearQaToolHistory,
  createQaSession,
  deleteQaSession,
  editAndResendQaMessage,
  getQaActiveContextChars,
  getQaChatSnapshot,
  getQaContextBudgetChars,
  getQaEditAndResendBlockReason,
  getQaTheme,
  hasQaToolHistory,
  hydrateQaChat,
  QA_CONTEXT_BUDGET_MAX,
  QA_CONTEXT_BUDGET_MIN,
  QA_DEFAULT_CONTEXT_BUDGET_CHARS,
  QA_TEXT_ATTACHMENT_MAX_BYTES,
  QA_TEXT_ATTACHMENTS_MAX_CHARS,
  QA_TEXT_ATTACHMENTS_MAX_COUNT,
  rateQaMessage,
  setQaContextBudgetChars,
  setQaTheme,
  retryQaMessage,
  renameQaSession,
  revertQaAppliedCommit,
  sendQaMessage,
  stopQaGeneration,
  subscribeQaChat,
  switchQaSession,
  toggleQaSessionPin,
  updateQaMessageContent,
  type QaMsg,
  type QaSession,
  type QaTextAttachment,
  type QaTheme,
  type QaToolStatus,
} from "@/lib/qa-chat-store";
import {
  getQaPageChars,
  setQaPageChars,
  QA_DEFAULT_PAGE_CHARS,
  QA_PAGE_CHARS_MIN,
  QA_PAGE_CHARS_MAX,
  getQaMaxRounds,
  setQaMaxRounds,
  QA_DEFAULT_MAX_ROUNDS,
  QA_MAX_ROUNDS_MIN,
  QA_MAX_ROUNDS_MAX,
  getQaMaxOutputTokens,
  setQaMaxOutputTokens,
  QA_DEFAULT_MAX_OUTPUT_TOKENS,
  QA_MAX_OUTPUT_TOKENS_MIN,
  QA_MAX_OUTPUT_TOKENS_MAX,
} from "@/lib/qa-prefs";
import { resolveQaApiConfig, formatQaErrorMessage } from "@/lib/qa-agent-engine";
import {
  loadQaGithubConfig,
  saveQaGithubConfig,
  clearQaGithubConfig,
  validateQaGithubConfig,
  type QaGithubConfig,
  type QaGithubValidation,
} from "@/lib/qa-github";
import "@/lib/qa-error-log";

type PhoneQaAppProps = {
  onClose: () => void;
  onNotice?: (msg: string) => void;
};

// ── 内联线性图标（24x24 / 线宽 1.7 / 圆头，path 全部取自设计稿） ──

function Ic({ size, sw = 1.7, fill = "none", children }: { size: number; sw?: number; fill?: string; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const IconMenu = ({ size = 22 }: { size?: number }) => (
  <Ic size={size}><path d="M4 9h16M4 15h10" /></Ic>
);
const IconDots = ({ size = 22 }: { size?: number }) => (
  <Ic size={size}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Ic>
);
const IconDots16 = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Ic>
);
const IconChevronDown = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="m6 9 6 6 6-6" /></Ic>
);
const IconChevronRight = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="m9 18 6-6-6-6" /></Ic>
);
const IconSparkle = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z" /></Ic>
);
const IconFile = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></Ic>
);
const IconSearch = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Ic>
);
const IconWrench = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" /></Ic>
);
const IconCheckCircle = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Ic>
);
const IconXCircle = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></Ic>
);
const IconCopy = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Ic>
);
const IconThumbUp = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></Ic>
);
const IconThumbDown = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></Ic>
);
const IconRetry = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" /></Ic>
);
const IconPencil = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></Ic>
);
const IconPlus = ({ size = 24 }: { size?: number }) => (
  <Ic size={size}><path d="M12 5v14M5 12h14" /></Ic>
);
const IconWave = ({ size = 20 }: { size?: number }) => (
  <Ic size={size} sw={2.2}><path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" /></Ic>
);
const IconStop = ({ size = 20 }: { size?: number }) => (
  <Ic size={size} fill="currentColor"><rect width="10" height="10" x="7" y="7" rx="2" /></Ic>
);
const IconArrowUp = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><path d="M12 19V5M5 12l7-7 7 7" /></Ic>
);
const IconPin = ({ size = 14 }: { size?: number }) => (
  <Ic size={size}><path d="M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z" /></Ic>
);
const IconSun = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></Ic>
);
const IconMoon = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Ic>
);
const IconNewChat = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></Ic>
);
const IconChat = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Ic>
);
const IconRepo = ({ size = 20 }: { size?: number }) => (
  <Ic size={size}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" /></Ic>
);
const IconBack = ({ size = 22 }: { size?: number }) => (
  <Ic size={size}><path d="m15 18-6-6 6-6" /></Ic>
);
const IconListTree = ({ size = 16 }: { size?: number }) => (
  <Ic size={size}><path d="M21 12h-8M21 6h-11M21 18h-5M3 6v11a1 1 0 0 0 1 1h5" /><path d="m6 12 2 2 4-4" /></Ic>
);
const IconArrowDown = ({ size = 14 }: { size?: number }) => (
  <Ic size={size}><path d="M12 5v14M19 12l-7 7-7-7" /></Ic>
);
const IconCamera = ({ size = 24 }: { size?: number }) => (
  <Ic size={size}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></Ic>
);
const IconGallery = ({ size = 24 }: { size?: number }) => (
  <Ic size={size}><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></Ic>
);
const IconScreenshot = ({ size = 24 }: { size?: number }) => (
  <Ic size={size}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect width="8" height="6" x="8" y="9" rx="1" /></Ic>
);
const IconBook = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></Ic>
);
const IconLink = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Ic>
);
const IconPalette = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><circle cx="13.5" cy="6.5" r=".6" /><circle cx="17.5" cy="10.5" r=".6" /><circle cx="8.5" cy="7.5" r=".6" /><circle cx="6.5" cy="12.5" r=".6" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z" /></Ic>
);
const IconChatBubble = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Ic>
);
const IconHeart = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" /></Ic>
);
const IconPerson = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></Ic>
);
const IconClock = ({ size = 18 }: { size?: number }) => (
  <Ic size={size}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Ic>
);
const IconCheckMark = ({ size = 14 }: { size?: number }) => (
  <Ic size={size} sw={2.2}><path d="m5 12.5 4.5 4.5L19 7.5" /></Ic>
);

// ── ＋ 号菜单附件与引用（全部走真实数据通道，不做假入口） ──

/** 文本附件：限定可安全读进上下文的纯文本类型 */
const QA_FILE_ACCEPT = ".txt,.md,.json,.csv,.js,.ts,.tsx,.html,.css";
const QA_FILE_EXT_RE = /\.(txt|md|json|csv|js|ts|tsx|html|css)$/i;
/** 单文件上限与总量约束与 store 侧 QA_TEXT_ATTACHMENT_* 保持一致（1MB / 6 个 / 200K 字符） */
const QA_MAX_FILE_BYTES = QA_TEXT_ATTACHMENT_MAX_BYTES;
const QA_MAX_FILE_ATTACH = QA_TEXT_ATTACHMENTS_MAX_COUNT;
const QA_MAX_FILE_CHARS = QA_TEXT_ATTACHMENTS_MAX_CHARS;

type QaPendingFile = {
  id: string;
  name: string;
  size: number;
  status: "reading" | "ready" | "error";
  text?: string;
  error?: string;
};

type QaPendingRef = { id: string; label: string; text: string };

function makeAttachId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatAttachBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${bytes}B`;
}

function formatRefDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}年${base}`;
}

/** 引用正文截断：超长如实标注字数，不悄悄吞内容 */
function capRefText(text: string, max = 8000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…（已截断，原文共 ${trimmed.length} 字）`;
}

/** 聊天会话名：群名 / 联系人昵称 / 角色名逐级兜底 */
function chatSessionName(s: ChatSession, contacts: ChatContact[], chars: Character[]): string {
  if (s.isGroup) return s.groupName?.trim() || "群聊";
  const contact = contacts.find((c) => c.id === s.contactId);
  if (contact?.nickname?.trim()) return contact.nickname.trim();
  const character = chars.find((c) => c.id === contact?.characterId);
  return character?.name?.trim() || "聊天会话";
}

/** 工坊会话导出为 markdown（「添加到仓库项目」真实提交的文件内容） */
function buildQaSessionExport(session: QaSession): string {
  const lines: string[] = [`# ${session.title}`, "", `> 由 AI 工坊导出 · ${new Date().toLocaleString("zh-CN")}`, ""];
  for (const msg of session.messages) {
    if (msg.role === "user") {
      lines.push("## 用户", "", msg.content, "");
    } else if (msg.role === "assistant") {
      lines.push("## 小坊", "", msg.content || "（无回复内容）", "");
      if (msg.error) lines.push(`> 本轮错误：${msg.error}`, "");
    }
  }
  return lines.join("\n");
}

// ── Claude 星芒：12 条射线长短交替，4s 线性旋转（path 取自设计稿） ──

const STARBURST_PATH =
  "M12 12L23.00 12.00M12 12L19.36 16.25M12 12L17.50 21.53M12 12L12.00 20.50M12 12L6.50 21.53M12 12L4.64 16.25M12 12L1.00 12.00M12 12L4.64 7.75M12 12L6.50 2.47M12 12L12.00 3.50M12 12L17.50 2.47M12 12L19.36 7.75";

function QaStarburst({ size = 16 }: { size?: number }) {
  return (
    <svg className="qa-cl-starburst" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--qa-cl-ac)" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
      <path d={STARBURST_PATH} />
    </svg>
  );
}

// ── 代码块（语言标签 + 一键复制）─────────────────────

function QaCodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1] ?? "";
  const code = String(children ?? "").replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [code]);

  return (
    <div className="qa-codeblock">
      <div className="qa-codeblock-head">
        <span className="qa-codeblock-lang">{language || "code"}</span>
        <button type="button" className="qa-codeblock-copy" onClick={handleCopy} aria-label="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const QA_MARKDOWN_COMPONENTS = {
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  code(props: { className?: string; children?: React.ReactNode }) {
    const { className, children } = props;
    const isBlock = /language-/.test(className || "") || String(children ?? "").includes("\n");
    if (isBlock) return <QaCodeBlock className={className}>{children}</QaCodeBlock>;
    return <code className="qa-inline-code">{children}</code>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// ── 提交提案卡片 ─────────────────────────────────────

function QaCommitCard({ msg }: { msg: QaMsg }) {
  const pending = msg.pendingCommit;
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const { proposal, status, result, error } = pending;
  const files = proposal.files;

  const apply = async () => {
    setBusy(true);
    await applyQaCommit(msg.id);
    setBusy(false);
  };
  const revert = async () => {
    setBusy(true);
    await revertQaAppliedCommit(msg.id);
    setBusy(false);
  };

  return (
    <div className={`qa-commit-card status-${status}`}>
      <div className="qa-commit-head">
        <span className="qa-commit-title">
          {status === "applied" ? "已提交" : status === "reverted" ? "已撤销" : status === "canceled" ? "已取消" : "修改提案"}
        </span>
        <span className="qa-commit-branch">{proposal.branch || "默认分支"} · {files.length + (proposal.deletes?.length ?? 0)} 个文件</span>
      </div>
      <div className="qa-commit-msg">{proposal.message}</div>
      <ul className="qa-commit-files">
        {files.map((f) => (
          <li key={f.path}>{f.path}</li>
        ))}
        {(proposal.deletes ?? []).map((path) => (
          <li key={`del-${path}`} className="qa-commit-file-delete">− {path}（删除）</li>
        ))}
      </ul>
      {error && <div className="qa-commit-error">{error}</div>}
      {status === "pending" && (
        <div className="qa-commit-actions">
          <button type="button" className="qa-commit-btn is-primary" onClick={apply} disabled={busy}>
            {busy ? <Loader2 size={13} className="qa-spin" /> : "应用"}
          </button>
          <button type="button" className="qa-commit-btn" onClick={() => cancelQaCommit(msg.id)} disabled={busy}>
            取消
          </button>
        </div>
      )}
      {(status === "applying" || status === "reverting") && (
        <div className="qa-commit-actions">
          <span className="qa-commit-progress">
            <Loader2 size={13} className="qa-spin" /> {status === "applying" ? "提交中…" : "撤销中…"}
          </span>
        </div>
      )}
      {status === "applied" && result && (
        <div className="qa-commit-actions">
          <a className="qa-commit-link" href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
            查看 commit {result.sha.slice(0, 7)}
          </a>
          <button type="button" className="qa-commit-btn is-danger" onClick={revert} disabled={busy}>
            撤销
          </button>
        </div>
      )}
    </div>
  );
}

// ── 思考时间线（真实 reasoning + 真实工具调用，不编造步骤） ──

type ThinkStep =
  | { kind: "thought"; title: string; text: string; fullText: string }
  | { kind: "tool"; tool: QaToolStatus };

type QaReasoningStage = { title: string; text: string; fullText: string };

/**
 * 把模型真实返回的 reasoning 整理成可读阶段。
 * 只做归类、去标记和截断预览，不补写模型没有返回的想法。
 */
function compactReasoningStages(reasoning: string): QaReasoningStage[] {
  const cleaned = reasoning
    .replace(/<\/?(?:thinking|analysis)>/gi, "")
    .replace(/^\s*(?:#{1,6}|[-*+]\s*\[[ xX]\]|[-*+]\s+|\d+[.)、]\s*)/gm, "")
    .replace(/\*\*|__/g, "")
    .trim();
  if (!cleaned) return [];

  const sections = cleaned
    .split(/\n\s*\n|(?=^\s*(?:消息接收|历史回顾|角色与环境|规则与世界书|回复策略|草稿|检查|终检|来源分析)\s*[:：]?)/gim)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const buckets = [
    { title: "理解请求", match: /(消息|字面|意图|情绪|表情|语气|需求|请求|梗)/i, texts: [] as string[] },
    { title: "读取上下文", match: /(历史|上下文|角色|人设|环境|世界书|规则|记忆|设定)/i, texts: [] as string[] },
    { title: "制定方案", match: /(策略|方案|执行|回复形态|主动|姿态|结构|工具|搜索|读取)/i, texts: [] as string[] },
    { title: "检查并作答", match: /(草稿|闸门|筛选|修正|检查|终检|来源|输出|作答)/i, texts: [] as string[] },
  ];

  sections.forEach((section, index) => {
    const matched = buckets.find((bucket) => bucket.match.test(section));
    (matched ?? buckets[Math.min(index, buckets.length - 1)]).texts.push(section);
  });

  return buckets
    .filter((bucket) => bucket.texts.length > 0)
    .map((bucket) => {
      const fullText = bucket.texts.join("\n\n");
      const text = fullText.length > 180 ? `${fullText.slice(0, 180).trim()}…` : fullText;
      return { title: bucket.title, text, fullText };
    });
}

/** 工具 → 图标分类：读取/查看类=文件，搜索类=放大镜，其余=扳手 */
function toolIconKind(name: string): "file" | "search" | "wrench" {
  if (name.includes("搜")) return "search";
  if (/(读|查看|文档|文件|报错|记录|历史|列表|树|体检|环境)/.test(name)) return "file";
  return "wrench";
}

function ToolLineIcon({ name, size = 16 }: { name: string; size?: number }) {
  const kind = toolIconKind(name);
  if (kind === "search") return <IconSearch size={size} />;
  if (kind === "file") return <IconFile size={size} />;
  return <IconWrench size={size} />;
}

/** 工具结果首行摘要（真实 result，截断展示） */
function toolSummary(result: string | undefined): string {
  if (!result) return "";
  const firstLine = result.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine;
}

// 工具步小白条：点击展开真实参数与结果（保留原工具行的详情能力）
function QaTimelineTool({ tool }: { tool: QaToolStatus }) {
  const [open, setOpen] = useState(false);
  const { text: resultText } = parseQaFileMarker(tool.result || "");
  const hasDetail = Boolean(tool.detail || resultText);
  const side = tool.running ? "进行中" : tool.success === false ? "失败" : toolSummary(resultText);
  return (
    <div className="qa-cl-toolwrap">
      <button
        type="button"
        className={`qa-cl-toolcard ${tool.running ? "is-running" : tool.success === false ? "is-fail" : ""}`}
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
      >
        <span className="qa-cl-toolcard-name">
          {tool.name}
          {tool.subtitle ? ` · ${tool.subtitle}` : ""}
        </span>
        {side && <small className="qa-cl-toolcard-side">{side}</small>}
      </button>
      {open && hasDetail && (
        <div className="qa-tool-row-body qa-cl-tooldetail">
          {tool.detail && (
            <>
              <div className="qa-tool-row-label">参数</div>
              <pre className="qa-tool-row-pre">{tool.detail}</pre>
            </>
          )}
          {resultText && (
            <>
              <div className="qa-tool-row-label">结果</div>
              <pre className="qa-tool-row-pre">{resultText}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function QaThinkBody({ msg, isStreaming }: { msg: QaMsg; isStreaming: boolean }) {
  const steps = useMemo<ThinkStep[]>(() => {
    const arr: ThinkStep[] = [];
    for (const stage of compactReasoningStages(msg.reasoning ?? "")) arr.push({ kind: "thought", ...stage });
    for (const tool of msg.tools ?? []) arr.push({ kind: "tool", tool });
    return arr;
  }, [msg.reasoning, msg.tools]);

  if (steps.length === 0) return null;

  const failed = (msg.tools ?? []).some((t) => t.success === false) || Boolean(msg.error);
  // 结束行：全部结束后才有；被中断的一轮没有结束行（下方另有「已停止生成」提示）
  const showEnd = !isStreaming && !msg.aborted;
  // 元信息：只有前端真实计时的耗时；tokens/缓存接口不回传，没有就不显示
  const meta = !isStreaming && msg.thinkingMs != null ? `${Math.max(0, Math.round(msg.thinkingMs / 1000))} 秒` : "";

  return (
    <>
      <div className="qa-cl-timeline">
        {steps.map((step, i) => (
          <div className="qa-cl-step" key={i}>
            <span className="qa-cl-step-dot">
              {step.kind === "thought" ? (
                <IconSparkle size={16} />
              ) : step.tool.running ? (
                <QaStarburst size={16} />
              ) : (
                <ToolLineIcon name={step.tool.name} />
              )}
            </span>
            <div className="qa-cl-step-body">
              {step.kind === "thought" ? (
                <div className="qa-cl-stage">
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                  {step.fullText !== step.text && (
                    <details className="qa-cl-stage-detail">
                      <summary>展开这一阶段</summary>
                      <p>{step.fullText}</p>
                    </details>
                  )}
                </div>
              ) : <QaTimelineTool tool={step.tool} />}
            </div>
          </div>
        ))}
        {showEnd && (
          <div className="qa-cl-step">
            <span className="qa-cl-step-dot">{failed ? <IconXCircle size={16} /> : <IconCheckCircle size={16} />}</span>
            <div className="qa-cl-step-text">{failed ? "失败" : "完成"}</div>
          </div>
        )}
      </div>
      {meta && <div className="qa-cl-meta">{meta}</div>}
    </>
  );
}

// ── 消息渲染 ─────────────────────────────────────────

// 已完成文本的 Markdown 渲染：memo 缓存——流式期间每次增量都全文重排 remark 是
// 低端机 WebView OOM 崩溃的主因（几万字 × 每秒多次解析）。文本不变就不重渲。
const QaMarkdownBlock = memo(function QaMarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkCjkFriendly]} components={QA_MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

// 正在生长的活跃段：纯文本渲染（零解析成本），生成结束后换回完整 Markdown
function QaStreamingText({ text }: { text: string }) {
  return (
    <>
      <div className="qa-stream-text">{text}</div>
      <span className="qa-cursor" />
    </>
  );
}

const QaMessageItem = memo(function QaMessageItem({
  msg,
  isStreaming,
  onRetry,
  onViewImage,
  onCopy,
  onEdit,
}: {
  msg: QaMsg;
  isStreaming: boolean;
  onRetry: (id: string) => void;
  onViewImage: (url: string) => void;
  onCopy: (content: string) => void;
  onEdit: (msg: QaMsg) => void;
}) {
  const thinkingOnly = isStreaming && !msg.content && (!msg.tools || msg.tools.length === 0);
  const showActions = !isStreaming && !thinkingOnly;

  // 思考区展开状态：生成中默认展开、结束时收起一次，之后由用户掌握，重渲不抖动
  const [thinkOpen, setThinkOpen] = useState(isStreaming);
  useEffect(() => {
    setThinkOpen(isStreaming);
  }, [isStreaming]);

  // 生成中的真实计时（每秒刷新）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  const hasThink = Boolean(msg.reasoning?.trim() || (msg.tools && msg.tools.length > 0));
  const thinkLabel = msg.thinkingMs != null ? `思考过程 · ${Math.max(0, Math.round(msg.thinkingMs / 1000))} 秒` : "思考过程";

  // 正文 = segments 里的全部文字段（工具行已上移到思考时间线）；旧消息回退 msg.content
  const bodyText = useMemo(() => {
    if (!msg.segments?.length) return msg.content;
    return msg.segments
      .filter((seg) => seg.kind === "text" && seg.text.trim())
      .map((seg) => (seg as { kind: "text"; text: string }).text)
      .join("");
  }, [msg.segments, msg.content]);

  // 模型没有返回 reasoning / 工具记录时：不渲染思考时间线，改显真实回复耗时
  const replySeconds = msg.thinkingMs != null ? Math.max(0, Math.round(msg.thinkingMs / 1000)) : null;
  const showReplyTime = !isStreaming && !hasThink && Boolean(bodyText) && replySeconds != null;
  // 无思考内容区块的展开态（默认展开卡片与说明，点击标题可收起）
  const [replyTimeOpen, setReplyTimeOpen] = useState(true);

  if (msg.role === "user") {
    return (
      <div className="qa-cl-msg is-user" id={`qa-message-${msg.id}`} data-message-id={msg.id}>
        <div className="qa-cl-user-msg">
          {msg.images && msg.images.length > 0 && (
            <div className="qa-msg-images">
              {msg.images.map((url, i) => (
                <button key={i} type="button" className="qa-msg-image" onClick={() => onViewImage(url)} aria-label="查看图片">
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
          {msg.files && msg.files.length > 0 && (
            <div className="qa-cl-msg-files">
              {msg.files.map((file) => (
                <span className="qa-cl-file-chip" key={file.name} title={file.name}>
                  <IconFile size={13} />
                  <span>{file.name}</span>
                </span>
              ))}
            </div>
          )}
          {msg.content}
        </div>
        {/* 用户消息操作（复制 / 编辑原始内容） */}
        <div className="qa-cl-actions qa-cl-actions-user">
          <button type="button" className="qa-cl-action" aria-label="复制原始内容" title="复制" onClick={() => onCopy(msg.content)}>
            <IconCopy size={18} />
          </button>
          <button type="button" className="qa-cl-action" aria-label="编辑原始内容" title="编辑" onClick={() => onEdit(msg)}>
            <IconPencil size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qa-cl-msg" id={`qa-message-${msg.id}`} data-message-id={msg.id}>
      {hasThink && (
        <div className="qa-cl-think">
          <button type="button" className="qa-cl-think-head" onClick={() => setThinkOpen((v) => !v)} aria-expanded={thinkOpen}>
            {isStreaming ? (
              <>
                <QaStarburst size={16} />
                <span className="qa-cl-think-label">正在思考… {Math.max(0, Math.floor((nowTick - msg.ts) / 1000))} 秒</span>
              </>
            ) : (
              <span className="qa-cl-think-label">{thinkLabel}</span>
            )}
            <span className={`qa-cl-think-chevron ${thinkOpen ? "is-open" : ""}`}>
              <IconChevronDown size={16} />
            </span>
          </button>
          {thinkOpen && <QaThinkBody msg={msg} isStreaming={isStreaming} />}
        </div>
      )}

      {showReplyTime && (
        <div className="qa-cl-nothink">
          <button
            type="button"
            className="qa-cl-nothink-head"
            onClick={() => setReplyTimeOpen((v) => !v)}
            aria-expanded={replyTimeOpen}
          >
            <span className="qa-cl-think-label">回复用时 {replySeconds} 秒</span>
            <span className={`qa-cl-think-chevron ${replyTimeOpen ? "is-open" : ""}`}>
              <IconChevronDown size={16} />
            </span>
          </button>
          {replyTimeOpen && (
            <>
              <div className="qa-cl-nothink-card">
                <IconClock size={18} />
                <span className="qa-cl-nothink-card-title">生成回复</span>
                <span className="qa-cl-nothink-card-time">{replySeconds} 秒</span>
              </div>
              <div className="qa-cl-nothink-note">这个模型没有返回思考内容</div>
            </>
          )}
        </div>
      )}

      {thinkingOnly ? (
        <div className="qa-thinking">{msg.toolDrafting ? "正在编写工具调用…" : msg.reasoning ? "正在思考…" : "正在生成…"}</div>
      ) : isStreaming ? (
        bodyText ? (
          <div className="qa-markdown">
            <QaStreamingText text={bodyText} />
          </div>
        ) : null
      ) : bodyText ? (
        <div className="qa-markdown">
          <QaMarkdownBlock text={bodyText} />
        </div>
      ) : null}

      {isStreaming && msg.toolDrafting && !thinkingOnly && (
        <div className="qa-thinking qa-tool-drafting">正在编写工具调用…</div>
      )}
      {msg.streamNote && <div className="qa-msg-note">{msg.streamNote}</div>}
      {msg.pendingCommit && <QaCommitCard msg={msg} />}
      {msg.aborted && <div className="qa-msg-note">已停止生成</div>}
      {msg.error && (
        <div className="qa-msg-error">
          <div className="qa-msg-error-text">{msg.error}</div>
          <button type="button" className="qa-retry-btn" onClick={() => onRetry(msg.id)}>
            重试
          </button>
        </div>
      )}

      {/* 生成中：消息左下角转动星芒；无完成行、无操作栏 */}
      {isStreaming && <div className="qa-cl-generating" aria-hidden><QaStarburst size={26} /></div>}

      {showActions && (
        <div className="qa-cl-actions">
          <button type="button" className="qa-cl-action" aria-label="复制原始内容" title="复制" onClick={() => onCopy(msg.content)}>
            <IconCopy size={18} />
          </button>
          <button type="button" className="qa-cl-action" aria-label="编辑原始内容" title="编辑" onClick={() => onEdit(msg)}>
            <IconPencil size={18} />
          </button>
          <button
            type="button"
            className={`qa-cl-action ${msg.rating === "up" ? "is-active" : ""}`}
            aria-label="点赞"
            aria-pressed={msg.rating === "up"}
            title="赞"
            onClick={() => rateQaMessage(msg.id, "up")}
          >
            <IconThumbUp size={18} />
          </button>
          <button
            type="button"
            className={`qa-cl-action ${msg.rating === "down" ? "is-active" : ""}`}
            aria-label="点踩"
            aria-pressed={msg.rating === "down"}
            title="踩"
            onClick={() => rateQaMessage(msg.id, "down")}
          >
            <IconThumbDown size={18} />
          </button>
          <button type="button" className="qa-cl-action" aria-label="重试" title="重试" onClick={() => onRetry(msg.id)}>
            <IconRetry size={18} />
          </button>
        </div>
      )}
    </div>
  );
});

// ── 会话大纲（对话轮次胶囊：真实用户消息轮次，点击跳转；含记忆结转入口） ──

function QaConversationOutline({
  messages,
  open,
  carrying,
  onToggle,
  onClose,
  onCarryOver,
  onScrollBottom,
}: {
  messages: QaMsg[];
  open: boolean;
  carrying: boolean;
  onToggle: () => void;
  onClose: () => void;
  onCarryOver: () => void;
  onScrollBottom: () => void;
}) {
  // 每一轮 = 一条真实用户消息；标题取正文，纯附件轮次用文件名 / 图片说明
  const rounds = useMemo(() => {
    const result: Array<{ id: string; title: string }> = [];
    for (const message of messages) {
      if (message.role !== "user") continue;
      const title = message.content.trim().replace(/\s+/g, " ")
        || message.files?.map((file) => file.name).join("、")
        || (message.images?.length ? "图片消息" : "新一轮对话");
      result.push({ id: message.id, title: title.length > 48 ? `${title.slice(0, 48)}…` : title });
    }
    return result;
  }, [messages]);

  if (rounds.length === 0) return null;

  const jumpTo = (id: string) => {
    document.getElementById(`qa-message-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    onClose();
  };

  return (
    <div className="qa-cl-outline">
      {open && (
        <div className="qa-cl-outline-panel" role="dialog" aria-label="对话大纲">
          <div className="qa-cl-outline-head">
            <span>对话大纲</span>
            <button type="button" className="qa-cl-outline-carry" onClick={onCarryOver} disabled={carrying}>
              {carrying ? <Loader2 size={13} className="qa-spin" /> : <IconListTree size={13} />}
              {carrying ? "提炼中" : "结转新会话"}
            </button>
          </div>
          <div className="qa-cl-outline-list hide-scrollbar">
            {rounds.map((round, index) => (
              <button type="button" className="qa-cl-outline-item" key={round.id} onClick={() => jumpTo(round.id)}>
                <span>{index + 1}</span>
                <strong>{round.title}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="qa-cl-outline-capsule">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label="打开对话大纲">
          <IconListTree size={13} />
          <span>{rounds.length} 轮</span>
        </button>
        <i aria-hidden />
        <button type="button" onClick={onScrollBottom} aria-label="定位最后一条回复">
          <IconArrowDown size={13} />
        </button>
      </div>
    </div>
  );
}

// ── 会话侧栏（左侧滑出：新会话 / 当前会话 / 项目仓库 / 记忆结转 / 置顶与最近 / 账号行） ──

function QaSessionSidebar({
  open,
  sessions,
  activeId,
  theme,
  userName,
  carrying,
  onClose,
  onSelect,
  onDelete,
  onCreate,
  onOpenRepo,
  onCarryOver,
  onOpenSettings,
  onRenameRequest,
  onToggleTheme,
}: {
  open: boolean;
  sessions: QaSession[];
  activeId: string | null;
  theme: QaTheme;
  userName: string;
  carrying: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onOpenRepo: () => void;
  onCarryOver: () => void;
  onOpenSettings: () => void;
  onRenameRequest: (id: string, title: string) => void;
  onToggleTheme: () => void;
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // 置顶的排最前，其余保持时间序。只在渲染层排，存储顺序不动
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <>
      <div className={`qa-cl-scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden={!open} />
      <aside className={`qa-cl-drawer ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div className="qa-cl-drawer-scroll hide-scrollbar" onClick={() => menuOpenId && setMenuOpenId(null)}>
          <button type="button" className="qa-cl-drow" onClick={onCreate}>
            <span className="qa-cl-drow-ic"><IconNewChat size={20} /></span>
            <b>新会话</b>
          </button>
          <button type="button" className="qa-cl-drow on" onClick={onClose}>
            <span className="qa-cl-drow-ic"><IconChat size={20} /></span>
            <b>{activeSession?.title ?? "会话"}</b>
          </button>
          <button type="button" className="qa-cl-drow" onClick={onOpenRepo}>
            <span className="qa-cl-drow-ic"><IconRepo size={20} /></span>
            <b>项目仓库</b>
          </button>
          <button type="button" className="qa-cl-drow" onClick={onCarryOver} disabled={carrying}>
            <span className="qa-cl-drow-ic">{carrying ? <Loader2 size={20} className="qa-spin" /> : <IconListTree size={20} />}</span>
            <b>{carrying ? "提炼记忆中…" : "记忆结转"}</b>
          </button>
          <button type="button" className="qa-cl-drow" onClick={onOpenSettings}>
            <span className="qa-cl-drow-ic"><IconWrench size={20} /></span>
            <b>Claude 配置</b>
          </button>
          <div className="qa-cl-group-head">置顶与最近</div>
          {sortedSessions.length === 0 && <div className="qa-cl-drawer-empty">还没有对话</div>}
          {sortedSessions.map((session) => (
            <div
              key={session.id}
              className={`qa-cl-drow qa-cl-drow-session ${session.id === activeId ? "on" : ""}`}
              onClick={() => onSelect(session.id)}
            >
              <b>{session.title}</b>
              <span className="qa-cl-drow-end">
                {session.isPinned && <span className="qa-cl-pin" aria-label="已置顶"><IconPin size={14} /></span>}
                <button
                  type="button"
                  className="qa-cl-drow-more"
                  aria-label="更多操作"
                  aria-expanded={menuOpenId === session.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === session.id ? null : session.id);
                  }}
                >
                  <IconDots16 size={16} />
                </button>
              </span>
              {menuOpenId === session.id && (
                <div className="qa-cl-drow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    role="menuitem"
                    className="qa-cl-dmenu-btn"
                    onClick={() => {
                      toggleQaSessionPin(session.id);
                      setMenuOpenId(null);
                    }}
                  >
                    {session.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    {session.isPinned ? "取消置顶" : "置顶"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="qa-cl-dmenu-btn"
                    onClick={() => {
                      onRenameRequest(session.id, session.title);
                      setMenuOpenId(null);
                    }}
                  >
                    <Pencil size={14} /> 重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="qa-cl-dmenu-btn is-danger"
                    onClick={() => {
                      onDelete(session.id);
                      setMenuOpenId(null);
                    }}
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="qa-cl-account">
          <span className="qa-cl-avatar" aria-hidden>{userName.charAt(0)}</span>
          <b>{userName}</b>
          <button type="button" className="qa-cl-theme-btn" onClick={onToggleTheme} aria-label="切换深色 / 浅色主题" title={theme === "dark" ? "切换到浅色" : "切换到深色"}>
            {theme === "dark" ? <IconMoon size={20} /> : <IconSun size={20} />}
          </button>
        </div>
      </aside>
    </>
  );
}

// ── 顶栏「?」使用说明弹窗（每条都对应界面上真实存在的控件） ──

function QaHelpModal({
  onClose,
  rounds,
  contextPercent,
}: {
  onClose: () => void;
  rounds: number;
  contextPercent: number;
}) {
  const rows: Array<{ visual: ReactNode; text: string }> = [
    { visual: <IconMenu size={18} />, text: "打开会话侧栏，切换或新建会话" },
    { visual: <QaStarburst size={17} />, text: "点开看 Claude 这次做了什么；模型返回了思考内容时，这里会显示思考过程" },
    { visual: <IconCopy size={18} />, text: "复制回复、点赞、点踩、让它重新回答" },
    { visual: <IconListTree size={18} />, text: `这个会话已经聊了 ${rounds} 轮，点箭头回到最新消息` },
    { visual: <MiniMeter percent={contextPercent} />, text: "已用掉多少对话容量，快满时提醒你做记忆结转" },
    { visual: <IconPlus size={18} />, text: "添加图片、文件、截屏，或引用本机内容和技能" },
    { visual: <IconChevronDown size={18} />, text: "切换模型，还可以打开「扩展思考」" },
  ];
  return (
    <div className="qa-cl-help-backdrop" onClick={onClose}>
      <div className="qa-cl-help-modal" role="dialog" aria-modal="true" aria-label="这个页面怎么用" onClick={(e) => e.stopPropagation()}>
        <div className="qa-cl-help-title">这个页面怎么用</div>
        <div className="qa-cl-help-list">
          {rows.map((row, index) => (
            <div className="qa-cl-help-row" key={index}>
              <span className="qa-cl-help-visual" aria-hidden>{row.visual}</span>
              <span className="qa-cl-help-text">{row.text}</span>
            </div>
          ))}
        </div>
        <button type="button" className="qa-cl-help-ok" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}

/** 说明弹窗里的迷你容量条示意（宽度取自真实上下文用量） */
function MiniMeter({ percent }: { percent: number }) {
  return (
    <span className="qa-cl-help-meter" aria-hidden>
      <i style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
    </span>
  );
}

// ── 顶栏「···」菜单（全部为现有真实动作） ─────────────

function QaTopMenu({
  onClose,
  onOpenHelp,
  onOpenSettings,
  onOpenApiLog,
  onOpenRepo,
  onClearToolHistory,
  onExit,
}: {
  onClose: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenApiLog: () => void;
  onOpenRepo: () => void;
  onClearToolHistory: () => void;
  onExit: () => void;
}) {
  const items: Array<{ icon: ReactNode; label: string; desc: string; onClick: () => void }> = [
    { icon: <span className="qa-cl-menu-question">?</span>, label: "使用说明", desc: "查看页面、附件与上下文功能", onClick: onOpenHelp },
    { icon: <IconWrench size={18} />, label: "Claude 配置", desc: "上下文预算、翻页与输出上限", onClick: onOpenSettings },
    { icon: <IconFile size={18} />, label: "API 调用记录", desc: "Claude 每次调用大模型的记录", onClick: onOpenApiLog },
    { icon: <IconRepo size={18} />, label: "仓库设置", desc: "连接 GitHub 仓库", onClick: onOpenRepo },
    { icon: <BrushCleaning size={18} strokeWidth={1.7} />, label: "清空工具历史", desc: "修复原生工具协议报错", onClick: onClearToolHistory },
    { icon: <IconBack size={18} />, label: "退出工坊", desc: "回到手机桌面", onClick: onExit },
  ];
  return (
    <div className="qa-cl-sheet-backdrop" onClick={onClose}>
      <div className="qa-cl-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
        <div className="qa-cl-sheet-grab" aria-hidden />
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="qa-cl-sheet-row"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span className="qa-cl-sheet-row-ic">{item.icon}</span>
            <span className="qa-cl-sheet-row-main">
              <b>{item.label}</b>
              <small>{item.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 模型选择弹层（真实切换工坊绑定的 API 配置） ──────

function QaModelSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const configs = useMemo(() => loadApiConfigs(), []);
  const currentId = resolveQaApiConfig()?.id ?? null;

  const handlePick = (id: string) => {
    if (id === currentId) {
      onClose();
      return;
    }
    const binding = loadBindingConfig();
    saveBindingConfig({ ...binding, qaApiConfigId: id });
    onSaved();
    onClose();
  };

  return (
    <div className="qa-cl-sheet-backdrop" onClick={onClose}>
      <div className="qa-cl-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="qa-cl-sheet-grab" aria-hidden />
        <div className="qa-cl-sheet-heading">选择工坊模型</div>
        <div className="qa-cl-sheet-body hide-scrollbar">
          {configs.length === 0 && (
            <p className="qa-cl-sheet-note">还没有可用的 API 配置。请先到「设置 → API 设置」添加 LLM API，再回来选择。</p>
          )}
          {configs.map((config) => (
            <button
              key={config.id}
              type="button"
              className={`qa-cl-option ${config.id === currentId ? "is-current" : ""}`}
              onClick={() => handlePick(config.id)}
            >
              <span className="qa-cl-option-main">
                <b>{config.defaultModel}</b>
                <small>{config.name || config.provider}</small>
              </span>
              {config.id === currentId && (
                <span className="qa-cl-option-check" aria-label="当前使用">
                  <IconCheckCircle size={16} />
                </span>
              )}
            </button>
          ))}
          <p className="qa-cl-sheet-note">列表来自「设置 → API 设置」里的真实 API 配置；这里切换工坊的绑定，要改模型本体请到设置里编辑对应 API。</p>
        </div>
      </div>
    </div>
  );
}

// ── 工坊配置面板 ─────────────────────────────────────

function QaSettingsSheet({ onClose, onNotice }: { onClose: () => void; onNotice?: (msg: string) => void }) {
  const [budget, setBudget] = useState(() => String(getQaContextBudgetChars()));
  const [pageChars, setPageChars] = useState(() => String(getQaPageChars()));
  const [maxRounds, setMaxRounds] = useState(() => String(getQaMaxRounds()));
  const [maxOutTokens, setMaxOutTokens] = useState(() => {
    const v = getQaMaxOutputTokens();
    return v == null ? "" : String(v);
  });
  const usedChars = getQaActiveContextChars();
  const pct = Math.round((usedChars / getQaContextBudgetChars()) * 100);

  const save = () => {
    const parsed = Number(budget);
    if (!Number.isFinite(parsed) || parsed < QA_CONTEXT_BUDGET_MIN || parsed > QA_CONTEXT_BUDGET_MAX) {
      onNotice?.(`预算需为 ${QA_CONTEXT_BUDGET_MIN.toLocaleString()} - ${QA_CONTEXT_BUDGET_MAX.toLocaleString()} 之间的数字。`);
      return;
    }
    const parsedPage = Number(pageChars);
    if (!Number.isFinite(parsedPage) || parsedPage < QA_PAGE_CHARS_MIN || parsedPage > QA_PAGE_CHARS_MAX) {
      onNotice?.(`单页字符数需为 ${QA_PAGE_CHARS_MIN.toLocaleString()} - ${QA_PAGE_CHARS_MAX.toLocaleString()} 之间的数字。`);
      return;
    }
    const parsedRounds = Number(maxRounds);
    if (!Number.isFinite(parsedRounds) || parsedRounds < QA_MAX_ROUNDS_MIN || parsedRounds > QA_MAX_ROUNDS_MAX) {
      onNotice?.(`工具调用上限需为 ${QA_MAX_ROUNDS_MIN.toLocaleString()} - ${QA_MAX_ROUNDS_MAX.toLocaleString()} 之间的数字。`);
      return;
    }
    const trimmedTokens = maxOutTokens.trim();
    const parsedTokens = trimmedTokens ? Number(trimmedTokens) : null;
    if (parsedTokens != null && (!Number.isFinite(parsedTokens) || parsedTokens < QA_MAX_OUTPUT_TOKENS_MIN || parsedTokens > QA_MAX_OUTPUT_TOKENS_MAX)) {
      onNotice?.(`单次最大输出 token 需留空或为 ${QA_MAX_OUTPUT_TOKENS_MIN.toLocaleString()} - ${QA_MAX_OUTPUT_TOKENS_MAX.toLocaleString()} 之间的数字。`);
      return;
    }
    setQaContextBudgetChars(parsed);
    setQaPageChars(parsedPage);
    setQaMaxRounds(parsedRounds);
    // 留空 = 显式不传 max_tokens（0 哨兵），与"没设置用默认值"区分开
    setQaMaxOutputTokens(trimmedTokens ? parsedTokens : 0);
    onNotice?.("已保存 Claude 配置。");
    onClose();
  };

  const reset = () => {
    setQaContextBudgetChars(null);
    setQaPageChars(null);
    setQaMaxRounds(null);
    setQaMaxOutputTokens(null);
    setBudget(String(QA_DEFAULT_CONTEXT_BUDGET_CHARS));
    setPageChars(String(QA_DEFAULT_PAGE_CHARS));
    setMaxRounds(String(QA_DEFAULT_MAX_ROUNDS));
    setMaxOutTokens(String(QA_DEFAULT_MAX_OUTPUT_TOKENS));
    onNotice?.("已恢复默认配置。");
  };

  return (
    <div className="qa-devnotice-backdrop" onClick={onClose}>
      <div className="qa-devnotice" role="dialog" aria-label="Claude 配置" onClick={(e) => e.stopPropagation()}>
        <div className="qa-devnotice-title">Claude 配置</div>
        <label className="qa-settings-field">
          <span>上下文预算（字符）</span>
          <input
            type="number"
            inputMode="numeric"
            min={QA_CONTEXT_BUDGET_MIN}
            max={QA_CONTEXT_BUDGET_MAX}
            step={1000}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
        <div className="qa-settings-hint">
          上下文满 100% 时自动压缩成摘要并重新累计。中文约 1 字符 ≈ 1 token；默认 {QA_DEFAULT_CONTEXT_BUDGET_CHARS.toLocaleString()}，小上下文（32k）模型建议 30000–50000。
        </div>
        <div className="qa-settings-hint">当前会话已用 {usedChars.toLocaleString()} 字符（约 {pct}%）。</div>
        <label className="qa-settings-field">
          <span>单页读取字符数</span>
          <input
            type="number"
            inputMode="numeric"
            min={QA_PAGE_CHARS_MIN}
            max={QA_PAGE_CHARS_MAX}
            step={1000}
            value={pageChars}
            onChange={(e) => setPageChars(e.target.value)}
          />
        </label>
        <div className="qa-settings-hint">
          克克翻页读答疑文档 / 本机内容 / 仓库源码时，每页返回的字符数。默认 {QA_DEFAULT_PAGE_CHARS.toLocaleString()}；调大读得快但更占上下文，小上下文模型建议调小。
        </div>
        <label className="qa-settings-field">
          <span>单轮工具调用上限（次）</span>
          <input
            type="number"
            inputMode="numeric"
            min={QA_MAX_ROUNDS_MIN}
            max={QA_MAX_ROUNDS_MAX}
            step={1}
            value={maxRounds}
            onChange={(e) => setMaxRounds(e.target.value)}
          />
        </label>
        <div className="qa-settings-hint">
          一次提问里克克最多连续执行多少轮工具，用完会提示「回复继续」。默认 {QA_DEFAULT_MAX_ROUNDS}；复杂任务（写游戏、改代码）可调大，想控制 token 消耗可调小。
        </div>
        <label className="qa-settings-field">
          <span>单次最大输出 token</span>
          <input
            type="number"
            inputMode="numeric"
            min={QA_MAX_OUTPUT_TOKENS_MIN}
            max={QA_MAX_OUTPUT_TOKENS_MAX}
            step={1000}
            placeholder="留空 = 不传"
            value={maxOutTokens}
            onChange={(e) => setMaxOutTokens(e.target.value)}
          />
        </label>
        <div className="qa-settings-hint">
          输出长度护栏：每次请求带 max_tokens，克克会按该预算分段写大文件，写超被安全截断后自动续接，不再整轮报废。默认 {QA_DEFAULT_MAX_OUTPUT_TOKENS.toLocaleString()}；留空 = 不传该参数（部分模型/中转不支持 max_tokens 时请留空）。
        </div>
        <div className="qa-devnotice-actions is-row">
          <button type="button" className="qa-devnotice-btn" onClick={reset}>恢复默认</button>
          <button type="button" className="qa-devnotice-btn is-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ── GitHub 仓库配置面板 ──────────────────────────────

function QaRepoSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const existing = useMemo(() => loadQaGithubConfig(), []);
  const [owner, setOwner] = useState(existing?.owner ?? "");
  const [repo, setRepo] = useState(existing?.repo ?? "");
  const [branch, setBranch] = useState(existing?.branch ?? "");
  const [token, setToken] = useState(existing?.token ?? "");
  const [writeMode, setWriteMode] = useState<"confirm" | "auto">(existing?.writeMode ?? "confirm");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<QaGithubValidation | null>(null);

  const buildConfig = useCallback((): QaGithubConfig => {
    const cfg: QaGithubConfig = { owner: owner.trim(), repo: repo.trim(), writeMode };
    if (branch.trim()) cfg.branch = branch.trim();
    if (token.trim()) cfg.token = token.trim();
    if (existing?.apiBase) cfg.apiBase = existing.apiBase;
    return cfg;
  }, [owner, repo, branch, token, writeMode, existing]);

  const handleVerify = useCallback(async () => {
    if (!owner.trim() || !repo.trim()) {
      setResult({ ok: false, error: "请填写 owner 和 repo。" });
      return;
    }
    setChecking(true);
    setResult(null);
    const validation = await validateQaGithubConfig(buildConfig());
    setResult(validation);
    setChecking(false);
  }, [owner, repo, buildConfig]);

  const handleSave = useCallback(() => {
    if (!owner.trim() || !repo.trim()) return;
    saveQaGithubConfig(buildConfig());
    onSaved();
    onClose();
  }, [owner, repo, buildConfig, onSaved, onClose]);

  const handleDisconnect = useCallback(() => {
    clearQaGithubConfig();
    onSaved();
    onClose();
  }, [onSaved, onClose]);

  return (
    <div className="qa-sheet-backdrop" onClick={onClose}>
      <div className="qa-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="qa-sheet-head">
          <span className="qa-sheet-title">
            <Github size={16} /> 连接 GitHub 仓库
          </span>
          <button type="button" className="qa-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="qa-sheet-body hide-scrollbar">
          <p className="qa-sheet-note">
            连接后可以让克克查阅这个仓库的代码来回答问题。配置只保存在你的浏览器本地，不会上传。公开仓库可不填 PAT。
          </p>
          <label className="qa-field">
            <span className="qa-field-label">Owner（用户名 / 组织）</span>
            <input className="qa-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="例：octocat" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="qa-field">
            <span className="qa-field-label">Repo（仓库名）</span>
            <input className="qa-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="例：hello-world" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="qa-field">
            <span className="qa-field-label">分支（可选，默认仓库默认分支）</span>
            <input className="qa-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="qa-field">
            <span className="qa-field-label">Fine-grained PAT（私有仓库或搜索代码需要）</span>
            <input className="qa-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <span className="qa-field-hint">
              GitHub → Settings → Menu 按钮 → Developer settings → Personal access tokens → Fine-grained tokens。创建时 Repository access 记得勾选目标仓库；Permissions 里：Contents——只查代码选 Read-only，要让克克改代码选 Read and write；要用「创建PR」再加 Pull requests 的 Read and write（Metadata 会自动带上，其余权限都不用勾）。
            </span>
          </label>
          <div className="qa-field">
            <span className="qa-field-label">改代码时的模式</span>
            <div className="qa-segment">
              <button type="button" className={`qa-segment-btn ${writeMode === "confirm" ? "is-active" : ""}`} onClick={() => setWriteMode("confirm")}>
                确认后提交
              </button>
              <button type="button" className={`qa-segment-btn ${writeMode === "auto" ? "is-active" : ""}`} onClick={() => setWriteMode("auto")}>
                全自动
              </button>
            </div>
            <span className="qa-field-hint">
              {writeMode === "confirm"
                ? "克克改代码前会先展示改动，你点「应用」才真正提交。推荐。"
                : "克克说完直接提交推送，不再逐次确认。仍可事后一键撤销。仅在信任后开启。"}
            </span>
          </div>
          {result && (
            <div className={`qa-verify ${result.ok ? "is-ok" : "is-fail"}`}>
              {result.ok
                ? `✓ 已连接 ${result.fullName}（${result.private ? "私有" : "公开"}，默认分支 ${result.defaultBranch}）`
                : `✗ ${result.error}`}
            </div>
          )}
        </div>
        <div className="qa-sheet-actions">
          {existing && (
            <button type="button" className="qa-sheet-btn is-danger" onClick={handleDisconnect}>
              断开
            </button>
          )}
          <button type="button" className="qa-sheet-btn" onClick={handleVerify} disabled={checking}>
            {checking ? <Loader2 size={14} className="qa-spin" /> : "验证"}
          </button>
          <button type="button" className="qa-sheet-btn is-primary" onClick={handleSave} disabled={!owner.trim() || !repo.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ＋ 号底部菜单（界面 3：四宫格 + 列表行，全部真实入口） ──

function QaPlusSheet({
  onClose,
  onCamera,
  onGallery,
  onFiles,
  onScreenshot,
  screenshotBusy,
  screenshotHint,
  onOpenRefs,
  onOpenSkills,
  onAddToRepo,
  onLink,
  repoBusy,
  repoConnected,
}: {
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onFiles: () => void;
  onScreenshot: () => void;
  screenshotBusy: boolean;
  screenshotHint: string;
  onOpenRefs: () => void;
  onOpenSkills: () => void;
  onAddToRepo: () => void;
  onLink: () => void;
  repoBusy: boolean;
  repoConnected: boolean;
}) {
  return (
    <div className="qa-cl-sheet-backdrop" onClick={onClose}>
      <div className="qa-cl-sheet" role="menu" aria-label="添加附件" onClick={(e) => e.stopPropagation()}>
        <div className="qa-cl-sheet-grab" aria-hidden />
        <div className="qa-cl-tiles">
          <button type="button" className="qa-cl-tile" onClick={onCamera}>
            <IconCamera size={24} />
            相机
          </button>
          <button type="button" className="qa-cl-tile" onClick={onGallery}>
            <IconGallery size={24} />
            相册
          </button>
          <button type="button" className="qa-cl-tile" onClick={onFiles}>
            <IconFile size={24} />
            文件
          </button>
          <button type="button" className="qa-cl-tile" onClick={onScreenshot} disabled={screenshotBusy}>
            <IconScreenshot size={24} />
            截屏
            <i>{screenshotBusy ? "截取中…" : screenshotHint}</i>
          </button>
        </div>
        <button type="button" role="menuitem" className="qa-cl-sheet-row" onClick={onOpenRefs}>
          <span className="qa-cl-sheet-row-ic"><IconBook size={18} /></span>
          <span className="qa-cl-sheet-row-main">
            <b>引用本机内容</b>
            <small>角色卡、世界书、聊天外观等</small>
          </span>
          <span className="qa-cl-sheet-row-arrow" aria-hidden><IconChevronRight size={16} /></span>
        </button>
        <button type="button" role="menuitem" className="qa-cl-sheet-row" onClick={onOpenSkills}>
          <span className="qa-cl-sheet-row-ic"><IconSparkle size={18} /></span>
          <span className="qa-cl-sheet-row-main">
            <b>技能</b>
            <small>美化、取色、润色、拆世界书…</small>
          </span>
          <span className="qa-cl-sheet-row-arrow" aria-hidden><IconChevronRight size={16} /></span>
        </button>
        <button type="button" role="menuitem" className="qa-cl-sheet-row" onClick={onAddToRepo} disabled={repoBusy}>
          <span className="qa-cl-sheet-row-ic"><IconRepo size={18} /></span>
          <span className="qa-cl-sheet-row-main">
            <b>添加到仓库项目</b>
            <small>{repoBusy ? "正在提交…" : repoConnected ? "把这个会话存档放进项目" : "需要先连接 GitHub 仓库"}</small>
          </span>
          <span className="qa-cl-sheet-row-arrow" aria-hidden>
            {repoBusy ? <Loader2 size={16} className="qa-spin" /> : <IconChevronRight size={16} />}
          </span>
        </button>
        <button type="button" role="menuitem" className="qa-cl-sheet-row" onClick={onLink}>
          <span className="qa-cl-sheet-row-ic"><IconLink size={18} /></span>
          <span className="qa-cl-sheet-row-main">
            <b>链接</b>
            <small>读取网页标题和正文</small>
          </span>
          <span className="qa-cl-sheet-row-arrow" aria-hidden><IconChevronRight size={16} /></span>
        </button>
      </div>
    </div>
  );
}

// ── 技能系统（界面 5 技能列表 + 界面 6 预览并确认写入） ──
// 每个技能都走完整闭环：选择目标 → 预览改动 → 确认后才写入 → 写入后可一键撤销。

type QaSkillId = "beauty" | "palette" | "lint" | "persona" | "night" | "worldbook" | "char";

type QaSubPage = "refs" | "skills" | { skill: QaSkillId } | null;

const QA_SKILLS: Array<{ id: QaSkillId; icon: ReactNode; name: string; desc: string }> = [
  { id: "beauty", icon: <IconPalette size={18} />, name: "美化聊天室", desc: "生成 CSS，预览后写进会话" },
  { id: "palette", icon: <IconGallery size={18} />, name: "看图取色", desc: "从图片提取主色、辅色、文字色" },
  { id: "lint", icon: <IconSearch size={18} />, name: "检查报错", desc: "读错误日志、CSS 语法和选择器" },
  { id: "persona", icon: <IconPerson size={18} />, name: "润色人设", desc: "对比字段差异，确认才修改" },
  { id: "night", icon: <IconClock size={18} />, name: "制作夜间版", desc: "把当前美化转成独立深色" },
  { id: "worldbook", icon: <IconBook size={18} />, name: "拆成世界书", desc: "拆成词条，预览后写入" },
  { id: "char", icon: <IconNewChat size={18} />, name: "创建角色", desc: "解析成结构化角色并保存" },
];

function qaSkillName(id: QaSkillId): string {
  return QA_SKILLS.find((s) => s.id === id)?.name ?? "技能";
}

function QaSkillsPage({ onOpen }: { onOpen: (id: QaSkillId) => void }) {
  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar">
        {QA_SKILLS.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className="qa-cl-sub-row"
            onClick={() => onOpen(skill.id)}
          >
            <span className="qa-cl-sub-ic">{skill.icon}</span>
            <span className="qa-cl-sub-main">
              <b>{skill.name}</b>
              <small>{skill.desc}</small>
            </span>
            <span className="qa-cl-sheet-row-arrow" aria-hidden><IconChevronRight size={16} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 技能通用：真实数据加载 / 会话外观读写 / 颜色变换 / CSS 检查 ──

function useQaChatData() {
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  useEffect(() => {
    let alive = true;
    void hydrateChatStorage().then(() => {
      if (!alive) return;
      setSessions([...loadChatSessions()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      setContacts(loadChatContacts());
      setChars(loadCharacters());
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { ready, sessions, contacts, chars };
}

// 聊天应用的真实深浅色判定：与 chat-room 的 useChatAppearance 用同一个信号
function qaChatDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// 聊天皮肤默认页面底色（styles/imessage26.css 的 --im26-page 浅/深值）
const QA_CHAT_BG_LIGHT = "#ffffff";
const QA_CHAT_BG_DARK = "#171719";

type QaSessionLook = { bg: string | null; char: string; user: string; bubbleConfig: BubbleColors; autoChar: boolean };

function readSessionLook(session: ChatSession, dark: boolean): QaSessionLook {
  const bubbleConfig = loadBubbleColors(session.id, session.bubbleColors ?? {});
  return {
    bg: extractSessionBackground(session.customCSS),
    char: resolveBubbleColors(bubbleConfig, dark, false).surface,
    user: resolveBubbleColors(bubbleConfig, dark, true).surface,
    bubbleConfig,
    autoChar: bubbleConfig.charMode === "auto",
  };
}

// 从会话自定义 CSS 里读 body/html/:root/.chat-app 规则的背景色（后面的声明胜出）
function extractSessionBackground(css: string | undefined): string | null {
  if (!css) return null;
  let found: string | null = null;
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const sels = m[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const hit = sels.some((s) => s === "body" || s === "html" || s === ":root" || s === ".chat-app" || /^(body|html|:root|\.chat-app)\s/.test(s));
    if (!hit) continue;
    const decl = m[2].match(/background(?:-color)?\s*:\s*([^;}]+)/i);
    if (decl) {
      const val = decl[1].trim().split(/\s+/)[0];
      if (/^#[\da-f]{3,8}$/i.test(val) || /^rgba?\(/i.test(val)) found = val;
    }
  }
  return found;
}

// 写会话背景：已有同类声明就改值（不堆积），没有就补一条（body 会被作用域化成会话根元素）
function upsertSessionBackground(css: string | undefined, color: string): string {
  const base = (css ?? "").trim();
  const rule = `body { background-color: ${color}; }`;
  if (!base) return rule;
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
  let last: { start: number; end: number; sel: string; body: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(base)) !== null) {
    const sels = m[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const hit = sels.some((s) => s === "body" || s === "html" || s === ":root" || s === ".chat-app" || /^(body|html|:root|\.chat-app)\s/.test(s));
    if (hit && /background(?:-color)?\s*:/i.test(m[2])) last = { start: m.index, end: m.index + m[0].length, sel: m[1], body: m[2] };
  }
  if (!last) return `${base}\n${rule}`;
  const body = last.body.replace(/background(?:-color)?\s*:\s*[^;}]+/i, `background-color: ${color}`);
  return base.slice(0, last.start) + last.sel + "{" + body + "}" + base.slice(last.end);
}

// 会话外观的真实写入通道：气泡颜色走 kv 存储（自动派发刷新事件），页面背景走 customCSS + 更新事件
function applySessionLook(sessionId: string, bubbleColors: BubbleColors, bg: string) {
  saveBubbleColors(sessionId, bubbleColors, "local");
  const sessions = loadChatSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  const css = upsertSessionBackground(sessions[idx].customCSS, bg);
  sessions[idx] = { ...sessions[idx], customCSS: css };
  saveChatSessions(sessions);
  window.dispatchEvent(new CustomEvent("chat-session-css-updated", { detail: { sessionId, css } }));
}

function restoreSessionLook(sessionId: string, bubbleConfig: BubbleColors, customCSS: string | undefined) {
  saveBubbleColors(sessionId, bubbleConfig, "local");
  const sessions = loadChatSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  sessions[idx] = { ...sessions[idx], customCSS };
  saveChatSessions(sessions);
  window.dispatchEvent(new CustomEvent("chat-session-css-updated", { detail: { sessionId, css: customCSS ?? "" } }));
}

function qaHslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return hex([f(0), f(8), f(4)]);
}

// 夜间版颜色变换：HSL 空间亮度反转 + 饱和度调整（页面压暗、气泡压暗、强调色提到深底可读）
function nightify(color: string, kind: "bg" | "bubble" | "accent"): string {
  const [r, g, b] = rgb(color).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d + 6) % 6) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (kind === "bg") return qaHslToHex(h, Math.min(1, s * 0.7), cl(1 - l, 0.04, 0.12));
  if (kind === "bubble") return qaHslToHex(h, Math.min(1, s * 0.7), cl(1 - l, 0.14, 0.24));
  return qaHslToHex(h, Math.min(1, s * 1.05), cl(0.35 + (1 - l) * 0.35, 0.5, 0.68));
}

function qaColorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// 看图取色：canvas 缩小采样 + 每通道 4bit 量化分桶聚类，按出现次数取主色/辅色，文字色按明度对比推导
async function extractImagePalette(dataUrl: string): Promise<{ main: string; secondary: string; text: string }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });
  const maxSide = 72;
  const scale = Math.min(maxSide / image.width, maxSide / image.height, 1);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画布不可用");
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n += 1;
    cur.r += data[i];
    cur.g += data[i + 1];
    cur.b += data[i + 2];
    buckets.set(key, cur);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((c) => hex([c.r / c.n, c.g / c.n, c.b / c.n]));
  if (ranked.length === 0) throw new Error("图片里没有不透明像素");
  const main = ranked[0];
  const far = ranked.find((c) => qaColorDistance(c, main) > 64);
  return { main, secondary: far ?? mix(main, "#ffffff", 0.45), text: ink(main) };
}

// CSS 检查：未闭合注释、花括号不配对（跳过注释区间，带行号）；deficit>0 可自动修复
type QaCssIssue = { line: number; message: string };

function lintCssText(css: string): { issues: QaCssIssue[]; deficit: number } {
  const issues: QaCssIssue[] = [];
  const lineOf = (index: number) => css.slice(0, index).split("\n").length;
  let depth = 0;
  let surplus = 0;
  const openLines: number[] = [];
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      if (close === -1) {
        issues.push({ line: lineOf(i), message: "「/*」注释没有闭合" });
        return { issues, deficit: 0 };
      }
      i = close + 2;
      continue;
    }
    if (css[i] === "{") {
      depth += 1;
      openLines.push(lineOf(i));
    } else if (css[i] === "}") {
      if (depth === 0) surplus += 1;
      else {
        depth -= 1;
        openLines.pop();
      }
    }
    i += 1;
  }
  if (depth > 0) issues.push({ line: openLines[openLines.length - 1] ?? 1, message: `有 ${depth} 个「{」没有闭合` });
  if (surplus > 0) issues.push({ line: 1, message: `多出 ${surplus} 个「}」` });
  return { issues, deficit: depth };
}

function fixCssText(css: string): string {
  let out = css;
  const openIdx = out.lastIndexOf("/*");
  if (openIdx !== -1 && out.indexOf("*/", openIdx) === -1) out += "\n*/";
  const lint = lintCssText(out);
  if (lint.deficit > 0) out += "\n" + "}".repeat(lint.deficit);
  return out;
}

// 找到当前页面里真正载入的工坊样式表（含 .qa-cl- 规则的同源 <link>），取原始文本做检查
async function fetchQaCssText(): Promise<string | null> {
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      if (!sheet.href) continue;
      let hasQaRules = false;
      try {
        const rules = sheet.cssRules;
        for (let i = 0; i < rules.length; i++) {
          const sel = (rules[i] as CSSStyleRule).selectorText;
          if (sel && sel.includes("qa-cl-")) {
            hasQaRules = true;
            break;
          }
        }
      } catch {
        continue;
      }
      if (!hasQaRules) continue;
      const res = await fetch(sheet.href);
      if (!res.ok) return null;
      return await res.text();
    }
  } catch {
    return null;
  }
  return null;
}

// ── 技能通用 UI（对照设计稿界面 6：步骤行 / 预览卡 / 对比行 / 底部按钮 / 成功提示条） ──

function QaSkillStep({ n, on, title, desc }: { n: number; on: boolean; title: string; desc?: string }) {
  return (
    <div className="qa-cl-skillstep">
      <span className={`qa-cl-step-num${on ? " on" : ""}`}>{n}</span>
      <div className="qa-cl-step-main">
        <p>{title}</p>
        {desc ? <p className="qa-cl-step-desc">{desc}</p> : null}
      </div>
    </div>
  );
}

function QaLookPreview({
  now,
  next,
}: {
  now: { bg: string | null; char: string; user: string };
  next: { bg: string; char: string; user: string };
}) {
  const nowBg = now.bg ?? (qaChatDark() ? QA_CHAT_BG_DARK : QA_CHAT_BG_LIGHT);
  return (
    <div className="qa-cl-pv">
      <div className="qa-cl-pc" style={{ background: nowBg }}>
        <i>{now.bg ? "现在" : "现在 · 默认"}</i>
        <div className="qa-cl-pc-bar" style={{ background: now.char }} />
        <div className="qa-cl-pc-bar" style={{ background: now.user, width: "60%" }} />
      </div>
      <div className="qa-cl-pc" style={{ background: next.bg }}>
        <i>改后</i>
        <div className="qa-cl-pc-bar" style={{ background: next.char }} />
        <div className="qa-cl-pc-bar" style={{ background: next.user, width: "60%" }} />
      </div>
    </div>
  );
}

function QaLookSwatchRow({ label, old, neu }: { label: string; old: string | null; neu: string }) {
  return (
    <div className="qa-cl-df">
      <u>{label}</u>
      {old ? <s style={{ background: old }} title={old} /> : <span className="qa-cl-df-none" title="未自定义">默</span>}
      <span className="qa-cl-df-arrow" aria-hidden><IconChevronRight size={14} /></span>
      <s style={{ background: neu }} title={neu} />
    </div>
  );
}

function QaSkillFooter({
  onCancel,
  onWrite,
  writeLabel,
  writeDisabled,
  written,
  toastLabel,
  onUndo,
}: {
  onCancel: () => void;
  onWrite: () => void;
  writeLabel: string;
  writeDisabled?: boolean;
  written: boolean;
  toastLabel: string;
  onUndo: () => void;
}) {
  return (
    <div className="qa-cl-skillfoot">
      <div className="qa-cl-bts">
        <button type="button" className="qa-cl-bt" onClick={onCancel}>取消</button>
        <button type="button" className="qa-cl-bt pr" onClick={onWrite} disabled={writeDisabled || written}>{writeLabel}</button>
      </div>
      {written && (
        <div className="qa-cl-ts">
          <span>{toastLabel}</span>
          <button type="button" onClick={onUndo}>撤销</button>
        </div>
      )}
    </div>
  );
}

function QaSkillSessionPicker({
  sessions,
  contacts,
  chars,
  selectedId,
  onSelect,
}: {
  sessions: ChatSession[];
  contacts: ChatContact[];
  chars: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="qa-cl-skill-picker">
      {sessions.length === 0 ? (
        <p className="qa-cl-skill-empty">还没有聊天会话：先去聊天应用里和角色聊几句，再回来用这个技能。</p>
      ) : (
        sessions.map((s) => (
          <button key={s.id} type="button" className={`qa-cl-snippet-item${s.id === selectedId ? " on" : ""}`} onClick={() => onSelect(s.id)}>
            <b>{chatSessionName(s, contacts, chars)}</b>
            <small>{formatRefDate(s.updatedAt) || "未知时间"}</small>
          </button>
        ))
      )}
    </div>
  );
}

function QaSkillCountRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="qa-cl-skill-count">
      <span>{label}</span>
      {options.map((opt) => (
        <button key={opt} type="button" className={`qa-cl-chip${value === opt ? " on" : ""}`} onClick={() => onChange(opt)}>
          {opt} 条
        </button>
      ))}
    </div>
  );
}

// ── 技能 1：美化聊天室 ──

const QA_BEAUTY_PRESETS = [
  { id: "clay", name: "陶土暖白", bg: "#FAF9F5", char: "#F0EEE6", user: "#C96342" },
  { id: "mist", name: "雾霾湖蓝", bg: "#EEF2F7", char: "#DCE6F2", user: "#2B6CFF" },
  { id: "moss", name: "苔原青", bg: "#F0F4EF", char: "#DFE9DE", user: "#4F9E63" },
];

function QaSkillBeautyPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions, contacts, chars } = useQaChatData();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>("clay");
  const [custom, setCustom] = useState(false);
  const [customBg, setCustomBg] = useState("#FAF9F5");
  const [customChar, setCustomChar] = useState("#F0EEE6");
  const [customUser, setCustomUser] = useState("#C96342");
  const [written, setWritten] = useState(false);
  const [undoSnap, setUndoSnap] = useState<{ bubbleConfig: BubbleColors; customCSS: string | undefined } | null>(null);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const sessionName = session ? chatSessionName(session, contacts, chars) : "";
  const dark = qaChatDark();
  const now = session ? readSessionLook(session, dark) : null;
  const msgCount = session ? loadChatMessages(session.id).length : 0;
  const preset = QA_BEAUTY_PRESETS.find((p) => p.id === presetId) ?? QA_BEAUTY_PRESETS[0];
  const next = custom ? { bg: customBg, char: customChar, user: customUser } : { bg: preset.bg, char: preset.char, user: preset.user };

  const handleWrite = () => {
    if (!session || !now) return;
    setUndoSnap({ bubbleConfig: now.bubbleConfig, customCSS: session.customCSS });
    applySessionLook(
      session.id,
      { user: next.user, userText: ink(next.user), charMode: "manual", char: next.char, charText: ink(next.char) },
      next.bg,
    );
    setWritten(true);
  };

  const handleUndo = () => {
    if (!session || !undoSnap) return;
    restoreSessionLook(session.id, undoSnap.bubbleConfig, undoSnap.customCSS);
    setWritten(false);
    setUndoSnap(null);
    onNotice?.(`已撤销，「${sessionName}」恢复写入前的外观。`);
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={!!session}
          title="目标会话"
          desc={!ready ? "读取中…" : session ? `${sessionName} · ${msgCount} 条消息` : "选择要美化的会话"}
        />
        {ready && !session && <QaSkillSessionPicker sessions={sessions} contacts={contacts} chars={chars} selectedId={sessionId} onSelect={setSessionId} />}
        <QaSkillStep n={2} on={!!session} title="预览改动" />
        {session && now && (
          <>
            {!written && (
              <div className="qa-cl-chips">
                {QA_BEAUTY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`qa-cl-chip${!custom && p.id === preset.id ? " on" : ""}`}
                    onClick={() => {
                      setCustom(false);
                      setPresetId(p.id);
                    }}
                  >
                    <span className="qa-cl-chip-dot" style={{ background: p.user }} />
                    {p.name}
                  </button>
                ))}
                <button type="button" className={`qa-cl-chip${custom ? " on" : ""}`} onClick={() => setCustom(true)}>自定义</button>
              </div>
            )}
            {custom && !written && (
              <div className="qa-cl-color-row">
                <label>
                  聊天背景
                  <input type="color" value={customBg} onChange={(e) => setCustomBg(e.target.value)} />
                </label>
                <label>
                  气泡颜色
                  <input type="color" value={customChar} onChange={(e) => setCustomChar(e.target.value)} />
                </label>
                <label>
                  强调色
                  <input type="color" value={customUser} onChange={(e) => setCustomUser(e.target.value)} />
                </label>
              </div>
            )}
            <QaLookPreview now={now} next={next} />
            <QaLookSwatchRow label="聊天背景" old={now.bg} neu={next.bg} />
            <QaLookSwatchRow label="气泡颜色" old={now.char} neu={next.char} />
            <QaLookSwatchRow label="强调色" old={now.user} neu={next.user} />
            {now.autoChar && <p className="qa-cl-skill-empty">这个会话的对方气泡是「跟随头像」自动配色，上面读到的是自动算出的当前色。</p>}
          </>
        )}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={`写入到「${sessionName || "…"}」`}
        writeDisabled={!session}
        written={written}
        toastLabel={`已写入「${sessionName}」外观`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 2：看图取色 ──

function QaSkillPalettePage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions, contacts, chars } = useQaChatData();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<{ main: string; secondary: string; text: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [written, setWritten] = useState(false);
  const [undoSnap, setUndoSnap] = useState<{ bubbleConfig: BubbleColors; customCSS: string | undefined } | null>(null);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const sessionName = session ? chatSessionName(session, contacts, chars) : "";
  const dark = qaChatDark();
  const now = session ? readSessionLook(session, dark) : null;
  const next = palette ? { bg: mix(palette.main, "#ffffff", 0.9), char: palette.secondary, user: palette.main } : null;

  const handlePickImage = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      onNotice?.("图片超过 4MB，换一张试试。");
      return;
    }
    setBusy(true);
    setPalette(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      setImageUrl(url);
      setImageName(file.name);
      void extractImagePalette(url)
        .then((p) => setPalette(p))
        .catch(() => onNotice?.("取色失败：这张图读不出像素。"))
        .finally(() => setBusy(false));
    };
    reader.onerror = () => {
      setBusy(false);
      onNotice?.("图片读取失败，换一张试试。");
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleWrite = () => {
    if (!session || !now || !palette || !next) return;
    setUndoSnap({ bubbleConfig: now.bubbleConfig, customCSS: session.customCSS });
    applySessionLook(
      session.id,
      { user: palette.main, userText: palette.text, charMode: "manual", char: palette.secondary, charText: ink(palette.secondary) },
      next.bg,
    );
    setWritten(true);
  };

  const handleUndo = () => {
    if (!session || !undoSnap) return;
    restoreSessionLook(session.id, undoSnap.bubbleConfig, undoSnap.customCSS);
    setWritten(false);
    setUndoSnap(null);
    onNotice?.(`已撤销，「${sessionName}」恢复写入前的外观。`);
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={!!imageUrl && !!session}
          title="目标"
          desc={imageUrl ? `${imageName || "已选图片"}${session ? ` · ${sessionName}` : ""}` : "选一张图片，再选要应用配色的会话"}
        />
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePickImage(e.target.files)} />
        {!written && (
          <>
            <button type="button" className="qa-cl-upload" onClick={() => fileRef.current?.click()}>
              <IconGallery size={18} />
              <span>{imageUrl ? (busy ? "正在取色…" : `已选：${imageName || "图片"}`) : "选择图片（本机文件）"}</span>
            </button>
            {imageUrl && <img className="qa-cl-upload-thumb" src={imageUrl} alt="待取色的图片" />}
            {ready && !session && <QaSkillSessionPicker sessions={sessions} contacts={contacts} chars={chars} selectedId={sessionId} onSelect={setSessionId} />}
          </>
        )}
        <QaSkillStep n={2} on={!!palette} title="预览改动" desc={busy ? "正在从像素里取色…" : undefined} />
        {palette && next && session && now && (
          <>
            <div className="qa-cl-pal">
              <div className="qa-cl-pal-item">
                <s style={{ background: palette.main }} />
                <i>主色 {palette.main.toUpperCase()}</i>
              </div>
              <div className="qa-cl-pal-item">
                <s style={{ background: palette.secondary }} />
                <i>辅色 {palette.secondary.toUpperCase()}</i>
              </div>
              <div className="qa-cl-pal-item">
                <s style={{ background: palette.text }} />
                <i>文字色 {palette.text.toUpperCase()}</i>
              </div>
            </div>
            <QaLookPreview now={now} next={next} />
            <QaLookSwatchRow label="聊天背景" old={now.bg} neu={next.bg} />
            <QaLookSwatchRow label="气泡颜色" old={now.char} neu={next.char} />
            <QaLookSwatchRow label="强调色" old={now.user} neu={next.user} />
          </>
        )}
        {imageUrl && !palette && !busy && <p className="qa-cl-skill-empty">还没有可用的取色结果。</p>}
        {!imageUrl && <p className="qa-cl-skill-empty">先选一张图片：主色来自出现最多的像素簇，辅色是与之差异最大的次高频色，文字色按主色明度自动取黑或白。</p>}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={`写入到「${sessionName || "…"}」`}
        writeDisabled={!session || !palette}
        written={written}
        toastLabel={`已按取色写入「${sessionName}」`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 3：检查报错 ──

type QaLintSourceKind = "logs" | "runtime" | "qacss" | "sessions";

function QaSkillLintPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions } = useQaChatData();
  const [logsIssues, setLogsIssues] = useState<string[]>([]);
  const [runtimeIssues, setRuntimeIssues] = useState<string[]>([]);
  const [qaCss, setQaCss] = useState<{ state: "loading" | "ok" | "unreadable"; issues: QaCssIssue[] }>({ state: "loading", issues: [] });
  const [sessionCssIssues, setSessionCssIssues] = useState<Array<{ session: ChatSession; issues: QaCssIssue[]; fixed: string }>>([]);
  const [include, setInclude] = useState<Record<QaLintSourceKind, boolean>>({ logs: true, runtime: true, qacss: true, sessions: true });
  const [written, setWritten] = useState(false);
  const [undoSnaps, setUndoSnaps] = useState<Array<{ sessionId: string; name: string; css: string }>>([]);

  useEffect(() => {
    const logs = getQaApiLogs().filter((l) => l.rawResponse.startsWith("[API 错误") || l.rawResponse.startsWith("[请求失败]"));
    setLogsIssues(logs.slice(-10).reverse().map((l) => `${l.model || "模型"} · ${capRefText(l.rawResponse, 100)}`));
    setRuntimeIssues(getQaErrorEntries().slice(-10).reverse().map((e) => `${e.kind === "error" ? "脚本错误" : "未捕获 Promise"} · ${capRefText(e.message, 100)}`));
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchQaCssText()
      .then((text) => {
        if (!alive) return;
        if (text == null) {
          setQaCss({ state: "unreadable", issues: [] });
          return;
        }
        setQaCss({ state: "ok", issues: lintCssText(text).issues });
      })
      .catch(() => {
        if (alive) setQaCss({ state: "unreadable", issues: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const found: Array<{ session: ChatSession; issues: QaCssIssue[]; fixed: string }> = [];
    for (const s of sessions) {
      if (!s.customCSS?.trim()) continue;
      const lint = lintCssText(s.customCSS);
      if (lint.issues.length === 0) continue;
      found.push({ session: s, issues: lint.issues, fixed: fixCssText(s.customCSS) });
    }
    setSessionCssIssues(found);
  }, [ready, sessions]);

  const fixable = sessionCssIssues.filter((x) => x.fixed !== x.session.customCSS);
  const totalIssues =
    (include.logs ? logsIssues.length : 0) +
    (include.runtime ? runtimeIssues.length : 0) +
    (include.qacss ? qaCss.issues.length : 0) +
    (include.sessions ? sessionCssIssues.length : 0);

  const handleWrite = () => {
    if (fixable.length === 0) return;
    const updates = fixable.map((f) => ({ sessionId: f.session.id, css: f.session.customCSS ?? "", newCss: f.fixed }));
    const all = loadChatSessions();
    for (const u of updates) {
      const idx = all.findIndex((s) => s.id === u.sessionId);
      if (idx >= 0) all[idx] = { ...all[idx], customCSS: u.newCss };
    }
    saveChatSessions(all);
    for (const u of updates) window.dispatchEvent(new CustomEvent("chat-session-css-updated", { detail: { sessionId: u.sessionId, css: u.newCss } }));
    setUndoSnaps(updates.map((u) => ({ sessionId: u.sessionId, name: "", css: u.css })));
    setWritten(true);
  };

  const handleUndo = () => {
    if (undoSnaps.length === 0) return;
    const all = loadChatSessions();
    for (const u of undoSnaps) {
      const idx = all.findIndex((s) => s.id === u.sessionId);
      if (idx >= 0) all[idx] = { ...all[idx], customCSS: u.css };
    }
    saveChatSessions(all);
    for (const u of undoSnaps) window.dispatchEvent(new CustomEvent("chat-session-css-updated", { detail: { sessionId: u.sessionId, css: u.css } }));
    setWritten(false);
    setUndoSnaps([]);
    onNotice?.("已撤销：会话 CSS 恢复修复前的原文。");
  };

  const sourceRows: Array<{ kind: QaLintSourceKind; label: string; desc: string }> = [
    { kind: "logs", label: "工坊调用日志", desc: !ready ? "读取中…" : logsIssues.length > 0 ? `失败记录 · 最近 ${logsIssues.length} 条` : "没有失败记录" },
    { kind: "runtime", label: "运行时错误", desc: runtimeIssues.length > 0 ? `最近 ${runtimeIssues.length} 条` : "没有捕获到错误" },
    {
      kind: "qacss",
      label: "qa.css 样式表",
      desc: qaCss.state === "loading" ? "读取中…" : qaCss.state === "unreadable" ? "读不到原始文本（内联样式）" : qaCss.issues.length > 0 ? `语法问题 · ${qaCss.issues.length} 处` : "没有语法问题",
    },
    { kind: "sessions", label: "会话自定义 CSS", desc: !ready ? "读取中…" : sessionCssIssues.length > 0 ? `${sessionCssIssues.length} 个会话有问题` : "没有问题" },
  ];

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep n={1} on={ready} title="检查范围" desc="勾选要读取的真实数据源" />
        <div className="qa-cl-skill-picker">
          {sourceRows.map((row) => (
            <button
              key={row.kind}
              type="button"
              className="qa-cl-sub-row"
              aria-pressed={include[row.kind]}
              onClick={() => setInclude((prev) => ({ ...prev, [row.kind]: !prev[row.kind] }))}
            >
              <span className="qa-cl-sub-ic"><IconFile size={16} /></span>
              <span className="qa-cl-sub-main">
                <b>{row.label}</b>
                <small>{row.desc}</small>
              </span>
              <span className={`qa-cl-ck ${include[row.kind] ? "on" : ""}`} aria-hidden>
                {include[row.kind] && <IconCheckMark size={14} />}
              </span>
            </button>
          ))}
        </div>
        <QaSkillStep n={2} on={ready} title="预览改动" desc={totalIssues === 0 ? "没有发现问题" : `共 ${totalIssues} 处`} />
        {include.logs &&
          logsIssues.map((text, i) => (
            <div className="qa-cl-issue" key={`log-${i}`}>
              <span className="dot" />
              {text}
            </div>
          ))}
        {include.runtime &&
          runtimeIssues.map((text, i) => (
            <div className="qa-cl-issue" key={`rt-${i}`}>
              <span className="dot" />
              {text}
            </div>
          ))}
        {include.qacss &&
          qaCss.state === "ok" &&
          qaCss.issues.map((issue, i) => (
            <div className="qa-cl-issue" key={`css-${i}`}>
              <span className="dot" />
              qa.css 第 {issue.line} 行：{issue.message}
            </div>
          ))}
        {include.sessions &&
          sessionCssIssues.map((item) => {
            const canFix = item.fixed !== item.session.customCSS;
            return (
              <div className="qa-cl-issue" key={item.session.id}>
                <span className="dot" />
                <div>
                  <b>会话自定义 CSS · {item.session.id}</b>
                  {item.issues.map((issue, i) => (
                    <small key={i}>
                      第 {issue.line} 行：{issue.message}
                    </small>
                  ))}
                  {canFix && (
                    <>
                      <small>可自动修复：补全缺失的闭合。修复前 → 修复后：</small>
                      <div className="qa-cl-field-diff">
                        <div>{capRefText(item.session.customCSS ?? "", 300) || "（空）"}</div>
                        <div className="is-new">{capRefText(item.fixed, 300) || "（空）"}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        {totalIssues === 0 && <p className="qa-cl-skill-empty">没有发现问题：勾选的范围里都是干净的。</p>}
        {totalIssues > 0 && fixable.length === 0 && <p className="qa-cl-skill-empty">这些问题没有自动修复方案（比如多出来的「{'}'}」要人工删），这里只如实展示。</p>}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={fixable.length > 0 ? `写入修复（${fixable.length} 个会话）` : "没有可修复项"}
        writeDisabled={fixable.length === 0}
        written={written}
        toastLabel={`已修复 ${undoSnaps.length} 个会话的 CSS`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 4：润色人设 ──

const QA_PERSONA_FIELDS = [
  { key: "persona", label: "人设", hint: "身份背景、外貌、说话风格" },
  { key: "personality", label: "性格", hint: "一句话概括" },
  { key: "briefPersona", label: "简介", hint: "别人可感知的第三人称简介" },
] as const;

type QaPersonaFieldKey = (typeof QA_PERSONA_FIELDS)[number]["key"];

function QaSkillPersonaPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, chars } = useQaChatData();
  const [charId, setCharId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<QaPersonaFieldKey, string>>({ persona: "", personality: "", briefPersona: "" });
  const [written, setWritten] = useState(false);
  const [undoChar, setUndoChar] = useState<Character | null>(null);

  const char = chars.find((c) => c.id === charId) ?? null;

  const handlePick = (id: string) => {
    const c = chars.find((x) => x.id === id);
    if (!c) return;
    setCharId(id);
    setEdits({ persona: c.persona, personality: c.personality ?? "", briefPersona: c.briefPersona ?? "" });
  };

  const changedCount = char
    ? QA_PERSONA_FIELDS.filter((f) => edits[f.key] !== ((char[f.key] as string | undefined) ?? "")).length
    : 0;

  const handleWrite = () => {
    if (!char || changedCount === 0) return;
    const all = loadCharacters();
    const idx = all.findIndex((c) => c.id === char.id);
    if (idx < 0) return;
    setUndoChar(all[idx]);
    const nowIso = new Date().toISOString();
    all[idx] = {
      ...all[idx],
      persona: edits.persona,
      personality: edits.personality.trim() || undefined,
      briefPersona: edits.briefPersona.trim() || undefined,
      briefPersonaUpdatedAt: edits.briefPersona.trim() ? nowIso : all[idx].briefPersonaUpdatedAt,
      updatedAt: nowIso,
    };
    saveCharacters(all);
    setWritten(true);
  };

  const handleUndo = () => {
    if (!undoChar) return;
    const all = loadCharacters();
    const idx = all.findIndex((c) => c.id === undoChar.id);
    if (idx >= 0) {
      all[idx] = undoChar;
      saveCharacters(all);
    }
    setWritten(false);
    setUndoChar(null);
    onNotice?.(`已撤销，「${undoChar.name}」的字段恢复原文。`);
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={!!char}
          title="目标角色"
          desc={!ready ? "读取中…" : char ? `${char.name || "未命名"} · 修改 ${changedCount} 个字段` : "选择要润色的角色卡"}
        />
        {ready && !char && (
          <div className="qa-cl-skill-picker">
            {chars.length === 0 ? (
              <p className="qa-cl-skill-empty">角色库还是空的，先用「创建角色」或联系人页建一个。</p>
            ) : (
              chars.map((c) => (
                <button key={c.id} type="button" className={`qa-cl-snippet-item${c.id === charId ? " on" : ""}`} onClick={() => handlePick(c.id)}>
                  <b>{c.name || "未命名"}</b>
                  <small>{c.briefPersona ? capRefText(c.briefPersona, 16) : "无简介"}</small>
                </button>
              ))
            )}
          </div>
        )}
        <QaSkillStep n={2} on={changedCount > 0} title="预览改动" desc={char ? "编辑字段，下面实时对比旧文 → 新文" : undefined} />
        {char && !written && (
          <>
            <div className="qa-cl-field">
              <div className="qa-cl-field-label">
                <span>编辑说明</span>
              </div>
              <p className="qa-cl-skill-empty">只改你编辑过的字段，其余保持原样。</p>
            </div>
            {QA_PERSONA_FIELDS.map((f) => {
              const oldValue = ((char[f.key] as string | undefined) ?? "");
              const changedField = edits[f.key] !== oldValue;
              return (
                <div className="qa-cl-field" key={f.key}>
                  <div className="qa-cl-field-label">
                    <span>
                      {f.label}
                      {changedField ? " · 已修改" : ""}
                    </span>
                    <small>{f.hint}</small>
                  </div>
                  <textarea
                    className="qa-cl-field-input qa-cl-textarea"
                    value={edits[f.key]}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                  {changedField && (
                    <div className="qa-cl-field-diff">
                      <div>{capRefText(oldValue, 400) || "（空）"}</div>
                      <div className="is-new">{capRefText(edits[f.key], 400) || "（空）"}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={`写入到「${char?.name || "…"}」`}
        writeDisabled={!char || changedCount === 0}
        written={written}
        toastLabel={`已写入「${char?.name ?? ""}」的人设`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 5：制作夜间版 ──

function QaSkillNightPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions, contacts, chars } = useQaChatData();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [written, setWritten] = useState(false);
  const [undoSnap, setUndoSnap] = useState<{ bubbleConfig: BubbleColors; customCSS: string | undefined } | null>(null);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const sessionName = session ? chatSessionName(session, contacts, chars) : "";
  const dark = qaChatDark();
  const now = session ? readSessionLook(session, dark) : null;
  const styled = now ? now.bg != null || Object.keys(now.bubbleConfig).length > 0 : false;
  const next = now
    ? {
        bg: nightify(now.bg ?? (dark ? QA_CHAT_BG_DARK : QA_CHAT_BG_LIGHT), "bg"),
        char: nightify(now.char, "bubble"),
        user: nightify(now.user, "accent"),
      }
    : null;

  const handleWrite = () => {
    if (!session || !now || !next) return;
    setUndoSnap({ bubbleConfig: now.bubbleConfig, customCSS: session.customCSS });
    applySessionLook(
      session.id,
      { user: next.user, userText: ink(next.user), charMode: "manual", char: next.char, charText: ink(next.char) },
      next.bg,
    );
    setWritten(true);
  };

  const handleUndo = () => {
    if (!session || !undoSnap) return;
    restoreSessionLook(session.id, undoSnap.bubbleConfig, undoSnap.customCSS);
    setWritten(false);
    setUndoSnap(null);
    onNotice?.(`已撤销，「${sessionName}」恢复写入前的外观。`);
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={!!session}
          title="目标会话"
          desc={!ready ? "读取中…" : session ? `${sessionName} · ${styled ? "已有自定义外观" : "当前是默认外观"}` : "选择要做夜间版的会话"}
        />
        {ready && !session && <QaSkillSessionPicker sessions={sessions} contacts={contacts} chars={chars} selectedId={sessionId} onSelect={setSessionId} />}
        <QaSkillStep n={2} on={!!session} title="预览改动" desc={session ? "亮度反转 + 饱和度调整，从当前真实配色算出" : undefined} />
        {session && now && next && (
          <>
            <QaLookPreview now={now} next={next} />
            <QaLookSwatchRow label="聊天背景" old={now.bg} neu={next.bg} />
            <QaLookSwatchRow label="气泡颜色" old={now.char} neu={next.char} />
            <QaLookSwatchRow label="强调色" old={now.user} neu={next.user} />
            <p className="qa-cl-skill-empty">说明：当前存储一档外观（不分浅/深两套），写入会替换为夜间配色；撤销可还原。</p>
          </>
        )}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={`写入到「${sessionName || "…"}」`}
        writeDisabled={!session}
        written={written}
        toastLabel={`已写入「${sessionName}」夜间版`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 6：拆成世界书 ──

type QaWbEntryDraft = { key: string; content: string };

function QaSkillWorldBookPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions, contacts, chars } = useQaChatData();
  const [kind, setKind] = useState<"chat" | "char" | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snippetCount, setSnippetCount] = useState("20");
  const [charId, setCharId] = useState<string | null>(null);
  const [bookName, setBookName] = useState("");
  const [entries, setEntries] = useState<QaWbEntryDraft[]>([]);
  const [written, setWritten] = useState(false);
  const [undoSnap, setUndoSnap] = useState<{ books: WorldBookConfig[]; binding: BindingConfig; boundCharId: string | null } | null>(null);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const sourceChar = chars.find((c) => c.id === charId) ?? null;
  const sourceLabel = kind === "chat" && session ? chatSessionName(session, contacts, chars) : kind === "char" && sourceChar ? sourceChar.name : "";

  const buildEntries = useCallback((): QaWbEntryDraft[] => {
    if (kind === "chat" && session) {
      const parsed = Number(snippetCount);
      const count = Number.isFinite(parsed) && parsed >= 1 && parsed <= 50 ? Math.floor(parsed) : 20;
      const msgs = loadChatMessages(session.id, count);
      const out: QaWbEntryDraft[] = [];
      for (let i = 0; i < msgs.length; i += 6) {
        const chunk = msgs.slice(i, i + 6);
        const content = chunk
          .map((m) => `${m.role === "user" ? "用户" : m.role === "assistant" ? "角色" : "系统"}：${capRefText(m.content, 300)}`)
          .join("\n");
        out.push({ key: `「${chatSessionName(session, contacts, chars)}」片段${out.length + 1}`, content });
      }
      return out;
    }
    if (kind === "char" && sourceChar) {
      const out: QaWbEntryDraft[] = [];
      const paras = (sourceChar.persona || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
      for (const p of paras) out.push({ key: capRefText(p, 10), content: capRefText(p, 400) });
      if (sourceChar.personality?.trim()) out.push({ key: "性格", content: capRefText(sourceChar.personality.trim(), 200) });
      return out;
    }
    return [];
  }, [kind, session, sourceChar, snippetCount, contacts, chars]);

  useEffect(() => {
    if (kind == null) return;
    setEntries(buildEntries());
    if (!bookName) setBookName(sourceLabel ? `${sourceLabel} · 世界书` : "工坊世界书");
    // 换来源 / 换条数会重新拆分，覆盖下面的手动编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sessionId, charId, snippetCount]);

  const bindCharId =
    kind === "char" && sourceChar ? sourceChar.id : kind === "chat" && session ? contacts.find((c) => c.id === session.contactId)?.characterId ?? null : null;
  const bindChar = chars.find((c) => c.id === bindCharId) ?? null;

  const handleWrite = () => {
    if (entries.length === 0) return;
    const booksSnap = loadWorldBooks();
    const bindingSnap = loadBindingConfig();
    const book = createWorldBook(bookName.trim() || "工坊世界书");
    const wbEntries: WorldBookEntry[] = entries.map((e, i) => ({
      uid: `wbe_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      key: e.key,
      content: e.content,
      comment: `来源：工坊「拆成世界书」（${sourceLabel || "本机内容"}）`,
      use_regex: false,
      disable: false,
      constant: false,
      position: "before_char",
      depth: 0,
      probability: 100,
      useProbability: false,
      role: 0,
      insertion_order: i,
    }));
    book.entries = wbEntries;
    saveWorldBooks([...booksSnap, book]);
    let bound: string | null = null;
    if (bindCharId) {
      const config = loadBindingConfig();
      const binding = getCharacterBinding(config, bindCharId);
      const slot = { ...binding.defaults, worldBookIds: [...(binding.defaults.worldBookIds ?? []), book.id] };
      saveBindingConfig(setCharacterBinding(config, { ...binding, defaults: slot }));
      bound = bindCharId;
    }
    setUndoSnap({ books: booksSnap, binding: bindingSnap, boundCharId: bound });
    setWritten(true);
  };

  const handleUndo = () => {
    if (!undoSnap) return;
    saveWorldBooks(undoSnap.books);
    saveBindingConfig(undoSnap.binding);
    setWritten(false);
    setUndoSnap(null);
    onNotice?.("已撤销：世界书已删除，角色绑定恢复原样。");
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={kind != null && (kind === "chat" ? !!session : !!sourceChar)}
          title="来源"
          desc={!ready ? "读取中…" : sourceLabel ? `「${sourceLabel}」` : "选聊天片段或角色卡内容当原料"}
        />
        {!written && !kind && (
          <div className="qa-cl-chips">
            <button type="button" className="qa-cl-chip on" onClick={() => setKind("chat")}>聊天片段</button>
            <button type="button" className="qa-cl-chip" onClick={() => setKind("char")}>角色卡内容</button>
          </div>
        )}
        {!written && kind === "chat" && !session && (
          <>
            <QaSkillSessionPicker sessions={sessions} contacts={contacts} chars={chars} selectedId={sessionId} onSelect={setSessionId} />
            <QaSkillCountRow label="取最近" value={snippetCount} onChange={setSnippetCount} options={["10", "20", "50"]} />
          </>
        )}
        {!written && kind === "char" && !sourceChar && (
          <div className="qa-cl-skill-picker">
            {chars.length === 0 ? (
              <p className="qa-cl-skill-empty">角色库还是空的，没有可拆的角色卡。</p>
            ) : (
              chars.map((c) => (
                <button key={c.id} type="button" className={`qa-cl-snippet-item${c.id === charId ? " on" : ""}`} onClick={() => setCharId(c.id)}>
                  <b>{c.name || "未命名"}</b>
                  <small>{c.persona ? `${c.persona.length} 字人设` : "无人设"}</small>
                </button>
              ))
            )}
          </div>
        )}
        <QaSkillStep n={2} on={entries.length > 0} title="预览改动" desc={entries.length > 0 ? `拆出 ${entries.length} 个词条，可编辑后写入` : undefined} />
        {entries.length > 0 && (
          <>
            {!written && (
              <>
                <div className="qa-cl-field">
                  <div className="qa-cl-field-label">
                    <span>世界书名</span>
                    <small>{bindChar ? `将绑定到角色「${bindChar.name}」` : "未找到对应角色，只保存不绑定"}</small>
                  </div>
                  <input className="qa-cl-field-input" value={bookName} onChange={(e) => setBookName(e.target.value)} />
                </div>
                {entries.map((entry, i) => (
                  <div className="qa-cl-wb-entry" key={i}>
                    <div className="qa-cl-wb-entry-head">
                      <input
                        className="qa-cl-field-input"
                        value={entry.key}
                        onChange={(e) => setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        className="qa-cl-wb-del"
                        aria-label="删除词条"
                        onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <textarea
                      className="qa-cl-field-input qa-cl-textarea"
                      value={entry.content}
                      onChange={(e) => setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
                    />
                  </div>
                ))}
                <p className="qa-cl-wb-count">词条 {entries.length} 个 · 换来源或条数会重新拆分</p>
              </>
            )}
            {written && <p className="qa-cl-wb-count">已写入「{bookName}」· {entries.length} 个词条</p>}
          </>
        )}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={entries.length > 0 ? `写入「${bookName.trim() || "工坊世界书"}」` : "先选择来源"}
        writeDisabled={entries.length === 0}
        written={written}
        toastLabel={`已写入「${bookName.trim() || "工坊世界书"}」`}
        onUndo={handleUndo}
      />
    </div>
  );
}

// ── 技能 7：创建角色（复用 npc-generator 的标签协议解析器 + simpleLLMCall 真实调用） ──

function qaExtractTag(text: string, tag: string): string {
  const match = text.match(new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`));
  return match?.[1]?.trim() ?? "";
}

const QA_CHAR_PARSE_PROMPT = [
  "你是角色档案助手。请把用户给的内容整理成一份结构化角色卡。",
  "严格按以下标签输出，每个标签都必填，标签外不要输出任何其他内容：",
  "[名字]角色姓名[/名字]",
  "[人设]完整角色卡：身份背景、外貌、性格、说话风格、习惯癖好，300~600字[/人设]",
  "[性格]一句话性格概括[/性格]",
  "[简介]100~200字第三人称简量人设，供其他角色了解TA时注入使用，只写别人可感知的信息[/简介]",
  "要求：内容必须来自用户给的资料，可以合理补全细节，但不要虚构与资料冲突的设定。",
].join("\n");

function QaSkillCharPage({ onNotice, onCancel }: { onNotice?: (msg: string) => void; onCancel: () => void }) {
  const { ready, sessions, contacts, chars } = useQaChatData();
  const [mode, setMode] = useState<"text" | "chat">("text");
  const [rawText, setRawText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snippetCount, setSnippetCount] = useState("10");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ name: string; persona: string; personality: string; briefPersona: string } | null>(null);
  const [written, setWritten] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const chatSource = useMemo(() => {
    if (mode !== "chat" || !session) return "";
    const parsedCount = Number(snippetCount);
    const count = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 50 ? Math.floor(parsedCount) : 10;
    return loadChatMessages(session.id, count)
      .map((m) => `${m.role === "user" ? "用户" : "角色"}：${capRefText(m.content, 400)}`)
      .join("\n");
  }, [mode, session, snippetCount]);
  const sourceText = mode === "text" ? rawText : chatSource;

  const handleParse = useCallback(async () => {
    const apiConfig = resolveQaApiConfig();
    if (!apiConfig) {
      setParseError("还没有可用的 API 配置：先在「··· → 模型」里选一个。");
      return;
    }
    if (!sourceText.trim()) {
      setParseError("先输入或选择要解析的内容。");
      return;
    }
    setParsing(true);
    setParseError(null);
    setParsed(null);
    try {
      const result = await simpleLLMCall(
        apiConfig,
        [
          { role: "system", content: QA_CHAR_PARSE_PROMPT },
          { role: "user", content: `请整理以下内容：\n\n${capRefText(sourceText, 4000)}` },
        ],
        { temperature: 0.85, max_tokens: 4096, label: "技能·创建角色" },
      );
      if (result.error || !result.content) {
        setParseError(result.error || "模型返回了空内容，重试一次试试。");
      } else {
        const name = qaExtractTag(result.content, "名字");
        const persona = qaExtractTag(result.content, "人设");
        if (!name || !persona) {
          setParseError("解析失败：模型没有按 [名字]/[人设] 标签输出，重试一次试试。");
        } else {
          setParsed({ name, persona, personality: qaExtractTag(result.content, "性格"), briefPersona: qaExtractTag(result.content, "简介") });
        }
      }
    } finally {
      setParsing(false);
    }
  }, [sourceText]);

  const handleWrite = () => {
    if (!parsed) return;
    const nowIso = new Date().toISOString();
    const newChar = createCharacter({
      name: parsed.name,
      persona: parsed.persona,
      personality: parsed.personality || undefined,
      briefPersona: parsed.briefPersona || undefined,
      briefPersonaUpdatedAt: parsed.briefPersona ? nowIso : undefined,
      avatar: null,
      tags: ["工坊创建"],
    });
    saveCharacters([...loadCharacters(), newChar]);
    setUndoId(newChar.id);
    setWritten(true);
  };

  const handleUndo = () => {
    if (!undoId) return;
    saveCharacters(loadCharacters().filter((c) => c.id !== undoId));
    setWritten(false);
    setUndoId(null);
    onNotice?.("已撤销：角色已从角色库删除。");
  };

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar qa-cl-skillpage">
        <QaSkillStep
          n={1}
          on={sourceText.trim().length > 0}
          title="人设文本"
          desc={!ready ? "读取中…" : sourceText.trim() ? `${capRefText(sourceText.trim(), 24)}… · ${sourceText.length} 字` : "粘贴人设文本，或从对话里选"}
        />
        {!written && (
          <>
            <div className="qa-cl-chips">
              <button type="button" className={`qa-cl-chip${mode === "text" ? " on" : ""}`} onClick={() => setMode("text")}>输入文本</button>
              <button type="button" className={`qa-cl-chip${mode === "chat" ? " on" : ""}`} onClick={() => setMode("chat")}>从对话选择</button>
            </div>
            {mode === "text" && (
              <div className="qa-cl-field">
                <textarea
                  className="qa-cl-field-input qa-cl-textarea"
                  placeholder="把人设、简介或聊天记录贴到这里，再点「解析」"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
              </div>
            )}
            {mode === "chat" && (
              <>
                {!session && <QaSkillSessionPicker sessions={sessions} contacts={contacts} chars={chars} selectedId={sessionId} onSelect={setSessionId} />}
                <QaSkillCountRow label="取最近" value={snippetCount} onChange={setSnippetCount} options={["10", "20", "50"]} />
                {chatSource && <p className="qa-cl-skill-empty">原文预览：{capRefText(chatSource, 160)}</p>}
              </>
            )}
            <div className="qa-cl-skill-count">
              <button type="button" className="qa-cl-chip" onClick={() => void handleParse()} disabled={parsing}>
                {parsing ? "解析中…" : "解析成结构化角色"}
              </button>
            </div>
          </>
        )}
        <QaSkillStep n={2} on={!!parsed} title="预览改动" desc={parsed ? `解析出「${parsed.name}」· 人设 ${parsed.persona.length} 字` : undefined} />
        {parseError && <p className="qa-cl-skill-empty">{parseError}</p>}
        {parsed && (
          <>
            <div className="qa-cl-field">
              <div className="qa-cl-field-label">
                <span>名字</span>
              </div>
              <input className="qa-cl-field-input" value={parsed.name} readOnly />
            </div>
            <div className="qa-cl-field">
              <div className="qa-cl-field-label">
                <span>人设（{parsed.persona.length} 字）</span>
              </div>
              <div className="qa-cl-field-diff">
                <div>{capRefText(sourceText, 400) || "（无原文）"}</div>
                <div className="is-new">{capRefText(parsed.persona, 400)}</div>
              </div>
            </div>
            {parsed.personality && (
              <div className="qa-cl-field">
                <div className="qa-cl-field-label">
                  <span>性格</span>
                </div>
                <input className="qa-cl-field-input" value={parsed.personality} readOnly />
              </div>
            )}
            {parsed.briefPersona && (
              <div className="qa-cl-field">
                <div className="qa-cl-field-label">
                  <span>简介（{parsed.briefPersona.length} 字）</span>
                </div>
                <textarea className="qa-cl-field-input qa-cl-textarea" value={parsed.briefPersona} readOnly />
              </div>
            )}
          </>
        )}
        <QaSkillStep n={3} on={written} title="确认后才写入" />
        <QaSkillStep n={4} on={written} title="写入后可一键撤销" />
      </div>
      <QaSkillFooter
        onCancel={onCancel}
        onWrite={handleWrite}
        writeLabel={parsed ? `写入到「${parsed.name}」` : "先解析再写入"}
        writeDisabled={!parsed}
        written={written}
        toastLabel={`已保存角色「${parsed?.name ?? ""}」到角色库`}
        onUndo={handleUndo}
      />
    </div>
  );
}

function QaSkillFlow({ skillId, onNotice, onCancel }: { skillId: QaSkillId; onNotice?: (msg: string) => void; onCancel: () => void }) {
  switch (skillId) {
    case "beauty":
      return <QaSkillBeautyPage onNotice={onNotice} onCancel={onCancel} />;
    case "palette":
      return <QaSkillPalettePage onNotice={onNotice} onCancel={onCancel} />;
    case "lint":
      return <QaSkillLintPage onNotice={onNotice} onCancel={onCancel} />;
    case "persona":
      return <QaSkillPersonaPage onNotice={onNotice} onCancel={onCancel} />;
    case "night":
      return <QaSkillNightPage onNotice={onNotice} onCancel={onCancel} />;
    case "worldbook":
      return <QaSkillWorldBookPage onNotice={onNotice} onCancel={onCancel} />;
    case "char":
      return <QaSkillCharPage onNotice={onNotice} onCancel={onCancel} />;
  }
}

// ── 引用本机内容（界面 4：7 个入口全部接真实数据源） ──

type QaRefKind = "appearance" | "offline" | "heart" | "snippet" | "chars" | "worldbooks" | "share";

const QA_REF_KINDS: QaRefKind[] = ["appearance", "offline", "heart", "snippet", "chars", "worldbooks", "share"];

function QaRefsPage({ onNotice, onAddRefs }: { onNotice?: (msg: string) => void; onAddRefs: (refs: QaPendingRef[]) => void }) {
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [msgCounts, setMsgCounts] = useState<Record<string, number>>({});
  const [offlineCount, setOfflineCount] = useState(0);
  const [heartCount, setHeartCount] = useState(0);
  const [shareIndex, setShareIndex] = useState<ShareIndex | null>(null);
  const [shareState, setShareState] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [selected, setSelected] = useState<Set<QaRefKind>>(() => new Set());
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [snippetPick, setSnippetPick] = useState<{ sessionId: string; count: number } | null>(null);
  const [snippetPickSession, setSnippetPickSession] = useState<string | null>(null);
  const [snippetCountInput, setSnippetCountInput] = useState("10");

  // 打开页面先补聊天存储水合，再同步统计各项真实数量（不编数据）
  useEffect(() => {
    let alive = true;
    void hydrateChatStorage().then(() => {
      if (!alive) return;
      const allSessions = [...loadChatSessions()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const allContacts = loadChatContacts();
      const allChars = loadCharacters();
      const counts: Record<string, number> = {};
      let hearts = 0;
      let offlines = 0;
      for (const s of allSessions) {
        const msgs = loadChatMessages(s.id);
        counts[s.id] = msgs.length;
        offlines += loadChatOfflineTurns(s.id).length;
        for (const m of msgs) {
          if (m.role === "assistant" && m.innerMonologue?.trim()) hearts += 1;
        }
      }
      setSessions(allSessions);
      setContacts(allContacts);
      setChars(allChars);
      setMsgCounts(counts);
      setOfflineCount(offlines);
      setHeartCount(hearts);
      setReady(true);
    });
    // 仓库帖子：资源集市索引为异步 CDN 拉取，失败如实标错、行禁用
    void fetchShareIndex(loadResourceHubSource())
      .then((index) => {
        if (!alive) return;
        setShareIndex(index);
        setShareState(index.entries.length > 0 ? "ok" : "empty");
      })
      .catch(() => {
        if (!alive) return;
        setShareState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggleKind = useCallback((kind: QaRefKind) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const latestSession = sessions.length > 0 ? sessions[0] : null;
  const latestName = latestSession ? chatSessionName(latestSession, contacts, chars) : "";
  const charCount = chars.length;
  const worldBookCount = useMemo(() => loadWorldBooks().length, []);
  const snippetName = snippetPick
    ? chatSessionName(sessions.find((s) => s.id === snippetPick.sessionId) ?? sessions[0], contacts, chars)
    : "";

  // 各行的真实副标题：读不到 / 还没有就如实说，绝不显示假数字
  const appearanceDesc = !ready
    ? "读取中…"
    : latestSession
      ? `${latestName} · 更新于${formatRefDate(latestSession.updatedAt) || "未知时间"}`
      : "还没有聊天会话";
  const offlineDesc = !ready ? "读取中…" : offlineCount > 0 ? `聊天生成记录 · ${offlineCount} 条` : "聊天生成记录 · 还没有";
  const heartDesc = !ready ? "读取中…" : heartCount > 0 ? `消息里已保存的内心独白 · ${heartCount} 条` : "还没有保存过内心独白";
  const snippetDesc = !ready ? "读取中…" : sessions.length === 0 ? "还没有聊天会话" : snippetPick ? `${snippetName} · 最近 ${snippetPick.count} 条` : "自己选会话和消息范围";
  const charsDesc = !ready ? "读取中…" : charCount > 0 ? `角色库 · ${charCount} 个` : "角色库 · 还没有角色";
  const worldBooksDesc = !ready ? "读取中…" : worldBookCount > 0 ? `设置里的世界书 · ${worldBookCount} 本` : "设置里还没有世界书";
  const shareDesc =
    shareState === "loading"
      ? "资源集市读取中…"
      : shareState === "error"
        ? "资源集市暂时读不到"
        : shareIndex && shareIndex.entries.length > 0
          ? `资源集市 · ${shareIndex.entries.length} 个帖子`
          : "资源集市里还没有帖子";

  const confirmSnippet = () => {
    const sessionId = snippetPickSession;
    if (!sessionId) return;
    const parsed = Number(snippetCountInput);
    const count = Number.isFinite(parsed) && parsed >= 1 && parsed <= 50 ? Math.floor(parsed) : 10;
    setSnippetCountInput(String(count));
    setSnippetPick({ sessionId, count });
    setSelected((prev) => new Set(prev).add("snippet"));
    setSnippetOpen(false);
  };

  // 勾选确认时才读取真实数据并组装引用正文（来源标注 + 截断说明）
  const buildRefPayload = useCallback(
    (kind: QaRefKind): QaPendingRef | null => {
      switch (kind) {
        case "appearance": {
          const s = latestSession;
          if (!s) return null;
          const name = chatSessionName(s, contacts, chars);
          const parts = [
            `来源：聊天应用「${name}」会话的外观设置`,
            `背景图：${s.backgroundImage ? `已设置（约 ${formatAttachBytes(s.backgroundImage.length)}）` : "未设置"}`,
            `玻璃气泡：${s.glassBubblesEnabled ? "开启" : "关闭"}`,
            `美化预设：${s.beautyPreset ?? "未设置"}`,
            `气泡颜色：${s.bubbleColors ? JSON.stringify(s.bubbleColors) : "未自定义"}`,
            `自定义 CSS：${s.customCSS ? capRefText(s.customCSS, 2000) : "未设置"}`,
          ];
          return { id: makeAttachId(), label: `聊天室外观 · ${name}`, text: parts.join("\n") };
        }
        case "offline": {
          const turns = sessions
            .flatMap((s) => loadChatOfflineTurns(s.id))
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, 20);
          if (turns.length === 0) return null;
          const body = turns
            .map((t, i) => `${i + 1}. 【用户】${capRefText(t.userContent, 80)}\n   【生成小结】${capRefText(t.summary, 80)}`)
            .join("\n");
          return { id: makeAttachId(), label: `线下模式记录 · 最近 ${turns.length} 条`, text: `来源：聊天应用的线下生成记录（最多带最近 20 条）\n${body}` };
        }
        case "heart": {
          const hearts: string[] = [];
          for (const s of sessions) {
            const msgs = loadChatMessages(s.id);
            for (let i = msgs.length - 1; i >= 0 && hearts.length < 20; i--) {
              const m = msgs[i];
              if (m.role === "assistant" && m.innerMonologue?.trim()) {
                hearts.push(`「${chatSessionName(s, contacts, chars)}」${capRefText(m.innerMonologue, 140)}`);
              }
            }
          }
          if (hearts.length === 0) return null;
          return { id: makeAttachId(), label: `心声 · 最近 ${hearts.length} 条`, text: `来源：聊天会话里保存的内心独白\n${hearts.join("\n")}` };
        }
        case "snippet": {
          const pick = snippetPick;
          if (!pick) return null;
          const session = sessions.find((s) => s.id === pick.sessionId);
          if (!session) return null;
          const name = chatSessionName(session, contacts, chars);
          const msgs = loadChatMessages(pick.sessionId, pick.count);
          if (msgs.length === 0) return null;
          const body = msgs
            .map((m) => `${m.role === "user" ? "【用户】" : m.role === "assistant" ? "【角色】" : `【${m.role}】`}${capRefText(m.content, 500)}`)
            .join("\n");
          return { id: makeAttachId(), label: `聊天片段 · ${name} · 最近 ${msgs.length} 条`, text: `来源：「${name}」最近 ${msgs.length} 条消息\n${body}` };
        }
        case "chars": {
          const all = chars;
          if (all.length === 0) return null;
          const body = all
            .map((c, i) => `${i + 1}. ${c.name}${c.personality ? `（性格：${capRefText(c.personality, 60)}）` : ""}\n${capRefText(c.persona, 300)}`)
            .join("\n\n");
          return { id: makeAttachId(), label: `角色卡 · ${all.length} 个`, text: `来源：本机角色库\n${capRefText(body, 8000)}` };
        }
        case "worldbooks": {
          const books = loadWorldBooks();
          if (books.length === 0) return null;
          const body = books
            .map((b) => {
              const head = `《${b.name}》 · ${b.entries.length} 个词条`;
              const sample = b.entries
                .slice(0, 5)
                .map((e) => `· ${e.key}：${capRefText(e.content, 120)}`)
                .join("\n");
              return sample ? `${head}\n${sample}` : head;
            })
            .join("\n\n");
          return { id: makeAttachId(), label: `世界书 · ${books.length} 本`, text: `来源：设置里的世界书（每本带前 5 个词条示例）\n${capRefText(body, 8000)}` };
        }
        case "share": {
          const index = shareIndex;
          if (!index || index.entries.length === 0) return null;
          const folders = index.folders.map((f) => `${f.name}×${f.count}`).join("、");
          const names = index.entries
            .slice(0, 40)
            .map((e) => `· ${e.folder} / ${e.name}`)
            .join("\n");
          return { id: makeAttachId(), label: `仓库帖子 · ${index.entries.length} 个`, text: `来源：资源集市分享索引（共 ${index.entries.length} 个，此处列前 40 个）\n目录：${folders}\n${names}` };
        }
      }
      return null;
    },
    [latestSession, sessions, contacts, chars, snippetPick, shareIndex],
  );

  const handleAdd = useCallback(() => {
    const refs: QaPendingRef[] = [];
    for (const kind of QA_REF_KINDS) {
      if (!selected.has(kind)) continue;
      const ref = buildRefPayload(kind);
      if (ref) refs.push(ref);
    }
    if (refs.length === 0) {
      onNotice?.("没有读到可引用的内容，换一项试试。");
      return;
    }
    onAddRefs(refs);
  }, [selected, buildRefPayload, onAddRefs, onNotice]);

  return (
    <div className="qa-cl-subwrap">
      <div className="qa-cl-subpage hide-scrollbar">
        <div className="qa-cl-group-head">聊天与外观</div>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={!ready || !latestSession}
          aria-pressed={selected.has("appearance")}
          onClick={() => toggleKind("appearance")}
        >
          <span className="qa-cl-sub-ic"><IconPalette size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>聊天室外观</b>
            <small>{appearanceDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("appearance") ? "on" : ""}`} aria-hidden>
            {selected.has("appearance") && <IconCheckMark size={14} />}
          </span>
        </button>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={!ready || offlineCount === 0}
          aria-pressed={selected.has("offline")}
          onClick={() => toggleKind("offline")}
        >
          <span className="qa-cl-sub-ic"><IconChatBubble size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>线下模式记录</b>
            <small>{offlineDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("offline") ? "on" : ""}`} aria-hidden>
            {selected.has("offline") && <IconCheckMark size={14} />}
          </span>
        </button>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={!ready || heartCount === 0}
          aria-pressed={selected.has("heart")}
          onClick={() => toggleKind("heart")}
        >
          <span className="qa-cl-sub-ic"><IconHeart size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>心声</b>
            <small>{heartDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("heart") ? "on" : ""}`} aria-hidden>
            {selected.has("heart") && <IconCheckMark size={14} />}
          </span>
        </button>
        {/* 聊天片段：先在展开面板里选会话与条数，选好后行尾出现勾选 */}
        <div
          className="qa-cl-sub-row"
          role="button"
          tabIndex={ready && sessions.length > 0 ? 0 : -1}
          aria-pressed={selected.has("snippet")}
          aria-label="选择聊天片段"
          onClick={() => {
            if (!ready || sessions.length === 0) return;
            setSnippetOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (ready && sessions.length > 0) setSnippetOpen((v) => !v);
            }
          }}
        >
          <span className="qa-cl-sub-ic"><IconChatBubble size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>聊天片段</b>
            <small>{snippetDesc}</small>
          </span>
          {snippetPick ? (
            <button
              type="button"
              className={`qa-cl-ck ${selected.has("snippet") ? "on" : ""}`}
              aria-label={selected.has("snippet") ? "取消勾选聊天片段" : "勾选聊天片段"}
              aria-pressed={selected.has("snippet")}
              onClick={(e) => {
                e.stopPropagation();
                toggleKind("snippet");
              }}
            >
              {selected.has("snippet") && <IconCheckMark size={14} />}
            </button>
          ) : (
            <span className="qa-cl-sheet-row-arrow" aria-hidden><IconChevronRight size={16} /></span>
          )}
        </div>
        {snippetOpen && (
          <div className="qa-cl-snippet">
            <div className="qa-cl-snippet-list hide-scrollbar">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`qa-cl-snippet-item ${snippetPickSession === s.id ? "on" : ""}`}
                  onClick={() => setSnippetPickSession(s.id)}
                >
                  <b>{chatSessionName(s, contacts, chars)}</b>
                  <small>{msgCounts[s.id] ?? 0} 条消息</small>
                </button>
              ))}
            </div>
            <div className="qa-cl-snippet-config">
              <label className="qa-cl-snippet-count">
                取最近
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={snippetCountInput}
                  onChange={(e) => setSnippetCountInput(e.target.value)}
                />
                条消息
              </label>
              <button type="button" className="qa-cl-snippet-btn" onClick={() => setSnippetOpen(false)}>
                取消
              </button>
              <button type="button" className="qa-cl-snippet-btn is-primary" disabled={!snippetPickSession} onClick={confirmSnippet}>
                选好
              </button>
            </div>
          </div>
        )}
        <div className="qa-cl-group-head">角色与世界</div>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={!ready || charCount === 0}
          aria-pressed={selected.has("chars")}
          onClick={() => toggleKind("chars")}
        >
          <span className="qa-cl-sub-ic"><IconPerson size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>角色卡</b>
            <small>{charsDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("chars") ? "on" : ""}`} aria-hidden>
            {selected.has("chars") && <IconCheckMark size={14} />}
          </span>
        </button>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={!ready || worldBookCount === 0}
          aria-pressed={selected.has("worldbooks")}
          onClick={() => toggleKind("worldbooks")}
        >
          <span className="qa-cl-sub-ic"><IconBook size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>世界书</b>
            <small>{worldBooksDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("worldbooks") ? "on" : ""}`} aria-hidden>
            {selected.has("worldbooks") && <IconCheckMark size={14} />}
          </span>
        </button>
        <div className="qa-cl-group-head">资源</div>
        <button
          type="button"
          className="qa-cl-sub-row"
          disabled={shareState !== "ok" || !shareIndex || shareIndex.entries.length === 0}
          aria-pressed={selected.has("share")}
          onClick={() => toggleKind("share")}
        >
          <span className="qa-cl-sub-ic"><IconRepo size={18} /></span>
          <span className="qa-cl-sub-main">
            <b>仓库帖子</b>
            <small>{shareDesc}</small>
          </span>
          <span className={`qa-cl-ck ${selected.has("share") ? "on" : ""}`} aria-hidden>
            {selected.has("share") && <IconCheckMark size={14} />}
          </span>
        </button>
      </div>
      <button
        type="button"
        className="qa-cl-sub-bottom"
        disabled={selected.size === 0}
        onClick={handleAdd}
      >
        {selected.size > 0 ? `添加 ${selected.size} 项到对话` : "先选择要添加的内容"}
      </button>
    </div>
  );
}

// ── App 本体 ─────────────────────────────────────────

export function PhoneQaApp({ onClose, onNotice }: PhoneQaAppProps) {
  const snapshot = useSyncExternalStore(subscribeQaChat, getQaChatSnapshot, getQaChatSnapshot);
  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  /** 顶栏「?」使用说明弹窗 */
  const [helpOpen, setHelpOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [repoSheetOpen, setRepoSheetOpen] = useState(false);
  const [clearToolsOpen, setClearToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiLogOpen, setApiLogOpen] = useState(false);
  const [theme, setTheme] = useState<QaTheme>(() => getQaTheme());
  /** 会话重命名弹窗：抽屉菜单里点「重命名」打开 */
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<QaMsg | null>(null);
  const [editText, setEditText] = useState("");
  /** 编辑弹窗里的图片 / 文本附件（与发送栏各自独立） */
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editFiles, setEditFiles] = useState<QaTextAttachment[]>([]);
  /** 会话大纲（对话轮次胶囊）展开态与结转进行中的会话 id */
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [carryingSessionId, setCarryingSessionId] = useState<string | null>(null);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [userName, setUserName] = useState("用户");
  /** ＋ 号菜单 / 子页面（引用本机内容、技能） */
  const [plusOpen, setPlusOpen] = useState(false);
  const [subPage, setSubPage] = useState<QaSubPage>(null);
  const [pendingFiles, setPendingFiles] = useState<QaPendingFile[]>([]);
  const [pendingRefs, setPendingRefs] = useState<QaPendingRef[]>([]);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoConnected, setRepoConnected] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shotPickInputRef = useRef<HTMLInputElement | null>(null);
  const [apiReady, setApiReady] = useState(true);
  const [modelName, setModelName] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  const refreshComposerMeta = useCallback(() => {
    setApiReady(resolveQaApiConfig() != null);
    setModelName(resolveQaApiConfig()?.defaultModel ?? "");
    setVisionEnabled(resolveQaApiConfig()?.enableImageRecognition === true);
  }, []);

  useEffect(() => {
    void hydrateQaChat();
    refreshComposerMeta();
    // 账号行名字：来自本机身份系统的真实用户名，拿不到显示「用户」
    const identity = resolveUserIdentity();
    if (identity?.name?.trim()) setUserName(identity.name.trim().slice(0, 12));
  }, [refreshComposerMeta]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: QaTheme = prev === "dark" ? "light" : "dark";
      setQaTheme(next);
      return next;
    });
  }, []);

  // 清理原生 tool 调用历史（防报错）：与小卷同款——移除上下文里的工具记录与原生元数据
  const handleClearToolHistory = useCallback(() => {
    if (snapshot.isGenerating) {
      onNotice?.("克克正在执行，完成后再清理。");
      return;
    }
    if (!hasQaToolHistory()) {
      onNotice?.("没有可清理的工具调用历史。");
      return;
    }
    setClearToolsOpen(true);
  }, [snapshot.isGenerating, onNotice]);

  const confirmClearToolHistory = useCallback(() => {
    setClearToolsOpen(false);
    const result = clearQaToolHistory();
    onNotice?.(result && result.removed + result.cleaned > 0
      ? `已清理 ${result.removed} 条工具记录，整理 ${result.cleaned} 条消息。`
      : "没有可清理的工具调用历史。");
  }, [onNotice]);

  const activeSession = useMemo(
    () => snapshot.sessions.find((s) => s.id === snapshot.activeSessionId) ?? null,
    [snapshot.sessions, snapshot.activeSessionId],
  );
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);
  const createdContent = useMemo(() => activeSession?.createdContent ?? [], [activeSession]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<QaCreatedContent | null>(null);
  const previewApp = useMemo(
    () => (previewItem?.type === "app" ? getInstalledCustomApp(previewItem.refId) : null),
    [previewItem],
  );

  // 自动滚动：用户上滚阅读时不拉回底部
  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (pendingFiles.some((f) => f.status === "reading")) {
      onNotice?.("文件还在读取，稍等一下再发送。");
      return;
    }
    // 文本附件走 store 的 files 上下文通道（引擎会渲染成 [附件：文件名] 块）；
    // 引用本机内容仍以结构化文本块并进消息正文
    const files: QaTextAttachment[] = pendingFiles
      .filter((f) => f.status === "ready" && f.text != null)
      .map((f) => ({ name: f.name, content: f.text as string }));
    const blocks: string[] = [];
    for (const r of pendingRefs) {
      blocks.push(`【引用本机内容 · ${r.label}】\n${r.text}\n【/引用】`);
    }
    const composed = blocks.length ? (text ? `${text}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n")) : text;
    if ((!composed && pendingImages.length === 0 && files.length === 0) || snapshot.isGenerating || snapshot.isCompacting) return;
    setInput("");
    const images = pendingImages;
    setPendingImages([]);
    setPendingFiles([]);
    setPendingRefs([]);
    stickToBottomRef.current = true;
    requestAnimationFrame(autoGrow);
    void sendQaMessage(composed, images.length ? images : undefined, files.length ? files : undefined);
  }, [input, pendingImages, pendingFiles, pendingRefs, snapshot.isGenerating, snapshot.isCompacting, autoGrow, onNotice]);

  // 附加图片：仅识图已开启的 API 显示入口；读为 dataURL，单张限 4MB（target=edit 写进编辑弹窗）
  const handlePickImages = useCallback((files: FileList | null, target: "composer" | "edit" = "composer") => {
    if (!files?.length) return;
    const setter = target === "edit" ? setEditImages : setPendingImages;
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 4 * 1024 * 1024) {
        onNotice?.(`「${file.name}」超过 4MB，已跳过。`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        if (url) setter((current) => (current.length >= 6 ? current : [...current, url]));
      };
      reader.readAsDataURL(file);
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, [onNotice]);

  // 文本附件：白名单扩展名 + 单文件 1MB + 6 个上限 + 200K 字符总量，FileReader 真实读取，失败如实标注
  const handlePickFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const room = QA_MAX_FILE_ATTACH - pendingFiles.length;
      if (room <= 0) {
        onNotice?.(`一次最多挂 ${QA_MAX_FILE_ATTACH} 个文件，先发出去或移除一些。`);
        return;
      }
      for (const file of Array.from(files).slice(0, room)) {
        if (!QA_FILE_EXT_RE.test(file.name)) {
          onNotice?.(`「${file.name}」不是文本文件，只支持 txt / md / json / csv / js / ts / tsx / html / css。`);
          continue;
        }
        if (pendingFiles.some((f) => f.name === file.name)) {
          onNotice?.(`「${file.name}」已经添加过了。`);
          continue;
        }
        if (file.size > QA_MAX_FILE_BYTES) {
          onNotice?.(`「${file.name}」有 ${formatAttachBytes(file.size)}，超过 ${formatAttachBytes(QA_MAX_FILE_BYTES)} 上限，没有添加。`);
          continue;
        }
        const id = makeAttachId();
        setPendingFiles((current) => [...current, { id, name: file.name, size: file.size, status: "reading" }]);
        const reader = new FileReader();
        reader.onload = () => {
          const text = typeof reader.result === "string" ? reader.result : "";
          setPendingFiles((current) => {
            const next: QaPendingFile[] = current.map((f) =>
              f.id === id ? { ...f, status: text ? "ready" : "error", text: text || undefined, error: text ? undefined : "文件内容为空" } : f,
            );
            if (text) {
              const totalChars = next.reduce((sum, f) => sum + f.name.length + (f.text?.length ?? 0), 0);
              if (totalChars > QA_MAX_FILE_CHARS) {
                onNotice?.(`附件文本合计不能超过 ${Math.floor(QA_MAX_FILE_CHARS / 1000)}K 字符，最后这个文件没有添加。`);
                return next.map((f): QaPendingFile => (f.id === id ? { ...f, status: "error", text: undefined, error: "超出字符总量" } : f));
              }
            }
            return next;
          });
        };
        reader.onerror = () => {
          setPendingFiles((current) => current.map((f) => (f.id === id ? { ...f, status: "error", error: "读取失败" } : f)));
        };
        reader.readAsText(file);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [pendingFiles, onNotice],
  );

  const handleRetry = useCallback((assistantMsgId: string) => {
    stickToBottomRef.current = true;
    void retryQaMessage(assistantMsgId);
  }, []);

  const handleCopyMessage = useCallback((content: string) => {
    void navigator.clipboard?.writeText(content).then(
      () => onNotice?.("已复制原始内容"),
      () => onNotice?.("复制失败"),
    );
  }, [onNotice]);

  const handleEditMessage = useCallback((msg: QaMsg) => {
    setEditingMsg(msg);
    setEditText(msg.content);
    setEditImages(msg.images ?? []);
    setEditFiles(msg.files ?? []);
  }, []);

  // 修改已发送消息：只保存（同步模型侧上下文）或保存并重新生成（仅限无工具副作用的纯对话）
  const handleSaveEdit = useCallback(
    (andResend: boolean) => {
      if (!editingMsg || !snapshot.activeSessionId) return;
      const result = andResend
        ? editAndResendQaMessage(snapshot.activeSessionId, editingMsg.id, editText, editImages, editFiles)
        : updateQaMessageContent(
            snapshot.activeSessionId,
            editingMsg.id,
            editText,
            editingMsg.role === "user" ? editImages : undefined,
            editingMsg.role === "user" ? editFiles : undefined,
          );
      if (!result.ok) {
        onNotice?.(result.reason);
        return;
      }
      setEditingMsg(null);
      onNotice?.(andResend ? "已修改并重新发送" : "已保存消息内容");
    },
    [editingMsg, editText, editImages, editFiles, snapshot.activeSessionId, onNotice],
  );

  // 重发被拦的真实原因（有工具副作用 / 正在执行等），null = 可以安全重发
  const editResendBlockReason = editingMsg?.role === "user" && snapshot.activeSessionId
    ? getQaEditAndResendBlockReason(snapshot.activeSessionId, editingMsg.id)
    : null;

  // 大纲胶囊「回到底部」：贴底并收起大纲
  const handleScrollBottom = useCallback(() => {
    const target = bodyRef.current;
    if (!target) return;
    stickToBottomRef.current = true;
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
    setOutlineOpen(false);
  }, []);

  // 记忆结转：把当前会话的关键目标 / 改动 / 下一步提炼进新会话，原会话完整保留
  const handleCarryOverSession = useCallback(async () => {
    const sessionId = snapshot.activeSessionId;
    if (!sessionId || carryingSessionId) return;
    if (snapshot.isGenerating || snapshot.isCompacting) {
      onNotice?.("克克正在执行任务或整理上下文，完成后再结转。");
      return;
    }
    setCarryingSessionId(sessionId);
    try {
      const nextId = await carryOverQaSession(sessionId);
      if (nextId) {
        setOutlineOpen(false);
        setDrawerOpen(false);
        onNotice?.("已提炼关键记忆并接续到新会话，原会话仍完整保留。");
      } else {
        onNotice?.("当前会话暂无可结转内容，或记忆提炼失败。");
      }
    } finally {
      setCarryingSessionId(null);
    }
  }, [snapshot.activeSessionId, snapshot.isGenerating, snapshot.isCompacting, carryingSessionId, onNotice]);

  // ＋ 按钮：弹出底部菜单（界面 3），菜单里每个入口接真实能力
  const handlePlus = useCallback(() => {
    setRepoConnected(loadQaGithubConfig() != null);
    setPlusOpen(true);
  }, []);

  // 图片类附件的识图门禁：没开启就提示真实原因，不偷偷放行
  const gateImageAttach = useCallback(() => {
    if (visionEnabled) return true;
    onNotice?.("当前 API 未开启图像识别：到「设置 → API 设置」开启后才能添加图片。");
    return false;
  }, [visionEnabled, onNotice]);

  const handleMenuCamera = useCallback(() => {
    setPlusOpen(false);
    if (!gateImageAttach()) return;
    cameraInputRef.current?.click();
  }, [gateImageAttach]);

  const handleMenuGallery = useCallback(() => {
    setPlusOpen(false);
    if (!gateImageAttach()) return;
    imageInputRef.current?.click();
  }, [gateImageAttach]);

  const handleMenuFiles = useCallback(() => {
    setPlusOpen(false);
    fileInputRef.current?.click();
  }, []);

  // 截屏：APK 有桥走真实截屏；网页没有桥就退化为「选择截图文件」，不假装截屏
  const handleMenuScreenshot = useCallback(async () => {
    if (screenshotBusy) return;
    if (!gateImageAttach()) return;
    if (!hasScreenshotBridge()) {
      setPlusOpen(false);
      shotPickInputRef.current?.click();
      return;
    }
    setScreenshotBusy(true);
    try {
      const result = await captureScreenshot();
      if (!result.ok) {
        onNotice?.(`截屏失败：${result.reason}`);
        return;
      }
      if (result.bytes > 4 * 1024 * 1024) {
        onNotice?.(`这张截屏有 ${formatAttachBytes(result.bytes)}，超过 4MB 上限，没有添加。`);
        return;
      }
      setPendingImages((current) => (current.length >= 6 ? current : [...current, `data:image/png;base64,${result.base64}`]));
      setPlusOpen(false);
      onNotice?.("已截取当前屏幕，随下一条消息一起发送。");
    } finally {
      setScreenshotBusy(false);
    }
  }, [screenshotBusy, gateImageAttach, onNotice]);

  const handleMenuRefs = useCallback(() => {
    setPlusOpen(false);
    setSubPage("refs");
  }, []);

  const handleMenuSkills = useCallback(() => {
    setPlusOpen(false);
    setSubPage("skills");
  }, []);

  // 链接：项目里没有网页抓取通道（需要服务端代理），如实说明而不是造假入口
  const handleMenuLink = useCallback(() => {
    setPlusOpen(false);
    onNotice?.("当前版本还没有网页读取通道（需要服务端代理）。可以先把网页内容复制成文字或存成文件再发。");
  }, [onNotice]);

  // 添加到仓库项目：与工坊改代码同一条 GitHub 提交通道（commitQaFiles）
  const handleMenuAddToRepo = useCallback(async () => {
    if (repoBusy) return;
    const config = loadQaGithubConfig();
    if (!config) {
      setPlusOpen(false);
      onNotice?.("还没有连接仓库：先在「··· → 仓库设置」里连接 GitHub 项目。");
      setRepoSheetOpen(true);
      return;
    }
    if (!activeSession) {
      setPlusOpen(false);
      onNotice?.("当前会话是空的，没有可存档的内容。");
      return;
    }
    setRepoBusy(true);
    try {
      const date = new Date();
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const safeTitle = activeSession.title.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "未命名会话";
      const path = `工坊会话/${stamp}-${safeTitle}.md`;
      const result = await commitQaFiles(config, {
        message: `工坊会话存档：${activeSession.title}`,
        files: [{ path, content: buildQaSessionExport(activeSession) }],
      });
      setPlusOpen(false);
      onNotice?.(`已存档到仓库：${path}（commit ${result.sha.slice(0, 7)}）。`);
    } catch (error) {
      onNotice?.(`存档失败：${formatQaErrorMessage(error)}`);
    } finally {
      setRepoBusy(false);
    }
  }, [repoBusy, activeSession, onNotice]);

  // 引用本机内容子页确认后：暂存引用块，随下一条消息一起发送
  const handleAddRefs = useCallback(
    (refs: QaPendingRef[]) => {
      setPendingRefs((current) => [...current, ...refs]);
      setSubPage(null);
      onNotice?.(`已引用 ${refs.length} 项本机内容，随下一条消息一起发送。`);
    },
    [onNotice],
  );

  // 空输入时的语音按钮：项目里没有真实 STT，点击给真实状态提示
  const handleVoice = useCallback(() => {
    onNotice?.("语音输入需要 APK 版本支持，网页版暂时做不到。");
  }, [onNotice]);

  const streamingMsgId =
    snapshot.isGenerating && messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1].id
      : null;
  const hasInput = input.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0 || pendingRefs.length > 0;
  const screenshotHint = hasScreenshotBridge() ? "截取当前屏幕" : "选择截图文件";

  return (
    <div className="qa-app-shell" data-qa-theme={theme}>
      {/* 顶栏：返回永远在左上角；会话入口与模型切换保持 Claude 式轻量结构 */}
      <header className="qa-cl-topbar">
        {subPage ? (
          <>
            <button
              type="button"
              className="qa-cl-topbar-btn"
              onClick={() => setSubPage(subPage === "refs" || subPage === "skills" ? null : "skills")}
              aria-label="返回"
            >
              <IconBack size={22} />
            </button>
            <div className="qa-cl-topbar-title">
              {subPage === "refs" ? "引用本机内容" : subPage === "skills" ? "技能" : qaSkillName(subPage.skill)}
            </div>
            <span className="qa-cl-topbar-btn" aria-hidden />
          </>
        ) : (
          <>
            <div className="qa-cl-topbar-leading">
              <button type="button" className="qa-cl-topbar-btn" onClick={onClose} aria-label="返回手机桌面">
                <IconBack size={22} />
              </button>
              <button type="button" className="qa-cl-topbar-btn" onClick={() => setDrawerOpen(true)} aria-label="打开会话侧栏">
                <IconMenu size={22} />
              </button>
            </div>
            <button type="button" className="qa-cl-topbar-model" onClick={() => setModelSheetOpen(true)} aria-label="切换模型">
              <span>{modelName || "Claude"}</span>
              <IconChevronDown size={15} />
            </button>
            <div className="qa-cl-topbar-actions">
              <button type="button" className="qa-cl-topbar-btn" onClick={() => createQaSession()} aria-label="新建会话">
                <IconPlus size={22} />
              </button>
              <button type="button" className="qa-cl-topbar-btn" onClick={() => setTopMenuOpen(true)} aria-label="更多操作">
                <IconDots size={22} />
              </button>
            </div>
          </>
        )}
      </header>

      {/* 内容区：子页面整体替换聊天区与输入卡 */}
      {subPage === "refs" ? (
        <QaRefsPage onNotice={onNotice} onAddRefs={handleAddRefs} />
      ) : subPage === "skills" ? (
        <QaSkillsPage onOpen={(id) => setSubPage({ skill: id })} />
      ) : subPage ? (
        <QaSkillFlow skillId={subPage.skill} onNotice={onNotice} onCancel={() => setSubPage("skills")} />
      ) : (
      <>
      <div className="qa-cl-body hide-scrollbar" ref={bodyRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="qa-cl-welcome">
            <div className="qa-cl-welcome-star" aria-hidden>
              <QaStarburst size={34} />
            </div>
            <div className="qa-cl-welcome-title">你好，{userName}</div>
            <div className="qa-cl-welcome-sub">今天想一起做点什么？</div>
            {!apiReady && (
              <div className="qa-cl-welcome-warn">还没有可用的 API：请先到「设置 → API 设置」添加 LLM API。</div>
            )}
          </div>
        ) : (
          <div className="qa-cl-msgs">
            {messages.map((msg) => (
              <QaMessageItem key={msg.id} msg={msg} isStreaming={msg.id === streamingMsgId} onRetry={handleRetry} onViewImage={setViewerImage} onCopy={handleCopyMessage} onEdit={handleEditMessage} />
            ))}
          </div>
        )}
      </div>

      {/* 输入卡（上方：真实数据小件——上下文用量、本轮创建预览、对话大纲） */}
      <div className="qa-cl-inputwrap">
        {carryingSessionId && (
          <div className="qa-cl-carrying-bar" role="status">
            <Loader2 size={13} className="qa-spin" />
            <span>克克正在提炼会话记忆…</span>
          </div>
        )}
        <div className="qa-cl-statusbar">
          {createdContent.length > 0 && (
            <button
              type="button"
              className="qa-cl-float-btn"
              onClick={() => setPreviewOpen(true)}
              aria-label="预览本轮创建的内容"
              title="预览本轮创建的内容"
            >
              <Play size={14} />
            </button>
          )}
          <div
            className={`qa-context-meter ${snapshot.isCompacting ? "is-compacting" : ""}`}
            title="上下文用量：满 100% 时自动压缩成摘要并从头累计"
          >
            <div className="qa-context-meter-track" aria-hidden>
              <i style={{ width: `${Math.min(100, Math.round(snapshot.contextUsage * 100))}%` }} />
            </div>
            <span className="qa-context-meter-label">
              {snapshot.isCompacting ? "压缩中" : `${Math.min(999, Math.round(snapshot.contextUsage * 100))}%`}
            </span>
          </div>
          <QaConversationOutline
            messages={messages}
            open={outlineOpen}
            carrying={Boolean(carryingSessionId)}
            onToggle={() => setOutlineOpen((current) => !current)}
            onClose={() => setOutlineOpen(false)}
            onCarryOver={() => void handleCarryOverSession()}
            onScrollBottom={handleScrollBottom}
          />
        </div>
        <div className="qa-cl-input">
          {pendingImages.length > 0 && (
            <div className="qa-attach-strip">
              {pendingImages.map((url, i) => (
                <div key={i} className="qa-attach-thumb">
                  <button type="button" className="qa-attach-view" onClick={() => setViewerImage(url)} aria-label="查看图片">
                    <img src={url} alt="" />
                  </button>
                  <button
                    type="button"
                    className="qa-attach-remove"
                    onClick={() => setPendingImages((current) => current.filter((_, idx) => idx !== i))}
                    aria-label="移除图片"
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handlePickImages(e.target.files)}
          />
          {/* 相机（调起后置摄像头）/ 文本文件 / 网页版截屏文件选择 */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => handlePickImages(e.target.files)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={QA_FILE_ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(e) => handlePickFiles(e.target.files)}
          />
          <input
            ref={shotPickInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handlePickImages(e.target.files)}
          />
          {(pendingFiles.length > 0 || pendingRefs.length > 0) && (
            <div className="qa-cl-att-strip">
              {pendingFiles.map((f) => (
                <div key={f.id} className={`qa-cl-att-chip ${f.status === "error" ? "is-error" : ""}`}>
                  <IconFile size={13} />
                  <span className="qa-cl-att-name" title={f.name}>
                    {f.status === "reading"
                      ? `${f.name} · 读取中…`
                      : f.status === "error"
                        ? `${f.name} · ${f.error ?? "读取失败"}`
                        : `${f.name} · ${formatAttachBytes(f.size)}`}
                  </span>
                  <button
                    type="button"
                    className="qa-cl-att-remove"
                    aria-label="移除文件"
                    onClick={() => setPendingFiles((cur) => cur.filter((x) => x.id !== f.id))}
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
              {pendingRefs.map((r) => (
                <div key={r.id} className="qa-cl-att-chip is-ref">
                  <IconBook size={13} />
                  <span className="qa-cl-att-name" title={r.label}>{r.label}</span>
                  <button
                    type="button"
                    className="qa-cl-att-remove"
                    aria-label="移除引用"
                    onClick={() => setPendingRefs((cur) => cur.filter((x) => x.id !== r.id))}
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="qa-cl-input-area hide-scrollbar"
            placeholder="和 Claude 聊聊工坊"
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
          />
          <div className="qa-cl-input-row">
            <button type="button" className="qa-cl-plus" onClick={handlePlus} aria-label="添加附件">
              <IconPlus size={24} />
            </button>
            <span className="qa-cl-input-spacer" />
            {modelName && (
              <button type="button" className="qa-cl-model" onClick={() => setModelSheetOpen(true)} aria-label="切换工坊模型">
                <span className="qa-cl-model-name">{modelName}</span>
                <IconChevronDown size={14} />
              </button>
            )}
            {snapshot.isGenerating ? (
              <button type="button" className="qa-cl-send is-stop" onClick={stopQaGeneration} aria-label="停止生成">
                <IconStop size={20} />
              </button>
            ) : (
              <button
                type="button"
                className={`qa-cl-send ${hasInput ? "has-text" : ""}`}
                onClick={hasInput ? handleSend : handleVoice}
                aria-label={hasInput ? "发送" : "语音输入"}
              >
                {hasInput ? <IconArrowUp size={20} /> : <IconWave size={20} />}
              </button>
            )}
          </div>
        </div>
      </div>
      </>
      )}

      {/* 会话侧栏（左侧滑出） */}
      <QaSessionSidebar
        open={drawerOpen}
        sessions={snapshot.sessions}
        activeId={snapshot.activeSessionId}
        theme={theme}
        userName={userName}
        carrying={Boolean(carryingSessionId)}
        onClose={() => setDrawerOpen(false)}
        onSelect={(id) => {
          switchQaSession(id);
          setDrawerOpen(false);
        }}
        onDelete={deleteQaSession}
        onCreate={() => {
          createQaSession();
          setDrawerOpen(false);
        }}
        onOpenRepo={() => {
          setRepoSheetOpen(true);
          setDrawerOpen(false);
        }}
        onCarryOver={() => void handleCarryOverSession()}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setDrawerOpen(false);
        }}
        onRenameRequest={(id, title) => {
          setRenameTarget({ id, title });
          setRenameTitle(title);
        }}
        onToggleTheme={handleToggleTheme}
      />

      {/* ＋ 号底部菜单（仅对话页弹出） */}
      {plusOpen && !subPage && (
        <QaPlusSheet
          onClose={() => setPlusOpen(false)}
          onCamera={handleMenuCamera}
          onGallery={handleMenuGallery}
          onFiles={handleMenuFiles}
          onScreenshot={() => void handleMenuScreenshot()}
          screenshotBusy={screenshotBusy}
          screenshotHint={screenshotHint}
          onOpenRefs={handleMenuRefs}
          onOpenSkills={handleMenuSkills}
          onAddToRepo={() => void handleMenuAddToRepo()}
          onLink={handleMenuLink}
          repoBusy={repoBusy}
          repoConnected={repoConnected}
        />
      )}

      {helpOpen && (
        <QaHelpModal
          onClose={() => setHelpOpen(false)}
          rounds={messages.filter((msg) => msg.role === "user").length}
          contextPercent={Math.round(snapshot.contextUsage * 100)}
        />
      )}

      {topMenuOpen && (
        <QaTopMenu
          onClose={() => setTopMenuOpen(false)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenApiLog={() => setApiLogOpen(true)}
          onOpenRepo={() => setRepoSheetOpen(true)}
          onClearToolHistory={handleClearToolHistory}
          onExit={onClose}
        />
      )}

      {modelSheetOpen && (
        <QaModelSheet onClose={() => setModelSheetOpen(false)} onSaved={refreshComposerMeta} />
      )}

      {renameTarget && (
        <div className="qa-rename-backdrop" role="presentation" onClick={() => setRenameTarget(null)}>
          <form
            className="qa-rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qa-rename-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const title = renameTitle.trim();
              if (!title) return;
              renameQaSession(renameTarget.id, title);
              setRenameTarget(null);
            }}
          >
            <div id="qa-rename-dialog-title" className="qa-rename-title">重命名对话</div>
            <input
              className="qa-rename-input"
              autoFocus
              value={renameTitle}
              maxLength={80}
              aria-label="新对话名称"
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setRenameTarget(null); }}
            />
            <div className="qa-rename-actions">
              <button type="button" className="qa-rename-cancel" onClick={() => setRenameTarget(null)}>取消</button>
              <button type="submit" className="qa-devnotice-btn is-primary qa-rename-confirm" disabled={!renameTitle.trim()}>确认</button>
            </div>
          </form>
        </div>
      )}

      {clearToolsOpen && (
        <div className="qa-devnotice-backdrop" onClick={() => setClearToolsOpen(false)}>
          <div className="qa-devnotice" role="alertdialog" aria-label="清理工具历史确认" onClick={(e) => e.stopPropagation()}>
            <div className="qa-devnotice-title">清理工具调用历史？</div>
            <div className="qa-devnotice-text">
              将移除本会话上下文中的工具调用与工具结果记录，用于修复原生工具协议的报错。普通对话内容不会删除，之前的工具结论仍保留在克克的回复文字里。
            </div>
            <div className="qa-devnotice-actions is-row">
              <button type="button" className="qa-devnotice-btn" onClick={() => setClearToolsOpen(false)}>
                取消
              </button>
              <button type="button" className="qa-devnotice-btn is-primary" onClick={confirmClearToolHistory}>
                清理
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerImage && (
        <div className="qa-image-viewer" role="presentation" onClick={() => setViewerImage(null)}>
          <img src={viewerImage} alt="" />
          <button type="button" className="qa-image-viewer-close" aria-label="关闭" onClick={() => setViewerImage(null)}>
            <X size={20} />
          </button>
        </div>
      )}

      {editingMsg && (
        <div className="qa-edit-backdrop" onClick={() => setEditingMsg(null)}>
          <div className="qa-edit-dialog" role="dialog" aria-label="修改消息" onClick={(e) => e.stopPropagation()}>
            <div className="qa-edit-head">
              <span className="qa-edit-title">修改消息（原始内容）</span>
              <button type="button" className="qa-icon-btn" onClick={() => setEditingMsg(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <textarea
              className="qa-edit-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              spellCheck={false}
              autoFocus
              aria-label="消息原始内容"
              placeholder="这里显示的是消息的原始内容，不会被前端渲染，可放心查看特殊标签。"
            />
            {editingMsg.role === "user" && editImages.length > 0 && (
              <div className="qa-attach-strip">
                {editImages.map((url, index) => (
                  <div className="qa-attach-thumb" key={index}>
                    <button type="button" className="qa-attach-view" onClick={() => setViewerImage(url)} aria-label="查看图片">
                      <img src={url} alt="" />
                    </button>
                    <button
                      type="button"
                      className="qa-attach-remove"
                      onClick={() => setEditImages((current) => current.filter((_, i) => i !== index))}
                      aria-label="移除图片"
                    >
                      <X size={11} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {editingMsg.role === "user" && editFiles.length > 0 && (
              <div className="qa-cl-edit-files">
                {editFiles.map((file) => (
                  <span className="qa-cl-file-chip is-removable" key={file.name} title={file.name}>
                    <IconFile size={13} />
                    <span>{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditFiles((current) => current.filter((candidate) => candidate.name !== file.name))}
                      aria-label={`移除附件 ${file.name}`}
                    >
                      <X size={11} strokeWidth={2.4} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {editingMsg.role === "user" && editResendBlockReason && (
              <div className="qa-edit-warning" role="status">{editResendBlockReason}</div>
            )}
            {editingMsg.role === "user" && !editResendBlockReason && (
              <div className="qa-edit-hint">保存并发送会删除这条消息及其后续纯对话，再根据修改后的内容重新生成。</div>
            )}
            <div className="qa-edit-actions">
              <button type="button" className="qa-devnotice-btn" onClick={() => setEditingMsg(null)}>
                取消
              </button>
              <button
                type="button"
                className={`qa-devnotice-btn ${editingMsg.role === "assistant" ? "is-primary" : ""}`}
                onClick={() => handleSaveEdit(false)}
                disabled={!editText.trim() && editImages.length === 0 && editFiles.length === 0}
              >
                保存
              </button>
              {editingMsg.role === "user" && (
                <button
                  type="button"
                  className="qa-devnotice-btn is-primary"
                  onClick={() => handleSaveEdit(true)}
                  disabled={Boolean(editResendBlockReason) || (!editText.trim() && editImages.length === 0 && editFiles.length === 0)}
                >
                  保存并发送
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <QaSettingsSheet onClose={() => setSettingsOpen(false)} onNotice={onNotice} />
      )}

      {apiLogOpen && (
        <QaApiLogSheet onClose={() => setApiLogOpen(false)} onNotice={onNotice} />
      )}

      {repoSheetOpen && (
        <QaRepoSheet
          onClose={() => setRepoSheetOpen(false)}
          onSaved={() => {
            refreshComposerMeta();
            setRepoConnected(loadQaGithubConfig() != null);
          }}
        />
      )}

      {previewOpen && !previewItem && (
        <div className="qa-sheet-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="qa-sheet qa-preview-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="qa-sheet-head">
              <span className="qa-sheet-title">
                <Play size={16} /> 预览本轮创建
              </span>
              <button type="button" className="qa-icon-btn" onClick={() => setPreviewOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="qa-sheet-body">
              <p className="qa-sheet-note">本次对话里创建/更新的内容，点开直接测试，返回后回到聊天。</p>
              {createdContent.map((item) => (
                <button
                  key={`${item.type}-${item.refId}`}
                  type="button"
                  className="qa-preview-item"
                  onClick={() => setPreviewItem(item)}
                >
                  {item.type === "app" ? <AppWindow size={17} /> : item.type === "game" ? <Gamepad2 size={17} /> : <Drama size={17} />}
                  <span className="qa-preview-item-title">{item.title}</span>
                  <span className="qa-preview-item-type">
                    {item.type === "app" ? "应用" : item.type === "game" ? "游戏" : "剧场"}
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewItem && (
        <div className="qa-preview-runtime">
          {previewItem.type === "app" ? (
            previewApp ? (
              <CustomAppForegroundBoundary
                key={previewApp.id}
                appName={previewApp.name}
                appId={previewApp.id}
                appVersion={previewApp.version}
                manifestId={previewApp.manifest?.id}
                closeLabel="返回"
                onClose={() => setPreviewItem(null)}
              >
                <CustomAppRunner app={previewApp} onClose={() => setPreviewItem(null)} />
              </CustomAppForegroundBoundary>
            ) : (
              <div className="qa-preview-missing">
                <p>这个应用已被卸载或找不到了。</p>
                <button type="button" className="qa-sheet-btn is-primary" onClick={() => setPreviewItem(null)}>
                  返回
                </button>
              </div>
            )
          ) : previewItem.type === "game" ? (
            <GameHubApp onClose={() => setPreviewItem(null)} autoOpenLocalId={previewItem.refId} />
          ) : (
            <BlackMarketApp onClose={() => setPreviewItem(null)} autoOpenLocalId={previewItem.refId} />
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   工坊调用记录面板：侧栏与「···」菜单进入，
   只展示工坊自己的 LLM 调用（与聊天页底层日志完全独立）。
   ══════════════════════════════════════════ */
function QaApiLogSheet({ onClose, onNotice }: { onClose: () => void; onNotice?: (msg: string) => void }) {
  const [logs, setLogs] = useState<DebugInfo[]>(() => [...getQaApiLogs()].reverse());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(() => setLogs([...getQaApiLogs()].reverse()), []);
  useEffect(() => { refresh(); }, [refresh]);

  const handleClear = () => {
    clearQaApiLogs();
    setLogs([]);
    onNotice?.("已清空 Claude 调用记录");
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  return (
    <div className="qa-sheet-backdrop" onClick={onClose}>
      <div className="qa-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="qa-sheet-head">
          <span className="qa-sheet-title">
            <IconFile size={16} /> 调用记录
          </span>
          <div className="qa-sheet-head-actions">
            {logs.length > 0 && (
              <button type="button" className="qa-sheet-btn" onClick={handleClear}>
                <Trash2 size={14} /> 清空
              </button>
            )}
            <button type="button" className="qa-icon-btn" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="qa-sheet-body hide-scrollbar qa-log-body">
          {logs.length === 0 ? (
            <p className="qa-sheet-note">
              还没有 Claude 的 AI 调用记录。调用过模型后，这里会显示每次请求的 Prompt 与 AI 原始回复（含思维链），供排查用。
            </p>
          ) : (
            <>
              <p className="qa-sheet-note">
                Claude 每次调用大模型的记录，与聊天页「底层调用大模型日志」互相独立，互不混入。
              </p>
              <div className="qa-log-list">
                {logs.map((log) => {
                  const isOpen = expandedId === log.id;
                  return (
                    <div key={log.id} className="qa-log-item">
                      <button
                        type="button"
                        className="qa-log-item-head"
                        onClick={() => setExpandedId(isOpen ? null : log.id)}
                      >
                        <div className="qa-log-item-meta">
                          <span className="qa-log-item-time">{formatTime(log.timestamp)}</span>
                          <span className="qa-log-item-detail">
                            {log.model ? `Model: ${log.model}` : ""}
                            {log.model && log.messages.length ? " · " : ""}
                            {log.messages.length} 条消息
                            {log.usage ? ` · Tokens: ${log.usage.prompt_tokens ?? "—"} / ${log.usage.completion_tokens ?? "—"} / ${log.usage.total_tokens ?? "—"}` : ""}
                          </span>
                        </div>
                        <ChevronRight size={15} className={isOpen ? "qa-log-chevron-open" : ""} />
                      </button>
                      {isOpen && (
                        <div className="qa-log-item-body">
                          <div className="qa-log-label">Prompt（{log.messages.length} 条消息）</div>
                          {log.messages.map((m, i) => (
                            <div key={i} className="qa-log-entry" data-role={m.role}>
                              <div className="qa-log-entry-role">[{i}] {m.role}</div>
                              <div className="qa-log-entry-content">{m.content}</div>
                            </div>
                          ))}
                          {log.reasoning && (
                            <>
                              <div className="qa-log-label">思维链（Reasoning）</div>
                              <pre className="qa-log-response">{log.reasoning}</pre>
                            </>
                          )}
                          <div className="qa-log-label is-danger">AI 原始回复</div>
                          <pre className="qa-log-response">{log.rawResponse}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
