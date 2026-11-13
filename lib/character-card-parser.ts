/**
 * Deterministic character-card parser used by XiaoJuan.
 *
 * Chat can be verbose; storage must not be. The parser deliberately keeps
 * only card fields and drops assistant meta text, tool results and transcript
 * wrappers before a character is written.
 */

export type ParsedCharacterCard = {
    name: string;
    persona: string;
    personality: string;
    briefPersona?: string;
};

const META_LINE = /^(?:收到|好的|好嘞|搞定|我帮|我先|已经|已成功|首先|其次|现在|如果之后|宝[，,！!]|小姐姐|小卷|出错了|错误|failed to fetch|missing mascot|创建角色\s*[:：]|写入人设|请(?:前往|打开|连接)|需要连接|工具箱|google keep|id\s*[:：]|char_[a-z0-9_-]+)/i;
const TRANSCRIPT_LINE = /^(?:user|assistant|system|用户|助手|小卷|ai)\s*[:：]/i;

const LABELS = [
    "角色名称", "角色名", "姓名", "名字", "name", "昵称", "身份/定位", "身份", "定位",
    "人设描述", "角色描述", "persona", "人设", "性格特质", "性格", "人格特征", "personality",
    "简量版人设", "briefpersona", "brief persona",
] as const;

type MajorBlock = { key: string; body: string };
type LabeledLine = { key: string; value: string };

function normalizeLine(line: string): string {
    return line
        .replace(/\u00a0/g, " ")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/^[\s>*•·▪◦]+/, "")
        .trim();
}

function unwrapMarkdown(text: string): string {
    return String(text || "")
        .replace(/```(?:json|markdown|text|txt)?/gi, "")
        .replace(/```/g, "")
        .replace(/^\s*---+\s*$/gm, "")
        .replace(/^\s*#{1,6}\s*/gm, "")
        .trim();
}

function cleanName(value: string): string {
    return String(value || "")
        .replace(/[（(][^）)]*[）)]?\s*$/, "")
        .replace(/^[\s"'“”‘’「」『』【】<>《》:：-]+|[\s"'“”‘’「」『』【】<>《》:：,，。！？!?-]+$/g, "")
        .replace(/^(?:角色名称|角色名|姓名|名字|name)\s*[:：]?\s*/i, "")
        // 模型有时把整行塞进名字：孟凡 relation: 大学室友 / 沈岚 age: 46
        .replace(/\s+(?:relation|nickname|nick\s*name|age|gender|height|identity|archetype|persona|tagline|signature|关系|身份|年龄|性别|身高)\s*[:：].*$/i, "")
        .replace(/^([^:：]{1,12})[:：].*$/, "$1")
        .replace(/[（(].*?[）)]\s*$/, "")
        .trim()
        .slice(0, 60);
}

function dedupeParagraphs(text: string): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const paragraph of text.split(/\n\s*\n+/)) {
        const clean = paragraph.trim();
        if (!clean) continue;
        const key = clean.replace(/\s+/g, " ").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
    }
    return out.join("\n\n");
}

/** Remove assistant meta chatter while keeping ordinary role prose. */
export function cleanCharacterText(value: string, options: { keepHeadings?: boolean } = {}): string {
    const lines = unwrapMarkdown(value).split(/\r?\n/).map(normalizeLine);
    const kept: string[] = [];
    let transcript = false;
    for (const line of lines) {
        if (!line) {
            if (kept.length && kept[kept.length - 1] !== "") kept.push("");
            continue;
        }
        if (TRANSCRIPT_LINE.test(line)) {
            transcript = true;
            continue;
        }
        if (META_LINE.test(line)) continue;
        if (/^(?:回复|回答|用户消息|助手回复|对话记录|聊天记录|工具结果|action_result)\s*[:：]?$/i.test(line)) {
            transcript = true;
            continue;
        }
        if (transcript && /^(?:发送|下一句|继续聊天|好的我|收到啦)/.test(line)) continue;
        if (/^\(?char_[a-z0-9_-]+\)?$/i.test(line)) continue;
        if (!options.keepHeadings && /^(?:PERSONA\s*\/\s*TRAITS|PERSONALITY|角色卡|人设卡)$/i.test(line)) continue;
        kept.push(line);
    }
    return dedupeParagraphs(kept.join("\n").replace(/\n{3,}/g, "\n\n")).trim();
}

