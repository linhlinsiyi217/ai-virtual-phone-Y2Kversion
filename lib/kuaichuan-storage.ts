// lib/kuaichuan-storage.ts — 快穿局客户端存储：金币钱包、转盘记账、文游存档。
// 纯 kv-db（localStorage），不引入第二套服务端数据源。

import { kvGet, kvSet, kvRemove, registerKvMigration } from "./kv-db";

const WALLET_KEY = "ai_phone_kuaichuan_wallet_v1";
const WHEEL_CONFIG_KEY = "ai_phone_kuaichuan_wheel_config_v1";
const GAME_KEY_PREFIX = "ai_phone_kuaichuan_game_";
registerKvMigration(WALLET_KEY);
registerKvMigration(WHEEL_CONFIG_KEY);

/** 每日免费转盘次数（默认值，可在转盘页配置） */
export const FREE_SPINS_PER_DAY = 5;

// ── 转盘配置（G8 修复：不再写死在组件里，落 kv 可编辑）──

export type WheelSegmentConfig = {
    /** 扇区显示文案 */
    label: string;
    /** 金币值；-1 表示「再来一次」（返还一次机会），其余为入账金币数 */
    coins: number;
};

export type WheelConfig = {
    segments: WheelSegmentConfig[];
    /** 每日免费次数 */
    freeSpinsPerDay: number;
};

export const DEFAULT_WHEEL_CONFIG: WheelConfig = {
    segments: [
        { label: "金币 +8", coins: 8 },
        { label: "金币 +15", coins: 15 },
        { label: "金币 +28", coins: 28 },
        { label: "谢谢参与", coins: 0 },
        { label: "金币 +8", coins: 8 },
        { label: "金币 +50", coins: 50 },
        { label: "金币 +88", coins: 88 },
        { label: "再来一次", coins: -1 },
    ],
    freeSpinsPerDay: FREE_SPINS_PER_DAY,
};

/** 配置合法性：4-16 段、label 非空、coins 为 -10000~10000 的整数、每日 1-20 次 */
export function isValidWheelConfig(cfg: unknown): cfg is WheelConfig {
    if (!cfg || typeof cfg !== "object") return false;
    const c = cfg as WheelConfig;
    if (!Array.isArray(c.segments) || c.segments.length < 4 || c.segments.length > 16) return false;
    if (!Number.isInteger(c.freeSpinsPerDay) || c.freeSpinsPerDay < 1 || c.freeSpinsPerDay > 20) return false;
    return c.segments.every(
        (s) =>
            s && typeof s.label === "string" && s.label.trim().length > 0 && s.label.length <= 12 &&
            typeof s.coins === "number" && Number.isInteger(s.coins) && s.coins >= -10000 && s.coins <= 10000,
    );
}

export function loadWheelConfig(): WheelConfig {
    try {
        const raw = kvGet(WHEEL_CONFIG_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (isValidWheelConfig(parsed)) return parsed;
        }
    } catch { /* 损坏配置回默认 */ }
    return { ...DEFAULT_WHEEL_CONFIG, segments: DEFAULT_WHEEL_CONFIG.segments.map((s) => ({ ...s })) };
}

export function saveWheelConfig(cfg: WheelConfig): void {
    if (!isValidWheelConfig(cfg)) return;
    kvSet(WHEEL_CONFIG_KEY, JSON.stringify(cfg));
}

export type KuaichuanWallet = {
    coins: number;
    freeSpinsLeft: number;
    spinsDate: string;
    /** 命运重抽券：下一抽必中 88 金币大奖格 */
    luckyCharm: number;
    totalSpins: number;
    withdrawLog: { at: string; coins: number; note: string }[];
    /** 转盘中奖历史（最近在前，最多 SPIN_LOG_KEEP 条） */
    spinLog: { at: string; label: string; coins: number }[];
};

/** 转盘中奖历史保留条数 */
export const SPIN_LOG_KEEP = 30;

