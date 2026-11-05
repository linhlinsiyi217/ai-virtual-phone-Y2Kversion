"use client";

// 桌宠 App 的图标出口：统一走 lucide（与 PageShell / modal 等现有组件同源），
// 保持各页面已使用的语义名，类型与 EmptyState.icon（LucideIcon）完全兼容。

import {
    AlarmClock,
    BellRing,
    Check,
    ChevronRight,
    Clock,
    Info,
    Loader2,
    MessageCircle,
    MessageSquareText,
    Moon,
    PauseCircle,
    PawPrint,
    PlayCircle,
    Plus,
    RotateCcw,
    Send,
    StopCircle,
    Trash2,
    X,
    type LucideIcon,
} from "lucide-react";

export const BellRingOutline = BellRing;
export const ChatOutline = MessageCircle;
export const ClockOutline = Clock;
export const InformationOutline = Info;
export const MessageTextOutline = MessageSquareText;
export const PauseCircleOutline = PauseCircle;
export const PawOutline = PawPrint;
export const PlayCircleOutline = PlayCircle;
export const PlusIcon = Plus;
export const SendOutlineIcon = Send;
export const SleepIcon = Moon;
export const StopCircleOutlineIcon = StopCircle;
export const TrashCanOutlineIcon = Trash2;
export const AlarmIcon = AlarmClock;
export const CloseIcon = X;
export const CheckIcon = Check;

export { ChevronRight, Loader2, RotateCcw, Send, Trash2 };
export type { LucideIcon };
