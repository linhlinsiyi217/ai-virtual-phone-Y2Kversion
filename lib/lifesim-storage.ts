// lib/lifesim-storage.ts
// 生活模拟（G11）：天气 / 行程 / 便利店 / 速配 / 生活小记 的轻量 kv 存储
// 与内置数据。天气与行程按「当天日期」确定性生成，跨天自动换一批；
// 速配、小记、购买记录持久化，历史长度有上限（防 kv 膨胀）。

import { kvGet, kvRemove, kvSet } from "@/lib/kv-db";

// ── kv keys ──
const SCHEDULE_KEY = "lifesim_schedule_v1";
const NARRATIVE_KEY = "lifesim_narrative_v1";
const SPEEDDATE_KEY = "lifesim_speeddate_v1";
const PURCHASES_KEY = "lifesim_purchases_v1";
const LINKED_CHARACTER_KEY = "lifesim_character_v1";

// ── 历史长度上限 ──
const NARRATIVE_KEEP = 60;
const SPEEDDATE_RECORDS_KEEP = 60;
const PURCHASES_KEEP = 40;

// ── 通用工具 ──

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function localDateKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readJson<T>(key: string): T | null {
  const raw = kvGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  kvSet(key, JSON.stringify(value));
}

// ── 天气（纯派生，按日期确定，不入库）──

export type LifesimWeather = {
  dateKey: string;
  kind: string;
  glyph: string;
  tempLow: number;
  tempHigh: number;
  note: string;
};

type WeatherTemplate = Omit<LifesimWeather, "dateKey">;

const SEASON_WEATHER: Record<string, WeatherTemplate[]> = {
  winter: [
    { kind: "晴", glyph: "☀", tempLow: -4, tempHigh: 5, note: "天晴但有风，出门记得把围巾裹严" },
    { kind: "多云", glyph: "⛅", tempLow: -2, tempHigh: 6, note: "云层压得很低，下午可能会飘点碎雪" },
    { kind: "小雪", glyph: "🌨", tempLow: -6, tempHigh: 1, note: "细雪落了一整天，路面结了薄冰" },
    { kind: "阴", glyph: "☁", tempLow: -3, tempHigh: 3, note: "灰蒙蒙的阴天，空气冷得发脆" },
  ],
  spring: [
    { kind: "晴", glyph: "☀", tempLow: 12, tempHigh: 22, note: "阳光晒得人发困，适合出门走走" },
    { kind: "多云", glyph: "⛅", tempLow: 11, tempHigh: 20, note: "云影在街上慢慢挪，风是软的" },
    { kind: "小雨", glyph: "🌧", tempLow: 10, tempHigh: 16, note: "断断续续的小雨，伞带上再出门" },
    { kind: "阴", glyph: "☁", tempLow: 9, tempHigh: 17, note: "阴着天，闷闷的，傍晚可能放晴" },
  ],
  summer: [
    { kind: "晴", glyph: "☀", tempLow: 26, tempHigh: 35, note: "太阳很毒，午后尽量别在外面久待" },
    { kind: "雷阵雨", glyph: "⛈", tempLow: 24, tempHigh: 31, note: "午后有雷阵雨，雨来得快去得也快" },
    { kind: "多云", glyph: "⛅", tempLow: 25, tempHigh: 33, note: "云多风也多，比昨天凉快一点" },
    { kind: "高温", glyph: "🔥", tempLow: 30, tempHigh: 38, note: "连续高温，出门记得补水" },
  ],
  autumn: [
    { kind: "晴", glyph: "☀", tempLow: 15, tempHigh: 25, note: "秋高气爽，是拍照的好天气" },
    { kind: "多云", glyph: "⛅", tempLow: 14, tempHigh: 23, note: "风里有桂花味，云走得很慢" },
    { kind: "小雨", glyph: "🌧", tempLow: 12, tempHigh: 18, note: "一场秋雨一场凉，外套穿上再走" },
    { kind: "阴", glyph: "☁", tempLow: 11, tempHigh: 19, note: "阴天微凉，路灯亮得比平时早" },
  ],
};