function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function loadWallet(freeSpinsPerDay: number = FREE_SPINS_PER_DAY): KuaichuanWallet {
    const daily = Number.isInteger(freeSpinsPerDay) && freeSpinsPerDay > 0 ? freeSpinsPerDay : FREE_SPINS_PER_DAY;
    let wallet: KuaichuanWallet | null = null;
    try {
        const raw = kvGet(WALLET_KEY);
        if (raw) wallet = JSON.parse(raw);
    } catch { wallet = null; }
    if (!wallet) {
        wallet = { coins: 0, freeSpinsLeft: daily, spinsDate: todayKey(), luckyCharm: 0, totalSpins: 0, withdrawLog: [], spinLog: [] };
    }
    // 旧存档没有中奖历史：补默认，避免 undefined 顺着往下传
    if (!Array.isArray(wallet.spinLog)) wallet.spinLog = [];
    // 跨天自动补满免费次数（按当前配置补，改配置次日生效）
    if (wallet.spinsDate !== todayKey()) {
        wallet.spinsDate = todayKey();
        wallet.freeSpinsLeft = daily;
    }
    return wallet;
}

export function saveWallet(wallet: KuaichuanWallet): void {
    kvSet(WALLET_KEY, JSON.stringify(wallet));
}

// ── 预设世界（快穿局派发的世界任务）──

export type KuaichuanWorld = {
    id: string;
    title: string;
    subtitle: string;
    goal: string;
    opener: string;
};

export const KUAICHUAN_WORLDS: KuaichuanWorld[] = [
    {
        id: "mansion",
        title: "豪门夺嫡",
        subtitle: "深宅大院，步步惊心",
        goal: "以三房幼子的身份，在三个月内拿到集团继承权",
        opener:
            "【系统】叮——绑定成功。欢迎来到世界线 001：豪门夺嫡。\n\n你睁开眼，正跪在灵堂的白毡上。牌位上是你刚认回来的父亲，满堂吊客的目光像针一样扎过来。管家高声宣读遗嘱：名下资产归长子一系，而你——三房那位不受待见的幼子，只分到一栋老宅和一箱旧账本。\n\n【系统】本局任务：在三个月内拿到集团继承权。提示：那箱旧账本里，藏着大房最不想见光的秘密。\n\n灵堂外雨声渐密，大房的管家正朝你走来。你的下一步是？",
    },
    {
        id: "sect",
        title: "仙门问道",
        subtitle: "灵根废柴的逆袭",
        goal: "以废灵根外门弟子的身份，在宗门大比进入前十",
        opener:
            "【系统】叮——世界线 002 装载完毕：仙门问道。\n\n测灵台前哄笑一片。执事捻着灵石看了三遍，才报出你的结果：五行俱废，杂灵根。别的弟子一炷香就通过外门考核，你分到的却是最偏僻的柴房、最没人要的《引气诀》残卷。\n\n【系统】本局任务：宗门大比进入前十。提示：柴房后山那口枯井，每逢子时会亮一下。\n\n今夜子时将至，你握着残卷站在井边。要下去看看吗？",
    },
    {
        id: "wasteland",
        title: "末日求生",
        subtitle: "雨落第七天的超市",
        goal: "带领幸存者小队把净水设备运回安全区",
        opener:
            "【系统】叮——紧急投放：世界线 003，末日求生。\n\n酸雨下到第七天。你蹲在超市货架后面，数了数手里的罐头：三个。收音机里安全区的坐标还在循环播放，但中间隔着一片积水区，积水里有东西在动。\n\n同行的还有四个人：沉默的司机、受了伤的护士、抱着猫的老人，和一个谁都不敢信的陌生人。他们都在等你拿主意。\n\n【系统】本局任务：把西郊水厂的净水设备运回安全区。设备很重，路很烂，水里的东西很快。\n\n雨声里，陌生人开了口：「我知道一条近路。」你的回答是？",
    },
    {
        id: "campus",
        title: "校园救赎",
        subtitle: "给十七岁递一把伞",
        goal: "在不惊动任何人的前提下，阻止转学生在天台做出无法挽回的事",
        opener:
            "【系统】叮——世界线 004：校园救赎。\n\n六月的最后一节自习课，风扇在头顶吱呀转。你趴在课桌上，看见靠窗最后一排的转学生把一张揉皱的成绩单塞进抽屉，肩膀绷得很紧。你认得那种绷紧——上一个世界线里，你没能来得及。\n\n【系统】本局任务：在毕业典礼之前，把她从天台的栏杆边带回来。注意：这是低武世界，你没有任何异能，只有十七岁的那点笨拙和真心。\n\n放学铃响，她第一个冲出教室。窗外，晚霞烧得正旺。你跟不跟？",
    },
    {
        id: "palace",
        title: "宫廷棋局",
        subtitle: "尚宫局的最后一步棋",
        goal: "在冷宫得势，查清先皇后死因并活着走出宫门",
        opener:
            "【系统】叮——世界线 005：宫廷棋局。\n\n三更的梆子刚敲过。你顶着尚宫局女官的皮，把最后一枚银针藏进发髻。白天皇后凤仪宫走水，烧掉的是账房，死的是会说话的老太监——这宫里想让你活的人不多，想让你死的人排到了午门外。\n\n【系统】本局任务：查清先皇后死因，并活着走出宫门。提示：御膳房今晚多备了一副碗筷，多出来的那副，是给谁的？\n\n廊下传来脚步声，来人举着灯，是御前总管。他笑着说：「姑娘，皇后娘娘有请。」你去，还是不去？",
    },
    {
        id: "starfall",
        title: "星际拓荒",
        subtitle: "第七殖民星的自种田",
        goal: "在补给船抵达前，把穹顶农场的第一季作物种活",
        opener:
            "【系统】叮——世界线 006：星际拓荒。\n\n登陆第七殖民星的第九天，主控 AI 用毫无起伏的电子音通知你：补给船提前了，但生态穹顶的氧气循环坏了，七十二小时后穹顶浓度跌破生存线。\n\n你是农业舱唯一醒着的拓荒者。舱里还有三枚休眠舱、一仓库耐储存的种子，和一台只肯用文言文说话的老旧农机。\n\n【系统】本局任务：在补给船抵达前种活第一季作物、修好氧气循环。提示：老农机嘴里的「旧主」，上一个用户记录停在了二十年前。\n\n老农机的屏幕亮起来：「客官何往？」你先去哪儿？",
    },
];

