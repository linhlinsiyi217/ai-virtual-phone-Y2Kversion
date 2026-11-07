import QRCode from "qrcode";
import { buildFriendCodeUri } from "./friend-code";
import type { FriendOwnerType } from "./social-types";

export async function renderFriendCodeDataUrl(code: string, kind: FriendOwnerType): Promise<string> {
  return QRCode.toDataURL(buildFriendCodeUri(code, kind), {
    width: 320,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0A0A0A", light: "#FFFFFF" },
  });
}
