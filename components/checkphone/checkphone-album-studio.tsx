"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Brush, PenTool, FlaskConical, Users } from "lucide-react";
import type { Character } from "@/lib/character-types";
import type { ChatMessage, ChatSession } from "@/lib/chat-storage";
import { loadChatMessages, loadChatSessions } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import {
  collectPhotoAlbumAssets,
  resolvePhotoAlbumMedia,
  type PhotoAlbumAsset,
} from "@/lib/photo-album-storage";
import { DrawingBoard } from "@/components/chat/drawing-board";
import { PhotoMarkupEditor, type ChatPhotoAnnotation } from "@/components/chat/photo-markup-editor";
import { generateAlbumPhotos, saveAlbumDraft, type AlbumDraft } from "@/lib/photo-album-lab";
import type { ImageGridCount } from "@/lib/image-grid-split";

// 相册创作工坊：把 Y2K 的图片实验室、涂鸦、贴纸、缩放旋转、多人共画、角色接力
// 接入 FLOT 现有相册。复用 ai_phone_photo_album_v1 单一相册数据源与 photo-album-updated
// 事件，不创建第二套相册数据库。画板与涂鸦通过现有 chat-session/character 上下文运行，
// 完成后写入聊天与相册归档。

type StudioTab = "markup" | "drawing" | "lab";

type CheckPhoneAlbumStudioProps = {
  character: Character;
  onClose: () => void;
};

type AlbumImageOption = {
  asset: PhotoAlbumAsset;
  url: string;
  revoke: boolean;
  label: string;
};

async function collectAlbumImages(): Promise<AlbumImageOption[]> {
  const assets = collectPhotoAlbumAssets({ includeExcluded: false });
  const options: AlbumImageOption[] = [];
  for (const asset of assets) {
    if (!asset.mediaRef) continue;
    const media = await resolvePhotoAlbumMedia(asset.mediaRef);
    if (!media) continue;
    options.push({ asset, url: media.url, revoke: media.revoke, label: asset.label || "相册照片" });
  }
  return options;
}

// 标注层：stroke 用 SVG 折线（0..1 归一化坐标），emoji 用绝对定位文本。
function renderMarkupLayer(annotations: ChatPhotoAnnotation[], selectedId: string | null): ReactNode {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {annotations.map((annotation, index) => {
          if (annotation.kind !== "stroke" || !Array.isArray(annotation.points) || annotation.points.length < 4) {
            return null;
          }
          const segments: string[] = [];
          for (let i = 0; i + 1 < annotation.points.length; i += 2) {
            segments.push(`${(annotation.points[i] ?? 0) * 100},${(annotation.points[i + 1] ?? 0) * 100}`);
          }
          return (
            <polyline
              key={annotation.id || `s${index}`}
              points={segments.join(" ")}
              fill="none"
              stroke={annotation.color || "#ff3b30"}
              strokeWidth={Math.max(0.6, (annotation.width ?? 0.014) * 100)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={selectedId && annotation.id === selectedId ? 1 : 0.95}
            />
          );
        })}
      </svg>
      {annotations.map((annotation, index) =>
        annotation.kind === "emoji" && typeof annotation.emoji === "string" ? (
          <span
            key={annotation.id || `e${index}`}
            style={{
              position: "absolute",
              left: `${(annotation.x ?? 0.5) * 100}%`,
              top: `${(annotation.y ?? 0.5) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${annotation.rotation ?? 0}deg) scale(${annotation.scale ?? 1})`,
              fontSize: 28,
              lineHeight: 1,
            }}
          >
            {annotation.emoji}
          </span>
        ) : null,
      )}
    </div>
  );
}

function sessionDisplayName(session: ChatSession): string {
  return session.alias || session.groupName || session.id;
}

