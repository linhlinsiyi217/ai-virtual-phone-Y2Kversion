"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character } from "@/lib/character-types";
import {
  createCharacter,
  exportCharacterAsJson,
  exportCharacterAsPng,
  loadCharacters,
  parseCharacterFromJson,
  parseCharacterFromPng,
  saveCharacters,
  loadBackgroundItems,
  saveBackgroundItems,
  type CharacterImportData,

  CHAR_BLOCKED_FIELDS,
} from "@/lib/character-storage";
import { generateBriefPersonaText, isBriefPersonaStale } from "@/lib/brief-persona";
import { generateSupportingCharacters, materializeSupportingCharacter, type GeneratedSupportingCharacter } from "@/lib/npc-generator";
import {
  addCharacterWorldRelation,
  createCharacterWorldGroup,
  deleteCharacterWorldGroup,
  deleteCharacterWorldRelation,
  getCharacterWorldGroupId,
  loadCharacterWorldGroups,
  moveCharacterToWorld,
  renameCharacterWorldGroup,
  updateCharacterWorldDescription,
  CHARACTER_WORLDS_UPDATED_EVENT,
  DEFAULT_CHARACTER_WORLD_ID,
  type CharacterWorldGroup,
} from "@/lib/character-world-storage";
import { WorldCaseSheet, NewWorldSheet } from "@/components/character/world-tabs";
import { RelationLinkDialog, RelationPairSheet } from "@/components/character/relation-dialogs";
import { CSheet, CConfirm } from "@/components/character/modal-kit";
import { loadMomentsConfig, saveMomentsConfig } from "@/lib/moments-storage";
import type { CanvasBgItem } from "@/lib/character-types";
import { ConfirmDialog } from "@/components/ui/modal";
import { AlertCircle, History } from "lucide-react";
import {
  backupCharacterVersion,
  clearCharacterVersions,
  deleteCharacterVersion,
  getCharacterCurrentVersion,
  getCharacterNextVersion,
  loadCharacterVersions,
  overwriteCharacterVersion,
  switchCharacterVersion,
  type CharacterVersion,
} from "@/lib/character-version-storage";
import { notifyMascotPageContext } from "@/lib/mascot-events";
import { kvGet, kvSet } from "@/lib/kv-db";
import { normalizeTimeZone } from "@/lib/character-time";
import { removeCharacterChatReferences } from "@/lib/character-chat-cleanup";

type ViewType = "list" | "detail";

// 画布连线：与世界观关系同步——同一对角色间的多条关系合并为一条线，标签并列显示
type CanvasRelationLine = { key: string; aId: string; bId: string; labels: string[] };

// 每个世界一张画布：平移缩放记忆按世界分 key（默认世界沿用旧 key，存量零迁移）
const PAN_STORAGE_BASE_KEY = 'ai_phone_canvas_pan_v2';
const WORLD_TAB_KEY = 'ai_phone_character_app_world_v1';
const CHARACTER_AVATAR_MAX_BYTES = 600 * 1024;
const CHARACTER_AVATAR_COMPRESSION_FALLBACKS = [
  { maxSize: 1280, quality: 0.8 },
  { maxSize: 1024, quality: 0.8 },
  { maxSize: 1024, quality: 0.72 },
  { maxSize: 768, quality: 0.72 },
  { maxSize: 640, quality: 0.68 },
  { maxSize: 512, quality: 0.64 },
  { maxSize: 400, quality: 0.6 },
  { maxSize: 320, quality: 0.56 },
] as const;
function worldPanKey(worldId: string): string {
  return worldId === DEFAULT_CHARACTER_WORLD_ID ? PAN_STORAGE_BASE_KEY : `${PAN_STORAGE_BASE_KEY}_${worldId}`;
}

function loadWorldPan(worldId: string): { x: number; y: number; zoom: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0, zoom: 1 };
  try {
    const raw = kvGet(worldPanKey(worldId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return { x: parsed.x ?? 0, y: parsed.y ?? 0, zoom: parsed.zoom ?? 1 };
    }
  } catch { }
  return { x: 0, y: 0, zoom: 1 };
}

type TransitionState = {
  char: Character;
  sourceRect: DOMRect;
  phase: "start" | "fly" | "flip";
  onComplete?: () => void;
  reverse?: boolean;
};

type PinchState = { dist: number; zoom: number; midX: number; midY: number };

type PhoneCharacterAppProps = {
  onClose: () => void;
  onNotice: (text: string) => void;
};

type IntlWithTimeZoneList = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

const COMMON_CHARACTER_TIME_ZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const SUPPORTED_CHARACTER_TIME_ZONES = (() => {
  try {
    const intl = Intl as IntlWithTimeZoneList;
    const values = typeof intl.supportedValuesOf === "function"
      ? intl.supportedValuesOf("timeZone")
      : [];
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
})();

function getCharacterTimeZoneOptions(currentTimeZone = ""): string[] {
  const options: string[] = [];
  const seen = new Set<string>();
  const add = (timeZone: string) => {
    if (!timeZone || seen.has(timeZone)) return;
    seen.add(timeZone);
    options.push(timeZone);
  };

  COMMON_CHARACTER_TIME_ZONES.forEach(add);
  SUPPORTED_CHARACTER_TIME_ZONES.forEach(add);
  const normalizedCurrentTimeZone = normalizeTimeZone(currentTimeZone);
  if (normalizedCurrentTimeZone) add(normalizedCurrentTimeZone);
  return options;
}

export function PhoneCharacterApp({ onClose, onNotice }: PhoneCharacterAppProps) {
  const [view, setView] = useState<{ type: ViewType; id: string | null; isEditing?: boolean }>({ type: "list", id: null, isEditing: false });
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [bgItems, setBgItems] = useState<CanvasBgItem[]>(() => loadBackgroundItems());
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [pendingPlacementChar, setPendingPlacementChar] = useState<Character | null>(null);
  const [pendingPolaroidStyle, setPendingPolaroidStyle] = useState<number>(0);

  // ── 世界卷宗：分组数据 + 当前打开的卷宗（持久记忆） ──
  const [worldGroups, setWorldGroups] = useState<CharacterWorldGroup[]>(() => loadCharacterWorldGroups());
  const [currentWorldId, setCurrentWorldId] = useState<string>(() => {
    const saved = typeof window !== "undefined" ? kvGet(WORLD_TAB_KEY) : null;
    return saved || DEFAULT_CHARACTER_WORLD_ID;
  });
  useEffect(() => {
    const reload = () => setWorldGroups(loadCharacterWorldGroups());
    window.addEventListener(CHARACTER_WORLDS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(CHARACTER_WORLDS_UPDATED_EVENT, reload);
  }, []);
  // 记忆的世界可能已被删除 → 回落默认卷宗
  const safeWorldId = worldGroups.some(g => g.id === currentWorldId) ? currentWorldId : DEFAULT_CHARACTER_WORLD_ID;
  function selectWorldId(worldId: string) {
    setCurrentWorldId(worldId);
    try { kvSet(WORLD_TAB_KEY, worldId); } catch { }
  }

  function updateChars(next: Character[]) {
    setCharacters(next);
    saveCharacters(next);
    // 角色增删会影响世界成员归属（normalize），同步刷新分组
    setWorldGroups(loadCharacterWorldGroups());
  }

  function updateBgItems(next: CanvasBgItem[]) {
    setBgItems(next);
    saveBackgroundItems(next);
  }

  // Handle clicking a polaroid
  function handleSelectChar(char: Character, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();

    setTransition({
      char,
      sourceRect: rect,
      phase: "start",
    });

    // Animate
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTransition((p) => p ? { ...p, phase: "fly" } : null);
        setTimeout(() => {
          setTransition((p) => p ? { ...p, phase: "flip" } : null);
          setTimeout(() => {
            setView({ type: "detail", id: char.id });
            setTransition(null);
          }, 400); // Wait for flip 0.4s
        }, 400); // Wait for fly 0.4s
      });
    });
  }

  // Handle back from detail
  function handleBackFromDetail() {
    setView({ type: "list", id: null, isEditing: false });
  }

  return (
    <>
      <div className="char-app">
        {view.type === "list" && (
          <CharListView
            characters={characters}
            bgItems={bgItems}
            worldGroups={worldGroups}
            currentWorldId={safeWorldId}
            onSelectWorld={selectWorldId}
            onUpdateChars={updateChars}
            onUpdateBgItems={updateBgItems}
            onClose={onClose}
            onSelect={handleSelectChar}
            onCreate={(style: number) => { setPendingPolaroidStyle(style); setView({ type: "detail", id: null, isEditing: true }); }}
            pendingPlacementChar={pendingPlacementChar}
            onStartCharPlacement={(char: Character) => setPendingPlacementChar(char)}
            onPlacementDone={(placed: Character) => {
              setPendingPlacementChar(null);
              // 新建/导入的角色放进当前打开的卷宗（normalize 默认丢进默认世界）
              if (safeWorldId !== DEFAULT_CHARACTER_WORLD_ID) {
                moveCharacterToWorld(placed.id, safeWorldId);
              } else {
                setWorldGroups(loadCharacterWorldGroups());
              }
            }}
            onClearPendingPlacement={() => setPendingPlacementChar(null)}
            onNotice={onNotice}
          />
        )}

        {view.type === "detail" && (
          <CharArchiveView
            char={view.id ? (characters.find((c) => c.id === view.id) ?? createCharacter({ name: "", persona: "", avatar: null })) : createCharacter({ name: "", persona: "", avatar: null })}
            isEditing={view.isEditing}
            isExisting={Boolean(view.id)}
            onBack={handleBackFromDetail}
            onEdit={() => setView({ type: "detail", id: view.id, isEditing: true })}
            onCancelEdit={() => {
              if (view.id) {
                setView({ type: "detail", id: view.id, isEditing: false });
              } else {
                setView({ type: "list", id: null, isEditing: false });
              }
            }}
            onSave={(data, createVersion) => {
              const existing = view.id ? characters.find((c) => c.id === view.id) : null;
              if (existing) {
                const nextVersion = createVersion
                  ? backupCharacterVersion(existing, "manual", "手动编辑前备份")
                  : overwriteCharacterVersion(existing.id);
                const updated: Character = {
                  ...existing,
                  ...data,
                  updatedAt: new Date().toISOString(),
                };
                updateChars(characters.map((c) => (c.id === existing.id ? updated : c)));
                setView({ type: "detail", id: existing.id, isEditing: false });
                onNotice(createVersion
                  ? `已备份旧卡，当前为 V${nextVersion}`
                  : `已覆盖旧版本，当前为 V${nextVersion}`);
              } else {
                const newChar = createCharacter(data);
                newChar.polaroidStyle = pendingPolaroidStyle;
                setPendingPlacementChar(newChar);
                setView({ type: "list", id: null, isEditing: false });
                onNotice("点击画布放置角色");
              }
            }}
            onRestoreVersion={(version) => {
              const existing = view.id ? characters.find((c) => c.id === view.id) : null;
              if (!existing) return;
              const activeVersion = switchCharacterVersion(existing, version);
              const restored: Character = {
                ...version.data,
                id: existing.id,
                createdAt: existing.createdAt,
                updatedAt: new Date().toISOString(),
              };
              updateChars(characters.map((c) => (c.id === existing.id ? restored : c)));
              setView({ type: "detail", id: existing.id, isEditing: false });
              onNotice(`已切换到 V${activeVersion}，未创建新版本`);
            }}
            onDelete={async () => {
              const characterId = view.id;
              if (characterId) {
                await removeCharacterChatReferences(characterId);
                clearCharacterVersions(characterId);
                updateChars(characters.filter((c) => c.id !== characterId));
              }
              setView({ type: "list", id: null, isEditing: false });
              onNotice("已删除档案");
            }}
            onExportJson={() => {
              const c = view.id ? characters.find(x => x.id === view.id) : null;
              if (c) exportCharacterAsJson(c);
            }}
            onExportPng={async () => {
              const c = view.id ? characters.find(x => x.id === view.id) : null;
              if (c) {
                await exportCharacterAsPng(c);
                onNotice("导出成功");
              }
            }}
            onNotice={onNotice}
            relations={view.id ? (() => {
              const group = worldGroups.find((g) => g.id === safeWorldId);
              return (group?.relations ?? [])
                .filter((r) => r.fromCharacterId === view.id || r.toCharacterId === view.id)
                .map((r) => {
                  const otherId = r.fromCharacterId === view.id ? r.toCharacterId : r.fromCharacterId;
                  const other = characters.find((c) => c.id === otherId);
                  return { name: other?.name || "未知角色", label: r.label };
                });
            })() : []}
          />
        )}
      </div>

      {/* Fly & Flip Transition Overlay */}
      {transition && (
        <FlipTransitionOverlay transit={transition} />
      )}
    </>
  );
}