function seasonOfMonth(month: number): keyof typeof SEASON_WEATHER {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export function getWeatherFor(dateKey: string): LifesimWeather {
  const month = Number(dateKey.slice(5, 7));
  const pool = SEASON_WEATHER[seasonOfMonth(month)] ?? SEASON_WEATHER.spring;
  const template = pool[hashString(`${dateKey}@weather`) % pool.length];
  const jitter = (hashString(`${dateKey}@temp`) % 5) - 2;
  return {
    dateKey,
    ...template,
    tempLow: template.tempLow + jitter,
    tempHigh: template.tempHigh + jitter,
  };
}

export function getWeatherToday(): LifesimWeather {
  return getWeatherFor(localDateKey());
}

export function getWeatherForecast(days = 3): LifesimWeather[] {
  return Array.from({ length: days }, (_, i) => getWeatherFor(localDateKey(i + 1)));
}

// ── 今日行程（每天一批，完成状态持久）──

export type LifesimScheduleItem = { id: string; time: string; title: string; done: boolean };
export type LifesimSchedule = { dateKey: string; items: LifesimScheduleItem[] };

type ScheduleTemplate = { time: string; title: string; kinds?: string[] };

const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  { time: "07:30", title: "晨跑三公里" },
  { time: "08:10", title: "楼下早餐铺买豆浆" },
  { time: "09:30", title: "回一封积压的邮件" },
  { time: "10:30", title: "去图书馆还两本书" },
  { time: "11:30", title: "和同事拼一单午市套餐" },
  { time: "14:00", title: "咖啡店赶一份稿子" },
  { time: "15:30", title: "药店取预约的维C" },
  { time: "17:00", title: "健身房练背" },
  { time: "18:30", title: "菜场挑一把青菜" },
  { time: "20:00", title: "整理换季的衣服" },
  { time: "21:00", title: "泡脚看一集老剧" },
  { time: "22:00", title: "给绿植浇水" },
  { time: "13:00", title: "雨停在窗边听歌", kinds: ["小雨", "雷阵雨", "小雪"] },
  { time: "16:00", title: "公园长椅上晒太阳", kinds: ["晴"] },
  { time: "19:30", title: "拍一组傍晚的街景", kinds: ["晴", "多云"] },
  { time: "12:30", title: "高温天躲进商场吹空调", kinds: ["高温"] },
];

function generateSchedule(dateKey: string): LifesimSchedule {
  const weather = getWeatherFor(dateKey);
  const weatherItems = SCHEDULE_TEMPLATES.filter(t => t.kinds?.includes(weather.kind));
  const normalItems = SCHEDULE_TEMPLATES.filter(t => !t.kinds);
  const picked: ScheduleTemplate[] = [];
  // 天气专属 0~2 条 + 普通 4 条（按日期哈希取，不重复）
  for (const t of weatherItems) {
    if (hashString(`${dateKey}@${t.title}`) % 3 === 0) picked.push(t);
  }
  const startIdx = hashString(`${dateKey}@sched`);
  for (let i = 0; picked.filter(t => !t.kinds).length < 4 && i < normalItems.length * 2; i++) {
    const t = normalItems[(startIdx + i * 3) % normalItems.length];
    if (!picked.includes(t)) picked.push(t);
  }
  picked.sort((a, b) => a.time.localeCompare(b.time));
  return {
    dateKey,
    items: picked.map((t, i) => ({ id: `s${dateKey}-${i}`, time: t.time, title: t.title, done: false })),
  };
}

export function loadSchedule(): LifesimSchedule | null {
  const parsed = readJson<LifesimSchedule>(SCHEDULE_KEY);
  // 跨天（或结构坏掉）视为无效，让调用方重新生成
  if (!parsed || parsed.dateKey !== localDateKey() || !Array.isArray(parsed.items)) return null;
  return parsed;
}

export function ensureTodaySchedule(): LifesimSchedule {
  const existing = loadSchedule();
  if (existing) return existing;
  const next = generateSchedule(localDateKey());
  writeJson(SCHEDULE_KEY, next);
  return next;
}

export function toggleScheduleItem(schedule: LifesimSchedule, itemId: string): LifesimSchedule {
  const next: LifesimSchedule = {
    ...schedule,
    items: schedule.items.map(item => (item.id === itemId ? { ...item, done: !item.done } : item)),
  };
  writeJson(SCHEDULE_KEY, next);
  return next;
}

// ── 生活小记（AI / 本地模板，双向都落库）──