// ── 文游存档（每个世界一档）──

export type KuaichuanGameMessage = { role: "user" | "assistant"; content: string };

export type KuaichuanGameSave = {
    worldId: string;
    rounds: number;
    history: KuaichuanGameMessage[];
    updatedAt: string;
};

export function loadGameSave(worldId: string): KuaichuanGameSave | null {
    try {
        const raw = kvGet(GAME_KEY_PREFIX + worldId);
        if (!raw) return null;
        const save = JSON.parse(raw) as KuaichuanGameSave;
        if (!save || !Array.isArray(save.history)) return null;
        return save;
    } catch { return null; }
}

// ── 文游存档历史上限（G8 修复：存档不再无限膨胀）──
/** history 总条数超过这个值就压缩，防止 localStorage 被单档撑爆 */
export const MAX_GAME_HISTORY = 160;
/** 压缩后保留最近多少条 */
export const KEEP_RECENT_HISTORY = 120;

/**
 * 压缩过长历史：保留第一条（系统开场白）+ 一条归档说明 + 最近 KEEP_RECENT_HISTORY 条。
 * rounds 不变（它记录的是真实推进轮数）。
 */
export function compressGameHistory(history: KuaichuanGameMessage[], rounds: number): KuaichuanGameMessage[] {
    if (history.length <= MAX_GAME_HISTORY) return history;
    const dropped = history.length - 1 - KEEP_RECENT_HISTORY;
    const archiver: KuaichuanGameMessage = {
        role: "assistant",
        content: `【前情压缩】为了控制存档体积，中间约 ${dropped} 轮（共 ${rounds} 轮）的细节已从本机归档移除；任务目标与最近进展保留。`,
    };
    return [history[0], archiver, ...history.slice(-KEEP_RECENT_HISTORY)];
}

export function saveGameSave(save: KuaichuanGameSave): void {
    kvSet(
        GAME_KEY_PREFIX + save.worldId,
        JSON.stringify({
            ...save,
            history: compressGameHistory(save.history, save.rounds),
            updatedAt: new Date().toISOString(),
        }),
    );
}

export function clearGameSave(worldId: string): void {
    kvRemove(GAME_KEY_PREFIX + worldId);
}
