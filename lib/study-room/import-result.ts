// lib/study-room/import-result.ts — 把书城里的一条结果加入书架（详情页、抽一本共用）。
//
//  - 内置书库：读随应用部署的整理好的正文；
//  - 联网来源：书房自己的接口（维基文库正文）直接请求，外部文件走服务端代理；
//  - 去重：同一来源链接的书已经在书架上，就直接打开那一本，不再新建一份；
//    但书架上那本没有正文（上次导入写到一半失败留下的空壳）时不算「已在书架」：
//    内置书原地补回正文（书 id 不变，进度、批注、书签都还在），联网书说明原因。

import { addBook, deleteBook, loadBooks, loadChapters, saveChapters, updateBook } from "@/lib/reading-storage";
import type { Book } from "@/lib/reading-types";

import type { BookSearchResult } from "./book-source";
import { BUILTIN_SOURCE_LABEL, loadBuiltinBook, toBookChapters } from "./builtin-library";
import { importBookFromBlob } from "./import";

export class SourceImportError extends Error {}

function sameSource(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const norm = (url: string) => {
    try {
      return decodeURI(url).replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

/** 书架上来源相同的书（同一来源链接视为同一本）。 */
export function findShelfBookBySource(sourceUrl: string): Book | undefined {
  return loadBooks().find((book) => sameSource(book.sourceUrl, sourceUrl));
}

/** 书架上这本是否真的有正文（至少一章有段落）。 */
async function hasText(book: Book): Promise<boolean> {
  try {
    return (await loadChapters(book.id)).some((chapter) => (chapter.paragraphs?.length ?? 0) > 0);
  } catch {
    return false;
  }
}

/** 存储失败的真实原因（空间不足、浏览器禁用存储等），直接给用户看。 */
function storageErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const inner = (error as { inner?: { name?: string } } | null)?.inner?.name ?? "";
  if (name === "QuotaExceededError" || inner === "QuotaExceededError") {
    return "手机给网页的存储空间不够，正文没能存进书架。可以先删掉书架上不读的书再试。";
  }
  if (name === "InvalidStateError" || name === "DatabaseClosedError" || name === "OpenFailedError") {
    return "浏览器不让书房写入本地存储（可能是无痕模式或存储被关闭），正文没能存进书架。";
  }
  const detail = error instanceof Error && error.message ? `：${error.message}` : "";
  return `正文没能存进书架${detail}`;
}

/** 内置书已在书架但没有正文：按原来的书 id 补回正文，进度和批注不受影响。 */
async function repairBuiltin(existing: Book, item: BookSearchResult, onProgress?: (stage: string) => void): Promise<Book> {
  const { chapters } = await loadBuiltinBook(item.importFile!.url, onProgress);
  onProgress?.("书架上那本缺正文，正在补回…");
  try {
    await saveChapters(existing.id, toBookChapters(existing.id, chapters));
    const repaired = { ...existing, totalChapters: chapters.length };
    await updateBook(repaired);
    return repaired;
  } catch (error) {
    throw new SourceImportError(storageErrorMessage(error));
  }
}

async function importBuiltin(item: BookSearchResult, onProgress?: (stage: string) => void): Promise<Book> {
  const { manifest, chapters } = await loadBuiltinBook(item.importFile!.url, onProgress);
  const bookId = `book_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const book: Book = {
    id: bookId,
    title: manifest.title,
    author: manifest.author,
    format: "txt",
    totalChapters: chapters.length,
    createdAt: new Date().toISOString(),
    description: `${manifest.edition}。${manifest.license}`,
    tags: ["内置书库"],
    sourceLabel: `${BUILTIN_SOURCE_LABEL} · ${manifest.source.name}`,
    sourceUrl: manifest.source.url,
  };
  onProgress?.("正在写入书架…");
  // 先存正文、确认存进去了，再把书放上书架：中途失败不会留下一本点开是空白的书
  try {
    await saveChapters(bookId, toBookChapters(bookId, chapters));
    const saved = await loadChapters(bookId);
    if (saved.length !== chapters.length) throw new Error(`只存进 ${saved.length}/${chapters.length} 章`);
    await addBook(book);
  } catch (error) {
    await deleteBook(bookId).catch(() => undefined);
    throw new SourceImportError(storageErrorMessage(error));
  }
  return book;
}

/** 联网接口失败时把服务端给的原因带出来（如维基文库限流、篇数太多），不统一说「没有这本书」。 */
async function responseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (data?.error) return data.error;
  if (response.status === 429 || response.status === 503) return "来源暂时限流，请稍后再试";
  if (response.status === 504) return "来源响应超时，请稍后再试";
  return `来源返回错误（${response.status}），请稍后再试`;
}

async function importNetwork(item: BookSearchResult, onProgress?: (stage: string) => void): Promise<Book> {
  const file = item.importFile!;
  // 书房自己的接口（如维基文库正文）直接用相对地址；外部来源走服务端代理
  const url = file.url.startsWith("/") ? file.url : `/api/study-room/fetch?url=${encodeURIComponent(file.url)}`;
  onProgress?.("正在取正文…");
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new SourceImportError("网络连接失败，请检查网络后再试");
  }
  if (!response.ok) throw new SourceImportError(await responseError(response));
  const blob = await response.blob();
  return importBookFromBlob(blob, `${item.title}.${file.format}`, onProgress, item.cover, {
    sourceLabel: item.sourceLabel,
    sourceUrl: item.externalUrl,
    description: item.description,
  });
}

/**
 * 加入书架。已在书架（同一来源）时返回原来那本，existed=true。
 * 失败时抛 SourceImportError（带可直接展示的原因）或 UnsupportedBookFormatError。
 */
export async function importSearchResult(
  item: BookSearchResult,
  onProgress?: (stage: string) => void,
): Promise<{ book: Book; existed: boolean }> {
  if (!item.importFile) throw new SourceImportError("这本书没有可导入的正文");
  const builtin = item.importFile.format === "builtin";
  const matches = loadBooks().filter((book) => sameSource(book.sourceUrl, item.externalUrl));
  // 同一来源可能有好几本（联网导入过一份、内置又导入过一份），优先打开有正文的那本
  for (const book of matches) {
    if (await hasText(book)) return { book, existed: true };
  }
  const empty = matches[0];
  if (empty && builtin) {
    try {
      return { book: await repairBuiltin(empty, item, onProgress), existed: false };
    } catch (error) {
      if (error instanceof SourceImportError) throw error;
      throw new SourceImportError(error instanceof Error ? error.message : "内置书库读取失败");
    }
  }
  if (empty) {
    throw new SourceImportError(
      `书架上已经有一本《${empty.title}》，但它没有正文（上次导入没完成）。请先在书架点开那本，在详情里「移出书架」，再回来导入。`,
    );
  }
  if (builtin) {
    try {
      return { book: await importBuiltin(item, onProgress), existed: false };
    } catch (error) {
      if (error instanceof SourceImportError) throw error;
      throw new SourceImportError(error instanceof Error ? error.message : "内置书库读取失败");
    }
  }
  return { book: await importNetwork(item, onProgress), existed: false };
}
