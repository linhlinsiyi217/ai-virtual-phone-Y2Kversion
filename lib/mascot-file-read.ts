/**
 * 小卷「看文件」：把用户上传的文件读成模型能懂的文本。
 *
 * - 纯文本类（txt/md/json/csv/代码/配置）：直接读
 * - docx：解开 zip，取 word/document.xml 去标签
 * - zip：列出条目，抽取其中文本类成员
 * - 图片：交给原有的图片通道，这里只标记 kind
 * - pdf 等二进制：不硬解，给一句说明让用户换格式
 */

const TEXT_EXT = new Set([
    "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "yml", "yaml", "ini", "conf", "env",
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "html", "htm", "xml", "svg",
    "py", "java", "kt", "go", "rs", "c", "h", "cpp", "sh", "bat", "sql", "toml",
]);

const PER_FILE_LIMIT = 20000;
const TOTAL_LIMIT = 60000;

export type MascotFileResult = {
    name: string;
    kind: "text" | "docx" | "zip" | "image" | "unsupported";
    text?: string;
    note?: string;
};

function ext(name: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : "";
}

function stripXml(xml: string): string {
    return xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function clip(text: string): string {
    const t = text.trim();
    return t.length > PER_FILE_LIMIT ? `${t.slice(0, PER_FILE_LIMIT)}\n…（内容过长，已截断）` : t;
}

export async function readMascotFile(file: File): Promise<MascotFileResult> {
    const name = file.name || "未命名文件";
    const e = ext(name);

    if (file.type.startsWith("image/")) return { name, kind: "image" };

    if (e === "docx") {
        try {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const entry = zip.file("word/document.xml");
            if (!entry) return { name, kind: "unsupported", note: "这个 docx 里没找到正文" };
            const text = clip(stripXml(await entry.async("string")));
            return { name, kind: "docx", text };
        } catch {
            return { name, kind: "unsupported", note: "docx 解不开，可能已损坏" };
        }
    }

    if (e === "zip") {
        try {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
            const picked: string[] = [];
            let budget = PER_FILE_LIMIT;
            for (const n of names) {
                if (picked.join("").length > TOTAL_LIMIT) break;
                if (!TEXT_EXT.has(ext(n))) continue;
                if (budget <= 0) break;
                const content = await zip.files[n].async("string");
                const slice = content.slice(0, Math.min(6000, budget));
                budget -= slice.length;
                picked.push(`--- ${n} ---\n${slice}`);
            }
            const head = `压缩包共 ${names.length} 个文件：${names.slice(0, 30).join("、")}${names.length > 30 ? " …" : ""}`;
            return {
                name,
                kind: "zip",
                text: clip(`${head}\n\n${picked.length ? picked.join("\n\n") : "（里面没有可直接读取的文本文件）"}`),
            };
        } catch {
            return { name, kind: "unsupported", note: "zip 解不开，可能已损坏" };
        }
    }

    if (TEXT_EXT.has(e) || file.type.startsWith("text/") || file.type === "application/json") {
        try {
            return { name, kind: "text", text: clip(await file.text()) };
        } catch {
            return { name, kind: "unsupported", note: "读取失败" };
        }
    }

    if (e === "pdf") {
        return { name, kind: "unsupported", note: "PDF 暂时读不了，转成 txt 或截图发我" };
    }

    return { name, kind: "unsupported", note: `暂不支持 .${e || "该"} 格式，文本类、docx、zip、图片都可以` };
}

/** 把附件内容拼成一段可直接塞进对话的文本。 */
export function buildFilePreamble(files: Array<{ name: string; text: string }>): string {
    if (!files.length) return "";
    let budget = TOTAL_LIMIT;
    const blocks: string[] = [];
    for (const f of files) {
        if (budget <= 0) break;
        const body = f.text.length > budget ? `${f.text.slice(0, budget)}\n…（已截断）` : f.text;
        budget -= body.length;
        blocks.push(`【附件：${f.name}】\n${body}`);
    }
    return blocks.join("\n\n");
}