export type LifesimNarrativeEntry = { ts: string; text: string; source: "ai" | "local" };

export function loadNarrative(): LifesimNarrativeEntry[] {
  const parsed = readJson<LifesimNarrativeEntry[]>(NARRATIVE_KEY);
  return Array.isArray(parsed) ? parsed.slice(0, NARRATIVE_KEEP) : [];
}

export function addNarrativeEntry(text: string, source: LifesimNarrativeEntry["source"]): LifesimNarrativeEntry[] {
  const next = [{ ts: new Date().toISOString(), text: text.trim(), source }, ...loadNarrative()].slice(0, NARRATIVE_KEEP);
  writeJson(NARRATIVE_KEY, next);
  return next;
}

// ── 便利店（商品内置；购买走统一钱包，这里只记流水）──

export type LifesimProduct = { id: string; name: string; price: number; desc: string; glyph: string };

export const STORE_PRODUCTS: LifesimProduct[] = [
  { id: "coffee", name: "现磨咖啡", price: 15, desc: "中杯微糖，赶稿救急", glyph: "☕" },
  { id: "lemon", name: "冰镇柠檬水", price: 8, desc: "去冰半糖，夏天的凉", glyph: "🍋" },
  { id: "yogurt", name: "老式酸奶", price: 10, desc: "玻璃瓶要还的那种", glyph: "🥛" },
  { id: "choco", name: "黑巧克力", price: 12, desc: "88% 苦甜比", glyph: "🍫" },
  { id: "chips", name: "海苔薯片", price: 6, desc: "看剧标配", glyph: "🥔" },
  { id: "noodle", name: "深夜泡面", price: 6, desc: "加蛋加肠自由", glyph: "🍜" },
  { id: "bandaid", name: "卡通创可贴", price: 5, desc: "一盒六片，摔了也不疼", glyph: "🩹" },
  { id: "sticker", name: "手账贴纸", price: 9, desc: "四季款随机", glyph: "✨" },
  { id: "plant", name: "小盆栽", price: 18, desc: "桌面绿植，好养活", glyph: "🌱" },
  { id: "warm", name: "暖宝宝", price: 7, desc: "贴一片管八小时", glyph: "🔥" },
  { id: "umbrella", name: "便利店雨伞", price: 22, desc: "格子纹，骨架结实", glyph: "☂" },
  { id: "film", name: "胶卷", price: 26, desc: "36 张装的旧时光", glyph: "📷" },
];

export type LifesimPurchase = { ts: string; item: string; qty: number; amount: number };

export function loadPurchases(): LifesimPurchase[] {
  const parsed = readJson<LifesimPurchase[]>(PURCHASES_KEY);
  return Array.isArray(parsed) ? parsed.slice(0, PURCHASES_KEEP) : [];
}

export function addPurchase(item: string, qty: number, amount: number): LifesimPurchase[] {
  const next = [{ ts: new Date().toISOString(), item, qty, amount }, ...loadPurchases()].slice(0, PURCHASES_KEEP);
  writeJson(PURCHASES_KEY, next);
  return next;
}

// ── 速配（问答 + 好感，答案写入角色会话由 App 层负责）──

export type LifesimSpeedDateOption = { text: string; delta: number; tone: string };
export type LifesimSpeedDateQuestion = { q: string; options: LifesimSpeedDateOption[] };

