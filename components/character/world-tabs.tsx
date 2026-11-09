"use client";

// 世界卷宗 tab 条 + 卷宗编辑 sheet + 新建卷宗 sheet
// 视觉隐喻：每个世界 = 一份牛皮纸案卷，激活的 tab 是「翻开的那份」，
// 与画布纸面连成一体；编辑模式下拍立得可以拖到 tab 上「归档」进别的世界。

import { useState } from "react";
import type { CharacterWorldGroup } from "@/lib/character-world-storage";
import { DEFAULT_CHARACTER_WORLD_ID } from "@/lib/character-world-storage";
import { CSheet, CConfirm } from "@/components/character/modal-kit";

export function WorldTabStrip({
  groups,
  currentWorldId,
  memberCounts,
  dropTargetWorldId,
  onSelect,
  onOpenEditor,
  onOpenCreate,
}: {
  groups: CharacterWorldGroup[];
  currentWorldId: string;
  memberCounts: Map<string, number>;
  /** 拖拽拍立得悬停中的 tab（高亮为可归档状态） */
  dropTargetWorldId: string | null;
  onSelect: (worldId: string) => void;
  /** 再次点按当前激活的 tab → 打开卷宗编辑 */
  onOpenEditor: () => void;
  onOpenCreate: () => void;
}) {
  return (
    <div className="wt-strip" role="tablist" aria-label="世界卷宗">
      {groups.map(group => {
        const active = group.id === currentWorldId;
        const dropping = group.id === dropTargetWorldId;
        return (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-world-tab-id={group.id}
            className={`wt-tab ${active ? "wt-tab-active" : ""} ${dropping ? "wt-tab-drop" : ""}`}
            onClick={() => (active ? onOpenEditor() : onSelect(group.id))}
            title={active ? "点按编辑这份卷宗" : `打开「${group.name}」`}
          >
            <span className="wt-tab-name">{group.name}</span>
            <span className="wt-tab-count">{memberCounts.get(group.id) ?? 0}</span>
            {active && <span className="wt-tab-edit" aria-hidden>✎</span>}
          </button>
        );
      })}
      <button type="button" className="wt-tab wt-tab-new" onClick={onOpenCreate} aria-label="新建世界">
        ＋
      </button>
    </div>
  );
}

/** 卷宗编辑：改名 / 世界观描述 / 删除（角色并回默认世界） */
export function WorldCaseSheet({
  group,
  onRename,
  onUpdateDescription,
  onDelete,
  onClose,
}: {
  group: CharacterWorldGroup;
  onRename: (name: string) => void;
  onUpdateDescription: (description: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDefault = group.id === DEFAULT_CHARACTER_WORLD_ID;

  const save = () => {
    if (name.trim() && name.trim() !== group.name) onRename(name.trim());
    if (description.trim() !== group.description) onUpdateDescription(description.trim());
    onClose();
  };

  return (
    <>
      <CSheet
        eyebrow="CASE FILE"
        title="卷宗详情"
        ariaLabel="卷宗详情"
        onClose={save}
        onBackdrop={save}
        footer={{ label: "完成", onClick: save }}
      >
        <label className="cm-label" htmlFor="world-case-name">卷宗名称</label>
        <input
          id="world-case-name"
          className="cm-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="世界名称"
          disabled={isDefault}
        />
        {isDefault && <p className="cm-hint">默认世界不可改名或删除，删除其他世界时角色会回到这里。</p>}
        <label className="cm-label" htmlFor="world-case-desc">世界观描述（会注入该世界所有角色的上下文）</label>
        <textarea
          id="world-case-desc"
          className="cm-textarea"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="写下这个世界的背景、时代、阵营边界、共同常识或角色互动前提…"
        />
        {!isDefault && (
          <button type="button" className="cm-link" onClick={() => setConfirmDelete(true)}>
            删除卷宗
          </button>
        )}
      </CSheet>

      {confirmDelete && (
        <CConfirm
          title="删除这个卷宗？"
          message={`「${group.name}」里的角色会全部并回默认世界；这份卷宗的世界观描述和角色之间的关系线会一起丢失，无法恢复。`}
          cancelLabel="取消"
          confirmLabel="删除"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}

/** 新建卷宗 */
export function NewWorldSheet({
  onCreate,
  onClose,
}: {
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onCreate(name.trim());
  };
  return (
    <CSheet
      eyebrow="NEW CASE"
      title="新建卷宗"
      ariaLabel="新建卷宗"
      onClose={onClose}
      footer={{ label: "建立", onClick: submit, disabled: !name.trim() }}
    >
      <label className="cm-label" htmlFor="new-world-name">卷宗名称</label>
      <input
        id="new-world-name"
        className="cm-input"
        value={name}
        autoFocus
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="例如：现代都市 / 仙侠界"
      />
      <p className="cm-hint">角色、关系线和世界观描述都会归档在这份卷宗里。</p>
    </CSheet>
  );
}
