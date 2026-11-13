/**
 * 主聊天「思考过程」展示策略。
 *
 * 背景：1.8.59 把思维链做成「默认常开 + 无条件强注入」，任何模型、任何请求都会被
 * 要求先写 <thinking>，并且掐断了模型原生推理的透传。这带来三个问题：
 * 强注入影响所有对话语气、绕过模型原生 reasoning、模型不写标签时胶囊是空的。
 *
 * 这里把控制权收拢成一个按会话隔离的策略：
 * - tag（默认）：每一轮都明确要求模型先写一小段 <thinking>；同时保留模型原生推理透传，
 *   标签内容有则覆盖显示，没有也能显示原生推理 —— 胶囊不会空。用户不用自己去开开关。
 *   曾经做过「连续两条没写就冷却几轮不注入」，但真机证明多数线上模型没有原生推理，
 *   冷却等于把胶囊关掉，所以 1.8.71 起只要开关开着就每轮都要求。
 * - off（用户关闭）：预设里显式关掉「显示思考过程」后不再要求标签。
 *
 * 状态只存在内存里、按会话隔离，不写入任何持久化数据。
 * 本模块不改变任何消息内容，消息层面的注入在 llm-provider-adapter 里完成。
 * 问答、推送、连通性测试等非聊天链路不调用本模块，不受影响。
 */
import type { PresetConfig } from "./settings-types";

export type ThinkingChainMode = "tag" | "native" | "off";

/** 连续多少条回复没拿到标签（仅用于记录，不再触发降级） */
const MISS_LIMIT = 2;
/** 最多记住多少个会话，避免长期运行无限增长 */
const MAX_SESSIONS = 256;

type ThinkingChainSessionState = { misses: number };
const sessionStates = new Map<string, ThinkingChainSessionState>();

/** 默认开启：只有显式设为 false 才是关闭，保证「不用自己去打开」 */
export function isThinkingChainEnabled(preset: PresetConfig | null): boolean {
    return preset?.thinking_chain_enabled !== false;
}

/** 思维链标签名：沿用预设里已有的线上 / 线下字段，默认 thinking */
export function resolveThinkingChainTag(preset: PresetConfig | null): string {
    return (preset?.online_thinking_tag || preset?.thinking_tag)?.trim() || "thinking";
}

/**
 * 本次回复该用哪种模式。
 * 真机结论（1.8.70 前）：多数线上模型不返回原生推理，一旦因为没写标签而停止注入要求，
 * 胶囊就整段消失 —— 这正是「只有特意说才出现」的主因之一。
 * 所以只要开关开着，每一轮都继续要求标签；没拿到标签只做记录，不再中断注入。
 * 本函数保持纯读（之前在读取时扣减冷却，连提示词预览都会扣，属于副作用 bug）。
 */
export function resolveThinkingChainMode(preset: PresetConfig | null, sessionId: string): ThinkingChainMode {
    if (!isThinkingChainEnabled(preset)) return "off";
    return "tag";
}

/** 一次回复结束后调用；hasTag 表示这一轮是否真的从输出里拿到了 <thinking> 内容。
 *  misses 只用于记录（将来排查用），不再触发降级/冷却。 */
export function noteThinkingChainResult(sessionId: string, hasTag: boolean): void {
    const state = sessionStates.get(sessionId) ?? { misses: 0 };
    state.misses = hasTag ? 0 : state.misses + 1;
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