function stripDecorators(line: string): string {
    return line
        .replace(/^[^\p{L}\p{N}#*`_\s■◆【\[（(]+/u, "")
        .replace(/^[#*`_\s■◆【\[（(]+/, "")
        .replace(/[\]*`_】】：:]+$/, "")
        .trim();
}

function parseLabeledLine(line: string): LabeledLine | null {
    const clean = stripDecorators(normalizeLine(line));
    const labelPattern = LABELS.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = clean.match(new RegExp(`^(${labelPattern})\\s*(?:\\([^)]*\\)|（[^）]*）)?\\s*[:：]\\s*(.*)$`, "i"));
    if (!match) return null;
    return { key: match[1].toLowerCase(), value: match[2].trim() };
}

function majorHeading(line: string): { key: string; inline: string } | null {
    const clean = stripDecorators(normalizeLine(line));
    const match = clean.match(/^(PERSONA\s*\/\s*TRAITS|PERSONALITY|BRIEF\s*PERSONA|PERSONA\b|角色卡|人设卡|人设描述|角色描述|性格特质|性格|人格特征|简量版人设)\s*(?:\([^)]*\)|（[^）]*）)?\s*(?::|：)?\s*(.*)$/i);
    if (!match) return null;
    return { key: match[1].toLowerCase().replace(/\s+/g, " "), inline: match[2].trim() };
}

function collectMajorBlocks(text: string): MajorBlock[] {
    const blocks: MajorBlock[] = [];
    let current: MajorBlock | null = null;
    for (const raw of unwrapMarkdown(text).split(/\r?\n/)) {
        const line = normalizeLine(raw);
        const heading = majorHeading(line);
        if (heading) {
            if (current) current.body = current.body.trim();
            current = { key: heading.key, body: heading.inline };
            blocks.push(current);
            continue;
        }
        if (current) current.body += `${current.body ? "\n" : ""}${line}`;
    }
    if (current) current.body = current.body.trim();
    return blocks.filter(block => block.body.trim());
}

function findLabeledValues(text: string): Map<string, string> {
    const values = new Map<string, string>();
    let current: { key: string; body: string } | null = null;
    const flush = () => {
        if (!current) return;
        const value = current.body.trim();
        if (value) values.set(current.key, value);
        current = null;
    };
    for (const raw of unwrapMarkdown(text).split(/\r?\n/)) {
        const line = normalizeLine(raw);
        const labeled = parseLabeledLine(line);
        if (labeled) {
            flush();
            current = { key: labeled.key, body: labeled.value };
            continue;
        }
        if (majorHeading(line)) {
            flush();
            continue;
        }
        if (current) current.body += `${current.body ? "\n" : ""}${line}`;
    }
    flush();
    return values;
}

function extractName(text: string): string {
    const values = findLabeledValues(text);
    for (const key of ["角色名称", "角色名", "姓名", "名字", "name"]) {
        const name = cleanName(values.get(key) || "");
        if (name && !/^(?:未设置|暂无|unknown|角色)$/i.test(name)) return name;
    }
    const patterns = [
        /(?:名字|姓名)\s*(?:叫(?:做|作)?|是|为)\s*[“"「『]?([^\n，。,；;。！？!?」』”"（()]{1,40})/i,
        /(?:你是|角色是|角色叫)\s*[“"「『]?([^\n，。,；;。！？!?」』”"（()]{1,40})/i,
        /(?:叫做|叫作|称为)\s*[“"「『]?([^\n，。,；;。！？!?」』”"（()]{1,40})/i,
    ];
    for (const pattern of patterns) {
        const name = cleanName(text.match(pattern)?.[1] || "");
        if (name && !/^(?:一个|一只|小猫|助手|角色)$/i.test(name)) return name;
    }
    return "";
}

function fieldValue(values: Map<string, string>, keys: string[]): string {
    for (const key of keys) {
        const value = values.get(key);
        if (value?.trim()) return value.trim();
    }
    return "";
}

function looksLikeRawPrompt(text: string): boolean {
    return /(帮我创建|帮我新建|你必须无条件|收到啦|我把.*整理|首先.*工具箱|google keep|角色卡写好|创建角色：)/i.test(text)
        || /(user命令|测试小助手|写入人设档案)/i.test(text);
}

function parseJsonCandidate(text: string): ParsedCharacterCard | null {
    const candidates: string[] = [];
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (fenced) candidates.push(fenced);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate) as Record<string, unknown>;
            const nested = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
            const name = cleanName(String(nested.name ?? nested.character_name ?? nested.char_name ?? ""));
            const persona = String(nested.persona ?? nested.description ?? nested.desc ?? "").trim();
            const personality = String(nested.personality ?? nested.traits ?? "").trim();
            if (name && (persona || personality)) {
                return {
                    name,
                    persona: cleanCharacterText(persona || personality, { keepHeadings: true }),
                    personality: cleanCharacterText(personality || persona).slice(0, 1200),
                    briefPersona: typeof nested.briefPersona === "string" ? cleanCharacterText(nested.briefPersona).slice(0, 800) || undefined : undefined,
                };
            }
        } catch {
            // Fall through to the heading parser.
        }
    }
    return null;
}

function cardBodyFromBlock(block: MajorBlock): string {
    const lines = block.body.split(/\r?\n/).map(normalizeLine);
    // If the assistant put the original user prompt above the actual fields,
    // begin at the first explicit card field and discard that prompt.
    const firstField = lines.findIndex(line => Boolean(parseLabeledLine(line)));
    return (firstField >= 0 ? lines.slice(firstField) : lines).join("\n").trim();
}

/** Parse a user message and (optionally) the immediately preceding assistant draft. */
export function parseCharacterCardText(userText: string, assistantText = ""): ParsedCharacterCard | null {
    const user = String(userText || "").trim();
    const assistant = String(assistantText || "").trim();
    const json = parseJsonCandidate(user) || parseJsonCandidate(assistant);
    if (json) return json;

    const candidates = [assistant, user].filter(Boolean);
    const score = (text: string) => (/(PERSONA\s*\/\s*TRAITS|PERSONALITY|角色名|姓名|人设描述|性格特质)/i.test(text) ? 5 : 0) - (looksLikeRawPrompt(text) ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    const chosen = candidates[0] || "";
    const blocks = collectMajorBlocks(chosen);
    const allText = [user, assistant].filter(Boolean).join("\n\n");
    const allBlocks = blocks.length ? blocks : collectMajorBlocks(allText);

    const personaBlocks = allBlocks.filter(block => /^(?:persona(?: \/ traits)?|人设描述|角色描述|角色卡|人设卡)$/i.test(block.key));
    const personaBlock = personaBlocks[0];
    const personalityBlocks = allBlocks.filter(block => /^(?:personality|性格特质|性格|人格特征)$/i.test(block.key));
    const briefBlock = allBlocks.find(block => /^(?:brief persona|briefpersona|简量版人设)$/i.test(block.key));
    const cardText = personaBlocks.length > 0 ? personaBlocks.map(cardBodyFromBlock).join("\n\n") : chosen;
    const values = findLabeledValues([cardText, chosen, allText].filter(Boolean).join("\n\n"));

    const name = extractName([cardText, chosen, allText].filter(Boolean).join("\n\n"));
    let persona = cardText;
    if (personaBlock) {
        const explicitPersona = fieldValue(values, ["人设描述", "角色描述", "persona", "人设"]);
        if (explicitPersona) persona = explicitPersona;
    } else {
        const stripped = user.replace(/^(?:帮我|请|想要|我要|直接)?\s*(?:创建|新建|添加)(?:一个|一张)?(?:角色|角色卡)\s*[:：]?/i, "").trim();
        persona = stripped || chosen;
    }

    let personality = personalityBlocks.map(cardBodyFromBlock).join("\n\n");
    if (!personality) personality = fieldValue(values, ["性格特质", "性格", "人格特征", "personality"]);
    persona = cleanCharacterText(persona, { keepHeadings: true });
    personality = cleanCharacterText(personality).slice(0, 1200);
    const briefPersona = cleanCharacterText(briefBlock ? cardBodyFromBlock(briefBlock) : fieldValue(values, ["简量版人设", "briefpersona", "brief persona"])).slice(0, 800) || undefined;

    if (!name || persona.length < 8) return null;
    // A structured card may legitimately be short (for example a test helper
    // character). Only reject the prompt-looking fallback when no card fields
    // or headings were found at all.
    if (!personaBlock && values.size < 2 && looksLikeRawPrompt(persona) && persona.replace(/\s+/g, "").length < 12) return null;
    if (!personality) {
        personality = persona.split(/\n+/).filter(line => !META_LINE.test(line)).join(" ").slice(0, 280).trim()
            || "按照角色卡设定行动，保持身份、语气与关系边界一致";
    }
    return { name: cleanName(name), persona: persona.slice(0, 16000), personality, ...(briefPersona ? { briefPersona } : {}) };
}

/**
 * 4.7 小卷误建角色的源头修复：用户消息明显是在说「自己的资料/人设」。
 * 命中时 isCharacterWriteIntent 必须返回 false —— 否则用户发自己的人设文档，
 * 会在模型运行前就被确定性路径直接建成角色（实测出过「孟凡 relation: 大学室友」事故）。
 * 边缘场景（一句话里既要建角色又要存自己的资料）宁可走模型路由，
 * 那里有工具抑制 + 提示词规则兜底，不会再被确定性路径误建。
 */
export function isOwnProfileIntent(text: string): boolean {
    return /我(的)?(人设|资料|设定|档案|信息|自我介绍)|是我自己|本人(的人设|的资料|的设定|人设|资料|设定)|存(到|进|入)我的|这是我(的)?(人设|设定|资料)|我自己的人设|user\s+persona|my\s+(persona|profile|character\s+sheet)/i.test(text);
}

export function isCharacterWriteIntent(text: string): boolean {
    if (isOwnProfileIntent(text)) return false;
    return /(创建|新建|添加|写入|导入|保存|录入|修改|更新).{0,18}(角色|角色卡|人设|人物档案)|做成.{0,6}(角色|角色卡)|角色卡.{0,10}(写入|导入|保存)|写入人设档案/i.test(text)
        || (/(PERSONA\s*\/\s*TRAITS|PERSONALITY|角色名\s*[:：]|角色名称\s*[:：]|人设描述\s*[:：])/i.test(text) && text.length >= 30);
}

/** Sanitize fields already produced by a native tool call. */
export function sanitizeCharacterDraft(args: Record<string, unknown>): ParsedCharacterCard | null {
    const name = cleanName(String(args.name || ""));
    const rawPersona = String(args.persona || "").trim();
    const rawPersonality = String(args.personality || "").trim();
    if (!name || !rawPersona) return null;
    // Native calls already have separate fields. Only strip obvious wrappers;
    // do not re-parse a valid persona and accidentally reduce it to one field.
    const looksLikeTranscript = /(帮我创建|帮我新建|角色卡写好|收到啦|assistant\s*[:：]|user\s*[:：]|创建角色)/i.test(rawPersona);
    const recovered = looksLikeTranscript ? parseCharacterCardText(rawPersona, rawPersonality) : null;
    const persona = recovered?.persona || cleanCharacterText(rawPersona, { keepHeadings: true });
    const personality = recovered?.personality || cleanCharacterText(rawPersonality).slice(0, 1200);
    // 角色卡里常把用户写成裸词 user（从别人模板抄来的），模型会照着念「user额」。
    // 统一收成 {{user}} 宏，渲染时才会换成真实网名。
    const asMacro = (text: string) => text
        .replace(/(?<![A-Za-z0-9_])user(?![A-Za-z0-9_])/gi, "{{user}}")
        .replace(/\{\{\s*\{\{\s*user\s*\}\}\s*\}\}/gi, "{{user}}");
    return {
        name,
        persona: asMacro(persona || rawPersona.slice(0, 16000)),
        personality: asMacro(personality || "按照角色卡设定行动，保持身份与关系边界一致"),
        briefPersona: typeof args.briefPersona === "string" ? (asMacro(cleanCharacterText(args.briefPersona)).slice(0, 800) || undefined) : undefined,
    };
}

