/**
 * 主聊天「思考过程」展示策略。
 *
 * 背景：1.8.59 把思维链做成「默认常开 + 无条件强注入」，任何模型、任何请求都会被
 * 要求先写 <thinking>，并且掐断了模型原生推理的透传。这带来三个问题：
 * 强注入影响所有对话语气、绕过模型原生 reasoning、模型不写标签时胶囊是空的。
 *
 * 这里把控制权收拢成一个按会话隔离的策略：
 * - tag（默认）：明确要求模型先写一小段 <thinking>；同时保留模型原生推理透传，
 *   标签内容有则覆盖显示，没有也能显示原生推理 —— 胶囊不会空。用户不用自己去开开关。
 * - native（自动降级）：连续两条回复都没拿到 <thinking> 标签后，先停几轮不再要求标签，
 *   完全走模型原生推理；冷却结束后自动再试一次，避免一次失手就永久失去胶囊。
 * - off（用户关闭）：预设里显式关掉「显示思考过程」后固定走原生推理，不再尝试标签。
 *
 * 状态只存在内存里、按会话隔离，不写入任何持久化数据。拿到标签会清零计数与冷却；
 * 用户重新打开开关、切换开关或换会话时重新尝试标签模式。
 * 问答、推送、连通性测试等非聊天链路不调用本模块，不受影响。
 */
import type { PresetConfig } from "./settings-types";

export type ThinkingChainMode = "tag" | "native" | "off";

/** 连续多少条回复没拿到标签就降级回原生推理 */
const MISS_LIMIT = 2;
/** 降级后先走几条原生推理，再自动重试一次标签；避免一直失手就永久不再出现 */
const DEGRADE_ROUNDS = 3;
/** 最多记住多少个会话，避免长期运行无限增长 */
const MAX_SESSIONS = 256;

type ThinkingChainSessionState = { misses: number; cooldown: number };
const sessionStates = new Map<string, ThinkingChainSessionState>();

/** 默认开启：只有显式设为 false 才是关闭，保证「不用自己去打开」 */
export function isThinkingChainEnabled(preset: PresetConfig | null): boolean {
    return preset?.thinking_chain_enabled !== false;
}

/** 思维链标签名：沿用预设里已有的线上 / 线下字段，默认 thinking */
export function resolveThinkingChainTag(preset: PresetConfig | null): string {
    return (preset?.online_thinking_tag || preset?.thinking_tag)?.trim() || "thinking";
}

/** 本次回复该用哪种模式 */
export function resolveThinkingChainMode(preset: PresetConfig | null, sessionId: string): ThinkingChainMode {
    if (!isThinkingChainEnabled(preset)) return "off";
    const state = sessionStates.get(sessionId);
    if (state && state.cooldown > 0) {
        state.cooldown -= 1;
        return "native";
    }
    return "tag";
}

/** 一次回复结束后调用；hasTag 表示这一轮是否真的从输出里拿到了 <thinking> 内容 */
export function noteThinkingChainResult(sessionId: string, hasTag: boolean): void {
    const state = sessionStates.get(sessionId) ?? { misses: 0, cooldown: 0 };
    if (hasTag) {
        state.misses = 0;
        state.cooldown = 0;
    } else {
        state.misses += 1;
        if (state.misses >= MISS_LIMIT) {
            state.misses = 0;
            state.cooldown = DEGRADE_ROUNDS;
        }
    }
    if (!sessionStates.has(sessionId) && sessionStates.size >= MAX_SESSIONS) {
        const oldest = sessionStates.keys().next().value;
        if (oldest !== undefined) sessionStates.delete(oldest);
    }
    sessionStates.set(sessionId, state);
}

/** 用户重新开始某个会话时可调用，立即重新尝试标签模式 */
export function resetThinkingChain(sessionId: string): void {
    sessionStates.delete(sessionId);
}

/** 用户切换「显示思考过程」开关时清空所有会话的降级记忆，立即重新尝试标签模式 */
export function resetThinkingChainSessions(): void {
    sessionStates.clear();
}
