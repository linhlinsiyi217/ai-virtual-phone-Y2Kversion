import QRCode from "qrcode";
import { buildFriendCodeUri } from "./friend-code";
import type { FriendOwnerType } from "./social-types";

export async function renderFriendCodeDataUrl(code: string, kind: FriendOwnerType, avatarUrl?: string): Promise<string> {
  const base = await QRCode.toDataURL(buildFriendCodeUri(code, kind), {
    width: 320,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#0A0A0A", light: "#FFFFFF" },
  });
  if (!avatarUrl || typeof document === "undefined") return base;
  try {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      if (!src.startsWith("data:")) image.crossOrigin = "anonymous";
      image.src = src;
    });
    const [qr, avatar] = await Promise.all([load(base), load(avatarUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) return base;
    context.drawImage(qr, 0, 0, 320, 320);
    const size = 62;
    const x = (320 - size) / 2;
    const y = x;
    context.save();
    context.beginPath();
    context.arc(160, 160, size / 2 + 5, 0, Math.PI * 2);
    context.fillStyle = "#FFFFFF";
    context.fill();
    context.beginPath();
    context.arc(160, 160, size / 2, 0, Math.PI * 2);
    context.clip();
    const crop = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    context.drawImage(avatar, (avatar.naturalWidth - crop) / 2, (avatar.naturalHeight - crop) / 2, crop, crop, x, y, size, size);
    context.restore();
    return canvas.toDataURL("image/png");
  } catch {
    return base;
  }
}
