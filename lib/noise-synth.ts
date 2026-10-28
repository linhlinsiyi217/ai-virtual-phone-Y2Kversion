// lib/noise-synth.ts — 白噪音合成核心（G4 全局白噪音与书房背景音共用的唯一算法来源）。
//
// 在本机用 Web Audio 按算法合成噪声，不下载音频文件、不联网、不调用模型，
// 因此没有第三方音频素材，也不涉及素材授权（粉红噪音用 Paul Kellet 的公开滤波系数）。
// 消费方：
//   - lib/study-room/ambient.ts   书房阅读背景音（退出书房即停）
//   - lib/focus-ambient.ts        全局白噪音（桌面级，专注模式使用，跨页面持续）

export type NoiseKind = "rain" | "room" | "white" | "pink" | "brown";

export const NOISE_LABELS: Record<NoiseKind, string> = {
  rain: "雨声",
  room: "室内底噪",
  white: "白噪音",
  pink: "粉红噪音",
  brown: "棕噪音",
};

/** 每种声音一句话说明（面板里显示） */
export const NOISE_HINTS: Record<NoiseKind, string> = {
  rain: "偏亮的沙沙声，像窗外小雨",
  room: "低沉平稳，像空调或室内底噪",
  white: "各频段一样响，最「嘶」的一种",
  pink: "高频减弱，比白噪音柔和",
  brown: "低频最多，像远处的瀑布或风",
};

/** 循环缓冲长度（秒）与首尾交叉淡化长度（秒），循环接缝听不出来 */
const LOOP_SECONDS = 8;
const SEAM_SECONDS = 0.5;

/** 每种声音的目标响度（RMS），让切换种类时音量差不多 */
const NOISE_RMS: Record<NoiseKind, number> = { rain: 0.24, room: 0.22, white: 0.14, pink: 0.2, brown: 0.22 };

/**
 * 生成一种噪声的循环 AudioBuffer：多生成一段与开头交叉淡化，
 * 循环回到开头时没有接缝；最后按目标响度归一，切换种类时音量差不多。
 */
export function createNoiseBuffer(audio: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  const rate = audio.sampleRate;
  const length = Math.round(rate * LOOP_SECONDS);
  const seam = Math.round(rate * SEAM_SECONDS);
  // 多生成一段，用来和开头交叉淡化
  const raw = new Float32Array(length + seam);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (kind === "rain") {
      // 雨：高频偏亮，轻微起伏
      last = 0.85 * white + 0.15 * last;
      raw[i] = last;
    } else if (kind === "room") {
      // 室内底噪：低频偏多，接近空调声
      last = 0.97 * last + 0.03 * white;
      raw[i] = last;
    } else if (kind === "white") {
      raw[i] = white;
    } else if (kind === "pink") {
      // 粉红噪音：Paul Kellet 三级滤波（每倍频程 -3dB）
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = b0 + b1 + b2 + white * 0.1848;
    } else {
      // 棕噪音：带泄漏的积分（每倍频程 -6dB），比室内底噪更沉
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last;
    }
  }
  // 首尾交叉淡化（噪声不相关，用等功率曲线）
  for (let i = 0; i < seam; i += 1) {
    const t = i / seam;
    raw[i] = raw[i] * Math.sin((t * Math.PI) / 2) + raw[length + i] * Math.cos((t * Math.PI) / 2);
  }
  // 按目标响度归一
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += raw[i] * raw[i];
  const rms = Math.sqrt(sum / length) || 1;
  const scale = NOISE_RMS[kind] / rms;
  const buffer = audio.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.max(-1, Math.min(1, raw[i] * scale));
  return buffer;
}
