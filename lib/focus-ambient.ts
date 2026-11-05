// lib/focus-ambient.ts — 全局白噪音（G4）。
//
// 与书房背景音（lib/study-room/ambient.ts）共用同一套合成算法（lib/noise-synth.ts），
// 但生命周期不同：书房那一路退出书房即停；这一路是桌面级全局单例，
// 在专注模式面板关闭、页面切换后继续播放，直到用户显式停止。
// 两路各自独立 AudioContext，互不干扰；同时播放时是两路叠加，各管各的音量。
//
// 一样是本机 Web Audio 合成，不联网、不下载素材。播放必须由用户点击触发。

import { createNoiseBuffer, type NoiseKind } from "@/lib/noise-synth";

export type FocusAmbientStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type FocusAmbientState = {
    kind: NoiseKind | null;
    status: FocusAmbientStatus;
    /** 用户设定的音量 0..1 */
    volume: number;
    error: string | null;
};

const STORE_KEY = "focus_ambient_v1";
/** 生成的噪声本身偏响，按这个系数换算成实际增益（与书房一致） */
const GAIN_SCALE = 0.35;
/** 音量渐变时间常数（秒） */
const RAMP = 0.12;

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

let state: FocusAmbientState = { kind: null, status: "idle", volume: 0.5, error: null };
let loaded = false;
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
/** 每次开始播放递增；旧的异步启动发现编号变了就放弃，避免连点叠出多路 */
let token = 0;

function ensureLoaded(): void {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "null") as { volume?: number } | null;
        state = { ...state, volume: raw?.volume == null ? 0.5 : clamp01(raw.volume) };
    } catch {
        /* 读不到就按默认音量 */
    }
}

function save(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ volume: state.volume }));
    } catch {
        /* 存不下就只在本次生效 */
    }
}

function emit(next: Partial<FocusAmbientState>): void {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
}

export function getFocusAmbientState(): FocusAmbientState {
    ensureLoaded();
    return state;
}

export function subscribeFocusAmbient(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function targetGain(): number {
    return state.volume * GAIN_SCALE;
}

function applyGain(timeConstant = RAMP): void {
    if (!gain || !ctx) return;
    try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setTargetAtTime(targetGain(), ctx.currentTime, timeConstant);
    } catch {
        /* 忽略 */
    }
}

function teardown(): void {
    try {
        source?.stop();
    } catch {
        /* 忽略 */
    }
    try {
        source?.disconnect();
        gain?.disconnect();
    } catch {
        /* 忽略 */
    }
    source = null;
    gain = null;
    const old = ctx;
    ctx = null;
    if (old) void old.close().catch(() => undefined);
}

/**
 * 开始播放一种白噪音（必须由用户点击触发，浏览器才允许出声）。
 * 已经在播同一种就什么也不做；在播别的就先停掉再换。
 */
export async function playFocusNoise(kind: NoiseKind): Promise<void> {
    ensureLoaded();
    if (typeof window === "undefined") return;
    if (state.kind === kind && (state.status === "playing" || state.status === "loading")) return;
    if (state.kind === kind && state.status === "paused") {
        await resumeFocusAmbient();
        return;
    }
    teardown();
    const mine = ++token;
    emit({ kind, status: "loading", error: null });
    const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
        emit({ status: "error", error: "这个浏览器不支持生成背景声音。" });
        return;
    }
    try {
        const audio = new Ctor();
        ctx = audio;
        if (audio.state === "suspended") {
            await Promise.race([audio.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 800))]);
        }
        if (mine !== token) return;
        if (audio.state !== "running") {
            teardown();
            emit({ status: "error", error: "浏览器没有允许播放声音，请再点一次播放。" });
            return;
        }
        const node = audio.createBufferSource();
        node.buffer = createNoiseBuffer(audio, kind);
        node.loop = true;
        const level = audio.createGain();
        level.gain.value = targetGain();
        node.connect(level).connect(audio.destination);
        node.start();
        source = node;
        gain = level;
        // 系统打断（来电、切到别的应用）时如实显示为已暂停
        audio.onstatechange = () => {
            if (ctx !== audio) return;
            if (audio.state === "running" && state.status === "paused") emit({ status: "playing" });
            else if (audio.state !== "running" && state.status === "playing") emit({ status: "paused" });
        };
        emit({ status: "playing", error: null });
    } catch {
        if (mine !== token) return;
        teardown();
        emit({ status: "error", error: "背景声音没能播放，请再试一次。" });
    }
}

export async function pauseFocusAmbient(): Promise<void> {
    if (!ctx || state.status !== "playing") return;
    try {
        await ctx.suspend();
        emit({ status: "paused" });
    } catch {
        emit({ status: "error", error: "暂停失败，可以直接点「停止」。" });
    }
}

export async function resumeFocusAmbient(): Promise<void> {
    if (!ctx || state.status !== "paused") return;
    try {
        await ctx.resume();
        emit({ status: "playing" });
    } catch {
        emit({ status: "error", error: "恢复播放失败，请重新点一次。" });
    }
}

/** 完全停止（不再保留种类），并释放 AudioContext。 */
export function stopFocusAmbient(): void {
    token += 1;
    teardown();
    emit({ kind: null, status: "idle", error: null });
}

export function setFocusAmbientVolume(volume: number): void {
    ensureLoaded();
    emit({ volume: clamp01(volume) });
    // 拖动音量条要跟手但不出「咔哒」声：用很短的时间常数
    applyGain(0.03);
    save();
}
