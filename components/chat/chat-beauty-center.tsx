"use client";

import { useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { InnerVoiceStylePage } from "@/components/settings/inner-voice-style-page";
import { Check, ChevronRight, Code2, Copy, HelpCircle, Layers3, MessageCircle, Palette, Search, Sparkles, UsersRound, X } from "lucide-react";
import { CHAT_BEAUTY_CLASS_GROUPS, CHAT_BEAUTY_PRESETS, CHAT_BEAUTY_SCOPES, type ChatBeautyScope, loadChatBeauty, saveChatBeauty } from "@/lib/chat-beauty";

const HELP_TEXT: Record<string, string> = {
  "美化": "这里把能改的地方分成三组：聊天、内容、参考。点任意一项进去单独改，改坏了能一键回到预设，其他界面不受影响。",
  "聊天与线下美化": "在线聊天室和线下模式是两套外观，分开保存。进错组不会影响另一个。",
  "消息页装饰": "消息列表、联系人、动态、我的，四个页面各自独立；在里面写 CSS 只作用于那一个页面。",
  "心声美化": "决定角色「心里那句话」怎么写、卡片长什么样、出现时用什么动效。可以建多套来回切。",
  "样式类名参考": "列出项目里真实使用的选择器，每行下面写着它管哪块。点一行复制，贴到自定义 CSS 里就能改那一块。",
  "完整美化教程": "五步走完一遍：选界面、挑预设、写 CSS、加装饰、存成自己的预设。",
  "编辑美化": "这里写当前这个界面的 CSS。右下角保存只存这个界面；想给别的界面用，先切到那个界面再写。",
};

type Page = "home" | "online" | "social" | "editor" | "classes" | "tutorial" | "innerVoice";

export function ChatBeautyCenter({ onBack }: { onBack: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const [scope, setScope] = useState<ChatBeautyScope>("room");
  const [help, setHelp] = useState<string | null>(null);

  const goEditor = (next: ChatBeautyScope) => { setScope(next); setPage("editor"); };
  const back = () => {
    if (page === "home") return onBack();
    if (page === "editor") return setPage(CHAT_BEAUTY_SCOPES.find(item => item.id === scope)?.group === "online" ? "online" : "social");
    setPage("home");
  };

  return (
    <PageShell
      title={pageTitle(page)}
      onBack={back}
      className="chat-beauty-center"
      rightAction={
        <button type="button" className="beauty-help-btn" aria-label="说明" onClick={() => setHelp(pageTitle(page))}>
          <HelpCircle size={22} strokeWidth={1.6} />
        </button>
      }
    >
      {page === "home" && <BeautyHome onOpen={setPage} />}
      {page === "online" && <ScopeList group="online" onOpen={goEditor} />}
      {page === "social" && <ScopeList group="social" onOpen={goEditor} />}
      {page === "editor" && <BeautyEditor key={scope} scope={scope} />}
      {page === "classes" && <ClassReference />}
      {page === "tutorial" && <BeautyTutorial />}
      {page === "innerVoice" && <InnerVoiceStylePage />}
      {help ? (
        <div className="beauty-help-backdrop" onClick={() => setHelp(null)}>
          <div className="beauty-help-card" onClick={e => e.stopPropagation()}>
            <div className="beauty-help-head">
              <b>{help}</b>
              <button type="button" aria-label="关闭" onClick={() => setHelp(null)}><X size={18} strokeWidth={1.8} /></button>
            </div>
            <p>{HELP_TEXT[help] || "这一页能改的东西都在下面，改完只会影响对应界面。"}</p>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function pageTitle(page: Page) {
  if (page === "online") return "聊天与线下美化";
  if (page === "social") return "消息页装饰";
  if (page === "classes") return "样式类名参考";
  if (page === "tutorial") return "完整美化教程";
  if (page === "innerVoice") return "心声美化";
  if (page === "editor") return "编辑美化";
  return "美化";
}

function BeautyHome({ onOpen }: { onOpen: (page: Page) => void }) {
  const [group, setGroup] = useState<"chat" | "content" | "ref">("chat");
  const rows: Array<{ page: Page; title: string; desc: string; icon: typeof Palette; group: "chat" | "content" | "ref"; tint: string; ink: string }> = [
    { page: "online", title: "聊天与线下美化", desc: "气泡、背景、输入栏，分开设置", icon: MessageCircle, group: "chat", tint: "#E8F6EC", ink: "#22A85A" },
    { page: "social", title: "消息页装饰", desc: "列表、联系人、动态、我的", icon: UsersRound, group: "chat", tint: "#E9F0FE", ink: "#2F80ED" },
    { page: "innerVoice", title: "心声美化", desc: "写法、卡片模板、出现动效", icon: Sparkles, group: "content", tint: "#FCEBF3", ink: "#D83F87" },
    { page: "classes", title: "样式类名参考", desc: "可复制的选择器，带中文说明", icon: Code2, group: "ref", tint: "#F1ECFD", ink: "#7C3AED" },
    { page: "tutorial", title: "完整美化教程", desc: "五步走完一遍", icon: Layers3, group: "ref", tint: "#FDF2E6", ink: "#D88B2A" },
  ];
  const list = rows.filter(row => row.group === group);
  return (
    <div className="beauty-page-body">
      <section className="beauty-hero">
        <span className="beauty-hero-kicker">APPEARANCE LAB</span>
        <h2>把界面改成你的</h2>
        <p>选一个界面单独改，其他界面保持原样。</p>
      </section>

      <div className="beauty-tabs" role="tablist">
        {([["chat", "聊天"], ["content", "内容"], ["ref", "参考"]] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={group === key}
            className={`beauty-tab${group === key ? " is-on" : ""}`}
            onClick={() => setGroup(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="beauty-list">
        {list.map(({ page, title, desc, icon: Icon, tint, ink }) => (
          <button key={page} className="beauty-item" onClick={() => onOpen(page)}>
            <span className="beauty-item-icon" style={{ background: tint, color: ink }}><Icon size={20} strokeWidth={1.8} /></span>
            <span className="beauty-item-text">
              <strong>{title}</strong>
              <small>{desc}</small>
            </span>
            <ChevronRight size={18} strokeWidth={1.7} className="beauty-item-chev" />
          </button>
        ))}
      </section>
    </div>
  );
}

function ScopeList({ group, onOpen }: { group: "online" | "social"; onOpen: (scope: ChatBeautyScope) => void }) {
  const items = CHAT_BEAUTY_SCOPES.filter(item => item.group === group);
  return (
    <div className="beauty-page-body">
      <p className="beauty-section-label">{group === "online" ? "聊天场景" : "独立页面"}</p>
      <section className="beauty-scope-grid">
        {items.map(item => {
          const saved = loadChatBeauty(item.id);
          return (
            <button key={item.id} className="beauty-scope-card" onClick={() => onOpen(item.id)}>
              <span className="beauty-scope-status">{saved.css || saved.html ? "已应用" : "默认"}</span>
              <strong>{item.title}</strong>
              <p>{item.subtitle}</p>
              <span className="beauty-scope-link">打开编辑 <ChevronRight size={15} /></span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function BeautyEditor({ scope }: { scope: ChatBeautyScope }) {
  const info = CHAT_BEAUTY_SCOPES.find(item => item.id === scope)!;
  const initial = loadChatBeauty(scope);
  const [css, setCSS] = useState(initial.css);
  const [html, setHTML] = useState(initial.html);
  const [mode, setMode] = useState<"preset" | "css" | "html">("preset");
  const [saved, setSaved] = useState(false);
  const apply = () => { saveChatBeauty(scope, css, html); setSaved(true); window.setTimeout(() => setSaved(false), 1200); };
  return (
    <div className="beauty-page-body beauty-editor-page">
      <section className="beauty-editor-heading"><span>{info.title}</span><p>{info.subtitle}</p></section>
      <div className="beauty-segmented">
        {(["preset", "css", "html"] as const).map(id => <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{id === "preset" ? "预设" : id.toUpperCase()}</button>)}
      </div>
      {mode === "preset" && <section className="beauty-preset-stack">
        {CHAT_BEAUTY_PRESETS[scope].map(preset => <button key={preset.name} className="beauty-preset-card" onClick={() => { setCSS(preset.css); setMode("css"); }}><span><Layers3 size={20} /><strong>{preset.name}</strong></span><small>载入后可继续编辑</small><ChevronRight size={18} /></button>)}
      </section>}
      {mode === "css" && <>
        <p className="beauty-editor-help">只作用于“{info.title}”。支持普通 CSS 与 HTTPS 图片地址。</p>
        <textarea className="beauty-code-editor" value={css} onChange={e => setCSS(e.target.value)} placeholder={`/* ${info.title} CSS */\n${info.selector} { }`} spellCheck={false} />
        <div className="beauty-scheme-row"><CSSSchemeBar target={`chat_beauty_${scope}`} currentCSS={css} onLoad={setCSS} /><span>保存 / 载入 / 导入这一类的方案</span></div>
      </>}
      {mode === "html" && <>
        <p className="beauty-editor-help">HTML 会放进此页面的透明装饰层。建议只用 div、span、img、svg；它不会挡住点击。</p>
        <textarea className="beauty-code-editor" value={html} onChange={e => setHTML(e.target.value)} placeholder={'<div class="my-decoration">Hold me</div>'} spellCheck={false} />
      </>}
      <div className="beauty-editor-actions"><button onClick={() => { setCSS(""); setHTML(""); }}>清空</button><button className="primary" onClick={apply}>{saved ? <><Check size={17} /> 已应用</> : "应用到此界面"}</button></div>
    </div>
  );
}

function ClassReference() {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const groups = useMemo(() => CHAT_BEAUTY_CLASS_GROUPS.map(group => ({ ...group, rows: group.rows.filter(row => `${row[0]} ${row[1]}`.toLowerCase().includes(query.toLowerCase())) })).filter(group => group.rows.length), [query]);
  const copy = async (value: string) => { await navigator.clipboard?.writeText(value); setCopied(value); window.setTimeout(() => setCopied(""), 1000); };
  return <div className="beauty-page-body">
    <label className="beauty-search"><Search size={20} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜类名或说明（所有分类一起找）" /></label>
    <p className="beauty-footnote">点一行复制。这里列的是当前项目实际使用的入口；给 AI 时可以直接附上类名。</p>
    {groups.map(group => <section className="beauty-class-group" key={group.title}><h3>{group.title}</h3>{group.rows.map(([label, selector, hint]) => <button key={`${label}-${selector}`} onClick={() => copy(selector)}><span>{label}<small className="beauty-class-hint">{hint}</small></span><code>{selector}</code>{copied === selector ? <Check size={16} /> : <Copy size={16} />}</button>)}</section>)}
  </div>;
}

function BeautyTutorial() {
  return <div className="beauty-page-body beauty-tutorial">
    <section><span>01</span><div><h3>先选对界面</h3><p>消息、联系人、动态、我的、聊天室和线下模式分别保存。先进入对应分类，再选择预设或写代码。</p></div></section>
    <section><span>02</span><div><h3>从预设开始</h3><p>预设是可编辑的起点。点预设会把代码载入 CSS 页，不会影响其他界面。</p></div></section>
    <section><span>03</span><div><h3>写 CSS</h3><p>在“样式类名参考”复制选择器。尽量使用百分比、clamp() 和 max-width；需要覆盖内置样式时再加 !important。</p><code>{`.chat-bubble-role-user {\n  background:#171719 !important;\n  color:#fff !important;\n}`}</code></div></section>
    <section><span>04</span><div><h3>加静态 HTML 装饰</h3><p>HTML 适合标题、贴纸、边框和氛围文字。先写结构，再用同一分类里的 CSS 定位。</p><code>{`<div class="my-title">No one but you</div>\n\n.my-title { position:absolute; top:24px; }`}</code></div></section>
    <section><span>05</span><div><h3>保存为自己的预设</h3><p>CSS 编辑页的保存按钮只保存当前分类。横竖屏、320/375/430px 宽度都建议检查一次。</p></div></section>
  </div>;
}

