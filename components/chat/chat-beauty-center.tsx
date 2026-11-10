"use client";

import { useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-shell";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { InnerVoiceStylePage } from "@/components/settings/inner-voice-style-page";
import { Check, ChevronRight, Code2, Copy, Layers3, MessageCircle, Palette, Search, Sparkles, UsersRound } from "lucide-react";
import { CHAT_BEAUTY_CLASS_GROUPS, CHAT_BEAUTY_PRESETS, CHAT_BEAUTY_SCOPES, type ChatBeautyScope, loadChatBeauty, saveChatBeauty } from "@/lib/chat-beauty";

type Page = "home" | "online" | "social" | "editor" | "classes" | "tutorial" | "innerVoice";

export function ChatBeautyCenter({ onBack }: { onBack: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const [scope, setScope] = useState<ChatBeautyScope>("room");

  const goEditor = (next: ChatBeautyScope) => { setScope(next); setPage("editor"); };
  const back = () => {
    if (page === "home") return onBack();
    if (page === "editor") return setPage(CHAT_BEAUTY_SCOPES.find(item => item.id === scope)?.group === "online" ? "online" : "social");
    setPage("home");
  };

  return (
    <PageShell title={pageTitle(page)} onBack={back} className="chat-beauty-center">
      {page === "home" && <BeautyHome onOpen={setPage} />}
      {page === "online" && <ScopeList group="online" onOpen={goEditor} />}
      {page === "social" && <ScopeList group="social" onOpen={goEditor} />}
      {page === "editor" && <BeautyEditor key={scope} scope={scope} />}
      {page === "classes" && <ClassReference />}
      {page === "tutorial" && <BeautyTutorial />}
      {page === "innerVoice" && <InnerVoiceStylePage />}
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
  const rows: Array<{ page: Page; title: string; desc: string; icon: typeof Palette }> = [
    { page: "online", title: "聊天与线下美化", desc: "在线聊天室和线下模式分开设置", icon: MessageCircle },
    { page: "social", title: "消息页装饰", desc: "消息、联系人、动态、我的各自独立", icon: UsersRound },
    { page: "innerVoice", title: "心声美化", desc: "改提示词、卡片模板和出现动效", icon: Sparkles },
    { page: "classes", title: "样式类名参考", desc: "可搜索、复制的真实 CSS 选择器", icon: Code2 },
    { page: "tutorial", title: "完整美化教程", desc: "从预设、CSS 到 HTML 装饰层", icon: Sparkles },
  ];
  return (
    <div className="beauty-page-body">
      <section className="beauty-intro-card">
        <span>APPEARANCE LAB</span>
        <h2>每个界面，单独设计。</h2>
        <p>预设、CSS 与 HTML 装饰不会再挤在同一页。旧的全局 CSS 仍然兼容。</p>
      </section>
      <section className="beauty-list-card">
        {rows.map(({ page, title, desc, icon: Icon }) => (
          <button key={page} className="beauty-list-row" onClick={() => onOpen(page)}>
            <span className="beauty-row-icon"><Icon size={22} /></span>
            <span><strong>{title}</strong><small>{desc}</small></span>
            <ChevronRight size={19} />
          </button>
        ))}
      </section>
      <p className="beauty-footnote">应用预设后仍可继续改 CSS；HTML 仅作为无交互装饰层使用，脚本与危险标签会自动移除。</p>
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
    {groups.map(group => <section className="beauty-class-group" key={group.title}><h3>{group.title}</h3>{group.rows.map(([label, selector]) => <button key={`${label}-${selector}`} onClick={() => copy(selector)}><span>{label}</span><code>{selector}</code>{copied === selector ? <Check size={16} /> : <Copy size={16} />}</button>)}</section>)}
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

