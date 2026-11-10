"use client";

// 卷宗编辑 sheet + 新建卷宗 sheet

import { useState } from "react";
import type { CharacterWorldGroup } from "@/lib/character-world-storage";
import { DEFAULT_CHARACTER_WORLD_ID } from "@/lib/character-world-storage";
import { CSheet, CConfirm } from "@/components/character/modal-kit";

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