// ── 过渡动效层 ───────────────────────────────────────

function FlipTransitionOverlay({ transit }: { transit: TransitionState }) {
  const { char, sourceRect, phase } = transit;

  // Calculate relative bounds based on parent .phone-shell
  const [shellRect, setShellRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const shell = document.querySelector(".char-app");
    if (shell) setShellRect(shell.getBoundingClientRect());
  }, []);

  if (!shellRect) return null;

  // The final target rect inside the phone shell
  // We'll occupy the full width and height of the phone shell
  const targetWidth = shellRect.width;
  const targetHeight = shellRect.height;
  const targetTop = shellRect.top;
  const targetLeft = shellRect.left;

  // Render variables
  const isStart = phase === "start";

  const currentTop = isStart ? sourceRect.top : targetTop;
  const currentLeft = isStart ? sourceRect.left : targetLeft;
  const currentWidth = isStart ? sourceRect.width : targetWidth;
  const currentHeight = isStart ? sourceRect.height : targetHeight;

  // 3D Rotation
  const isFlipped = phase === "flip";

  const duration = isStart ? "0s" : "0.4s";

  return (
    <div
      className="char-flipper-container fixed"
      style={{
        top: currentTop,
        left: currentLeft,
        width: currentWidth,
        height: currentHeight,
        transition: `all ${duration} cubic-bezier(0.25, 1, 0.5, 1)`,
      }}
    >
      <div
        className="char-flipper-inner"
        style={{
          transition: `transform ${duration} ease-in-out`,
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div className="char-flipper-front" style={{ padding: isStart ? 0 : "12px" }}>
          {/* Polaroid Front */}
          <div className="char-polaroid w-full h-full border-none shadow-none" style={{
            transition: `padding ${duration} ease`
          }}>
            {isStart && <div className="char-polaroid-tape" />}
            <div className="char-polaroid-img-wrapper" style={{
              height: isStart ? "auto" : "100%",
              aspectRatio: isStart ? "1/1" : "auto",
              transition: `all ${duration} ease`
            }}>
              {char.avatar ? (
                <img src={char.avatar} className="char-polaroid-img" alt="" />
              ) : (
                <div className="w-full h-full bg-[#9b8aaa]" />
              )}
            </div>
            {isStart && <div className="char-polaroid-text">{char.name || "UNNAMED"}</div>}
          </div>
        </div>

        <div className="char-flipper-back">
          {/* Scaled down or full archive rendering so it doesn't look weird */}
          <div className="absolute top-0 left-0" style={{
            width: targetWidth, height: targetHeight,
            opacity: isFlipped ? 1 : 0.5,
            transition: `opacity ${duration} ease`
          }}>
            <CharArchiveView dummy char={char} onBack={() => { }} onEdit={() => { }} onDelete={() => { }} onExportJson={() => { }} onExportPng={async () => { }} />
          </div>
        </div>
      </div>
    </div>
  );
}


// ── 列表视图（角色库） ─────────────────────────────────────────

// 设计稿 library 屏里的线性图标
function LibIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="ic" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

// 设计稿里的猫咪（睡觉姿势），用于「新建档案」虚线卡
const CAT_SLEEP_SVG = `<svg class="cat" viewBox="0 0 160 144" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<g class="bob">
<g class="ear l"><path class="ln wf" d="M38 70C32 52 28 32 29 17C30 11 35 9 40 12C54 20 68 32 76 46"/><path class="gy" d="M40 61C36 47 33 33 34 23C44 28 56 36 64 47Z"/></g>
<g class="ear r"><path class="ln wf" d="M122 70C128 52 132 32 131 17C130 11 125 9 120 12C106 20 92 32 84 46"/><path class="gy" d="M120 61C124 47 127 33 126 23C116 28 104 36 96 47Z"/></g>
<path class="ln wf" d="M54 112C50 128 60 138 80 138C100 138 110 128 106 112"/>
<ellipse class="ln wf" cx="80" cy="80" rx="47" ry="38"/>
<path class="ln s tuft" d="M80 42C76 33 81 26 88 28"/><path class="ln s" style="stroke-width:1.5" d="M35 89L19 85M35 94L18 96M36 99L21 106M125 89L141 85M125 94L142 96M124 99L139 106"/>
<g class="face"><circle class="dt" cx="60" cy="69" r="2.4"/><circle class="dt" cx="100" cy="69" r="2.4"/>
<ellipse class="bl" cx="45" cy="94" rx="9" ry="5.5"/><ellipse class="bl" cx="115" cy="94" rx="9" ry="5.5"/>
<path class="bs" d="M40 92l-1.5 4M45 91l-1.5 4M50 91.5l-1.5 4M110 91.5l1.5 4M115 91l1.5 4M120 92l1.5 4"/>
<g class="eye"><g transform="rotate(10 62 84)"><ellipse class="ey" cx="62" cy="84" rx="6" ry="8"/></g><circle class="hi" cx="64.6" cy="80.4" r="2.3"/><circle class="hi" cx="68.6" cy="88" r="1"/></g>
<g class="eye"><g transform="rotate(-10 98 84)"><ellipse class="ey" cx="98" cy="84" rx="6" ry="8"/></g><circle class="hi" cx="95.4" cy="80.4" r="2.3"/><circle class="hi" cx="91.4" cy="88" r="1"/></g>
<g class="muzzle"><ellipse class="mz" cx="74" cy="95" rx="8.5" ry="6.2"/><ellipse class="mz" cx="86" cy="95" rx="8.5" ry="6.2"/>
<path class="nz" d="M76.5 88.5h7l-3.5 4.2z"/><path class="ln s" d="M74.5 97.5Q77 101 80 97Q83 101 85.5 97.5"/></g></g>
<path class="ln s" d="M64 117Q80 127 96 117"/><g class="bell"><circle class="ln s gy" style="stroke:#111;stroke-width:1.7" cx="80" cy="124" r="4"/><path class="ln s" d="M78 124h4"/></g>
<ellipse class="ln s wf" cx="63" cy="133" rx="7.5" ry="5.5"/><ellipse class="ln s wf" cx="97" cy="133" rx="7.5" ry="5.5"/>
<path class="z ln s" d="M118 46h9l-9 10h9"/><path class="z ln s" style="animation-delay:1.2s" d="M130 32h6l-6 7h6"/>
</g></svg>`;

// 档案完整度：已有字段里填了几项
function archiveCompleteness(c: Character): number {
  const checks = [Boolean(c.avatar), Boolean(c.persona), Boolean(c.briefPersona), Boolean(c.personality), (c.tags?.length ?? 0) > 0, Boolean(c.wechatID)];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function CharListView({
  characters,
  bgItems,
  worldGroups,
  currentWorldId,
  onSelectWorld,
  onUpdateChars,
  onUpdateBgItems,
  onClose,
  onSelect,
  onCreate,
  pendingPlacementChar,
  onStartCharPlacement,
  onPlacementDone,
  onClearPendingPlacement,
  onNotice,
}: {
  characters: Character[];
  bgItems: CanvasBgItem[];
  worldGroups: CharacterWorldGroup[];
  currentWorldId: string;
  onSelectWorld: (worldId: string) => void;
  onUpdateChars: (next: Character[]) => void;
  onUpdateBgItems: (next: CanvasBgItem[]) => void;
  onClose: () => void;
  onSelect: (char: Character, e: React.MouseEvent<HTMLDivElement>) => void;
  onCreate: (polaroidStyle: number) => void;
  pendingPlacementChar: Character | null;
  onStartCharPlacement: (char: Character) => void;
  onPlacementDone: (char: Character) => void;
  onClearPendingPlacement: () => void;
  onNotice: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNpcGen, setShowNpcGen] = useState(false);
  const [activeMoveChar, setActiveMoveChar] = useState<Character | null>(null);

  // ── 世界卷宗：当前世界派生数据 ──
  const currentGroup = worldGroups.find(g => g.id === currentWorldId)
    ?? worldGroups.find(g => g.id === DEFAULT_CHARACTER_WORLD_ID)
    ?? worldGroups[0];
  const memberSet = new Set(currentGroup?.memberIds ?? []);
  const worldCharacters = characters.filter(c => memberSet.has(c.id));
  const worldBgItems = (bgItems || []).filter(item => (item.worldId ?? DEFAULT_CHARACTER_WORLD_ID) === currentWorldId);
  const memberCounts = new Map(worldGroups.map(g => [g.id, g.memberIds.length]));
  const nameById = new Map(characters.map(c => [c.id, c.name || "未命名"]));
  // 连线与世界观关系同步：同一对角色的多条关系合并为一条线
  const relationLines: CanvasRelationLine[] = (() => {
    const pairs = new Map<string, CanvasRelationLine>();
    for (const relation of currentGroup?.relations ?? []) {
      const [aId, bId] = [relation.fromCharacterId, relation.toCharacterId].sort();
      const key = `${aId}__${bId}`;
      const existing = pairs.get(key);
      if (existing) {
        if (!existing.labels.includes(relation.label)) existing.labels.push(relation.label);
      } else {
        pairs.set(key, { key, aId, bId, labels: [relation.label] });
      }
    }
    return [...pairs.values()];
  })();

  // ── 世界卷宗：弹层与交互状态 ──
  const [showWorldEditor, setShowWorldEditor] = useState(false);
  const [showNewWorld, setShowNewWorld] = useState(false);
  const [dropTargetWorldId, setDropTargetWorldId] = useState<string | null>(null);
  // 拉线：编辑模式下点照片A→照片B
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState<{ fromId: string; toId: string } | null>(null);
  const [pairSheet, setPairSheet] = useState<{ aId: string; bId: string } | null>(null);

  // 切世界/退出编辑时收起拉线状态
  useEffect(() => { setLinkFromId(null); setLinkTo(null); setPairSheet(null); }, [currentWorldId]);

  /** 编辑模式下点拍立得：起线/落线 */
  function handleCharEditTap(charId: string) {
    if (linkFromId === charId) { setLinkFromId(null); return; }
    if (linkFromId) { setLinkTo({ fromId: linkFromId, toId: charId }); setLinkFromId(null); return; }
    setLinkFromId(charId);
  }

  /** 拖拍立得时实时检测是否悬停在某个世界 tab 上 */
  function handleCharDragMoveAt(clientX: number, clientY: number) {
    const tabEl = typeof document !== "undefined"
      ? document.elementFromPoint(clientX, clientY)?.closest("[data-world-tab-id]")
      : null;
    const worldId = tabEl?.getAttribute("data-world-tab-id") ?? null;
    setDropTargetWorldId(worldId && worldId !== currentWorldId ? worldId : null);
  }

  /** 松手落在世界 tab 上：把角色归档进那份卷宗（清旧坐标，按目标画布视野自动放置） */
  function handleCharDropAt(charId: string, clientX: number, clientY: number): boolean {
    setDropTargetWorldId(null);
    const tabEl = typeof document !== "undefined"
      ? document.elementFromPoint(clientX, clientY)?.closest("[data-world-tab-id]")
      : null;
    const worldId = tabEl?.getAttribute("data-world-tab-id");
    if (!worldId || worldId === currentWorldId) return false;
    const targetGroup = worldGroups.find(g => g.id === worldId);
    if (!targetGroup) return false;

    // 目标世界画布的可视区左上附近自动放置（读它的 pan 记忆）
    let targetPan = { x: 0, y: 0, zoom: 1 };
    try {
      const raw = kvGet(worldPanKey(worldId));
      if (raw) {
        const parsed = JSON.parse(raw);
        targetPan = { x: parsed.x ?? 0, y: parsed.y ?? 0, zoom: parsed.zoom ?? 1 };
      }
    } catch { }
    const dropX = (-targetPan.x + 130) / targetPan.zoom + Math.random() * 60;
    const dropY = (-targetPan.y + 160) / targetPan.zoom + Math.random() * 60;
    onUpdateChars(characters.map(c => c.id === charId
      ? { ...c, canvasX: dropX, canvasY: dropY, canvasRot: (Math.random() * 16) - 8 }
      : c
    ));
    moveCharacterToWorld(charId, worldId);
    onNotice(`已归入卷宗「${targetGroup.name}」`);
    return true;
  }

  /** 「生成配角」确认落库（支持一批）：落库逻辑与聊天名片建档共用 lib/npc-generator 的 materialize */
  function handleNpcGenerated(results: GeneratedSupportingCharacter[], targetId: string, allowAutoPost: boolean) {
    const newChars = results.map((result, index) =>
      materializeSupportingCharacter(result, targetId, { allowAutoPost, placementIndex: index })
    );
    // materialize 直接写存储；这里回读刷新 React 态（onUpdateChars 会再存一次同数据，无害）
    onUpdateChars(loadCharacters());
    setShowNpcGen(false);
    onNotice(`已生成配角：${newChars.map(c => `「${c.name}」`).join("")}`);
  }

  useEffect(() => {
    let changedChars = false;
    let newChars = [...characters];

    newChars = newChars.map((c, i) => {
      if (c.canvasX === undefined || c.canvasY === undefined) {
        changedChars = true;
        // 默认排布改成设计稿的双列档案卡网格（每列 169 + 12 间距，每行 196 + 12）
        const row = Math.floor(i / 2);
        const col = i % 2;
        return {
          ...c,
          canvasX: col * 181,
          canvasY: row * 208,
          canvasRot: 0,
          canvasZIndex: 100 + i
        };
      }
      return c;
    });

    if (changedChars) {
      onUpdateChars(newChars);
    }

    if (bgItems && bgItems.length === 0 && characters.length > 0) {
      const newBgItems = [];
      const numItems = Math.max(15, characters.length * 4);
      for (let i = 0; i < numItems; i++) {
        const hash = (i * 31) ^ 0x6a;
        const cx = (hash % 85);
        const totalHeight = 40 + Math.ceil(characters.length / 2) * 200 + 200;
        const cy = 20 + (hash * 17 % totalHeight);

        const typeMap = ['a4', 'yellow-note', 'blue-note', 'torn', 'grid', 'scrap'] as const;
        newBgItems.push({
          id: `bg_${Date.now()}_${i}`,
          type: typeMap[hash % 6],
          x: (cx / 100) * (typeof window !== 'undefined' ? window.innerWidth : 400),
          y: cy,
          rot: (hash % 60) - 30,
          zIndex: i
        });
      }
      onUpdateBgItems(newBgItems);
    }
  }, [characters.length]);

  const [pan, setPan] = useState(() => loadWorldPan(currentWorldId));

  /** 切换世界：先保存当前画布视野，再切换并载入目标画布的视野 */
  function selectWorld(worldId: string) {
    if (worldId === currentWorldId) return;
    try { kvSet(worldPanKey(currentWorldId), JSON.stringify(panRef.current)); } catch { }
    setLinkFromId(null);
    onSelectWorld(worldId);
    setPan(loadWorldPan(worldId));
  }
  const panRef = useRef(pan);
  const isDraggingCanvasRef = useRef(false);
  const canvasPointerIdRef = useRef<number | null>(null);
  const startPanRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchRef = useRef<PinchState | null>(null);
  const canvasElRef = useRef<HTMLDivElement>(null);
  const [isPropsMenuOpen, setIsPropsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [query, setQuery] = useState("");

  function toggleEditing() {
    if (isEditing) {
      // Exiting edit mode → persist pan + zoom position（按当前世界）
      try { kvSet(worldPanKey(currentWorldId), JSON.stringify(pan)); } catch { }
      setLinkFromId(null);
    }
    setIsEditing(!isEditing);
  }

  /** 恢复视角：把当前世界所有已放置的卡片/道具重新框进可视范围（卡片被拖出画面找不到时用） */
  function resetViewToFit() {
    const rect = canvasElRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const points: { x: number; y: number }[] = [];
    for (const c of worldCharacters) {
      if (c.canvasX !== undefined) points.push({ x: c.canvasX, y: c.canvasY || 0 });
    }
    for (const b of worldBgItems) points.push({ x: b.x, y: b.y });
    let next: { x: number; y: number; zoom: number };
    if (points.length === 0) {
      next = { x: 0, y: 0, zoom: 1 };
    } else {
      // 卡片以左上角定位，按最大卡片尺寸把包围盒补足，再留出边距
      const ITEM_W = 170, ITEM_H = 240, PAD = 40;
      const minX = Math.min(...points.map(p => p.x)) - PAD;
      const minY = Math.min(...points.map(p => p.y)) - PAD;
      const maxX = Math.max(...points.map(p => p.x)) + ITEM_W + PAD;
      const maxY = Math.max(...points.map(p => p.y)) + ITEM_H + PAD;
      const zoom = Math.min(1, Math.max(0.05, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
      next = {
        x: rect.width / 2 - zoom * ((minX + maxX) / 2),
        y: rect.height / 2 - zoom * ((minY + maxY) / 2),
        zoom,
      };
    }
    setPan(next);
    try { kvSet(worldPanKey(currentWorldId), JSON.stringify(next)); } catch { }
    onNotice("已恢复视角");
  }
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, type: 'char' | 'bg' } | null>(null);
  const [deleteConfirmReady, setDeleteConfirmReady] = useState(false);
  const [isAnyDragging, setIsAnyDragging] = useState(false);
  const [overTrashBin, setOverTrashBin] = useState(false);
  // 拖拽结束（含取消）时清掉世界 tab 的归档高亮
  useEffect(() => { if (!isAnyDragging) setDropTargetWorldId(null); }, [isAnyDragging]);
  const trashBinRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  panRef.current = pan;
  const [showStylePicker, setShowStylePicker] = useState(false);
  const pendingStyleRef = useRef<number>(0);
  const pendingActionRef = useRef<'import' | 'create'>('import');
  const [pendingBgType, setPendingBgType] = useState<CanvasBgItem['type'] | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number }>({ x: -9999, y: -9999 });
  const [importError, setImportError] = useState<string | null>(null);
  const placementActive = !!(pendingPlacementChar || pendingBgType);

  useEffect(() => {
    if (!deleteConfirm) {
      setDeleteConfirmReady(false);
      return;
    }
    setDeleteConfirmReady(false);
    const timer = window.setTimeout(() => setDeleteConfirmReady(true), 220);
    return () => window.clearTimeout(timer);
  }, [deleteConfirm]);

  // Escape key / right-click to cancel placement
  useEffect(() => {
    if (!placementActive) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPendingBgType(null);
        onClearPendingPlacement();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [placementActive, onClearPendingPlacement]);

  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (pinchRef.current) return;
    if (placementActive) {
      const rect = canvasElRef.current?.getBoundingClientRect();
      if (!rect) return;
      const canvasX = (e.clientX - rect.left - pan.x) / pan.zoom;
      const canvasY = (e.clientY - rect.top - pan.y) / pan.zoom;
      if (pendingPlacementChar) {
        const charWithCoords: Character = {
          ...pendingPlacementChar,
          canvasX,
          canvasY,
          canvasRot: (Math.random() * 20) - 10,
          canvasZIndex: 100 + characters.length,
        };
        onUpdateChars([...characters, charWithCoords]);
        onPlacementDone(charWithCoords);
        onNotice("已放置角色");
      } else if (pendingBgType) {
        const newId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newItem: CanvasBgItem = {
          id: newId,
          type: pendingBgType,
          x: canvasX,
          y: canvasY,
          rot: (Math.random() * 20) - 10,
          zIndex: (bgItems || []).length,
          worldId: currentWorldId,
        };
        onUpdateBgItems([...(bgItems || []), newItem]);
        setPendingBgType(null);
        onNotice("已放置道具");
      }
      return;
    }
    if (!isEditing) return;
    if ((e.target as HTMLElement).closest('.lib-card') || (e.target as HTMLElement).closest('.char-bg-item')) return;
    if (linkFromId) setLinkFromId(null); // 点空白处取消拉线
    isDraggingCanvasRef.current = true;
    canvasPointerIdRef.current = e.pointerId;
    startPanRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleCanvasPointerMove(e: React.PointerEvent) {
    if (pinchRef.current) return;
    if (placementActive) {
      const rect = canvasElRef.current?.getBoundingClientRect();
      if (rect) {
        setGhostPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
      return;
    }
    if (!isDraggingCanvasRef.current) return;
    const dx = e.clientX - startPanRef.current.x;
    const dy = e.clientY - startPanRef.current.y;
    setPan(p => ({ ...p, x: startPanRef.current.panX + dx, y: startPanRef.current.panY + dy }));
  }
  function handleCanvasPointerUp(e: React.PointerEvent) {
    if (!isDraggingCanvasRef.current) return;
    isDraggingCanvasRef.current = false;
    canvasPointerIdRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // Pinch-to-zoom uses native listeners so preventDefault is reliably non-passive.
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    const target: HTMLDivElement = el;

    function onTouchStart(e: TouchEvent) {
      if (!isEditingRef.current) return;
      if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        isDraggingCanvasRef.current = false;
        const pointerId = canvasPointerIdRef.current;
        if (pointerId !== null && target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
        canvasPointerIdRef.current = null;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinchRef.current = { dist, zoom: panRef.current.zoom, midX, midY };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!isEditingRef.current) return;
      if (e.touches.length !== 2 || !pinchRef.current) return;
      if (e.cancelable) e.preventDefault();

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.dist;
      const newZoom = Math.min(3, Math.max(0.2, pinchRef.current.zoom * ratio));
      const rect = target.getBoundingClientRect();
      const cx = pinchRef.current.midX - rect.left;
      const cy = pinchRef.current.midY - rect.top;

      setPan(p => {
        const scaleFactor = newZoom / p.zoom;
        const next = {
          x: cx - scaleFactor * (cx - p.x),
          y: cy - scaleFactor * (cy - p.y),
          zoom: newZoom,
        };
        panRef.current = next;
        return next;
      });
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        pinchRef.current = null;
      }
    }

    target.addEventListener("touchstart", onTouchStart, { passive: false });
    target.addEventListener("touchmove", onTouchMove, { passive: false });
    target.addEventListener("touchend", onTouchEnd);
    target.addEventListener("touchcancel", onTouchEnd);
    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);


  // Wheel zoom (desktop) — use native event to allow preventDefault on non-passive listener
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!isEditingRef.current) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.003;
      const rect = el!.getBoundingClientRect();
      setPan(p => {
        const newZoom = Math.min(3, Math.max(0.2, p.zoom * (1 + delta)));
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const scaleFactor = newZoom / p.zoom;
        return { x: cx - scaleFactor * (cx - p.x), y: cy - scaleFactor * (cy - p.y), zoom: newZoom };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function handleDragEndChar(id: string, newX: number, newY: number) {
    onUpdateChars(characters.map(c => c.id === id ? { ...c, canvasX: newX, canvasY: newY } : c));
  }
  function handleDragEndBg(id: string, newX: number, newY: number) {
    onUpdateBgItems((bgItems || []).map(b => b.id === id ? { ...b, x: newX, y: newY } : b));
  }

  function handleAddBgItem(type: CanvasBgItem['type']) {
    setPendingBgType(type);
    setIsPropsMenuOpen(false);
    onNotice("点击画布放置道具");
  }

  async function handleImportFile(file: File) {
    const styleIdx = pendingStyleRef.current;
    try {
      if (file.type === "application/json" || file.name.endsWith(".json")) {
        const text = await file.text();
        const data = parseCharacterFromJson(text);
        if (!data) return onNotice("解析失败，请检查文件格式");
        const c = createCharacter(data);
        c.polaroidStyle = styleIdx;
        onStartCharPlacement(c);
        onNotice("点击画布放置角色");
      } else if (file.type === "image/png" || file.name.endsWith(".png")) {
        const buffer = await file.arrayBuffer();
        const data = parseCharacterFromPng(buffer);
        if (!data) return onNotice("未在 PNG 中找到角色数据");
        let avatar = "";
        try {
          avatar = await fileToDataUrl(file);
        } catch (e) {
          console.error("Failed to read image file data", e);
        }
        if (!avatar && typeof data.avatar === "string" && data.avatar.trim() !== "") {
          avatar = data.avatar;
        }
        const c = createCharacter({ ...data, avatar });
        c.polaroidStyle = styleIdx;
        onStartCharPlacement(c);
        onNotice("点击画布放置角色");
      } else {
        onNotice("请选择 .json 或 .png 文件");
      }
    } catch (e) {
      if (e instanceof Error && e.message === CHAR_BLOCKED_FIELDS) {
        setImportError("不支持包含开场白、场景或示例对话的角色卡");
      } else {
        onNotice("解析失败，请检查文件格式");
      }
    }
  }

  function renderBgContent(item: CanvasBgItem) {
    const hash = item.id.charCodeAt(3) + item.id.charCodeAt(item.id.length - 1) * 17;
    const isBurnt = hash % 15 === 0;
    const hasCrease = hash % 7 === 0;

    let content;
    let baseClass = "";
    let extraAttrs: Record<string, string> = {};

    if (item.type === 'a4') {
      baseClass = "char-paper-a4";
      content = (
        <>
          {hasCrease && <div className="char-paper-crease" />}
          <div className="char-paper-header">
            <span>Dept of Truth</span>
            <span>REF:{hash.toString(16).toUpperCase()}</span>
          </div>
          <div className="char-barcode" />
          <div className="char-paper-paragraph">
            <strong>SUBJECT:</strong> Anomalous entity detected.
          </div>
          <div className="char-paper-paragraph relative">
            All field agents must maintain high alert.
            {hash % 4 === 0 && <div className="char-marker-circle" />}
          </div>
          {hash % 2 === 0 && <div className="char-stamp-red" style={{ top: 120, right: 10 }}>RESTRICTED</div>}
          {hash % 3 === 0 && <div className="char-handwriting red-ink" style={{ bottom: 20, right: 10 }}>* Verify ASAP *</div>}
        </>
      );
    } else if (item.type === 'yellow-note') {
      baseClass = "char-sticky-note";
      extraAttrs = { "data-color": "yellow" };
      content = (
        <>
          <div className="font-bold mb-1">REMINDER:</div>
          <ul className="char-checkbox-list">
            <li><span className="char-checkbox-box checked" /> Check logs</li>
            <li><span className="char-checkbox-box" /> Verify target</li>
          </ul>
          {hash % 5 === 0 && <div className="char-handwriting" style={{ bottom: -5, left: 10 }}>Who is this??</div>}
        </>
      );
    } else if (item.type === 'blue-note') {
      baseClass = "char-sticky-note";
      extraAttrs = { "data-color": "blue" };
      content = (
        <>
          <div className="font-bold border-b border-[#999] pb-0.5 mb-1">ROUTING SLIP</div>
          <div><strong>TO:</strong> Agent {hash % 99}</div>
          <div className="mt-2">Needs clearance.</div>
          {hash % 2 !== 0 && <div className="char-stamp-red" style={{ top: 20, right: -15, fontSize: "calc(12px*var(--app-text-scale,1))", transform: 'rotate(10deg)' }}>URGENT</div>}
        </>
      );
    } else if (item.type === 'torn') {
      baseClass = "char-paper-torn";
      content = (
        <>
          <div className="font-bold mb-1">Log Day {hash % 30}</div>
          <div className="char-paper-paragraph">
            Subject exhibited <span className="char-redacted">unusual</span> behavior.
          </div>
          {hash % 4 === 0 && <div className="char-handwriting red-ink" style={{ bottom: 5, right: -10 }}>Liar.</div>}
        </>
      );
    } else if (item.type === 'grid') {
      baseClass = "char-paper-grid";
      content = (
        <>
          {hasCrease && <div className="char-paper-crease" />}
          <div className="border-b border-[var(--c-panel-border)] mb-1"><strong>COORDINATES:</strong></div>
          <div className="ts-14 font-mono relative">
            [{hash % 90} N, {hash % 180} W]
            {hash % 3 === 0 && <div className="char-marker-circle" style={{ borderColor: '#000080' }} />}
          </div>
          <div className="char-barcode mt-2 h-4" />
        </>
      );
    } else {
      baseClass = "char-paper-scrap";
      content = (
        <>
          <strong>EVIDENCE 0X4A-{hash % 10}</strong>
          <div className="char-redacted mt-1">[EXPUNGED]</div>
        </>
      );
    }

    return (
      <div className={`char-bg-item ${baseClass} ${isBurnt ? 'char-burnt-edges' : ''}`} {...extraAttrs}>
        {content}
      </div>
    );
  }

  // 角色库搜索：按名字 / 签名 / 人设 / 标签过滤
  const q = query.trim().toLowerCase();
  const visibleCharacters = q
    ? worldCharacters.filter(c =>
        [c.name, c.briefPersona, c.persona, ...(c.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q))
    : worldCharacters;

  const createNewArchive = () => {
    pendingActionRef.current = 'create';
    setShowStylePicker(true);
  };

  return (
    <>
      <div className="lib lib-canvas char-archive-root">
        <div className="lib-top">
          <div className="ey">CHARACTER ARCHIVE</div>
          <div className="lib-acts">
            <button type="button" onClick={onClose} aria-label="返回桌面">
              <LibIcon><path d="M15 18l-6-6 6-6" /></LibIcon>
            </button>
            {isEditing && (
              <button type="button" onClick={() => resetViewToFit()} aria-label="恢复视角" title="恢复视角">
                <LibIcon><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></LibIcon>
              </button>
            )}
            <button type="button" className={isEditing ? "on" : ""} onClick={() => toggleEditing()} aria-label="编辑排版">
              <LibIcon><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></LibIcon>
            </button>
          </div>
        </div>
        <h1>角色档案</h1>
        <div className="sch">
          <LibIcon><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></LibIcon>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索角色、标签、人设" aria-label="搜索角色" />
        </div>
        <div className="chips">
          {worldGroups.map(g => (
            <b
              key={g.id}
              className={`${g.id === currentWorldId ? "on" : ""} ${g.id === dropTargetWorldId ? "drop" : ""}`}
              data-world-tab-id={g.id}
              role="button"
              tabIndex={0}
              onClick={() => (g.id === currentWorldId ? setShowWorldEditor(true) : selectWorld(g.id))}
            >
              {g.name} {memberCounts.get(g.id) ?? 0}
            </b>
          ))}
          <b className="add" role="button" tabIndex={0} onClick={() => setShowNewWorld(true)} aria-label="新建卷宗">＋</b>
        </div>
        <div
          ref={canvasElRef}
          className="char-infinite-canvas lib-stage select-none"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onContextMenu={(e) => {
            if (placementActive) {
              e.preventDefault();
              setPendingBgType(null);
              onClearPendingPlacement();
            }
          }}
          style={{ touchAction: 'none', WebkitUserSelect: 'none', cursor: placementActive ? 'crosshair' : undefined }}
        >
        {/* 拉线进行中的提示纸条 */}
        {linkFromId && (
          <div className="wt-link-hint">
            正在从 <strong>{nameById.get(linkFromId) ?? "?"}</strong> 拉线 · 点另一张照片牵上关系，点空白处取消
          </div>
        )}
        {worldCharacters.length === 0 && worldBgItems.length === 0 ? (
          <div className="lib-empty" style={{ zIndex: 100 }}>
            这份卷宗还是空的<br />
            <span>点下方 ＋ 新建档案，或把别的卷宗里的角色拖进来</span>
          </div>
        ) : (
          <div className="char-infinite-container absolute w-0 h-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.zoom})` }}>
            {/* 连线原本在这里渲染，现在移到了下方，确保它覆盖在拍立得照片的上方 */}

            {worldBgItems.map(item => (
              <DraggableNode
                key={item.id} id={item.id} x={item.x} y={item.y} rot={item.rot} zIndex={item.zIndex}
                onDragEnd={handleDragEndBg} isEditing={isEditing}
                onDeleteIntent={(id) => setDeleteConfirm({ id, type: 'bg' })}
                trashBinRef={trashBinRef}
                onDragActiveChange={setIsAnyDragging}
                onOverTrashChange={setOverTrashBin}
                zoom={pan.zoom}
                pinchRef={pinchRef}
              >
                {renderBgContent(item)}
              </DraggableNode>
            ))}

            {visibleCharacters.map((char) => {
              if (char.canvasX === undefined) return null;
              const pct = archiveCompleteness(char);
              const tags = (char.tags ?? []).slice(0, 2);

              return (
                <DraggableNode
                  key={char.id} id={char.id}
                  x={char.canvasX} y={char.canvasY || 0} rot={char.canvasRot || 0} zIndex={char.canvasZIndex || 100}
                  onDragEnd={handleDragEndChar}
                  onClick={isEditing ? undefined : (e) => onSelect(char, e)}
                  className={`ac lib-card ${linkFromId === char.id ? "wt-link-source" : ""}`}
                  w={169}
                  isEditing={isEditing}
                  onDeleteIntent={(id) => setDeleteConfirm({ id, type: 'char' })}
                  onEditTap={handleCharEditTap}
                  onDragMoveAt={handleCharDragMoveAt}
                  onDropAt={handleCharDropAt}
                  use2dTransform
                  trashBinRef={trashBinRef}
                  onDragActiveChange={setIsAnyDragging}
                  onOverTrashChange={setOverTrashBin}
                  zoom={pan.zoom}
                  pinchRef={pinchRef}
                >
                  <div className="a">
                    {char.avatar
                      ? <img src={char.avatar} alt={char.name} draggable={false} />
                      : (char.name || "?").slice(0, 1)}
                  </div>
                  <button
                    className="char-polaroid-menu-btn"
                    onClick={(e) => { e.stopPropagation(); setActiveMoveChar(char); }}
                    aria-label="转移世界"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                  </button>
                  <div className="n">{char.name || "未命名"}</div>
                  <div className="g">{char.briefPersona || char.persona || "还没有签名"}</div>
                  <div className="f">
                    <div className="tgm">{tags.map(tag => <i key={tag}>{tag}</i>)}</div>
                    <div className="rg" style={{ "--p": `${pct}%` } as React.CSSProperties}><b>{pct}</b></div>
                  </div>
                </DraggableNode>
              );
            })}

            {/* 设计稿右下角的虚线「新建档案」卡，放在最后一格 */}
            <div
              className="ac new"
              style={{
                position: 'absolute', left: 0, top: 0, width: 169, zIndex: 99,
                transform: `translate(${(worldCharacters.length % 2) * 181}px, ${Math.floor(worldCharacters.length / 2) * 208}px)`,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={createNewArchive}
            >
              <span dangerouslySetInnerHTML={{ __html: CAT_SLEEP_SVG }} />
              新建档案
              <span className="ac-sub">从空白或 AI 建议开始</span>
            </div>

            {/* 把拉线放在所有卡片的最后渲染，并设置超高 zIndex，使其盖在所有照片之上 */}
            <svg className="absolute top-0 left-0 w-[10000px] h-[10000px] pointer-events-none overflow-visible" style={{ zIndex: 99999 }}>
              {relationLines.map(line => {
                const a = worldCharacters.find(c => c.id === line.aId);
                const b = worldCharacters.find(c => c.id === line.bId);
                if (!a || !b || a.canvasX === undefined || a.canvasY === undefined || b.canvasX === undefined || b.canvasY === undefined) return null;
                const x1 = a.canvasX + 60, y1 = a.canvasY + 60;
                const x2 = b.canvasX + 60, y2 = b.canvasY + 60;
                return (
                  <g key={line.key}>
                    {/* 连线阴影 (更淡的阴影) */}
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.04)" strokeWidth="2" transform="translate(1, 1.5)" strokeDasharray="6 3" />
                    {/* 虚线（颜色更深） */}
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#222222" strokeWidth="1.5" opacity={0.9} strokeDasharray="6 3" />

                    {/* 图钉 (Pushpins - 更深的主色，更浅的阴影) */}
                    <g transform={`translate(${x1}, ${y1})`}>
                      <circle cx="1.5" cy="2" r="4.5" fill="rgba(0,0,0,0.12)" />
                      <circle cx="0" cy="0" r="4.5" fill="#111111" />
                      <circle cx="-1.5" cy="-1.5" r="1.5" fill="#555555" opacity="0.9" />
                    </g>
                    <g transform={`translate(${x2}, ${y2})`}>
                      <circle cx="1.5" cy="2" r="4.5" fill="rgba(0,0,0,0.12)" />
                      <circle cx="0" cy="0" r="4.5" fill="#111111" />
                      <circle cx="-1.5" cy="-1.5" r="1.5" fill="#555555" opacity="0.9" />
                    </g>
                    {/* 关系标签 */}
                    <foreignObject
                      x={(x1 + x2) / 2 - 100}
                      y={(y1 + y2) / 2 - 15}
                      width={200}
                      height={30}
                      className="overflow-visible pointer-events-none"
                    >
                      <div className="flex items-center justify-center w-full h-full pointer-events-none">
                        <span
                          className={`bg-[#111111] px-2 py-0.5 text-[11px] text-white border border-[#333333] rounded-[4px] font-bold ${isEditing ? 'cursor-pointer pointer-events-auto hover:bg-[#222222] transition-colors' : 'pointer-events-none'}`}
                          style={{
                            fontFamily: '"Courier New", monospace',
                            boxShadow: '1px 2px 4px rgba(0,0,0,0.06)',
                            transform: 'rotate(-2deg)',
                          }}
                          onClick={isEditing ? () => setPairSheet({ aId: line.aId, bId: line.bId }) : undefined}
                        >
                          {line.labels.join(" / ")}
                        </span>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Ghost preview following pointer during placement */}
        {placementActive && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 opacity-50 pointer-events-none"
            style={{
              left: ghostPos.x,
              top: ghostPos.y,
              zIndex: 999999,
            }}
          >
            {pendingPlacementChar ? (
              <div className="char-polaroid w-[100px]" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                <div className="char-polaroid-img-wrapper">
                  {pendingPlacementChar.avatar ? (
                    <img src={pendingPlacementChar.avatar} className="char-polaroid-img" alt="" draggable={false} />
                  ) : (
                    <CharAvatarFallback name={pendingPlacementChar.name} size="100%" />
                  )}
                </div>
                <div className="char-polaroid-text ts-10">{pendingPlacementChar.name || "UNNAMED"}</div>
              </div>
            ) : pendingBgType ? (
              <div className="scale-[0.6] origin-center">
                {renderBgContent({ id: `ghost-${pendingBgType}`, type: pendingBgType, x: 0, y: 0, rot: 0, zIndex: 0 })}
              </div>
            ) : null}
          </div>
        )}

        {/* Placement mode banner */}
        {placementActive && (
          <div className="char-placement-hint" style={{ zIndex: 999999 }}>
            <span className="char-placement-hint-finger" aria-hidden="true">👆</span>
            <span>点击画布放置 · ESC 取消</span>
          </div>
        )}

        {/* Trash bin: z-index between normal items and dragged item */}
        <div
          ref={trashBinRef}
          className={`char-trash-bin char-trash-bin-hitbox ${overTrashBin ? 'drag-over' : ''}`}
          style={{
            opacity: isAnyDragging ? 1 : 0,
            transform: overTrashBin ? 'translateX(-50%) translateY(-10px) scale(1.15)' : 'translateX(-50%) scale(1)',
            pointerEvents: isAnyDragging ? 'auto' : 'none',
            zIndex: 500000
          }}
        >
          <IconTrash size={32} />
        </div>

      </div>

        {/* 果冻导航：保留原有四个入口（角色 / 导入 / 世界书 / 配角）+ 新建 */}
        <div className="tb">
          <div className="ind" style={{ left: 8, width: 90 }} />
          <div className="tab on">
            <LibIcon><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></LibIcon>
            <span>角色</span>
          </div>
          <button type="button" className="tab" onClick={() => { pendingActionRef.current = 'import'; setShowStylePicker(true); }} aria-label="导入角色">
            <LibIcon><path d="M12 4v10M8.5 10.5L12 14l3.5-3.5M5 19h14" /></LibIcon>
            <span>导入</span>
          </button>
          <button type="button" className="tab" onClick={() => setShowWorldEditor(true)} aria-label="世界书">
            <LibIcon><path d="M5 5.5A2 2 0 017 3.5h11v15H7a2 2 0 00-2 2v-15z" /><path d="M5 20.5h13" /></LibIcon>
            <span>世界书</span>
          </button>
          <button type="button" className="tab" onClick={() => setShowNpcGen(true)} aria-label="生成配角">
            <LibIcon><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16.5 14.2c2.3 0 3.6 1.5 4 3.8" /></LibIcon>
            <span>配角</span>
          </button>
          {isEditing && (
            <button type="button" className="tab" onClick={() => setIsPropsMenuOpen(true)} aria-label="道具">
              <LibIcon><rect x="4.5" y="4.5" width="6" height="6" rx="2" /><rect x="13.5" y="4.5" width="6" height="6" rx="2" /><rect x="4.5" y="13.5" width="6" height="6" rx="2" /><rect x="13.5" y="13.5" width="6" height="6" rx="2" /></LibIcon>
              <span>道具</span>
            </button>
          )}
          <button type="button" className="pl" onClick={createNewArchive} aria-label="新建档案">
            <LibIcon><path d="M12 5v14M5 12h14" /></LibIcon>
          </button>
          <input
            ref={fileRef} type="file" accept=".json,.png,image/png,application/json" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await handleImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {deleteConfirm && (
        <div
          className="modal-overlay"
          style={{ zIndex: 8000000, backdropFilter: "blur(var(--ui-blur-light))" }}
          onClick={() => {
            if (deleteConfirmReady) setDeleteConfirm(null);
          }}
        >
          <div className="char-punched-hole-note" onClick={(e) => e.stopPropagation()}>
            <h3>销毁确认</h3>
            <p>您确定要丢弃该档案或物件吗？此操作将永远无法恢复。</p>
            <div className="char-punched-hole-btn-group">
              <button
                className="char-punched-hole-btn"
                disabled={!deleteConfirmReady}
                onClick={() => {
                  if (deleteConfirmReady) setDeleteConfirm(null);
                }}
              >驳回申请</button>
              <button className="char-punched-hole-btn danger" disabled={!deleteConfirmReady} onClick={() => {
                if (!deleteConfirmReady) return;
                if (deleteConfirm.type === 'char') {
                  onUpdateChars(characters.filter(c => c.id !== deleteConfirm.id));
                  onNotice?.("已销毁调查档案");
                } else {
                  onUpdateBgItems((bgItems || []).filter(b => b.id !== deleteConfirm.id));
                  onNotice?.("已销毁散落物件");
                }
                setDeleteConfirm(null);
              }}>批准销毁</button>
            </div>
          </div>
        </div>
      )}

      {importError && (
        <ConfirmDialog
          title="导入失败"
          message={importError}
          icon={AlertCircle}
          variant="danger"
          confirmLabel="知道了"
          cancelLabel=""
          onConfirm={() => setImportError(null)}
          onCancel={() => setImportError(null)}
        />
      )}

      {/* NPC generator sheet — 目标角色限当前世界，生成的配角落在当前画布 */}
      {showNpcGen && (
        <NpcGeneratorSheet
          characters={worldCharacters}
          onClose={() => setShowNpcGen(false)}
          onConfirm={handleNpcGenerated}
        />
      )}

      {/* 世界卷宗编辑 */}
      {showWorldEditor && currentGroup && (
        <WorldCaseSheet
          group={currentGroup}
          onRename={name => renameCharacterWorldGroup(currentGroup.id, name)}
          onUpdateDescription={description => updateCharacterWorldDescription(currentGroup.id, description)}
          onDelete={() => {
            deleteCharacterWorldGroup(currentGroup.id);
            setShowWorldEditor(false);
            selectWorld(DEFAULT_CHARACTER_WORLD_ID);
            onNotice("卷宗已删除，角色并回默认世界");
          }}
          onClose={() => setShowWorldEditor(false)}
        />
      )}

      {/* 新建卷宗 */}
      {showNewWorld && (
        <NewWorldSheet
          onCreate={name => {
            const group = createCharacterWorldGroup(name);
            setShowNewWorld(false);
            selectWorld(group.id);
            onNotice(`已建立卷宗「${group.name}」`);
          }}
          onClose={() => setShowNewWorld(false)}
        />
      )}

      {/* 拉线：关系标签输入 */}
      {linkTo && currentGroup && (
        <RelationLinkDialog
          fromName={nameById.get(linkTo.fromId) ?? "?"}
          toName={nameById.get(linkTo.toId) ?? "?"}
          onConfirm={label => {
            addCharacterWorldRelation(currentGroup.id, linkTo.fromId, linkTo.toId, label);
            setLinkTo(null);
          }}
          onCancel={() => setLinkTo(null)}
        />
      )}

      {/* 关系细目：逐条剪断 */}
      {pairSheet && currentGroup && (
        <RelationPairSheet
          relations={(currentGroup.relations ?? []).filter(r =>
            (r.fromCharacterId === pairSheet.aId && r.toCharacterId === pairSheet.bId)
            || (r.fromCharacterId === pairSheet.bId && r.toCharacterId === pairSheet.aId)
          )}
          nameById={nameById}
          onDelete={relationId => deleteCharacterWorldRelation(currentGroup.id, relationId)}
          onClose={() => setPairSheet(null)}
        />
      )}

      {/* Style picker popup */}
      {showStylePicker && (
        <CSheet
          eyebrow="SELECT FORMAT"
          title="选择拍立得比例"
          ariaLabel="选择拍立得比例"
          onClose={() => setShowStylePicker(false)}
          footer={{ label: "取消", onClick: () => setShowStylePicker(false) }}
        >
          <div className="cm-grid cm-grid-ratio">
            {[
              { label: "正方", w: 64, h: 64 },
              { label: "竖版", w: 48, h: 64 },
              { label: "横版", w: 64, h: 48 },
              { label: "16:9", w: 64, h: 36 },
              { label: "9:16", w: 36, h: 64 },
            ].map((style, idx) => (
              <button
                key={idx}
                type="button"
                className="cm-ratio"
                onClick={() => {
                  pendingStyleRef.current = idx;
                  setShowStylePicker(false);
                  if (pendingActionRef.current === "import") {
                    fileRef.current?.click();
                  } else {
                    onCreate(idx);
                  }
                }}
              >
                <span className="cm-ratio-paper" style={{ width: style.w, height: style.h }}>
                  <i />
                </span>
                <em>{style.label}</em>
              </button>
            ))}
          </div>
        </CSheet>
      )}

      {/* Props picker popup */}
      {isPropsMenuOpen && (
        <CSheet
          eyebrow="ADD PROPS"
          title="添加画布道具"
          ariaLabel="添加画布道具"
          onClose={() => setIsPropsMenuOpen(false)}
          footer={{ label: "完成", onClick: () => setIsPropsMenuOpen(false) }}
        >
          <p className="cm-lede">点一下就会放到画布上，可以连续添加。</p>
          <div className="cm-grid cm-grid-props">
            {([
              { type: "a4" as const, label: "档案", w: 200, h: 280, scale: 0.16 },
              { type: "yellow-note" as const, label: "便签", w: 110, h: 80, scale: 0.28 },
              { type: "blue-note" as const, label: "传票", w: 120, h: 90, scale: 0.26 },
              { type: "torn" as const, label: "碎片", w: 130, h: 70, scale: 0.24 },
              { type: "grid" as const, label: "网格", w: 150, h: 100, scale: 0.21 },
              { type: "scrap" as const, label: "烧纸", w: 140, h: 50, scale: 0.24 },
            ]).map((item) => (
              <button
                key={item.type}
                type="button"
                className="cm-prop"
                onClick={() => handleAddBgItem(item.type)}
              >
                <span
                  className={`cm-prop-paper cm-prop-${item.type}`}
                  style={{ width: Math.round(item.w * item.scale), height: Math.round(item.h * item.scale) }}
                />
                <em>{item.label}</em>
              </button>
            ))}
          </div>
        </CSheet>
      )}

      {/* 转移世界 Modal */}
      {activeMoveChar && (
        <div className="modal-overlay" data-ui="modal" onPointerDown={() => setActiveMoveChar(null)}>
          <div className="modal-dialog" data-ui="modal-dialog" onPointerDown={(e) => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden' }}>
            <div className="modal-header" data-ui="modal-header" style={{ padding: '20px 20px 10px' }}>
              <h3 className="modal-title" style={{ margin: 0, fontSize: '16px' }}>转移到其他卷宗</h3>
            </div>
            <div role="listbox" style={{ maxHeight: '40dvh', padding: '10px 16px', overflowY: 'auto' }}>
              {worldGroups.filter(g => g.id !== currentWorldId).map(group => (
                <button
                  key={group.id}
                  type="button"
                  style={{ width: '100%', padding: '12px 16px', textAlign: 'left', borderRadius: '8px', background: 'rgba(0,0,0,0.03)', marginBottom: '8px', border: '1px solid rgba(0,0,0,0.05)', fontWeight: '500', fontSize: '14px', color: '#333' }}
                  onClick={() => {
                    moveCharacterToWorld(activeMoveChar.id, group.id);
                    setActiveMoveChar(null);
                  }}
                  role="option"
                >
                  {group.name}
                </button>
              ))}
              {worldGroups.filter(g => g.id !== currentWorldId).length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>没有其他卷宗可供转移</div>
              )}
            </div>
            <div className="modal-footer" data-ui="modal-footer" style={{ padding: '10px 20px 20px' }}>
              <button className="ui-btn ui-btn-outline" style={{ width: '100%' }} onClick={() => setActiveMoveChar(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Draggable 组件封装 ───────────────────────────────────

function DraggableNode({
  id, x, y, rot, zIndex, children, onDragEnd, onClick, className, w, isEditing, onDeleteIntent,
  trashBinRef, onDragActiveChange, onOverTrashChange, zoom = 1, pinchRef,
  onEditTap, onDragMoveAt, onDropAt, use2dTransform = false
}: {
  id: string; x: number; y: number; rot: number; zIndex: number;
  children: React.ReactNode;
  onDragEnd: (id: string, newX: number, newY: number) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  className?: string; w?: number | string; isEditing?: boolean;
  onDeleteIntent?: (id: string) => void;
  trashBinRef?: React.RefObject<HTMLDivElement | null>;
  onDragActiveChange?: (active: boolean) => void;
  onOverTrashChange?: (over: boolean) => void;
  zoom?: number;
  pinchRef?: React.RefObject<PinchState | null>;
  /** 编辑模式下的「点按」（无位移的 tap）——用于拉线选点 */
  onEditTap?: (id: string) => void;
  /** 拖动过程中上报指针屏幕坐标——用于世界 tab 悬停高亮 */
  onDragMoveAt?: (clientX: number, clientY: number) => void;
  /** 松手时的落点处理；返回 true 表示已被消费（如归档进其他世界），位置回弹 */
  onDropAt?: (id: string, clientX: number, clientY: number) => boolean;
  /** 使用二维位移，避免 3D 合成导致档案墙图片重采样模糊 */
  use2dTransform?: boolean;
}) {
  const [pos, setPos] = useState({ x, y });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ cx: 0, cy: 0, startX: 0, startY: 0, moved: false });

  useEffect(() => { setPos({ x, y }); }, [x, y]);

  function handlePointerDown(e: React.PointerEvent) {
    if (pinchRef?.current) return;
    if (!isEditing && onClick) {
      // Non-edit mode: let click through for card open
      return;
    }
    if (!isEditing) return;
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { cx: e.clientX, cy: e.clientY, startX: pos.x, startY: pos.y, moved: false };
    setIsDragging(true);
    onDragActiveChange?.(true);
  }
  function isPointerOverTrash(cx: number, cy: number): boolean {
    if (!trashBinRef?.current) return false;
    const rect = trashBinRef.current.getBoundingClientRect();
    return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (pinchRef?.current) {
      if (isDragging) {
        setIsDragging(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        onDragActiveChange?.(false);
        onOverTrashChange?.(false);
        (e.currentTarget as HTMLElement).classList.remove('drag-over-trash');
      }
      return;
    }
    if (!isDragging) return;
    const dx = (e.clientX - dragStart.current.cx) / zoom;
    const dy = (e.clientY - dragStart.current.cy) / zoom;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStart.current.moved = true;
    }
    setPos({ x: dragStart.current.startX + dx, y: dragStart.current.startY + dy });
    onDragMoveAt?.(e.clientX, e.clientY);
    if (typeof document !== 'undefined') {
      const overTrash = isPointerOverTrash(e.clientX, e.clientY);
      onOverTrashChange?.(overTrash);
      // Visual feedback on the dragged item itself
      if (overTrash) {
        (e.currentTarget as HTMLElement).classList.add('drag-over-trash');
      } else {
        (e.currentTarget as HTMLElement).classList.remove('drag-over-trash');
      }
    }
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (typeof document !== 'undefined') {
      onDragActiveChange?.(false);
      onOverTrashChange?.(false);
      (e.currentTarget as HTMLElement).classList.remove('drag-over-trash');

      if (isPointerOverTrash(e.clientX, e.clientY) && onDeleteIntent) {
        onDeleteIntent(id);
        setPos({ x: dragStart.current.startX, y: dragStart.current.startY });
        return;
      }
      // 落点被外部消费（如拖到世界 tab 上归档）→ 位置回弹，不落坐标
      if (dragStart.current.moved && onDropAt?.(id, e.clientX, e.clientY)) {
        setPos({ x: dragStart.current.startX, y: dragStart.current.startY });
        return;
      }
    }
    onDragEnd(id, pos.x, pos.y);
  }
  function handlePointerCancel(e: React.PointerEvent) {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (typeof document !== 'undefined') {
      onDragActiveChange?.(false);
      onOverTrashChange?.(false);
    }
    onDragEnd(id, pos.x, pos.y);
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (dragStart.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if ((e.target as HTMLElement).closest('.char-polaroid-menu-btn')) {
      return;
    }
    if (isEditing) {
      e.stopPropagation();
      e.preventDefault();
      // 编辑模式下无位移的点按 → 拉线选点
      if (onEditTap) onEditTap(id);
      return;
    }
    if (onClick) onClick(e);
  }

  return (
    <div
      className={`${className || ''} absolute left-0 top-0 select-none`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClick}
      style={{
        width: w,
        transform: use2dTransform
          ? `translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg)`
          : `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${rot}deg)`,
        zIndex: isDragging ? 9999999 : zIndex,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        WebkitUserSelect: 'none'
      }}
    >
      {children}
    </div>
  )
}


// ── 绝密档案视图（详情页面） ─────────────────────────────────────────

function CharArchiveView({
  char,
  isEditing = false,
  isExisting = false,
  onBack,
  onEdit,
  onCancelEdit,
  onSave,
  onRestoreVersion,
  onDelete,
  onExportJson,
  onExportPng,
  onNotice = () => { },
  dummy,
  relations = [],
}: {
  char: Character;
  isEditing?: boolean;
  isExisting?: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCancelEdit?: () => void;
  onSave?: (data: CharacterImportData, createVersion: boolean) => void;
  onRestoreVersion?: (version: CharacterVersion) => void;
  onDelete: () => void;
  onExportJson: () => void;
  onExportPng: () => Promise<void>;
  onNotice?: (text: string) => void;
  dummy?: boolean;
  relations?: { name: string; label: string }[];
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState<"back" | "cancel" | null>(null);
  const [showSaveVersionConfirm, setShowSaveVersionConfirm] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<CharacterVersion[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<CharacterVersion | null>(null);
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<CharacterVersion | null>(null);
  const [name, setName] = useState(char.name || "");
  const [persona, setPersona] = useState(char.persona || "");
  const [personality, setPersonality] = useState(char.personality || "");
  const [briefPersona, setBriefPersona] = useState(char.briefPersona || "");
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [timeZone, setTimeZone] = useState(char.timeZone || "");
  const [tags, setTags] = useState<string[]>(char.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [showTimeZonePicker, setShowTimeZonePicker] = useState(false);
  const [timeZoneSearch, setTimeZoneSearch] = useState(char.timeZone || "");
  const [avatar, setAvatar] = useState<string | null>(char.avatar || null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cbRef = useRef<HTMLDivElement>(null);

  // Send mascot page context (on mount + field changes)
  useEffect(() => {
    notifyMascotPageContext({
      page: "character",
      mode: isEditing ? "editing" : "viewing",
      label: `角色编辑 · ${name || "新角色"}`,
      fields: {
        _characterId: char.id || "",
        name,
        persona,
        personality,
        timeZone,
      },
    });
  }, [isEditing, name, persona, personality, timeZone, char.id]);

  // Listen for mascot fill events (unified)
  useEffect(() => {
    const onFill = (e: Event) => {
      const { field, value } = (e as CustomEvent).detail;
      if (field === "name") setName(value);
      else if (field === "persona") setPersona(value);
      else if (field === "personality") setPersonality(value);
      else if (field === "timeZone") {
        setTimeZone(value);
        setTimeZoneSearch(value);
      }
    };
    window.addEventListener("mascot-fill-field", onFill);
    return () => window.removeEventListener("mascot-fill-field", onFill);
  }, []);

  // Reset mascot context on unmount
  useEffect(() => {
    return () => {
      notifyMascotPageContext({ page: "desktop", mode: "idle", label: "桌面", fields: {} });
    };
  }, []);

  // Dirty check — compare current edit state vs original char
  function isDirty(): boolean {
    if (!isEditing) return false;
    if (name !== (char.name || "")) return true;
    if (persona !== (char.persona || "")) return true;
    if (personality !== (char.personality || "")) return true;
    if (briefPersona !== (char.briefPersona || "")) return true;
    if (timeZone !== (char.timeZone || "")) return true;
    if (avatar !== (char.avatar || null)) return true;
    const origTags = char.tags || [];
    if (tags.length !== origTags.length || tags.some((t, i) => t !== origTags[i])) return true;
    return false;
  }

  function handleBack() {
    if (isDirty()) {
      setShowUnsavedConfirm("back");
    } else {
      onBack();
    }
  }

  useEffect(() => {
    if (!isEditing) {
      setName(char.name || "");
      setPersona(char.persona || "");
      setPersonality(char.personality || "");
      setBriefPersona(char.briefPersona || "");
      setBriefError("");
      setTimeZone(char.timeZone || "");
      setTimeZoneSearch(char.timeZone || "");
      setShowTimeZonePicker(false);
      setTags(char.tags || []);
      setAvatar(char.avatar || null);
    }
  }, [isEditing, char]);

  async function handleAvatarFile(file: File) {
    setAvatarBusy(true);
    try {
      const url = await fileToDataUrl(file, {
        maxSize: 1280,
        quality: 0.86,
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        fallbacks: CHARACTER_AVATAR_COMPRESSION_FALLBACKS,
      });
      setAvatar(url);
    } catch (error) {
      console.error("Failed to optimize character avatar", error);
      onNotice(error instanceof Error ? error.message : "图片处理失败，请更换图片");
    } finally {
      setAvatarBusy(false);
    }
  }

  function handleAvatarUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setAvatar(trimmed);
    setShowUrlInput(false);
    setUrlInput("");
  }

  function handleAddTag() {
    const t = tagInput.trim();
    if (!t) return;
    const split = t.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    const newTags = Array.from(new Set([...tags, ...split]));
    setTags(newTags);
    setTagInput("");
  }

  function commitSave(createVersion: boolean) {
    const trimmedTimeZone = timeZone.trim();
    const normalizedTimeZone = trimmedTimeZone ? normalizeTimeZone(trimmedTimeZone) : undefined;
    if (onSave) {
      const trimmedBrief = briefPersona.trim();
      onSave({
        name: name.trim() || char.name || "UNNAMED",
        persona,
        personality: personality.trim() || undefined,
        briefPersona: trimmedBrief || undefined,
        // 简介变动才刷新时间戳；未动则保留原值（供「设定已更新」过期提示判断）
        briefPersonaUpdatedAt: trimmedBrief
          ? (trimmedBrief !== (char.briefPersona || "").trim() ? new Date().toISOString() : char.briefPersonaUpdatedAt)
          : undefined,
        timeZone: normalizedTimeZone,
        tags,
        avatar: avatar ?? null
      }, createVersion);
    }
  }

  function handleSave() {
    if (isExisting) {
      setShowSaveVersionConfirm(true);
    } else {
      commitSave(false);
    }
  }

  function openVersionHistory() {
    setVersions(loadCharacterVersions(char.id));
    setShowVersions(true);
  }

  function removeVersion(version: CharacterVersion) {
    deleteCharacterVersion(char.id, version.id);
    setVersions(loadCharacterVersions(char.id));
    setDeleteVersionTarget(null);
  }

  async function handleGenerateBrief() {
    if (briefBusy) return;
    setBriefBusy(true);
    setBriefError("");
    try {
      const text = await generateBriefPersonaText({
        ...char,
        name: name.trim() || char.name || "未命名角色",
        persona,
        personality: personality.trim() || undefined,
      });
      setBriefPersona(text);
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : String(error));
    } finally {
      setBriefBusy(false);
    }
  }

  // Helper limits
  const personaText = persona || "NO DATA AVAILABLE.";
  const timeZoneOptions = getCharacterTimeZoneOptions(timeZone || timeZoneSearch);
  const timeZoneQuery = timeZoneSearch.trim().toLowerCase();
  const matchedTimeZoneOptions = timeZoneQuery
    ? timeZoneOptions.filter(option => option.toLowerCase().includes(timeZoneQuery))
    : timeZoneOptions;
  const filteredTimeZoneOptions = matchedTimeZoneOptions.slice(0, 80);
  const hasMoreTimeZoneOptions = matchedTimeZoneOptions.length > filteredTimeZoneOptions.length;

  function openTimeZonePicker() {
    setTimeZoneSearch(timeZone);
    setShowTimeZonePicker(true);
  }

  function closeTimeZonePicker() {
    setShowTimeZonePicker(false);
  }

  function selectTimeZoneOption(option: string) {
    setTimeZone(option);
    setTimeZoneSearch(option);
    setShowTimeZonePicker(false);
  }

  function applyTimeZoneSearch() {
    setTimeZone(timeZoneSearch.trim());
    setShowTimeZonePicker(false);
  }

  function clearTimeZone() {
    setTimeZone("");
    setTimeZoneSearch("");
    setShowTimeZonePicker(false);
  }

  const completeness = archiveCompleteness(char);
  const signatureLine = (briefPersona || persona || char.briefPersona || char.persona || "").trim().split("\n")[0] || "还没有签名";
  const updatedLabel = char.updatedAt ? char.updatedAt.slice(0, 10).replace(/-/g, "/") : "—";
  const railName = name.trim() || char.name || "未命名";

  function scrollToSection(section: "top" | "soul" | "relations") {
    const root = cbRef.current;
    if (!root) return;
    if (section === "top") {
      root.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const target = root.querySelector<HTMLElement>(`[data-sec="${section}"]`);
    if (target) root.scrollTo({ top: Math.max(0, target.offsetTop - root.offsetTop - 8), behavior: "smooth" });
  }

  const editTextStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 2,
  };

  const archiveFrame = (
    <div className={`profile-app${dummy ? " dummy" : ""}`}>
      <div className="rail">
        <button type="button" className="mn" onClick={handleBack} aria-label="返回角色列表">
          <svg className="ic" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div
          className={`av${isEditing ? " editable" : ""}`}
          role={isEditing ? "button" : undefined}
          tabIndex={isEditing ? 0 : undefined}
          aria-label={isEditing ? "更换头像" : undefined}
          onClick={() => {
            if (isEditing && !avatarBusy) fileRef.current?.click();
          }}
        >
          {avatar ? <img src={avatar} alt="Avatar" /> : (railName || "U").slice(0, 1)}
          {isEditing && (
            <span className="av-mask"><IconCamera size={14} /></span>
          )}
        </div>
        <div className="hd">@{railName}</div>
        <button type="button" className="ri" onClick={() => scrollToSection("top")}>
          <span className="pl">档案</span>
          <svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <button type="button" className="ri" onClick={() => scrollToSection("soul")}>
          <span>设定</span>
          <svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <button type="button" className="ri" onClick={() => scrollToSection("relations")}>
          <span>关系</span>
          <svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <div className="ri"><span>世界书</span><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></div>
        <div className="ri"><span>声音</span><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></div>
        <div className="ri"><span>记忆</span><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></div>
        <div className="ri"><span>更多</span><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></div>
        {!dummy && (
          <button type="button" className="ex" onClick={onExportPng} aria-label="导出档案图片" title="导出图片">
            <svg className="ic" viewBox="0 0 24 24"><path d="M10 5H6.5A2 2 0 004.5 7v10a2 2 0 002 2H10M14 8l4 4-4 4M18 12H9" /></svg>
          </button>
        )}
      </div>

      <div className="card">
        <div className="ch">
          <b>角色档案</b>
          <span className="ch-actions">
            {!isEditing && !dummy && isExisting && (
              <button type="button" className="ch-btn" onClick={openVersionHistory} aria-label="历史版本" title="历史版本">
                <History size={16} />
              </button>
            )}
            {!isEditing && !dummy && (
              <button type="button" className="ch-btn" onClick={onEdit} aria-label="编辑角色卡" title="编辑">
                <IconEdit />
              </button>
            )}
          </span>
        </div>

        <div className="cb" ref={cbRef}>
          {isEditing && !dummy && (
            <div className="photo-tools">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>更换头像</button>
              <button type="button" className="btn" onClick={() => setShowUrlInput(v => !v)}>图片链接</button>
              {showUrlInput && (
                <>
                  <input
                    className="photo-url"
                    placeholder="https://…"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAvatarUrl();
                      }
                    }}
                  />
                  <button type="button" className="btn k" onClick={handleAvatarUrl}>确定</button>
                </>
              )}
            </div>
          )}

          <div className="meter">
            档案完整度
            <div><i style={{ width: `${completeness}%` }} /></div>
            <b>{completeness}%</b>
          </div>

          <div className="lab">TAGS · 标签</div>
          <div className="tgs">
            {tags.map((t, i) => (
              <span className="tg" key={`${t}-${i}`}>
                {t}
                {isEditing && !dummy ? (
                  <button
                    type="button"
                    className="tag-x"
                    onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                    aria-label={`删除标签 ${t}`}
                  >×</button>
                ) : <i>×</i>}
              </span>
            ))}
            {isEditing && !dummy ? (
              <input
                className="tg-input"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="＋ 添加"
                aria-label="添加标签"
              />
            ) : (
              <button type="button" className="tg add" onClick={dummy ? undefined : onEdit}>＋ 添加</button>
            )}
          </div>

          {!isEditing && (
            <>
              <div className="qt">个性签名</div>
              <div className="qs">{signatureLine}</div>
            </>
          )}

          <div className="sh"><i>×</i><b>ABOUT ME</b></div>
          <div className="sl">基本信息</div>
          <div className="ln">
            <span>网名</span>
            {isEditing ? (
              <input
                className="ln-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="角色名字"
                aria-label="角色网名"
              />
            ) : (name || char.name || "未命名")}
          </div>
          <div className="ln"><span>微信号</span>{char.wechatID || "未绑定"}</div>
          <div className="ln">
            <span>时区</span>
            {isEditing ? (
              <button type="button" className="ln-chip" onClick={openTimeZonePicker}>{timeZone || "跟随系统"}</button>
            ) : (timeZone || "跟随系统")}
          </div>
          <div className="ln"><span>更新</span>{updatedLabel}</div>

          <div className="sh"><i>×</i><b>PERSONALITY</b></div>
          <div className="sl">角色性格</div>
          {isEditing ? (
            <AutoResizingTextarea
              className="ta"
              value={personality}
              onChange={setPersonality}
              placeholder="角色性格、说话习惯…"
              minHeight={84}
              style={editTextStyle}
            />
          ) : personality.trim() ? (
            <div className="ln">{personality}</div>
          ) : (
            <div className="ln muted">还没有填写</div>
          )}

          <div data-sec="soul">
            <div className="sh sec-row">
              <span className="sec-title"><i>×</i><b>BRIEF PERSONA</b></span>
              {isEditing && (
                <button type="button" className="btn" disabled={briefBusy} onClick={handleGenerateBrief}>
                  {briefBusy ? "生成中…" : briefPersona.trim() ? "重新生成" : "AI 生成"}
                </button>
              )}
            </div>
            <div className="sl">简量人设</div>
            {!isEditing && isBriefPersonaStale(char) && (
              <div className="hint" style={{ margin: "0 0 8px 25px" }}>⚠ 设定已更新，建议重新生成简介。</div>
            )}
            {briefError && <div className="hint" style={{ margin: "0 0 8px 25px", color: "#b4233b" }}>{briefError}</div>}
            {isEditing ? (
              <AutoResizingTextarea
                className="ta"
                value={briefPersona}
                onChange={setBriefPersona}
                placeholder="点「AI 生成」自动压缩人设，或手写 100~200 字简介…"
                minHeight={96}
                style={editTextStyle}
              />
            ) : briefPersona.trim() ? (
              <div className="ln">{briefPersona}</div>
            ) : (
              <div className="ln muted">还没有填写</div>
            )}
          </div>

          <div data-sec="relations">
            <div className="sh"><i>×</i><b>RELATIONSHIPS</b></div>
            <div className="sl">关系网 · {relations.length} 位</div>
            {relations.length > 0 ? (
              <div className="ln">{relations.map(r => `${r.name} · ${r.label}`).join("\n")}</div>
            ) : (
              <div className="ln muted">还没有建立关系</div>
            )}
          </div>

          <div className="sh"><i>×</i><b>PERSONA</b></div>
          <div className="sl">人物设定</div>
          {isEditing ? (
            <AutoResizingTextarea
              className="ta"
              value={persona}
              onChange={setPersona}
              placeholder="描述背景、性格、说话方式…"
              minHeight={150}
              style={editTextStyle}
            />
          ) : (
            <div className="ln">{persona.trim() ? persona : "NO DATA AVAILABLE."}</div>
          )}
        </div>

        {!dummy && (
          <div className="card-foot">
            {confirmDelete ? (
              <div className="confirm-row">
                <span>确定删除这份档案？</span>
                <button type="button" className="btn danger" onClick={onDelete}>删除</button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>取消</button>
              </div>
            ) : isEditing ? (
              <>
                <button
                  type="button"
                  className="btn grow"
                  onClick={() => {
                    if (isDirty()) setShowUnsavedConfirm("cancel");
                    else onCancelEdit?.();
                  }}
                >取消</button>
                <button type="button" className="btn k grow" onClick={handleSave}>保存</button>
              </>
            ) : (
              <>
                <button type="button" className="btn grow" onClick={onExportJson}>导出 JSON</button>
                <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>删除</button>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={avatarBusy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await handleAvatarFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );

  if (dummy) {
    return <div style={{ pointerEvents: "none" }}>{archiveFrame}</div>;
  }

  return (
    <>
      {archiveFrame}

      {showSaveVersionConfirm && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 px-5" role="dialog" aria-modal="true" aria-label="保存角色卡">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--c-panel-border)] bg-[var(--c-page-body-bg)] p-5 text-[var(--c-text)] shadow-2xl">
            <div className="text-base font-bold">保存角色卡</div>
            <p className="mt-2 ts-12 leading-relaxed opacity-75">
              当前是 V{getCharacterCurrentVersion(char.id)}。你可以先保存修改前的旧卡，也可以覆盖当前版本。
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className="rounded-xl bg-[var(--c-text)] px-4 py-3 font-semibold text-[var(--c-page-body-bg)]"
                onClick={() => {
                  setShowSaveVersionConfirm(false);
                  commitSave(true);
                }}
              >
                备份旧卡并保存为 V{getCharacterNextVersion(char.id)}
              </button>
              <button
                type="button"
                className="rounded-xl border border-[var(--c-panel-border)] px-4 py-3 font-semibold"
                onClick={() => {
                  setShowSaveVersionConfirm(false);
                  commitSave(false);
                }}
              >
                覆盖当前版本
              </button>
              <button
                type="button"
                className="px-4 py-2 opacity-65"
                onClick={() => setShowSaveVersionConfirm(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersions && (
        <div
          className="fixed inset-0 z-[10020] flex items-end justify-center bg-black/45 sm:items-center sm:px-5"
          role="dialog"
          aria-modal="true"
          aria-label="角色卡历史版本"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShowVersions(false);
          }}
        >
          <div className="max-h-[78vh] w-full max-w-md overflow-hidden rounded-t-2xl border border-[var(--c-panel-border)] bg-[var(--c-page-body-bg)] text-[var(--c-text)] shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-[var(--c-panel-border)] px-5 py-4">
              <div>
                <div className="font-bold">历史版本</div>
                <div className="mt-0.5 ts-10 opacity-60">当前生效：V{getCharacterCurrentVersion(char.id)}</div>
              </div>
              <button type="button" className="px-2 py-1 font-semibold" onClick={() => setShowVersions(false)}>关闭</button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto p-4">
              {versions.length === 0 ? (
                <div className="py-10 text-center ts-12 opacity-60">还没有历史版本。编辑保存或由小卷修改后会自动生成。</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded-xl border border-[var(--c-panel-border)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold">V{version.version}</div>
                          <div className="mt-1 ts-10 opacity-65">{version.label}</div>
                          <div className="mt-1 ts-10 opacity-50">{new Date(version.createdAt).toLocaleString()}</div>
                        </div>
                        {getCharacterCurrentVersion(char.id) === version.version && (
                          <span className="shrink-0 rounded-full border border-[var(--c-panel-border)] px-2 py-1 ts-10">当前</span>
                        )}
                      </div>
                      <div className="mt-3 rounded-lg bg-black/5 p-3 ts-11 dark:bg-white/5">
                        <div className="font-semibold">{version.data.name || "未命名角色"}</div>
                        <div className="mt-1 line-clamp-3 whitespace-pre-wrap opacity-65">
                          {version.data.persona || version.data.personality || "（无角色设定）"}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-[var(--c-text)] px-3 py-2 ts-12 font-semibold text-[var(--c-page-body-bg)] disabled:opacity-40"
                          disabled={getCharacterCurrentVersion(char.id) === version.version}
                          onClick={() => setRestoreTarget(version)}
                        >
                          切换到 V{version.version}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-red-400/60 px-3 py-2 ts-12 text-red-600"
                          onClick={() => setDeleteVersionTarget(version)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {restoreTarget && (
        <ConfirmDialog
          title={`切换到 V${restoreTarget.version}？`}
          message="当前角色卡会切换为该快照。切走前会同步保存当前版本，切换本身不会创建新版本号。"
          icon={History}
          confirmLabel="确认切换"
          cancelLabel="取消"
          onConfirm={() => {
            const target = restoreTarget;
            setRestoreTarget(null);
            setShowVersions(false);
            onRestoreVersion?.(target);
          }}
          onCancel={() => setRestoreTarget(null)}
        />
      )}

      {deleteVersionTarget && (
        <ConfirmDialog
          title={`删除 V${deleteVersionTarget.version}？`}
          message="此历史快照删除后无法恢复，不会删除当前角色卡。"
          icon={AlertCircle}
          variant="danger"
          confirmLabel="删除版本"
          cancelLabel="取消"
          onConfirm={() => removeVersion(deleteVersionTarget)}
          onCancel={() => setDeleteVersionTarget(null)}
        />
      )}

      {isEditing && showTimeZonePicker && (
        <div
          className="char-timezone-sheet-backdrop"
          onPointerDown={e => {
            if (e.target === e.currentTarget) closeTimeZonePicker();
          }}
        >
          <div className="char-timezone-sheet" role="dialog" aria-modal="true" aria-label="Timezone">
            <div className="char-timezone-sheet-header">
              <span>TIMEZONE</span>
              <button type="button" onClick={closeTimeZonePicker}>CLOSE</button>
            </div>
            <input
              className="char-timezone-search"
              value={timeZoneSearch}
              onChange={e => setTimeZoneSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  closeTimeZonePicker();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredTimeZoneOptions[0]) selectTimeZoneOption(filteredTimeZoneOptions[0]);
                  else applyTimeZoneSearch();
                }
              }}
              placeholder="Asia/Shanghai"
              spellCheck={false}
              autoFocus
            />
            <div className="char-timezone-sheet-actions">
              <button type="button" onClick={clearTimeZone}>SYSTEM</button>
              <button type="button" onClick={applyTimeZoneSearch}>DONE</button>
            </div>
            <div className="char-timezone-options" role="listbox">
              {filteredTimeZoneOptions.length > 0 ? (
                <>
                  {filteredTimeZoneOptions.map(option => (
                    <button
                      key={option}
                      type="button"
                      className="char-timezone-option"
                      onClick={() => selectTimeZoneOption(option)}
                      role="option"
                      aria-selected={option === timeZone}
                    >
                      {option}
                    </button>
                  ))}
                  {hasMoreTimeZoneOptions && (
                    <div className="char-timezone-more">MORE RESULTS</div>
                  )}
                </>
              ) : (
                <div className="char-timezone-empty">NO MATCHES</div>
              )}
            </div>
          </div>
        </div>
      )}



      {/* Unsaved changes confirmation dialog */}
      {showUnsavedConfirm && (
        <ConfirmDialog
          title="确定要放弃编辑吗？"
          message="当前编辑内容尚未保存，离开后所有更改将丢失。"
          icon={AlertCircle}
          variant="danger"
          confirmLabel="放弃更改"
          cancelLabel="继续编辑"
          onConfirm={() => {
            const action = showUnsavedConfirm;
            setShowUnsavedConfirm(null);
            if (action === "back") onBack();
            else onCancelEdit?.();
          }}
          onCancel={() => setShowUnsavedConfirm(null)}
        />
      )}
    </>
  );
}

// The CharEditView component has been removed as editing is now inline within CharArchiveView.

// ── 共享子组件 ───────────────────────────────────────

function CharAvatarFallback({
  name,
  size,
}: {
  name: string;
  size: number | string;
}) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: typeof size === "number" ? Math.round(size * 0.42) : "2rem",
  };
  return (
    <div className="flex items-center justify-center shrink-0 text-white font-bold" style={{ ...style, background: "linear-gradient(135deg, #7a8088, #5a6068)", fontFamily: "var(--app-font-family)" }}>
      {(name ?? "U").charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function AutoResizingTextarea({
  value,
  onChange,
  placeholder,
  style,
  minHeight = 60,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  minHeight?: number;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // useLayoutEffect（绘制前同步执行）：把"塌成一行→撑回真实高度"放在同一帧、绘制之前完成，
  // 避免某些内核（如小米浏览器）把中间那帧的高度骤减画出来、并因文档变矮把视口往上夹/拉。
  // 同时记录并还原最近可滚动祖先的 scrollTop，作为对 reflow 滚动锚定的额外保护。
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let scroller: HTMLElement | null = ta.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if ((oy === "auto" || oy === "scroll") && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    const prevTop = scroller ? scroller.scrollTop : window.scrollY;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(minHeight, ta.scrollHeight)}px`;
    if (scroller) {
      if (scroller.scrollTop !== prevTop) scroller.scrollTop = prevTop;
    } else if (window.scrollY !== prevTop) {
      window.scrollTo(0, prevTop);
    }
  }, [value, minHeight]);

  return (
    <textarea
      ref={textareaRef}
      className={`resize-none overflow-hidden${className ? ` ${className}` : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        ...style,
        minHeight,
      }}
    />
  );
}

// ── 工具函数 ─────────────────────────────────────────

type ImageCompressionAttempt = { maxSize: number; quality: number };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解析图片，请更换图片"));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("图片编码失败，请更换图片")),
      "image/webp",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取压缩图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function fileToDataUrl(
  file: File,
  options: {
    maxSize?: number;
    quality?: number;
    maxBytes?: number;
    fallbacks?: readonly ImageCompressionAttempt[];
  } = {},
): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const maxSize = options.maxSize ?? 400;
  const quality = options.quality ?? 0.8;

  try {
    const img = await loadDataUrlImage(sourceDataUrl);
    const attempts: ImageCompressionAttempt[] = [
      { maxSize, quality },
      ...(options.fallbacks ?? []),
    ];
    const canvas = document.createElement("canvas");

    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxSize / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器无法处理图片，请更换图片");
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, attempt.quality);
      if (!options.maxBytes || blob.size <= options.maxBytes) {
        return await blobToDataUrl(blob);
      }
    }

    throw new Error(`图片压缩后仍超过 ${Math.ceil((options.maxBytes ?? 0) / 1024)}KB，请更换图片`);
  } catch (error) {
    // 旧调用未要求体积上限时维持原有兼容兜底；角色头像的受限链路绝不保存原始大图。
    if (!options.maxBytes) return sourceDataUrl;
    throw error;
  }
}

// ── 图标 ─────────────────────────────────────────────

function IconBack() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconCamera({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
      <circle cx="12" cy="14" r="3"></circle>
    </svg>
  );
}

function IconTrash({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  );
}

// ── 组件实现 ─────────────────────────────────────────────

// ── NPC 生成器 ─────────────────────────────────────────────
// 「生成配角」弹层：选目标角色 + 可选要求 → LLM 生成完整角色卡 → 预览可编辑 → 确认落库。
// 生成逻辑见 lib/npc-generator.ts；落库动作在父组件 handleNpcGenerated。
function NpcGeneratorSheet({ characters, onClose, onConfirm }: {
  characters: Character[];
  onClose: () => void;
  onConfirm: (results: GeneratedSupportingCharacter[], targetId: string, allowAutoPost: boolean) => void;
}) {
  const [targetId, setTargetId] = useState(characters[0]?.id ?? "");
  const [hint, setHint] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<GeneratedSupportingCharacter[] | null>(null);
  const [allowAutoPost, setAllowAutoPost] = useState(false);

  const targetName = characters.find(c => c.id === targetId)?.name ?? "";

  async function handleGenerate() {
    if (!targetId || busy) return;
    setBusy(true);
    setError("");
    try {
      const generated = await generateSupportingCharacters(targetId, hint, count);
      setResults(generated);
      if (generated.length < count) {
        setError(`本次只成功解析出 ${generated.length} 位配角，可直接使用或重新生成。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const patchAt = (index: number, partial: Partial<GeneratedSupportingCharacter>) => {
    setResults(prev => (prev ? prev.map((item, i) => (i === index ? { ...item, ...partial } : item)) : prev));
  };
  const removeAt = (index: number) => {
    setResults(prev => {
      const next = prev ? prev.filter((_, i) => i !== index) : prev;
      return next && next.length > 0 ? next : null; // 全删了就回到生成表单
    });
  };
  const confirmDisabled = busy
    || !results
    || results.length === 0
    || results.some(r => !r.name.trim() || !r.persona.trim());

  return (
    <div
      className="wt-modal"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="wt-paper"
        onClick={e => e.stopPropagation()}
      >
        <div className="wt-paper-tape" />
        <div className="wt-paper-kicker text-center">
          {results ? "REVIEW NPC" : "GENERATE NPC"}
        </div>

        {!results ? (
          <div className="flex flex-col">
            <label className="wt-paper-label">为哪位角色生成配角</label>
            <select className="wt-paper-input" value={targetId} onChange={e => setTargetId(e.target.value)}>
              {characters.map(c => (
                <option key={c.id} value={c.id}>{c.name || "未命名角色"}</option>
              ))}
            </select>
            <label className="wt-paper-label mt-2">生成数量</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`wt-btn flex-1 ${count === n ? "wt-btn-primary" : ""}`}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <label className="wt-paper-label mt-2">补充要求（可选）</label>
            <textarea
              className="wt-paper-textarea"
              style={{ minHeight: 64 }}
              placeholder="例如：生成一个损友 / 她的亲妹妹 / 暗恋她的学长…"
              value={hint}
              onChange={e => setHint(e.target.value)}
            />
            <p className="wt-paper-hint mt-1">会带上 TA 的核心记忆与相关长期记忆——记忆里提过的人是最好的配角素材。</p>
            {error && <p className="wt-paper-confirm mt-2">{error}</p>}

            <div className="wt-paper-actions mt-4">
              <button className="wt-btn flex-1" onClick={onClose} disabled={busy}>取消</button>
              <button
                className="wt-btn wt-btn-primary flex-1"
                onClick={handleGenerate}
                disabled={busy || !targetId}
              >
                {busy ? "生成中…" : "生成"}
              </button>
            </div>
            {characters.length === 0 && <p className="wt-paper-hint mt-2">还没有角色，先创建一位主角。</p>}
          </div>
        ) : (
          <div className="flex flex-col">
            {results.map((result, index) => (
              <div key={index} className={index > 0 ? "mt-4 pt-3" : ""} style={index > 0 ? { borderTop: "1px dashed #c9b98a" } : undefined}>
                <div className="flex items-center">
                  <span className="wt-paper-kicker" style={{ marginBottom: 0 }}>NPC {index + 1} / {results.length}</span>
                  <span className="wt-paper-spacer" />
                  {results.length > 1 && (
                    <button type="button" className="wt-btn wt-btn-danger wt-btn-small" onClick={() => removeAt(index)}>
                      移除
                    </button>
                  )}
                </div>

                <label className="wt-paper-label mt-2">名字</label>
                <input className="wt-paper-input" value={result.name} onChange={e => patchAt(index, { name: e.target.value })} />

                <label className="wt-paper-label mt-2">人设（完整角色卡）</label>
                <textarea
                  className="wt-paper-textarea"
                  style={{ minHeight: 120 }}
                  value={result.persona}
                  onChange={e => patchAt(index, { persona: e.target.value })}
                />

                <label className="wt-paper-label mt-2">性格</label>
                <input className="wt-paper-input" value={result.personality} onChange={e => patchAt(index, { personality: e.target.value })} />

                <label className="wt-paper-label mt-2">简量人设（注入给同世界角色）</label>
                <textarea
                  className="wt-paper-textarea"
                  style={{ minHeight: 64 }}
                  value={result.briefPersona}
                  onChange={e => patchAt(index, { briefPersona: e.target.value })}
                />

                <div className="flex gap-2 mt-2">
                  <div className="flex-1 flex flex-col">
                    <label className="wt-paper-label">TA 是{targetName}的</label>
                    <input className="wt-paper-input" value={result.relationLabel} onChange={e => patchAt(index, { relationLabel: e.target.value })} />
                  </div>
                  <div className="flex-1 flex flex-col">
                    <label className="wt-paper-label">{targetName}是 TA 的</label>
                    <input className="wt-paper-input" value={result.reverseRelationLabel} onChange={e => patchAt(index, { reverseRelationLabel: e.target.value })} />
                  </div>
                </div>
              </div>
            ))}

            <label className="flex items-center gap-2 mt-3 wt-paper-label" style={{ fontWeight: 'normal' }}>
              <input type="checkbox" checked={allowAutoPost} onChange={e => setAllowAutoPost(e.target.checked)} />
              加好友后允许自动发朋友圈（本批全部生效）
            </label>

            {error && <p className="wt-paper-confirm mt-2">{error}</p>}

            <div className="wt-paper-actions mt-4">
              <button className="wt-btn flex-1" onClick={handleGenerate} disabled={busy}>
                {busy ? "生成中…" : "重新生成"}
              </button>
              <button
                className="wt-btn wt-btn-primary flex-1"
                disabled={confirmDisabled}
                onClick={() => results && onConfirm(results, targetId, allowAutoPost)}
              >
                {results.length > 1 ? `确认创建 ${results.length} 位` : "确认创建"}
              </button>
            </div>

            <div className="flex mt-2">
              <button className="wt-btn flex-1" onClick={onClose} disabled={busy}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
