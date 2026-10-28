"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, FileUp, LayoutTemplate, PenLine, Sparkles, X } from "lucide-react";

import type { Character } from "@/lib/character-types";
import type { WorldBookConfig } from "@/lib/settings-types";
import { loadBindingConfig, resolveBinding } from "@/lib/settings-storage";
import { CREATIVE_TEMPLATES, createDraft, type CreativeDraft, type WorkKind } from "@/lib/study-room/creative";
import {
  STRENGTH_LABEL,
  fetchBuiltinStyles,
  loadUserStyles,
  type StyleMeta,
  type StyleStrength,
} from "@/lib/study-room/writing-styles-client";
import type { InspirationNote } from "@/lib/study-room/inspiration";
import { HelpTip } from "./help-tip";

/** 创作方式：导入在第一步直接选文件，不走后面三步 */
export type StartMode = "ai" | "hand" | "template";
type Form = "novel" | "short" | "script" | "essay";
type Resource = "cast" | "outline" | "material" | "idea";

const MODES: Array<{ key: StartMode | "import"; label: string; desc: string; icon: React.ReactNode }> = [
  { key: "ai", label: "AI 帮我写", desc: "先定大纲，AI 一章章写，你随时改", icon: <Sparkles size={18} strokeWidth={1.7} /> },
  { key: "hand", label: "我自己写", desc: "只保存你写的字，不会调用模型", icon: <PenLine size={18} strokeWidth={1.7} /> },
  { key: "import", label: "导入已有文稿", desc: "把 txt / md / docx 变成草稿接着改", icon: <FileUp size={18} strokeWidth={1.7} /> },
  { key: "template", label: "从题材模板开始", desc: "套用现成题材：题材名、写法提示和标签先填好", icon: <LayoutTemplate size={18} strokeWidth={1.7} /> },
];

const FORMS: Array<{ key: Form; label: string; desc: string; templateId: string }> = [
  { key: "novel", label: "长篇", desc: "分章连载，有大纲与章末记忆", templateId: "longform" },
  { key: "short", label: "短篇", desc: "一篇写完，起承转合紧凑", templateId: "shortstory" },
  { key: "script", label: "剧本", desc: "以对白与动作提示为主", templateId: "script" },
  { key: "essay", label: "散文", desc: "第一人称，细节具体", templateId: "essay" },
];

/** 题材按形式给；templateId 只在「模板」方式下用来带入整套设定 */
const GENRES: Record<Form, Array<{ label: string; templateId?: string }>> = {
  novel: [
    { label: "都市日常", templateId: "urban" },
    { label: "悬疑推理", templateId: "mystery" },
    { label: "奇幻冒险", templateId: "fantasy" },
    { label: "言情", templateId: "romance" },
    { label: "科幻", templateId: "scifi" },
  ],
  short: [
    { label: "日常", templateId: "urban" },
    { label: "悬疑", templateId: "mystery" },
    { label: "奇幻", templateId: "fantasy" },
    { label: "言情", templateId: "romance" },
    { label: "科幻", templateId: "scifi" },
  ],
  script: [{ label: "舞台剧" }, { label: "广播剧" }, { label: "短剧" }, { label: "影视分场" }],
  essay: [{ label: "记事" }, { label: "写景" }, { label: "读书随笔" }, { label: "书信" }],
};

const WORD_OPTIONS: Record<Form, number[]> = {
  novel: [1500, 2500, 4000],
  short: [3000, 6000, 10000],
  script: [1500, 2200, 3500],
  essay: [800, 1500, 3000],
};
const CHAPTER_OPTIONS = [5, 10, 20, 40];

const STEP_TITLES = ["怎么开始", "写成什么", "写什么", "怎么写", "参考资料"] as const;
const LAST_STEP = STEP_TITLES.length - 1;

/** 题材模板（真实预设，见 lib/study-room/creative.ts），模板方式下按卡片列出 */
const GENRE_TEMPLATES = CREATIVE_TEMPLATES.filter((item) => item.fields.genre);

export type DeskStartInitial = { characterId?: string };

type Props = {
  characters: Character[];
  worldBooks: WorldBookConfig[];
  inspirations: InspirationNote[];
  initial?: DeskStartInitial;
  onCreate: (draft: CreativeDraft) => void;
  onImport: (file: File) => void;
  onClose: () => void;
};

/**
 * 开始创作：五步——怎么开始 → 写成什么 → 写什么（题材）→ 怎么写（文风）→ 参考资料。
 * 每一步都能返回上一步改；资源都是可选的，不选也能开始。
 */
