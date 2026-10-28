// lib/study-room/events.ts — 书房内部的小型事件约定（跨组件跳转用，避免层层透传 props）。
//
// 阅读时选中文字后「搜索」跳书城；导入成功后弹一次成功提示。

export const STUDYROOM_SEARCH_EVENT = "studyroom:search";

export type StudyRoomSearchDetail = { query: string };

export function requestSearchInStore(query: string): void {
  const value = query.trim();
  if (!value) return;
  window.dispatchEvent(new CustomEvent<StudyRoomSearchDetail>(STUDYROOM_SEARCH_EVENT, { detail: { query: value } }));
}

// 导入成功：真的新加进书架时才发（已在书架、失败、只收藏都不发），由书房外层统一弹「已经导入成功」。
export const STUDYROOM_IMPORTED_EVENT = "studyroom:imported";

export type StudyRoomImportedDetail = { title: string };

export function announceImported(title: string): void {
  window.dispatchEvent(new CustomEvent<StudyRoomImportedDetail>(STUDYROOM_IMPORTED_EVENT, { detail: { title } }));
}
