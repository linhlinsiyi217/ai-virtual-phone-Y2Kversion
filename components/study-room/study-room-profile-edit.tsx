"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Copy, ImageUp, Lock, Plus, RefreshCw, SlidersHorizontal, X } from "lucide-react";

import { avatarDataUrl, nextVariant } from "@/lib/study-room/npc-avatar";
import {
  HANDLE_MAX,
  NAME_MAX,
  SIGNATURE_MAX,
  STATUS_MAX,
  TAG_LEN_MAX,
  TAG_MAX,
  TAG_SUGGESTIONS,
  TAG_SWATCHES,
  displayHandle,
  displayName,
  isValidColor,
  normalizeProfile,
  profileAvatarSrc,
  saveProfileAsync,
  validateHandle,
  type UserProfile,
} from "@/lib/study-room/profile";
import {
  SVIP_BENEFITS,
  SVIP_PLAN,
  SVIP_SWATCHES,
  formatMemberDate,
  isMemberActive,
  loadMembership,
  membershipBalance,
  purchaseSvip,
  type MembershipState,
} from "@/lib/study-room/membership";
import { WALLET_UPDATED_EVENT, formatWalletAmount } from "@/lib/wallet-storage";
import { ColorSheet } from "./color-sheet";

const DEFAULT_TAG_COLOR = "#7A8FA6";

/** 上传的头像压到 256×256 的 JPEG，居中裁成正方形，避免把大图塞进存储。 */
function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const size = 256;
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx || side === 0) throw new Error("no-canvas");
        ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad-image"));
    };
    image.src = url;
  });
}

