"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, RotateCcw, Save, Users } from "lucide-react";

import type { ForumRules, ForumState } from "@/lib/study-room/forum";
import { normalizeRules, singleDefaultRule, updateForumRules } from "@/lib/study-room/forum-social";
import { HelpFoot } from "./help-tip";

type Field = {
  key: keyof ForumRules;
  label: string;
  kind: "text" | "number" | "toggle";
  rows?: number;
};

type Group = { key: string; label: string; desc: string; fields: Field[] };

/** 五组生成规则：默认开箱可用，普通用户不需要改。 */
const GROUPS: Group[] = [
  {
    key: "feed",
    label: "首页动态生成",
    desc: "控制自动帖子类型、数量、话题和内容边界",
    fields: [
      { key: "feedTypes", label: "自动帖子类型", kind: "text", rows: 2 },
      { key: "feedCount", label: "每次生成几条", kind: "number" },
      { key: "feedScope", label: "内容边界", kind: "text", rows: 2 },
    ],
  },
  {
    key: "search",
    label: "论坛搜索结果",
    desc: "只生成或返回与查询高度相关的内容",
    fields: [{ key: "searchScope", label: "搜索口径", kind: "text", rows: 2 }],
  },
  {
    key: "comment",
    label: "评论与回复",
    desc: "书友要不要自动回、每次几位，以及评论的长度、语气与关系感",
    fields: [
      { key: "autoReply", label: "书友自动回复", kind: "toggle" },
      { key: "replyCount", label: "每次几位回应（1–5）", kind: "number" },
      { key: "commentLength", label: "长度", kind: "text", rows: 2 },
      { key: "commentTone", label: "语气", kind: "text", rows: 2 },
      { key: "commentRelation", label: "关系感", kind: "text", rows: 2 },
      { key: "commentFollowUp", label: "允许继续追问", kind: "toggle" },
    ],
  },
  {
    key: "daily",
    label: "NPC 日常活动",
    desc: "书友发帖、点赞、关注、送礼与加好友的节奏",
    fields: [
      { key: "dailyPosts", label: "每天发帖", kind: "number" },
      { key: "dailyLikes", label: "每天点赞", kind: "number" },
      { key: "dailyFollows", label: "每天关注", kind: "number" },
      { key: "dailyGifts", label: "每天送礼", kind: "number" },
      { key: "dailyFriends", label: "每天加好友", kind: "number" },
    ],
  },
  {
    key: "hot",
    label: "热门话题",
    desc: "近期书籍、作者、类型与阅读话题",
    fields: [{ key: "hotTopics", label: "近期话题", kind: "text", rows: 3 }],
  },
];

type StudyRoomForumSettingsProps = {
  state: ForumState;
  onBack: () => void;
  onMutate: (updater: (prev: ForumState) => ForumState) => void;
  onNotice: (message: string, ms?: number) => void;
  onOpenNpcPanel: () => void;
};

