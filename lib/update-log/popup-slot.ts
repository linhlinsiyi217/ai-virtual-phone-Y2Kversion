// lib/update-log/popup-slot.ts — 更新弹窗的单一展示位。
//
// 项目整体日志与书房日志是同源数据的两个范围。两份弹窗都可能在同一次进入时
// 满足「新版本首次打开」的条件，如果各弹各的，用户一进来就会被两个重复通知叠住。
// 这里用一个全局展示位把它们串起来：同一时刻只有一个弹窗在前台，
// 前一个被确认关闭后，后一个才接上。
//
// 只管展示顺序，不碰已读状态 —— 已读仍由各自的 lib/update-log/{system,studyroom}.ts 记录。

type Listener = () => void;

let holder: string | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/**
 * 申请展示位。拿到返回 true；已被别人占着则返回 false，
 * 调用方应当订阅 subscribeSlot 等它空出来再试。
 * 同一个 owner 重复申请视为仍然持有（React 重渲染不会把自己挤掉）。
 */
export function claimSlot(owner: string): boolean {
  if (holder === null || holder === owner) {
    holder = owner;
    return true;
  }
  return false;
}

/** 释放展示位；只有当前持有者能释放，释放后通知等待方。 */
export function releaseSlot(owner: string) {
  if (holder !== owner) return;
  holder = null;
  notify();
}

/** 展示位空出来时回调一次（返回取消订阅函数）。 */
export function subscribeSlot(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