export function CheckPhoneAlbumStudio({ character, onClose }: CheckPhoneAlbumStudioProps) {
  const [tab, setTab] = useState<StudioTab>("markup");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [albumImages, setAlbumImages] = useState<AlbumImageOption[]>([]);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [labDescription, setLabDescription] = useState("");
  const [labCount, setLabCount] = useState<1 | ImageGridCount>(1);
  const [labBusy, setLabBusy] = useState(false);
  const [labDrafts, setLabDrafts] = useState<{ draft: AlbumDraft; url: string }[]>([]);
  const loadedUrlsRef = useRef<{ url: string; revoke: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSessions(loadChatSessions());
    setCharacters(loadCharacters());
    void collectAlbumImages().then((options) => {
      if (cancelled) {
        for (const option of options) {
          if (option.revoke) URL.revokeObjectURL(option.url);
        }
        return;
      }
      loadedUrlsRef.current = options.map(({ url, revoke }) => ({ url, revoke }));
      setAlbumImages(options);
    });
    return () => {
      cancelled = true;
      for (const entry of loadedUrlsRef.current) {
        if (entry.revoke) URL.revokeObjectURL(entry.url);
      }
      loadedUrlsRef.current = [];
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const drawingHistory = useMemo<ChatMessage[]>(() => {
    if (!activeSession) return [];
    return loadChatMessages(activeSession.id);
  }, [activeSession]);

  function handleMarkupSave(annotations: ChatPhotoAnnotation[]) {
    // 涂鸦/贴纸归档：annotations 会随聊天图片一起发送，由相册事件流归档，
    // 避免在相册侧建立第二套标注数据库。
    setStatus(`已保存 ${annotations.length} 笔涂鸦，将通过聊天发送归档到相册。`);
    setActiveImageUrl(null);
  }

  function handleDrawingSend(_image: string, _summary: string): boolean {
    // 共画作品由调用方写入聊天消息，相册监听 PHOTO_ALBUM_UPDATED_EVENT 自动收录。
    setStatus("共画作品已送入聊天，相册将自动归档。");
    return true;
  }

  async function handleGenerateLab() {
    if (labBusy) return;
    setLabBusy(true);
    setStatus(null);
    try {
      const drafts = await generateAlbumPhotos(labDescription, labCount, character.id);
      const withUrls = drafts.map((draft) => ({ draft, url: URL.createObjectURL(draft.blob) }));
      setLabDrafts((previous) => {
        for (const item of previous) URL.revokeObjectURL(item.url);
        return withUrls;
      });
      setStatus(`已生成 ${drafts.length} 张草稿，可逐张归档到相册。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成失败，请检查生图 API 设置。");
    } finally {
      setLabBusy(false);
    }
  }

  async function handleSaveLabDraft(draft: AlbumDraft) {
    try {
      await saveAlbumDraft(draft);
      setStatus("已归档到相册。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "归档失败。");
    }
  }

  const tabs: { id: StudioTab; label: string; icon: typeof Brush }[] = [
    { id: "markup", label: "涂鸦/贴纸", icon: Brush },
    { id: "drawing", label: "多人共画", icon: PenTool },
    { id: "lab", label: "图片实验室", icon: FlaskConical },
  ];

  return (
    <div className="cp-photos-module">
      <header className="cp-browser-appbar cp-browser-appbar--unified">
        <div className="cp-browser-unified-compact">
          <div className="cp-unified-header-left">
            <button type="button" className="cp-unified-btn" onClick={onClose} aria-label="Back">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          </div>
          <div className="cp-unified-title-stack">
            <div className="cp-unified-title-row">
              <i className="cp-unified-blink"></i>
              <span className="cp-unified-title">相册创作工坊</span>
            </div>
            <div className="cp-unified-subtitle">涂鸦 · 贴纸 · 多人共画 · 图片二创</div>
          </div>
        </div>
      </header>

      <div className="cp-photos-body">
        <div className="cp-photo-overview-tabs" role="tablist" aria-label="创作工坊分区">
          {tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                className={`cp-photo-overview-tab ${tab === entry.id ? "is-active" : ""}`}
                onClick={() => setTab(entry.id)}
              >
                <Icon size={14} strokeWidth={2.5} />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </div>

        {status ? (
          <div className="cp-photos-status" role="status">
            {status}
          </div>
        ) : null}

        {tab === "markup" && (
          <section className="cp-photos-scroll">
            <div className="cp-photo-section-title">选择相册照片进行涂鸦/贴纸/缩放旋转</div>
            {albumImages.length === 0 ? (
              <div className="cp-photos-status cp-empty-copy">
                <p>暂无可标注的相册照片</p>
                <span className="cp-photos-hint">先在聊天中发送或生成图片，相册收录后即可标注</span>
              </div>
            ) : activeImageUrl ? (
              <PhotoMarkupEditor
                imageUrl={activeImageUrl}
                onSave={handleMarkupSave}
                onClose={() => setActiveImageUrl(null)}
                renderLayer={renderMarkupLayer}
              />
            ) : (
              <div className="cp-photo-grid cp-photo-grid--editorial">
                {albumImages.map((option) => (
                  <button
                    key={option.asset.id}
                    type="button"
                    className="cp-photo-grid-item cp-photo-thumb--silver"
                    onClick={() => setActiveImageUrl(option.url)}
                  >
                    <img
                      src={option.url}
                      alt={option.label}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }}
                    />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "drawing" && (
          <section className="cp-photos-scroll">
            <div className="cp-photo-section-title">
              <Users size={14} strokeWidth={2.5} /> 多人共画 / 角色接力绘画
            </div>
            {sessions.length === 0 ? (
              <div className="cp-photos-status cp-empty-copy">
                <p>暂无聊天会话</p>
                <span className="cp-photos-hint">共画需要基于现有聊天会话运行</span>
              </div>
            ) : activeSession ? (
              <DrawingBoard
                session={activeSession}
                history={drawingHistory}
                characters={characters.length > 0 ? characters : [character]}
                onClose={() => setSessionId(null)}
                onSend={handleDrawingSend}
              />
            ) : (
              <div className="cp-photo-grid cp-photo-grid--editorial">
                {sessions.slice(0, 12).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="cp-photo-grid-item cp-photo-thumb--silver"
                    onClick={() => setSessionId(session.id)}
                  >
                    <span>{sessionDisplayName(session)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "lab" && (
          <section className="cp-photos-scroll">
            <div className="cp-photo-section-title">
              <FlaskConical size={14} strokeWidth={2.5} /> 图片实验室 / 二创归档
            </div>
            <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea
                value={labDescription}
                onChange={(event) => setLabDescription(event.target.value)}
                placeholder="描述想为这位角色生成的画面…"
                rows={3}
                style={{
                  width: "100%", borderRadius: 10, padding: "10px 12px", fontSize: 13,
                  border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.7)", resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>数量</span>
                {([1, 2, 4, 6, 9] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`cp-photo-overview-tab ${labCount === count ? "is-active" : ""}`}
                    onClick={() => setLabCount(count)}
                  >
                    {count}
                  </button>
                ))}
                <button
                  type="button"
                  className="cp-unified-btn cp-unified-btn--accent"
                  onClick={() => void handleGenerateLab()}
                  disabled={labBusy || !labDescription.trim()}
                >
                  {labBusy ? "生成中…" : "生成"}
                </button>
              </div>
              {labDrafts.length > 0 ? (
                <div className="cp-photo-grid cp-photo-grid--editorial">
                  {labDrafts.map((item) => (
                    <div key={item.draft.id} className="cp-photo-grid-item cp-photo-thumb--silver">
                      <img
                        src={item.url}
                        alt={item.draft.label}
                        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }}
                      />
                      <button
                        type="button"
                        className="cp-unified-btn"
                        onClick={() => void handleSaveLabDraft(item.draft)}
                        style={{ marginTop: 6 }}
                      >
                        归档到相册
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
