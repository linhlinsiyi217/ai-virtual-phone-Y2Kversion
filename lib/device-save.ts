/** 把网页里生成的文件落到手机「下载」目录；浏览器环境下退化为普通下载。 */

type ShellBridge = {
    saveBase64File?: (base64: string, fileName: string, mimeType: string) => boolean;
};

function shellBridge(): ShellBridge | null {
    const w = window as unknown as { AndroidShell?: ShellBridge };
    return w.AndroidShell || null;
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export type SaveResult = "device" | "download" | "failed";

export async function saveFileToDevice(blob: Blob, fileName: string): Promise<SaveResult> {
    const bridge = shellBridge();
    if (bridge?.saveBase64File) {
        try {
            const ok = bridge.saveBase64File(await blobToBase64(blob), fileName, blob.type || "application/octet-stream");
            if (ok) return "device";
        } catch {
            /* 落到下面的浏览器路径 */
        }
    }
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        return "download";
    } catch {
        return "failed";
    }
}
