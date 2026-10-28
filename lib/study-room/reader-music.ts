// lib/study-room/reader-music.ts — 朗读时的背景音乐「统一接口」（预留，未接入即如实说明）。
//
// 设计意图：以后接小手机音乐应用 / 网易云音乐时，只要实现同一个接口就能挂到朗读上；
// 现在没有真实接口，所以 available 为 false，界面显示「尚未接入」而不是做一个假的联网按钮。

export type ReaderMusicTrack = {
  id: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  /** 由音乐来源决定：本地文件 / 在线链接 */
  source: "local" | "online";
};

export type ReaderMusicController = {
  /** 当前环境有没有可用的音乐来源 */
  available: boolean;
  /** 不可用时的原因（直接显示给用户） */
  unavailableReason?: string;
  current: ReaderMusicTrack | null;
  /** 语速朗读时要自动降低背景音，实现方负责渐变 */
  duck: (ducked: boolean) => void;
};

const UNAVAILABLE_REASON = "尚未接入小手机的音乐应用 / 网易云音乐，接入后这里会自动出现可播放的曲目。";

/**
 * 取当前的音乐控制器。
 * 现在固定返回「不可用」——这是事实，不是占位符；接入真实来源后替换这里的实现即可。
 */
export function getReaderMusicController(): ReaderMusicController {
  return {
    available: false,
    unavailableReason: UNAVAILABLE_REASON,
    current: null,
    duck: () => undefined,
  };
}
