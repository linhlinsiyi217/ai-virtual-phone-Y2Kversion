/**
 * 心声美化：用户可自定义提示词、字段与 HTML 模板。
 * 默认两套：日常（增强版）、小剧场。数据存本机，可导出/导入 JSON。
 */

export type InnerVoiceField = { key: string; hint: string };

export type InnerVoiceStyle = {
    id: string;
    name: string;
    prompt: string;
    scenePrompt: string;
    fields: InnerVoiceField[];
    html: string;
    motion: "fade" | "rise" | "spring" | "none";
};

const STORE_KEY = "y2k:inner-voice-styles";
const ACTIVE_KEY = "y2k:inner-voice-active";

export const DEFAULT_PROMPT = `这是{{char}}此刻脑子里真实闪过的东西——不是台词，不是旁白，也不是写给别人看的文案。
它和{{char}}刚说出口的话可以不一致：说得好听但心里嫌麻烦，或者嘴上冷淡心里其实松了口气，都正常。

【从哪儿起手】
只从这一轮里一个具体的点起手，三选一：
1. {{user}}刚刚说的某一句话（引用其中的词，别复述整句）
2. {{char}}自己上一条发出去之后的后知后觉
3. 当下的身体和处境：几点、饿不饿、手上那件事做到一半

【强度】
大多数轮次是低强度：走神、嫌烦、想睡、惦记一件小事。
情绪有多大就写多大——三分高兴就写三分，不要抬成「心动了」。
允许这一轮和{{user}}完全无关。

【认知边界】
只用{{char}}自己知道的信息。可以猜{{user}}在想什么，但那是猜：会猜错。

【语言】
{{char}}平时想事情的词，大白话，可以不成句、可以跑题、可以自相矛盾。
长度 10–60 字，一到两句。

【禁止】
言情腔与金句、身体模板与网文比喻、总结分析腔、用省略号堆情绪、把上一轮心声改写再来一次。

【字段】
心情 2–6 字；心声 10–60 字；好感度 0–100 整数，大多数轮次不变或只动 1–2 点。`;

export const DEFAULT_SCENE_PROMPT = `这是{{char}}在「{{场景名}}」这一刻脑子里真实闪过的东西。
场景已经给了时间和地点，心声必须落在这个时空里：看得见的东西、听得到的声音、在场的人、手上的道具，至少沾到一样。

只对「这一刻」有反应，不预告后面会怎样，不总结这一幕的意义。
如果{{user}}刚说了一句带指令或试探的话，心声要接住它，但可以接歪。
允许心声和说出口的台词相反。
不写「我知道这是演戏」「这是一段剧情」这类跳出感。

长度 8–45 字，一到两句。禁止复述剧情、解释动机、抒情长句。

字段：心情 2–6 字；心声 8–45 字；好感度 0–100 整数。`;

export const DEFAULT_HTML = `<div class="ivx-card">
  <div class="ivx-top">
    <img class="ivx-face" src="{{charAvatar}}" alt="">
    <div class="ivx-who">
      <div class="ivx-name">{{char}}</div>
      <div class="ivx-time">{{time}}</div>
    </div>
    <span class="ivx-mood">{{心情}}</span>
  </div>
  <div class="ivx-say">{{心声}}</div>
  <div class="ivx-fav">
    <span>好感度</span>
    <span class="ivx-track"><span class="ivx-fill" style="width:{{好感度}}%"></span></span>
    <span class="ivx-num">{{好感度}}</span>
  </div>
</div>`;

export const DEFAULT_STYLES: InnerVoiceStyle[] = [
    {
        id: "default",
        name: "默认心声",
        prompt: DEFAULT_PROMPT,
        scenePrompt: DEFAULT_SCENE_PROMPT,
        fields: [
            { key: "心情", hint: "2 到 6 个字，随口说出来的那种" },
            { key: "心声", hint: "第一人称，此刻脑子里闪过的，10 到 60 字" },
            { key: "好感度", hint: "0 到 100 的整数，只写数字" },
        ],
        html: DEFAULT_HTML,
        motion: "rise",
    },
];

export function loadStyles(): InnerVoiceStyle[] {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return DEFAULT_STYLES.map(s => ({ ...s }));
        const parsed = JSON.parse(raw) as InnerVoiceStyle[];
        if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_STYLES.map(s => ({ ...s }));
        return parsed;
    } catch {
        return DEFAULT_STYLES.map(s => ({ ...s }));
    }
}

export function saveStyles(styles: InnerVoiceStyle[]): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(styles)); } catch { /* 存不下就算了 */ }
}

export function loadActiveStyleId(): string {
    try { return localStorage.getItem(ACTIVE_KEY) || "default"; } catch { return "default"; }
}

export function saveActiveStyleId(id: string): void {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* 同上 */ }
}

export function newStyle(): InnerVoiceStyle {
    return {
        id: `style_${Date.now().toString(36)}`,
        name: "新的心声",
        prompt: DEFAULT_PROMPT,
        scenePrompt: DEFAULT_SCENE_PROMPT,
        fields: DEFAULT_STYLES[0].fields.map(f => ({ ...f })),
        html: DEFAULT_HTML,
        motion: "rise",
    };
}

/** 极简净化：去掉脚本与事件属性，保留样式和结构。 */
function sanitize(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
        .replace(/javascript:/gi, "");
}

const SAMPLE: Record<string, string> = {
    "{{char}}": "许见青",
    "{{user}}": "林思伊",
    "{{time}}": "01:24",
    "{{date}}": "2026/11/11",
    "{{stamp}}": "1762800000",
    "{{charAvatar}}": "",
    "{{userAvatar}}": "",
    "{{心情}}": "有点烦",
    "{{心声}}": "大半夜还在这哦吼吼，笑得跟烧开的水壶一样，等下看我怎么拆穿宁。",
    "{{好感度}}": "94",
};

export function renderPreview(html: string): string {
    let out = html;
    for (const [k, v] of Object.entries(SAMPLE)) out = out.split(k).join(v);
    return sanitize(out);
}
