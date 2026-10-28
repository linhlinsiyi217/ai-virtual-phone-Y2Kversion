// lib/study-room/docx.ts — 从 DOCX 里取出正文段落（书架导入与书桌文风导入共用）。
//
// 只读 word/document.xml 的 <w:p> 段落：<w:t> 是文字，<w:tab> 记为制表，<w:br>/<w:cr> 记为换行。
// 不用正则粗暴去标签：<w:pPr>、<w:pStyle> 这类标签也以 "<w:p" 开头，会被误当成段落产生大量空行。

export class DocxReadError extends Error {}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** 读出 DOCX 的段落文字（保留空段，方便按空行分章）。 */
export async function readDocxParagraphs(data: ArrayBuffer): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new DocxReadError("这个文件不是有效的 DOCX（旧版 .doc 请先另存为 .docx）");
  }
  const entry = zip.file("word/document.xml");
  if (!entry) throw new DocxReadError("这个 DOCX 里没有正文");
  const xml = await entry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new DocxReadError("这个 DOCX 的正文损坏了");

  const paragraphs: string[] = [];
  const nodes = doc.getElementsByTagNameNS(W_NS, "p");
  for (let i = 0; i < nodes.length; i += 1) {
    let text = "";
    const walk = (node: Element) => {
      for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
        if (child.namespaceURI !== W_NS) {
          // 兼容块（mc:AlternateContent 等）里也可能有文字，只走 Fallback 避免重复
          if (child.localName === "Choice") continue;
          walk(child);
          continue;
        }
        switch (child.localName) {
          case "t":
            text += child.textContent ?? "";
            break;
          case "tab":
            text += "\t";
            break;
          case "br":
          case "cr":
            text += "\n";
            break;
          case "pPr":
          case "rPr":
          case "instrText":
          case "delText":
            break;
          case "p":
            // 嵌套段落（文本框）会被外层循环单独取到
            break;
          default:
            walk(child);
        }
      }
    };
    walk(nodes[i]);
    paragraphs.push(text.replace(/\s+$/g, ""));
  }
  if (!paragraphs.some((line) => line.trim())) throw new DocxReadError("这个 DOCX 里没有可用的文字");
  return paragraphs;
}

/** DOCX → 纯文本（段落之间一个换行）。 */
export async function readDocxText(data: ArrayBuffer): Promise<string> {
  return (await readDocxParagraphs(data)).join("\n").trim();
}
