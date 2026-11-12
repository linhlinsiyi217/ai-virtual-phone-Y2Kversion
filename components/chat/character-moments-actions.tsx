"use client";

import { useEffect, useRef, useState } from "react";
import { generateCharacterMomentCover, generateCharacterMomentText } from "@/lib/character-moments-generation";
import { saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { saveCharacterMomentsProfile } from "@/lib/character-moments-profile";

export function CharacterMomentsActions({ characterId, coverOpen, onCoverClose, onUpload }: {
  characterId: string;
  coverOpen: boolean;
  onCoverClose: () => void;
  onUpload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const run = useRef<AbortController | null>(null);

  useEffect(() => () => run.current?.abort(), []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  const stop = () => {
    run.current?.abort();
    run.current = null;
    setBusy(false);
  };

  const generate = async (kind: "signature" | "description" | "image") => {
    if (busy) return;
    stop();
    const controller = new AbortController();
    run.current = controller;
    setBusy(true);
    setError("");
    try {
      if (kind === "image") {
        const result = await generateCharacterMomentCover(characterId, description, controller.signal);
        if (!controller.signal.aborted) {
          setImage(previous => {
            if (previous) URL.revokeObjectURL(previous.url);
            return { blob: result.blob, url: URL.createObjectURL(result.blob) };
          });
        }
      } else {
        const content = await generateCharacterMomentText(characterId, kind === "signature" ? "signature" : "cover", controller.signal);
        if (!controller.signal.aborted) {
          if (kind === "signature") setSignature(content);
          else { setDescription(content); setImage(null); }
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "生成失败，原设置保留");
    } finally {
      if (run.current === controller) { run.current = null; setBusy(false); }
    }
  };

  const closeCover = () => {
    stop();
    onCoverClose();
    setImage(null);
  };

  return <div className="character-moments-actions">
    <button type="button" disabled={busy} onClick={() => void generate("signature")}>AI 生成签名</button>
    {busy && <span role="status">正在生成… <button type="button" onClick={stop}>停止</button></span>}
    {error && <p role="status">{error}</p>}
    {signature !== null && <section>
      <label>签名预览<input aria-label="生成的角色签名" value={signature} onChange={event => setSignature(event.target.value)} /></label>
      <button type="button" disabled={!signature.trim() || busy} onClick={() => { saveCharacterMomentsProfile(characterId, { signature: signature.trim() }); setSignature(null); }}>应用签名</button>
      <button type="button" onClick={() => setSignature(null)}>取消</button>
    </section>}
    {coverOpen && <section aria-label="角色朋友圈封面设置">
      <div><button type="button" onClick={() => { closeCover(); onUpload(); }}>上传图片</button><button type="button" disabled={busy} onClick={() => void generate("description")}>AI 构思封面</button></div>
      <p>先用角色文字模型构思画面，再用角色绑定的生图方案生成；应用前都可以修改和预览。</p>
      <textarea aria-label="角色封面画面描述" rows={4} value={description} placeholder="生成构思后可修改，也可以直接填写画面描述" onChange={event => { setDescription(event.target.value); setImage(null); }} disabled={busy} />
      <button type="button" disabled={busy || !description.trim()} onClick={() => void generate("image")}>生成封面图片</button>
      {image && <><img src={image.url} alt="生成的角色朋友圈封面预览" /><button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const id = await saveChatImageToIndexedDB(image.blob); saveCharacterMomentsProfile(characterId, { coverAssetId: id }); closeCover(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "封面保存失败"); }
        finally { setBusy(false); }
      }}>应用封面</button></>}
      <button type="button" onClick={closeCover}>关闭</button>
    </section>}
  </div>;
}
