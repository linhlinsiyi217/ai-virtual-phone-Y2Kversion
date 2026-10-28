// lib/study-room/background-image.ts — 书房背景图的本地读取与安全检查。
//
// 只做两件事：
//  1. 把用户选的本地图片读成 data URL（过大的图先等比缩小，避免塞进设置里太大）；
//  2. 校验图片链接是否真的能加载出来（坏链回退用）。
// 不做任何上传：图片只在浏览器本地使用。

/** 能直接解码的图片格式（与面板上的提示保持一致）。 */
export const SUPPORTED_BACKGROUND_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const BACKGROUND_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif";

/** 超过这个尺寸的图先缩小，再存进书房设置。 */
const MAX_STORED_BYTES = 1_200_000;
const MAX_EDGE = 1920;

export type PickedImage = {
  dataUrl: string;
  width: number;
  height: number;
  /** 给用户看的说明，例如「已缩小到 1920px」 */
  note?: string;
};

export class UnsupportedBackgroundError extends Error {}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 从文件名/类型判断是否是可解码的图片；不支持的给出具体原因。 */
export function assertSupportedImage(file: File): void {
  const name = file.name.toLowerCase();
  const byExtension = /\.(jpe?g|png|webp|gif)$/.test(name);
  const byType = SUPPORTED_BACKGROUND_TYPES.includes(file.type);
  if (byType || byExtension) return;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "该格式";
  throw new UnsupportedBackgroundError(
    `暂不支持 ${ext} 图片，请改用 JPG / PNG / WebP / GIF；GIF 会保留动画。`,
  );
}

function loadElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码"));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/** 等比缩小并尽量用 webp 重编码；失败时返回原图，不让用户白忙。 */
async function shrink(dataUrl: string, img: HTMLImageElement): Promise<PickedImage> {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  ctx.drawImage(img, 0, 0, width, height);
  const encoded = canvas.toDataURL("image/webp", 0.85);
  const useWebp = encoded.startsWith("data:image/webp");
  return {
    dataUrl: useWebp ? encoded : canvas.toDataURL("image/jpeg", 0.85),
    width,
    height,
    note: scale < 1 ? `已等比缩小到 ${width}×${height}` : "已重新压缩",
  };
}

/** 本地图片 → 背景用的 data URL。 */
export async function fileToBackgroundImage(file: File): Promise<PickedImage> {
  assertSupportedImage(file);
  const dataUrl = await readAsDataUrl(file);
  const img = await loadElement(dataUrl);
  const size = file.size;
  // GIF 重新编码会丢动画，体积不大时原样保留
  const keepOriginal = file.type === "image/gif" && size <= MAX_STORED_BYTES;
  if (keepOriginal || size <= MAX_STORED_BYTES) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }
  const shrunk = await shrink(dataUrl, img);
  return { ...shrunk, note: `${shrunk.note ?? "已压缩"}（原图 ${formatBytes(size)}）` };
}

/** 本地图片 → 书封用的 data URL：最长边压到 720px，JPEG 重编码，避免把大图塞进书架数据。 */
export async function fileToCoverImage(file: File): Promise<string> {
  assertSupportedImage(file);
  const dataUrl = await readAsDataUrl(file);
  const img = await loadElement(dataUrl);
  const scale = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

/** 检查链接能否作为背景图加载；失败时就别写进设置，保持原有底色。 */
export async function canLoadImageUrl(url: string): Promise<boolean> {
  try {
    await loadElement(url);
    return true;
  } catch {
    return false;
  }
}

/** 简单判断用户填的是不是可用的图片链接。 */
export function looksLikeImageUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith("data:image/")) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  return true;
}