export const SPEED_DATE_QUESTIONS: LifesimSpeedDateQuestion[] = [
  {
    q: "周末的清晨，你更想怎么开始？",
    options: [
      { text: "睡到自然醒", delta: 1, tone: "松弛" },
      { text: "早起晨跑", delta: 2, tone: "自律" },
      { text: "刷手机到中午", delta: 0, tone: "随性" },
    ],
  },
  {
    q: "旅行时你喜欢做计划吗？",
    options: [
      { text: "全部按攻略走", delta: 1, tone: "稳妥" },
      { text: "走哪算哪", delta: 2, tone: "冒险" },
      { text: "计划赶不上变化，干脆不做", delta: 0, tone: "佛系" },
    ],
  },
  {
    q: "理想的约会地点是？",
    options: [
      { text: "游乐园", delta: 2, tone: "热闹" },
      { text: "安静的书店", delta: 1, tone: "文艺" },
      { text: "家里追剧", delta: 0, tone: "宅系" },
    ],
  },
  {
    q: "遇到烦心事你通常会？",
    options: [
      { text: "找人倾诉", delta: 2, tone: "外放" },
      { text: "自己消化", delta: 1, tone: "内敛" },
      { text: "大吃一顿", delta: 0, tone: "美食疗愈" },
    ],
  },
  {
    q: "宠物派：猫还是狗？",
    options: [
      { text: "猫", delta: 1, tone: "猫派" },
      { text: "狗", delta: 2, tone: "狗派" },
      { text: "都爱，来者不拒", delta: 0, tone: "博爱" },
    ],
  },
  {
    q: "你更喜欢哪种天气？",
    options: [
      { text: "晴天", delta: 0, tone: "晒太阳型" },
      { text: "雨天", delta: 1, tone: "听雨型" },
      { text: "下雪", delta: 2, tone: "追雪型" },
    ],
  },
  {
    q: "对方做饭很难吃，你会？",
    options: [
      { text: "坦率说出来", delta: 1, tone: "直球" },
      { text: "硬着头皮吃完", delta: 0, tone: "心软" },
      { text: "抢过锅铲自己做", delta: 2, tone: "行动派" },
    ],
  },
  {
    q: "纪念日你更在意？",
    options: [
      { text: "礼物", delta: 0, tone: "务实" },
      { text: "陪伴", delta: 2, tone: "重感情" },
      { text: "仪式感的花招", delta: 1, tone: "浪漫派" },
    ],
  },
  {
    q: "深夜 emo 的时候，希望对方？",
    options: [
      { text: "打电话过来", delta: 2, tone: "要人陪" },
      { text: "发条消息就好", delta: 1, tone: "要安慰" },
      { text: "让我自己静一静", delta: 0, tone: "要空间" },
    ],
  },
  {
    q: "捡到一张空白的电影票，你会？",
    options: [
      { text: "看场次最近的", delta: 2, tone: "说走就走" },
      { text: "查查评分再决定", delta: 1, tone: "谨慎" },
      { text: "收藏起来当书签", delta: 0, tone: "恋物" },
    ],
  },
];

export type LifesimSpeedDateRecord = {
  ts: string;
  characterId: string;
  characterName: string;
  question: string;
  choice: string;
  tone: string;
  delta: number;
};

export type LifesimSpeedDateState = {
  round: number;
  favors: Record<string, number>;
  records: LifesimSpeedDateRecord[];
};

const FAVOR_MIN = -20;
const FAVOR_MAX = 99;

export function loadSpeedDate(): LifesimSpeedDateState {
  const parsed = readJson<LifesimSpeedDateState>(SPEEDDATE_KEY);
  if (!parsed || typeof parsed !== "object") return { round: 0, favors: {}, records: [] };
  return {
    round: Number.isFinite(parsed.round) ? parsed.round : 0,
    favors: parsed.favors && typeof parsed.favors === "object" ? parsed.favors : {},
    records: Array.isArray(parsed.records) ? parsed.records : [],
  };
}

export function recordSpeedDateAnswer(record: LifesimSpeedDateRecord): LifesimSpeedDateState {
  const current = loadSpeedDate();
  const favor = Math.min(FAVOR_MAX, Math.max(FAVOR_MIN, (current.favors[record.characterId] ?? 0) + record.delta));
  const next: LifesimSpeedDateState = {
    round: current.round + 1,
    favors: { ...current.favors, [record.characterId]: favor },
    records: [record, ...current.records].slice(0, SPEEDDATE_RECORDS_KEEP),
  };
  writeJson(SPEEDDATE_KEY, next);
  return next;
}

export function resetSpeedDate(): LifesimSpeedDateState {
  const next: LifesimSpeedDateState = { round: 0, favors: {}, records: [] };
  writeJson(SPEEDDATE_KEY, next);
  return next;
}

// ── 关联角色（事件写进哪个角色的会话）──

export function getLinkedCharacterId(): string | null {
  return kvGet(LINKED_CHARACTER_KEY);
}

export function setLinkedCharacterId(characterId: string | null): void {
  if (characterId) kvSet(LINKED_CHARACTER_KEY, characterId);
  else kvRemove(LINKED_CHARACTER_KEY);
}