export function StudyRoomDeskStart({ characters, worldBooks, inspirations, initial, onCreate, onImport, onClose }: Props) {
  const [step, setStep] = useState(initial?.characterId ? 1 : 0);
  const [mode, setMode] = useState<StartMode>("ai");
  const [form, setForm] = useState<Form>("novel");
  const [words, setWords] = useState(2500);
  const [chapters, setChapters] = useState(10);
  const [genre, setGenre] = useState<{ label: string; templateId?: string } | null>(null);
  const [customGenre, setCustomGenre] = useState("");
  const [openResource, setOpenResource] = useState<Resource | null>(initial?.characterId ? "cast" : null);
  const [characterId, setCharacterId] = useState<string | undefined>(initial?.characterId);
  const [outline, setOutline] = useState("");
  const [material, setMaterial] = useState("");
  const [ideaIds, setIdeaIds] = useState<string[]>([]);
  // 文风（写法）：和题材分开选；不选就是不指定
  const [builtinStyles, setBuiltinStyles] = useState<StyleMeta[] | null>(null);
  const userStyles = useMemo(() => loadUserStyles(), []);
  const [stylePick, setStylePick] = useState<{ kind: "builtin" | "user"; id: string } | null>(null);
  const [strength, setStrength] = useState<StyleStrength>("standard");
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 角色来写时自动带上的世界书（角色在「共创」里的绑定），这里只显示，不用再选
  const castWorldBookNote = (id: string) => {
    const ids = resolveBinding(loadBindingConfig(), id, "cocreate").worldBookIds ?? [];
    const names = worldBooks.filter((book) => ids.includes(book.id)).map((book) => book.name);
    return names.length > 0 ? `会自动带上 TA 绑定的世界书：${names.join("、")}` : "TA 没有绑定世界书，不带也能写";
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBuiltinStyles(controller.signal).then((list) => {
      if (!controller.signal.aborted) setBuiltinStyles(list);
    });
    return () => controller.abort();
  }, []);

  // 换步骤时把焦点放到面板上，读屏能读出新的一步
  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);

  const pickForm = (next: Form) => {
    setForm(next);
    setWords(WORD_OPTIONS[next][1]);
    setGenre(null);
  };

  const ai = mode !== "hand";
  const genreLabel = customGenre.trim() || genre?.label || "";

  const styleName =
    stylePick?.kind === "builtin"
      ? builtinStyles?.find((item) => item.id === stylePick.id)?.name
      : stylePick?.kind === "user"
        ? userStyles.find((item) => item.id === stylePick.id)?.name
        : undefined;

  const summary = useMemo(() => {
    const parts = [
      MODES.find((m) => m.key === mode)?.label,
      FORMS.find((f) => f.key === form)?.label,
      genreLabel || "题材待定",
      styleName ? `文风：${styleName}` : "",
    ];
    return parts.filter(Boolean).join(" · ");
  }, [mode, form, genreLabel, styleName]);

  const create = () => {
    const formInfo = FORMS.find((item) => item.key === form)!;
    // 模板方式：用题材模板带入整套设定，再按所选形式改形态与篇幅
    const useGenreTemplate = mode === "template" && genre?.templateId;
    const base = createDraft(useGenreTemplate ? genre!.templateId : formInfo.templateId);
    const finished = form === "short" || form === "essay";
    const pickedIdeas = inspirations.filter((item) => ideaIds.includes(item.id)).map((item) => `- ${item.text}`);
    const extra = [
      base.extra,
      material.trim() ? `素材：${material.trim()}` : "",
      pickedIdeas.length > 0 ? `灵感：\n${pickedIdeas.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const castMode = ai && characterId;
    const draft: CreativeDraft = {
      ...base,
      kind: form as WorkKind,
      genre: genreLabel || base.genre,
      style: form === "script" || form === "essay" ? createDraft(formInfo.templateId).style ?? base.style : base.style,
      serialization: finished ? "finished" : "serial",
      targetWords: words,
      plannedChapters: finished ? 1 : chapters,
      outline: outline.trim() || base.outline,
      extra: extra || undefined,
      writeMode: mode === "hand" ? "hand" : "ai",
      styleId: stylePick?.kind === "builtin" ? stylePick.id : undefined,
      userStyleId: stylePick?.kind === "user" ? stylePick.id : undefined,
      styleStrength: stylePick ? strength : undefined,
      writer: castMode
        ? // 世界书不在这里选：自动跟随角色在「共创」里的绑定；作品里的「写作设置」可以再改
          { ...base.writer, mode: "character", characterId, worldBookIds: undefined }
        : { ...base.writer, mode: "assistant", worldBookIds: undefined },
    };
    onCreate(draft);
  };

  const resourceRow = (key: Resource, label: string, value: string) => (
    <button
      type="button"
      className="sr-dstart-res"
      onClick={() => setOpenResource((current) => (current === key ? null : key))}
      aria-expanded={openResource === key}
    >
      <span className="sr-dstart-res-label">{label}</span>
      <span className="sr-dstart-res-value">{value}</span>
      <ChevronDown size={15} strokeWidth={1.8} data-open={openResource === key || undefined} aria-hidden />
    </button>
  );

  const chip = (active: boolean, label: string, onClick: () => void, key?: string | number) => (
    <button key={key ?? label} type="button" className="sr-chip" data-active={active ? "true" : undefined} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="sr-sheet-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="sr-sheet sr-sheet--tall sr-dstart"
        role="dialog"
        aria-modal="true"
        aria-label={`开始创作，第 ${step + 1} 步，共 ${STEP_TITLES.length} 步：${STEP_TITLES[step]}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sr-dstart-head">
          {step > 0 ? (
            <button type="button" className="sr-icon-btn" onClick={() => setStep(step - 1)} aria-label="上一步">
              <ChevronLeft size={21} strokeWidth={1.7} />
            </button>
          ) : (
            <span style={{ width: 44 }} aria-hidden />
          )}
          <span className="sr-dstart-title">开始创作</span>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} strokeWidth={1.7} />
          </button>
        </div>

        <ol className="sr-dstart-steps" aria-label="步骤">
          {STEP_TITLES.map((title, index) => (
            <li key={title} data-state={index < step ? "done" : index === step ? "now" : undefined} aria-current={index === step ? "step" : undefined}>
              <span className="sr-dstart-bar" aria-hidden />
              <span className="sr-dstart-step-name">{title}</span>
            </li>
          ))}
        </ol>

        <div className="sr-dstart-body">
          {step === 0 && (
            <>
              <div className="sr-dstart-label">
                怎么写
                <HelpTip id="desk-step-mode" label="创作方式说明">
                  这一步决定谁来写。AI 帮我写：先定大纲，AI 一章章生成，每章写完留一份章末记忆，接着写不失忆，后面还能选角色来当作者；
                  我自己写：只保存你写的字，不会自己调用模型，后面也不用选角色；导入：直接选文件，变成草稿接着改；
                  从题材模板开始：下一步会列出现成的题材模板，选中后题材名、写法提示和标签先填好，进去全都能改。
                </HelpTip>
              </div>
              <div className="sr-dstart-options" role="radiogroup" aria-label="创作方式">
                {MODES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={item.key !== "import" && mode === item.key}
                    className="sr-dstart-option"
                    data-active={item.key !== "import" && mode === item.key ? "true" : undefined}
                    onClick={() => {
                      if (item.key === "import") {
                        fileRef.current?.click();
                        return;
                      }
                      setMode(item.key);
                      setStep(1);
                    }}
                  >
                    <span className="sr-dstart-option-icon" aria-hidden>{item.icon}</span>
                    <span className="sr-dstart-option-main">
                      <span className="sr-dstart-option-name">{item.label}</span>
                      <span className="sr-note-meta">{item.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.docx,text/plain"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onImport(file);
                }}
              />
            </>
          )}

          {step === 1 && (
            <>
              <div className="sr-dstart-label">
                写成什么
                <HelpTip id="desk-step-form" label="作品形式说明">
                  长篇按章连载，会用到大纲、章末记忆与连贯检查；短篇和散文一篇写完；剧本以对白和动作提示为主。之后在作品里还能改。
                </HelpTip>
              </div>
              <div className="sr-dstart-options sr-dstart-options--grid" role="radiogroup" aria-label="作品形式">
                {FORMS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={form === item.key}
                    className="sr-dstart-option"
                    data-active={form === item.key ? "true" : undefined}
                    onClick={() => pickForm(item.key)}
                  >
                    <span className="sr-dstart-option-main">
                      <span className="sr-dstart-option-name">{item.label}</span>
                      <span className="sr-note-meta">{item.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="sr-filter-row">
                <span className="sr-filter-label">{form === "novel" || form === "script" ? "每章字数" : "字数"}</span>
                <div className="sr-chip-row">
                  {WORD_OPTIONS[form].map((value) => chip(words === value, `约 ${value}`, () => setWords(value), value))}
                </div>
              </div>
              {(form === "novel" || form === "script") && (
                <div className="sr-filter-row">
                  <span className="sr-filter-label">计划章数</span>
                  <div className="sr-chip-row">
                    {CHAPTER_OPTIONS.map((value) => chip(chapters === value, `${value} 章`, () => setChapters(value), value))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="sr-dstart-label">
                {mode === "template" ? "选一个题材模板" : "写什么题材"}
                <HelpTip id="desk-step-genre" label="题材说明">
                  题材说的是写什么（都市、悬疑、言情…），和下一步的文风（怎么写）是两回事。
                  {mode === "template"
                    ? "选模板会把题材名、一句写法提示和标签填进设定；剧本、散文暂时没有题材模板，只写题材名。"
                    : "题材是给 AI 和你自己的方向提示，不选也可以，进去再定。"}
                </HelpTip>
              </div>
              {mode === "template" && (form === "novel" || form === "short") ? (
                <div className="sr-dstart-options" role="radiogroup" aria-label="题材模板">
                  {GENRE_TEMPLATES.map((template) => {
                    const active = !customGenre.trim() && genre?.templateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className="sr-dstart-option"
                        data-active={active ? "true" : undefined}
                        onClick={() => {
                          setCustomGenre("");
                          setGenre(active ? null : { label: template.fields.genre ?? template.name, templateId: template.id });
                        }}
                      >
                        <span className="sr-dstart-option-main">
                          <span className="sr-dstart-option-name">{template.name}</span>
                          <span className="sr-note-meta">{template.desc}</span>
                          {template.fields.style && <span className="sr-note-meta">写法提示：{template.fields.style}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="sr-chip-row">
                  {GENRES[form].map((item) =>
                    chip(
                      !customGenre.trim() && genre?.label === item.label,
                      item.label,
                      () => {
                        setCustomGenre("");
                        setGenre(genre?.label === item.label ? null : { label: item.label });
                      },
                      item.label,
                    ),
                  )}
                </div>
              )}
              <input
                className="sr-appear-input sr-dstart-input"
                value={customGenre}
                onChange={(event) => setCustomGenre(event.target.value)}
                placeholder="或者自己写一个题材"
                aria-label="自定题材"
              />
            </>
          )}

          {step === 3 && (
            <>
              <div className="sr-dstart-label">
                用什么文风
                <HelpTip id="desk-step-style" label="文风说明">
                  文风管怎么写：句子长短、语气、叙述方式；不改人物设定和剧情。内置文风的规则在服务端，不会下发；「我的文风」只存在这台手机上。
                  不选就不指定，进作品后在「设定 → 文风」里随时能换。
                </HelpTip>
              </div>
              {mode === "hand" && <p className="sr-note-meta sr-dstart-note">自己写时不会调用模型；这里选的文风会记在作品上，之后让 AI 续写时才用到。</p>}
              <div className="sr-dstart-options" role="radiogroup" aria-label="文风">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!stylePick}
                  className="sr-dstart-option"
                  data-active={!stylePick ? "true" : undefined}
                  onClick={() => setStylePick(null)}
                >
                  <span className="sr-dstart-option-main">
                    <span className="sr-dstart-option-name">不指定</span>
                    <span className="sr-note-meta">按题材和设定自然写</span>
                  </span>
                </button>
                {builtinStyles === null ? (
                  <p className="sr-note-meta">正在读取内置文风…</p>
                ) : builtinStyles.length === 0 ? (
                  <p className="sr-note-meta">内置文风暂时读不到（可能是网络问题），进作品后可以在「设定 → 文风」里再选。</p>
                ) : (
                  builtinStyles.map((style) => {
                    const active = stylePick?.kind === "builtin" && stylePick.id === style.id;
                    return (
                      <button
                        key={style.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className="sr-dstart-option"
                        data-active={active ? "true" : undefined}
                        onClick={() => setStylePick({ kind: "builtin", id: style.id })}
                      >
                        <span className="sr-dstart-option-main">
                          <span className="sr-dstart-option-name">{style.name}</span>
                          <span className="sr-note-meta">{style.brief ?? style.summary}</span>
                          <span className="sr-note-meta">{style.origin ?? "仪仪原创原创"}</span>
                        </span>
                      </button>
                    );
                  })
                )}
                {userStyles.map((style) => {
                  const active = stylePick?.kind === "user" && stylePick.id === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className="sr-dstart-option"
                      data-active={active ? "true" : undefined}
                      onClick={() => setStylePick({ kind: "user", id: style.id })}
                    >
                      <span className="sr-dstart-option-main">
                        <span className="sr-dstart-option-name">{style.name}</span>
                        <span className="sr-note-meta">{style.summary} · 我的文风</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {stylePick && (
                <div className="sr-filter-row">
                  <span className="sr-filter-label">浓淡</span>
                  <div className="sr-chip-row">
                    {(["light", "standard", "dense"] as StyleStrength[]).map((level) =>
                      chip(strength === level, STRENGTH_LABEL[level], () => setStrength(level), level),
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div className="sr-dstart-label">
                参考资料（都可以不选）
                <HelpTip id="desk-step-resource" label="参考资料说明">
                  这一步是写的时候参考哪些设定。角色：让一位角色以作者身份来写，会自动带上 TA 的人设与绑定的世界书，不用再选；
                  写作助手默认不带世界书，需要时进作品后在「写作设置」里关联；
                  大纲：已经有就贴进来，没有进去可以让 AI 先给一版；素材与灵感：会写进「补充要求」，生成时参考。
                  这些设定只在书房写书时使用，不会带进平时的聊天。
                </HelpTip>
              </div>
              <div className="sr-dstart-resources">
                {ai &&
                  resourceRow(
                    "cast",
                    "角色",
                    characterId ? `${characters.find((c) => c.id === characterId)?.name ?? "角色"} 来写` : characters.length > 0 ? "写作助手来写" : "还没有角色",
                  )}
                {openResource === "cast" && ai && (
                  <div className="sr-dstart-panel">
                    {characters.length === 0 ? (
                      <p className="sr-note-meta">小手机里还没有角色，先用写作助手写。</p>
                    ) : (
                      <>
                        <div className="sr-desk-cast">
                          {characters.map((character) => (
                            <button
                              key={character.id}
                              type="button"
                              className="sr-desk-cast-item"
                              onClick={() => setCharacterId(characterId === character.id ? undefined : character.id)}
                              aria-pressed={characterId === character.id}
                              data-active={characterId === character.id ? "true" : undefined}
                            >
                              <span className="sr-desk-cast-avatar" aria-hidden>
                                {character.avatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={character.avatar} alt="" />
                                ) : (
                                  character.name.slice(0, 1)
                                )}
                              </span>
                              <span className="sr-desk-cast-name">{character.name}</span>
                            </button>
                          ))}
                        </div>
                        {characterId && (
                          <p className="sr-note-meta">{castWorldBookNote(characterId)}</p>
                        )}
                      </>
                    )}
                  </div>
                )}


                {resourceRow("outline", "大纲", outline.trim() ? `${outline.trim().length} 字` : ai ? "进去再写或让 AI 给一版" : "进去再写")}
                {openResource === "outline" && (
                  <div className="sr-dstart-panel">
                    <textarea
                      className="sr-css-editor"
                      rows={4}
                      value={outline}
                      onChange={(event) => setOutline(event.target.value)}
                      placeholder="已经有大纲就贴在这里：一幕一段"
                      aria-label="大纲"
                    />
                  </div>
                )}

                {resourceRow("material", "素材", material.trim() ? `${material.trim().length} 字` : "不带")}
                {openResource === "material" && (
                  <div className="sr-dstart-panel">
                    <textarea
                      className="sr-css-editor"
                      rows={3}
                      value={material}
                      onChange={(event) => setMaterial(event.target.value)}
                      placeholder="设定、人物、参考片段、必须出现的场景…"
                      aria-label="素材"
                    />
                  </div>
                )}

                {resourceRow("idea", "灵感", ideaIds.length > 0 ? `已选 ${ideaIds.length} 条` : inspirations.length > 0 ? `${inspirations.length} 条便签可选` : "还没有便签")}
                {openResource === "idea" && (
                  <div className="sr-dstart-panel">
                    {inspirations.length === 0 ? (
                      <p className="sr-note-meta">还没有便签，书桌「工具 → 灵感便签」里可以随手记。</p>
                    ) : (
                      <ul className="sr-dstart-ideas">
                        {inspirations.map((item) => {
                          const on = ideaIds.includes(item.id);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                className="sr-dstart-idea"
                                data-on={on || undefined}
                                onClick={() => setIdeaIds((list) => (on ? list.filter((id) => id !== item.id) : [...list, item.id]))}
                              >
                                <span className="sr-dstart-check" aria-hidden>{on && <Check size={13} strokeWidth={2.4} />}</span>
                                <span className="sr-dstart-idea-text">{item.text}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {step > 0 && (
          <div className="sr-dstart-foot">
            <span className="sr-note-meta sr-dstart-summary">{summary}</span>
            {step < LAST_STEP ? (
              <button type="button" className="sr-btn sr-btn-primary" onClick={() => setStep(step + 1)}>
                下一步
              </button>
            ) : (
              <button type="button" className="sr-btn sr-btn-primary" onClick={create}>
                <Sparkles size={16} strokeWidth={1.8} />
                开始写
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