function sameProfile(a: UserProfile, b: UserProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ──────────────────────────────────────────
   标签配色：白色玻璃半屏色板；长按色块或「详细调色」进完整调色
   ────────────────────────────────────────── */

export function TagColorSheet({
  tag,
  value,
  member,
  onPick,
  onClose,
}: {
  tag: string;
  value: string;
  member: boolean;
  onPick: (color: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef(value);
  const pressRef = useRef<{ timer: number; fired: boolean } | null>(null);

  const openDetail = (start: string) => {
    liveRef.current = start;
    setError(null);
    setDetail(start);
  };

  const startPress = (color: string) => {
    const timer = window.setTimeout(() => {
      if (pressRef.current) pressRef.current.fired = true;
      openDetail(color);
    }, 480);
    pressRef.current = { timer, fired: false };
  };
  const endPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
  };
  const tapSwatch = (color: string) => {
    // 长按已经打开了详细调色，就不再当作点选
    if (pressRef.current?.fired) {
      pressRef.current = null;
      return;
    }
    pressRef.current = null;
    onPick(color);
  };

  if (detail !== null) {
    return (
      <ColorSheet
        title={`「${tag}」的颜色`}
        value={detail}
        onChange={(next) => {
          liveRef.current = next;
        }}
        onClose={() => {
          const next = liveRef.current;
          if (next === detail) {
            setDetail(null);
            return;
          }
          if (!isValidColor(next)) {
            setError("这个颜色格式无法保存，已保留原来的颜色");
            setDetail(null);
            return;
          }
          onPick(next);
        }}
      />
    );
  }

  const swatch = (color: string, locked = false) => (
    <button
      key={color}
      type="button"
      className="sr-pf-swatch"
      style={{ background: color }}
      data-active={color.toLowerCase() === value.toLowerCase() ? "true" : undefined}
      disabled={locked}
      aria-label={locked ? `${color}（SVIP 配色）` : `选 ${color}，长按细调`}
      onPointerDown={locked ? undefined : () => startPress(color)}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={(event) => event.preventDefault()}
      onClick={locked ? undefined : () => tapSwatch(color)}
    >
      {locked && <Lock size={12} strokeWidth={2} aria-hidden />}
    </button>
  );

  return (
    <div className="sr-sheet-mask sr-sheet-mask--top" onClick={onClose}>
      <div className="sr-sheet sr-pf-glass-sheet" role="dialog" aria-label={`「${tag}」的颜色`} onClick={(event) => event.stopPropagation()}>
        <div className="sr-gift-head">
          <span className="sr-sheet-label" style={{ margin: 0 }}>「{tag}」的颜色</span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>
        <div className="sr-pf-swatches">{TAG_SWATCHES.map((color) => swatch(color))}</div>
        <div className="sr-pf-swatch-group">
          <span className="sr-pf-field-hint">SVIP 配色{member ? "" : "（开通后可选）"}</span>
          <div className="sr-pf-swatches">{SVIP_SWATCHES.map((color) => swatch(color, !member))}</div>
        </div>
        {error && <p className="sr-pf-form-error" role="alert">{error}</p>}
        <button type="button" className="sr-btn sr-pf-sheet-btn" onClick={() => openDetail(value)}>
          <SlidersHorizontal size={16} strokeWidth={1.8} />
          详细调色
        </button>
        <p className="sr-pf-field-hint" style={{ margin: "8px 0 0" }}>长按某个色块，可以从它开始细调。</p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
   SVIP：只用小手机统一钱包里的虚拟余额
   ────────────────────────────────────────── */

export function SvipSheet({ onClose, onChanged }: { onClose: () => void; onChanged: (state: MembershipState) => void }) {
  const [state, setState] = useState<MembershipState>(() => loadMembership());
  const [balance, setBalance] = useState(() => membershipBalance());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const active = isMemberActive(state);

  useEffect(() => {
    const refresh = () => setBalance(membershipBalance());
    window.addEventListener(WALLET_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, refresh);
  }, []);

  const buy = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const result = purchaseSvip();
      setState(result.state);
      setBalance(membershipBalance());
      onChanged(result.state);
      if (result.ok) setDone(true);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? `开通失败：${err.message}` : "开通失败，余额没有变动。");
    } finally {
      setBusy(false);
    }
  };

  const short = balance < SVIP_PLAN.price;

  return (
    <div className="sr-sheet-mask" onClick={busy ? undefined : onClose}>
      <div className="sr-sheet sr-pf-glass-sheet" role="dialog" aria-label="书房 SVIP" onClick={(event) => event.stopPropagation()}>
        <div className="sr-gift-head">
          <span className="sr-sheet-label" style={{ margin: 0 }}>书房 SVIP</span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭" disabled={busy}>
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <div className="sr-pf-svip-plan">
          <span className="sr-pf-svip sr-pf-svip--lg">SVIP</span>
          <div>
            <strong>{formatWalletAmount(SVIP_PLAN.price)} / {SVIP_PLAN.days} 天</strong>
            <span>{active ? `有效期至 ${formatMemberDate(state.endAt)}，续费从到期日往后加` : "用小手机钱包余额开通"}</span>
          </div>
        </div>

        <ul className="sr-pf-svip-list">
          {SVIP_BENEFITS.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li className="sr-pf-svip-free">普通标签、配色和资料编辑一直免费</li>
        </ul>

        <div className="sr-pf-svip-balance">
          <span>钱包余额</span>
          <strong>{formatWalletAmount(balance)}</strong>
        </div>

        {error && <p className="sr-pf-form-error" role="alert">{error}</p>}
        {done && <p className="sr-pf-form-ok" role="status">已开通，有效期至 {formatMemberDate(state.endAt)}</p>}

        <button
          type="button"
          className="sr-btn sr-btn-primary sr-pf-sheet-btn"
          onClick={buy}
          disabled={busy || short}
          aria-busy={busy || undefined}
        >
          {busy ? "处理中" : short ? "余额不足" : active ? `续费 ${SVIP_PLAN.days} 天` : `开通 ${SVIP_PLAN.days} 天`}
        </button>
        {short && <p className="sr-pf-field-hint" style={{ margin: "8px 0 0" }}>余额不够时不会扣费，也不会开通。可以先去钱包充值虚拟余额。</p>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
   编辑资料：草稿 + 实时预览；保存才写入，取消放弃
   ────────────────────────────────────────── */

export function ProfileEditSheet({
  profile,
  hostName,
  hostAvatar,
  member,
  onSaved,
  onClose,
}: {
  profile: UserProfile;
  hostName: string | null;
  hostAvatar: string | null;
  member: boolean;
  onSaved: (next: UserProfile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [tagInput, setTagInput] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = !sameProfile(draft, profile);
  const handleError = validateHandle(draft.handle);
  const nameError = draft.nameMode === "custom" && !draft.name.trim() ? "独立昵称不能为空" : null;
  const blocked = Boolean(handleError || nameError) || uploading || saving;

  const previewAvatar = profileAvatarSrc(draft, hostAvatar, avatarDataUrl(draft.avatar));
  const previewName = displayName(draft, hostName);
  const remainingSuggestions = useMemo(
    () => TAG_SUGGESTIONS.filter((tag) => !draft.tags.includes(tag)),
    [draft.tags],
  );

  const patch = (next: Partial<UserProfile>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setError(null);
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmLeave(true);
    else onClose();
  };

  const addTag = (raw: string) => {
    const tag = raw.trim().slice(0, TAG_LEN_MAX);
    if (!tag) return;
    if (draft.tags.includes(tag)) {
      setError(`已经有「${tag}」了`);
      return;
    }
    if (draft.tags.length >= TAG_MAX) {
      setError(`最多 ${TAG_MAX} 个标签`);
      return;
    }
    patch({ tags: [...draft.tags, tag] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const tagColors = { ...draft.tagColors };
    delete tagColors[tag];
    patch({ tags: draft.tags.filter((item) => item !== tag), tagColors });
  };

  const moveTag = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.tags.length) return;
    const tags = [...draft.tags];
    [tags[index], tags[target]] = [tags[target], tags[index]];
    patch({ tags });
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择一张图片");
      return;
    }
    setUploading(true);
    try {
      patch({ avatarUrl: await compressAvatar(file) });
    } catch {
      setError("这张图片读不出来，换一张试试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveProfileAsync(
        normalizeProfile(
          {
            ...draft,
            name: draft.name.trim(),
            signature: draft.signature.trim(),
            status: draft.status.trim(),
            handle: draft.handle.trim(),
          },
          draft.id,
        ),
      );
      onSaved(next);
    } catch (err) {
      // 草稿保留在面板里，可以直接再点保存
      const reason = err instanceof Error && err.message ? err.message : String(err || "未知错误");
      setError(`没能保存：${reason}。修改还在，可以再试一次。`);
    } finally {
      setSaving(false);
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(draft.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("这台设备暂时不能复制");
    }
  };

  return (
    <div className="sr-sheet-mask" onClick={requestClose}>
      <div className="sr-sheet sr-pf-edit" role="dialog" aria-label="编辑资料" onClick={(event) => event.stopPropagation()}>
        <div className="sr-pf-edit-head">
          <button type="button" className="sr-btn sr-btn-text" onClick={requestClose} disabled={saving}>
            取消
          </button>
          <span className="sr-pf-edit-title">编辑资料</span>
          <button
            type="button"
            className="sr-btn sr-btn-primary sr-btn-sm"
            onClick={() => void save()}
            disabled={blocked || !dirty}
            aria-busy={saving || undefined}
          >
            {saving ? "保存中" : "保存"}
          </button>
        </div>

        <div className="sr-pf-edit-scroll">
          {/* 实时预览：和主页同一份展示规则 */}
          <div className="sr-pf-preview" aria-label="预览">
            <span className="sr-pf-avatar sr-pf-preview-avatar" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewAvatar} alt="" />
            </span>
            <div className="sr-pf-preview-main">
              <div className="sr-pf-preview-name">
                <span>{previewName}</span>
                {member && <span className="sr-pf-svip">SVIP</span>}
              </div>
              <div className="sr-pf-sub">ID {displayHandle(draft)}</div>
              {draft.status.trim() && <div className="sr-pf-preview-status">「{draft.status.trim()}」</div>}
              {draft.tags.length > 0 && (
                <div className="sr-pf-tags">
                  {draft.tags.map((tag) => (
                    <span
                      key={tag}
                      className="sr-pf-tag"
                      style={{ "--sr-tag-color": draft.tagColors[tag] ?? DEFAULT_TAG_COLOR } as CSSProperties}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="sr-pf-field">
            <span className="sr-pf-field-label">头像</span>
            <div className="sr-pf-edit-avatar-tools">
              <button
                type="button"
                className="sr-btn sr-btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-busy={uploading || undefined}
              >
                <ImageUp size={15} strokeWidth={1.8} />
                {uploading ? "处理中" : "上传照片"}
              </button>
              <button
                type="button"
                className="sr-btn sr-btn-sm"
                onClick={() => patch({ avatar: nextVariant(draft.avatar), useHostAvatar: false, avatarUrl: undefined })}
              >
                <RefreshCw size={15} strokeWidth={1.8} />
                换一个
              </button>
              {hostAvatar && (
                <button
                  type="button"
                  className="sr-btn sr-btn-sm"
                  aria-pressed={draft.useHostAvatar && !draft.avatarUrl}
                  onClick={() => patch({ useHostAvatar: true, avatarUrl: undefined })}
                >
                  用宿主头像
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void pickAvatar(event.target.files?.[0])} />
          </div>

          <div className="sr-pf-field">
            <span className="sr-pf-field-label" id="sr-pf-name-mode">昵称</span>
            <div className="sr-pf-seg" role="radiogroup" aria-labelledby="sr-pf-name-mode">
              <button
                type="button"
                role="radio"
                aria-checked={draft.nameMode === "host"}
                onClick={() => patch({ nameMode: "host" })}
              >
                跟随宿主
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={draft.nameMode === "custom"}
                onClick={() => patch({ nameMode: "custom", name: draft.name || hostName || "" })}
              >
                独立昵称
              </button>
            </div>
            {draft.nameMode === "host" ? (
              <span className="sr-pf-field-hint">
                {hostName ? `显示为「${hostName}」，跟着小手机的用户身份走；这里只读取，不会改动宿主资料。` : "小手机里还没有用户身份，暂时显示为「我」。"}
              </span>
            ) : (
              <>
                <input
                  className="sr-appear-input"
                  value={draft.name}
                  maxLength={NAME_MAX}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="只在书房里用的名字"
                  aria-label="独立昵称"
                  aria-invalid={Boolean(nameError) || undefined}
                />
                {nameError && <span className="sr-pf-form-error">{nameError}</span>}
              </>
            )}
          </div>

          <div className="sr-pf-field">
            <span className="sr-pf-field-label">展示 ID</span>
            <input
              className="sr-appear-input"
              value={draft.handle}
              maxLength={HANDLE_MAX}
              onChange={(event) => patch({ handle: event.target.value })}
              placeholder={draft.id}
              spellCheck={false}
              autoCapitalize="off"
              aria-label="展示 ID"
              aria-invalid={Boolean(handleError) || undefined}
            />
            {handleError ? (
              <span className="sr-pf-form-error">{handleError}</span>
            ) : (
              <span className="sr-pf-field-hint">
                留空就显示系统 ID。书房只在本机运行，没有服务器能查重，别人也可能用同一个展示 ID。
              </span>
            )}
            <div className="sr-pf-field-static">
              <span className="sr-pf-field-id">系统 ID {draft.id}</span>
              <button type="button" className="sr-icon-btn" onClick={() => void copyId()} aria-label="复制系统 ID">
                <Copy size={16} strokeWidth={1.8} />
              </button>
            </div>
            {copied && <span className="sr-pf-field-hint" role="status">已复制</span>}
          </div>

          <label className="sr-pf-field">
            <span className="sr-pf-field-label">
              状态气泡 <em className="sr-pf-count">{draft.status.length}/{STATUS_MAX}</em>
            </span>
            <input
              className="sr-appear-input"
              value={draft.status}
              maxLength={STATUS_MAX}
              onChange={(event) => patch({ status: event.target.value })}
              placeholder="文字、颜文字或表情"
            />
          </label>

          <label className="sr-pf-field">
            <span className="sr-pf-field-label">
              签名 <em className="sr-pf-count">{draft.signature.length}/{SIGNATURE_MAX}</em>
            </span>
            <textarea
              className="sr-appear-input sr-pf-textarea"
              rows={3}
              maxLength={SIGNATURE_MAX}
              value={draft.signature}
              onChange={(event) => patch({ signature: event.target.value })}
              placeholder="介绍一下自己，可以换行"
            />
          </label>

          <div className="sr-pf-field">
            <span className="sr-pf-field-label">
              标签 <em className="sr-pf-count">{draft.tags.length}/{TAG_MAX}</em>
            </span>
            {draft.tags.length > 0 && (
              <ul className="sr-pf-tag-list">
                {draft.tags.map((tag, index) => {
                  const color = draft.tagColors[tag] ?? DEFAULT_TAG_COLOR;
                  return (
                    <li key={tag} className="sr-pf-tag-row">
                      <button
                        type="button"
                        className="sr-pf-tag-dot"
                        style={{ background: color }}
                        onClick={() => setColorFor(tag)}
                        aria-label={`改「${tag}」的颜色`}
                      />
                      <span className="sr-pf-tag-name">{tag}</span>
                      <button type="button" className="sr-icon-btn" onClick={() => moveTag(index, -1)} disabled={index === 0} aria-label={`「${tag}」上移`}>
                        <ArrowUp size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        className="sr-icon-btn"
                        onClick={() => moveTag(index, 1)}
                        disabled={index === draft.tags.length - 1}
                        aria-label={`「${tag}」下移`}
                      >
                        <ArrowDown size={16} strokeWidth={1.8} />
                      </button>
                      <button type="button" className="sr-icon-btn" onClick={() => removeTag(tag)} aria-label={`删除「${tag}」`}>
                        <X size={16} strokeWidth={1.8} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.tags.length < TAG_MAX && (
              <>
                <div className="sr-pf-field-inline">
                  <input
                    className="sr-appear-input"
                    value={tagInput}
                    maxLength={TAG_LEN_MAX}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    placeholder={`自己写一个，最多 ${TAG_LEN_MAX} 字`}
                    aria-label="新标签"
                  />
                  <button type="button" className="sr-btn sr-btn-sm" onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}>
                    <Plus size={15} strokeWidth={1.9} />
                    添加
                  </button>
                </div>
                {remainingSuggestions.length > 0 && (
                  <div className="sr-chip-row">
                    {remainingSuggestions.map((tag) => (
                      <button key={tag} type="button" className="sr-chip" onClick={() => addTag(tag)}>
                        + {tag}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {error && <p className="sr-pf-form-error" role="alert">{error}</p>}
        </div>

        {confirmLeave && (
          <div className="sr-pf-leave" role="alertdialog" aria-label="放弃修改">
            <p>有修改还没保存，要放弃吗？</p>
            <div className="sr-sheet-actions" style={{ marginTop: 10 }}>
              <button type="button" className="sr-btn" onClick={() => setConfirmLeave(false)}>
                继续编辑
              </button>
              <button type="button" className="sr-btn sr-btn-danger" onClick={onClose}>
                放弃修改
              </button>
            </div>
          </div>
        )}
      </div>

      {colorFor && (
        <div onClick={(event) => event.stopPropagation()}>
          <TagColorSheet
            tag={colorFor}
            value={draft.tagColors[colorFor] ?? DEFAULT_TAG_COLOR}
            member={member}
            onPick={(color) => {
              if (isValidColor(color)) patch({ tagColors: { ...draft.tagColors, [colorFor]: color } });
              setColorFor(null);
            }}
            onClose={() => setColorFor(null)}
          />
        </div>
      )}
    </div>
  );
}
