"use client";

// 画布拉线的两个弹窗：
// RelationLinkDialog —— 点照片A→照片B后输入关系标签
// RelationPairSheet —— 点线上标签，逐条查看/删除两人之间的关系

import { useState } from "react";
import type { CharacterWorldRelation } from "@/lib/character-world-storage";
import { CSheet } from "@/components/character/modal-kit";

export function RelationLinkDialog({
  fromName,
  toName,
  onConfirm,
  onCancel,
}: {
  fromName: string;
  toName: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const submit = () => {
    if (!label.trim()) return;
    onConfirm(label.trim());
  };
  return (
    <CSheet
      eyebrow="RED STRING"
      title="牵一条关系线"
      ariaLabel="牵线"
      onClose={onCancel}
      footer={{ label: "牵线", onClick: submit, disabled: !label.trim() }}
    >
      <div className="cm-rel-line">
        <strong>{fromName}</strong>
        <span>是</span>
        <strong>{toName}</strong>
        <span>的…</span>
      </div>
      <label className="cm-label" htmlFor="relation-label">关系标签</label>
      <input
        id="relation-label"
        className="cm-input"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="如：哥哥 / 宿敌 / 上司"
      />
      <p className="cm-hint">回车也可以直接牵线。</p>
    </CSheet>
  );
}

export function RelationPairSheet({
  relations,
  nameById,
  onDelete,
  onClose,
}: {
  /** 这对角色之间的全部关系（两个方向都算） */
  relations: CharacterWorldRelation[];
  nameById: Map<string, string>;
  onDelete: (relationId: string) => void;
  onClose: () => void;
}) {
  return (
    <CSheet
      eyebrow="RELATIONS"
      title="关系细目"
      ariaLabel="关系细目"
      onClose={onClose}
      footer={{ label: "完成", onClick: onClose }}
    >
      {relations.length === 0 ? (
        <p className="cm-empty">这两人之间已经没有关系线了。</p>
      ) : (
        <ul className="cm-rel-list">
          {relations.map(relation => (
            <li key={relation.id} className="cm-rel-item">
              <span className="cm-rel-text">
                {nameById.get(relation.fromCharacterId) ?? "?"}
                是{nameById.get(relation.toCharacterId) ?? "?"}的
                「{relation.label}」
              </span>
              <button
                type="button"
                className="cm-chip-btn"
                onClick={() => onDelete(relation.id)}
                aria-label="删除这条关系"
              >
                剪断
              </button>
            </li>
          ))}
        </ul>
      )}
    </CSheet>
  );
}