/** 论坛高级设置：每一组都能展开编辑、保存、取消与恢复默认。 */
export function StudyRoomForumSettings({
  state,
  onBack,
  onMutate,
  onNotice,
  onOpenNpcPanel,
}: StudyRoomForumSettingsProps) {
  const [expanded, setExpanded] = useState<string | null>("feed");
  const [draft, setDraft] = useState<ForumRules>(state.rules);
  const [nameDraft, setNameDraft] = useState(state.name);
  const rootRef = useRef<HTMLDivElement>(null);

  // 展开区的最大高度按当前可见高度算（键盘弹出时可见高度会变小）。
  // 只写一个 CSS 变量、不动 state，所以键盘开合和窗口变化都不会重新挂载表单，未保存内容不会丢。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      // 约占可见高度的一半：其余留给标题、动作行和后面几个分组
      const max = Math.max(160, Math.min(420, Math.round(height * 0.46)));
      root.style.setProperty("--sr-rule-max", max + "px");
    };
    apply();
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    return () => {
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  // 别处（书友管理、我的主页）改过规则时跟着更新，草稿不会停在旧值上
  useEffect(() => {
    setDraft(state.rules);
  }, [state.rules]);

  const setField = (key: keyof ForumRules, value: string | number | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }) as ForumRules);
  };

  const saveGroup = (group: Group) => {
    const patch: Partial<ForumRules> = {};
    for (const field of group.fields) {
      (patch as Record<string, unknown>)[field.key] = draft[field.key];
    }
    onMutate((prev) => updateForumRules(prev, normalizeRules({ ...prev.rules, ...patch })));
    onNotice("已保存这一组规则");
  };

  const resetGroup = (group: Group) => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const field of group.fields) {
        (next as Record<string, unknown>)[field.key] = singleDefaultRule(field.key);
      }
      return next;
    });
    onNotice("已改回默认值，点保存后生效");
  };

  /** 取消只放弃这一组没保存的改动，不动其他分组里还没保存的内容。 */
  const cancelGroup = (group: Group) => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const field of group.fields) {
        (next as Record<string, unknown>)[field.key] = state.rules[field.key];
      }
      return next;
    });
    onNotice("已取消这一组的未保存修改");
  };

  return (
    <div className="sr-forum-sub" ref={rootRef}>
      <div className="sr-forum-sub-head">
        <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
          <ChevronLeft size={22} strokeWidth={1.6} />
        </button>
        <span className="sr-forum-sub-title">论坛生成规则</span>
        <button type="button" className="sr-icon-btn" onClick={onOpenNpcPanel} aria-label="书友管理" title="书友管理">
          <Users size={19} strokeWidth={1.7} />
        </button>
      </div>

      <div className="sr-forum-sub-body">
        <div className="sr-appear-row">
          <span className="sr-appear-label">论坛名称</span>
          <input
            className="sr-appear-input"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            aria-label="论坛名称"
          />
          <button
            type="button"
            className="sr-btn sr-btn-sm"
            disabled={!nameDraft.trim() || nameDraft.trim() === state.name}
            onClick={() => {
              onMutate((prev) => ({ ...prev, name: nameDraft.trim() }));
              onNotice("名称已更新");
            }}
          >
            改名
          </button>
        </div>

        <HelpFoot id="forum-rules-about" label="关于生成规则">
          这些规则只影响书友圈自己生成的内容：不填也能正常用，默认值就是开箱可用的那套。
          改完点该组的「保存」才会生效；「取消」丢弃本次改动。
          默认值：{GROUPS.map((group) => group.label).join(" / ")}。全部改回默认不会影响已有的帖子、书友与关注关系。
        </HelpFoot>

        {GROUPS.map((group) => {
          const open = expanded === group.key;
          return (
            <section key={group.key} className="sr-rule-group" data-open={open ? "true" : undefined}>
              <button
                type="button"
                className="sr-rule-head"
                onClick={() => setExpanded(open ? null : group.key)}
                aria-expanded={open}
              >
                <span className="sr-rule-main">
                  <span className="sr-rule-label">{group.label}</span>
                  <span className="sr-note-meta">{group.desc}</span>
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={1.8}
                  style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
                />
              </button>

              {open && (
                <div className="sr-rule-body">
                  <div className="sr-rule-fields">
                  {group.fields.map((field) =>
                    field.kind === "toggle" ? (
                      <div key={field.key} className="sr-appear-row">
                        <span className="sr-appear-label">{field.label}</span>
                        <button
                          type="button"
                          className="sr-chip"
                          data-active={draft[field.key] === true ? "true" : undefined}
                          onClick={() => setField(field.key, !(draft[field.key] === true))}
                        >
                          {draft[field.key] === true ? "开" : "关"}
                        </button>
                      </div>
                    ) : field.kind === "number" ? (
                      <div key={field.key} className="sr-appear-row">
                        <span className="sr-appear-label">{field.label}</span>
                        <input
                          className="sr-appear-input"
                          type="number"
                          min={field.key === "replyCount" ? 1 : 0}
                          max={field.key === "replyCount" ? 5 : 40}
                          value={Number(draft[field.key] ?? 0)}
                          onChange={(event) => setField(field.key, Number(event.target.value))}
                          aria-label={field.label}
                        />
                      </div>
                    ) : (
                      <div key={field.key} style={{ marginBottom: 8 }}>
                        <div className="sr-note-meta" style={{ marginBottom: 4 }}>{field.label}</div>
                        <textarea
                          className="sr-css-editor"
                          rows={field.rows ?? 2}
                          value={String(draft[field.key] ?? "")}
                          onChange={(event) => setField(field.key, event.target.value)}
                          aria-label={field.label}
                        />
                      </div>
                    ),
                  )}
                  </div>

                  <div className="sr-css-actions">
                    <button type="button" className="sr-btn sr-btn-sm" onClick={() => resetGroup(group)}>
                      <RotateCcw size={13} strokeWidth={1.8} />
                      恢复默认
                    </button>
                    <button type="button" className="sr-btn-text" onClick={() => cancelGroup(group)}>
                      取消
                    </button>
                    <button type="button" className="sr-btn sr-btn-sm sr-btn-primary" onClick={() => saveGroup(group)}>
                      <Save size={13} strokeWidth={1.8} />
                      保存
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
