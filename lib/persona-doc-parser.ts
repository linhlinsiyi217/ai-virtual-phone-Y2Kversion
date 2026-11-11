/**
 * 人设文档解析：把别人写的人设卡（中英混排、YAML 风、自由段落）拆成字段。
 * 目标是"看得懂各种写法"，识别不到就留空，绝不硬塞。
 */

export type ParsedPersona = {
    realName?: string;
    nickname?: string;
    gender?: string;
    signature?: string;
    bio?: string;
    portraitDescription?: string;
};

const ALIASES: Record<keyof ParsedPersona, RegExp> = {
    realName: /^\s*(chinese\s*name|中文名|姓名|真名|本名|name|角色名)\s*[:：]/i,
    nickname: /^\s*(nickname|nick\s*name|网名|昵称|小名|别名|aka)\s*[:：]/i,
    gender: /^\s*(gender|sex|性别)\s*[:：]/i,
    signature: /^\s*(signature|tagline|个性签名|签名|一句话)\s*[:：]/i,
    bio: /^\s*(bio|about|description|persona|人设|设定|简介|介绍|背景|background(_story)?|identity|身份|archetype|性格)\s*[:：]/i,
    portraitDescription: /^\s*(appearance|looks|外貌|长相|身高|height|age|年龄)\s*[:：]/i,
};

function clean(value: string): string {
    return value
        .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, "")
        .replace(/&gt;/g, ">")
        .replace(/\s+$/g, "")
        .trim();
}

/** 把「标签: 值」和后续缩进块收成一组。 */
function sections(text: string): Array<{ label: string; body: string }> {
    const lines = text.split(/\r?\n/);
    const out: Array<{ label: string; body: string }> = [];
    let current: { label: string; body: string } | null = null;
    for (const raw of lines) {
        const line = clean(raw);
        if (!line) continue;
        const labelMatch = /^\s*([A-Za-z_\u4e00-\u9fa5][^:：]{0,24})\s*[:：]\s*(.*)$/.exec(line);
        if (labelMatch) {
            if (current) out.push(current);
            current = { label: labelMatch[1].trim(), body: labelMatch[2].trim() };
        } else if (current) {
            current.body += `\n${line}`;
        } else {
            current = { label: "", body: line };
        }
    }
    if (current) out.push(current);
    return out;
}

export function parsePersonaDoc(raw: string): ParsedPersona {
    const text = clean(raw.replace(/^\s*char[_\s-]?name\s*[:：]/i, ""));
    const parts = sections(text);
    const result: ParsedPersona = {};
    const bioParts: string[] = [];
    const looks: string[] = [];

    for (const part of parts) {
        const line = `${part.label}：${part.body}`;
        for (const key of Object.keys(ALIASES) as Array<keyof ParsedPersona>) {
            if (!ALIASES[key].test(line)) continue;
            const value = clean(part.body);
            if (!value) break;
            if (key === "bio") { bioParts.push(value); break; }
            if (key === "portraitDescription") { looks.push(`${part.label} ${value}`.trim()); break; }
            if (!result[key]) result[key] = value;
            break;
        }
    }

    if (bioParts.length) result.bio = bioParts.join("\n\n").slice(0, 4000);
    if (looks.length) result.portraitDescription = looks.join("；").slice(0, 400);

    // 网名常见写法：Nickname 里带引号的「目前叫"XXX"」
    const quoted = /叫[「"“']([^」"”']{1,20})[」"”']/.exec(result.nickname || "");
    if (quoted) result.nickname = quoted[1];

    // 签名没写就取人设里最短的一句
    if (!result.signature && result.bio) {
        const first = result.bio.split(/[\n。！？]/).map(s => s.trim()).find(s => s.length >= 4 && s.length <= 30);
        if (first) result.signature = first;
    }
    return result;
}
