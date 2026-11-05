import type { ApiConfig } from "./settings-types";
import { pushApiLog } from "./api-log-store";
import {
    buildSimpleLLMRequest,
    describeEmptyLLMResponse,
    extractFinishReason,
    extractUsage,
    isTruncationFinishReason,
    simpleLLMCall,
    stripHallucinatedTimestamps,
    stripReasoningMarkup,
    type SimpleLLMCallOptions,
    type SimpleLLMCallResult,
    type SimpleLLMMessage,
} from "./api-helpers";
import { parseProviderStreamDelta } from "./llm-provider-adapter";
import { createSseJsonParser } from "./sse-json";
import { assertIdentityActive, registerIdentityRequest } from "./identity-runtime";

function splitSseEvents(buffer: string): { events: string[]; rest: string } {
    const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
    return { events: parts.slice(0, -1), rest: parts.at(-1) || "" };
}

function anthropicStopReason(chunk: Record<string, unknown>): string | undefined {
    if (chunk.type !== "message_delta") return undefined;
    const delta = chunk.delta as { stop_reason?: unknown } | undefined;
    return typeof delta?.stop_reason === "string" ? delta.stop_reason : undefined;
}

/** null 表示完全没收到内容，调用方可安全退回非流式。 */
async function simpleLLMStreamCall(
    config: ApiConfig,
    messages: SimpleLLMMessage[],
    options?: SimpleLLMCallOptions,
): Promise<SimpleLLMCallResult | null> {
    const request = buildSimpleLLMRequest(config, messages, options, true);
    if (!request) return null;

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const release = registerIdentityRequest(controller);
    let content = "";
    let reasoning = "";
    let started = false;
    let finishReason: string | undefined;
    let usage: ReturnType<typeof extractUsage>;

    const handleChunk = (parsed: unknown) => {
        const delta = parseProviderStreamDelta(request.providerKind, parsed);
        if (delta.content) { content += delta.content; started = true; }
        if (delta.reasoning) { reasoning += delta.reasoning; started = true; }
        if (parsed && typeof parsed === "object") {
            const chunk = parsed as Record<string, unknown>;
            finishReason = extractFinishReason(chunk) ?? anthropicStopReason(chunk) ?? finishReason;
            usage = extractUsage(chunk) ?? usage;
        }
    };

    try {
        assertIdentityActive();
        const res = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: controller.signal });
        if (!res.ok || !res.body) return null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseJsonParser();
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            assertIdentityActive();
            buffer += decoder.decode(value, { stream: true });
            const split = splitSseEvents(buffer);
            buffer = split.rest;
            for (const eventText of split.events) for (const parsed of parser.pushEvent(eventText)) handleChunk(parsed);
        }
        buffer += decoder.decode();
        if (buffer.trim()) for (const parsed of parser.pushEvent(buffer)) handleChunk(parsed);
        for (const parsed of parser.flush()) handleChunk(parsed);
    } catch (error) {
        if (!started && !options?.signal?.aborted) return null;
        const message = error instanceof Error ? error.message : String(error);
        pushApiLog({ characterName: options?.label, source: "background", model: config.defaultModel, messages, rawResponse: `[请求失败] ${message}` });
        return { content: null, error: `请求失败: ${message}` };
    } finally {
        release();
        options?.signal?.removeEventListener("abort", abort);
    }

    if (!started) return null;
    let raw = content.trim();
    if (!raw && request.providerKind === "openai-compatible") raw = reasoning.trim();
    const finalContent = raw ? stripHallucinatedTimestamps(stripReasoningMarkup(raw)) : "";
    const wasTruncated = isTruncationFinishReason(finishReason);
    if (!finalContent) {
        const error = describeEmptyLLMResponse({}, finishReason, wasTruncated, config);
        pushApiLog({ characterName: options?.label, source: "background", model: config.defaultModel, messages, rawResponse: error, usage });
        return { content: null, error, finishReason, wasTruncated };
    }
    pushApiLog({ characterName: options?.label, source: "background", model: config.defaultModel, messages, rawResponse: finalContent, usage });
    return { content: finalContent, finishReason, wasTruncated };
}

/** 优先流式收齐全文；若服务完全不支持 SSE，再退回原非流式调用。 */
export async function simpleLLMCallPreferStream(
    config: ApiConfig,
    messages: SimpleLLMMessage[],
    options?: SimpleLLMCallOptions,
): Promise<SimpleLLMCallResult> {
    const streamed = await simpleLLMStreamCall(config, messages, options);
    if (streamed) return streamed;
    if (options?.signal?.aborted) return { content: null, error: "请求失败: 已中止" };
    return simpleLLMCall(config, messages, options);
}
