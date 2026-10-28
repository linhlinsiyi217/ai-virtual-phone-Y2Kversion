// lib/study-room/writing-worldbook.ts — 书房写作世界书（第三批）。
//
// 适用范围只有一个：书房里的 AI 写书（写作助手模式 + 角色卡写书，含续写/重写本章）。
// 普通聊天、书友圈 NPC、共读和其他应用都不读这里；范围由调用方传入的可信常量决定，
// 条目自己写的「最高优先级」之类字样不会扩大范围。
//
// 内容是按来源资料的意思**重新写成的精简规则**（不是原文），来源与作者记在 source 里。
// 第六轮（R07）：「防八股」= 《AI角色扮演「机械化八股与高频词句」拦截指令》，另一份按
// 《审美重构：去八股化艺术流写作指令》接入——只取通用的去套话部分；它「禁止心理旁白、镜头语言」
// 是一种特定文风，已经单独做成「留白」文风，这里不强加给所有文风。
// 优先级：用户本次要求、人物与剧情设定 > 用户选的文风（管写法）与关联世界书（管设定）> 本规范。
// 每次只按预算带一部分。

export const STUDYROOM_WRITING_SCOPE = "studyroom-writing" as const;
export type WritingScope = typeof STUDYROOM_WRITING_SCOPE;

export type WritingWorldbookEntry = {
  id: string;
  displayName: string;
  source: string;
  kind: "craft" | "character" | "relationship";
  scope: WritingScope;
  enabled: boolean;
  /** 空数组 = 常驻；否则设定、前文里出现任一关键词才带上 */
  triggerKeys: string[];
  /** 越大越先放进预算 */
  priority: number;
  content: string;
};

export const WRITING_WORLDBOOK: WritingWorldbookEntry[] = [
  {
    id: "anti-cliche",
    displayName: "去套话",
    source: "《AI角色扮演「机械化八股与高频词句」拦截指令》（精简改写）",
    kind: "craft",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: [],
    priority: 90,
    content: [
      "少用高频套话：「眼神中闪过一丝」「嘴角勾起一抹弧度」「不禁」「下意识地」「深吸一口气」「顿了顿」「微微一怔」「意味深长」「那双深邃的眼眸」「一字一顿」「仿佛要揉进骨血」，以及成串的「沉声道、哑声道、淡淡道」。",
      "不套固定句式：「明明……却……」递进、三连排比抒情、「他没有说话，只是……」「只是＋一个动作」收尾、「就在这时／突然」转折、「不知过了多久」跳时间、格言式哲理句收尾、环境恰好配合情绪。",
      "不用星河、深渊、电流穿身、心被攥紧这类夸张意象；不把「复杂、微妙、沉重」这类抽象词当作情绪的终点。",
      "去模板不等于去文学性：有具体情境支撑、新鲜贴切的比喻可以用；也不要矫枉过正写成「他抬手。走过去。坐下。」式的动作流水账。判断标准只有一个：这句话有没有让读者更具体地看见这个人。",
    ].join("\n"),
  },
  {
    id: "anti-template",
    displayName: "防二次八股",
    source: "《AI角色扮演「机械化八股与高频词句」拦截指令》（精简改写）",
    kind: "craft",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: [],
    priority: 85,
    content: [
      "情绪不停在抽象标签上：「复杂、微妙、沉重、压抑、难以言说」这类词不能当终点，要落到行为、对话、身体变化或和环境的互动上。",
      "不用「他只是看着你／她只是沉默了」这类「只是＋一个动作」当情绪的句号；不固定套「看见→心里一紧→很快恢复平静」的三段式。",
      "人物不把自己的情绪精准命名（「他意识到自己嫉妒了」）；做完一件事后，不用旁白解释深层含义，不写「这是他第一次意识到……」式总结。",
      "环境不刻意配合情绪（告别时恰好起风、心碎时恰好下雨）；结尾落回具体的行为或感知，不升华成人生感悟。",
      "人物不必永远「在状态」：可以走神、疲惫、敷衍、话说一半、词不达意；同样的刺激不必每次同样的反应。",
      "不要换成另一种单一模板：全短句、全动作、全对白、全意识流都算；同一段里允许对话、动作、停顿和环境交错。",
    ].join("\n"),
  },
  {
    id: "aesthetic-cliche",
    displayName: "去油腻意象",
    source: "《审美重构：去八股化艺术流写作指令》（只取通用部分，精简改写）",
    kind: "craft",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: [],
    priority: 75,
    content: [
      "避开被用滥的身体与气味描写：喉咙滚动、生理性泪水、雪松／烟草／薄荷味、「修长的手指」「大手」这类机械的部位特写。",
      "避开陈腐比喻：涟漪、小兽／野兽、猎物、棋子、浮木、神明与信徒、藤蔓、手术刀、心理「防线」。",
      "台词不油腻、不居高临下：不写「有意思」「你在玩火」「我的共犯」「这种程度就受不了了？」这类审视式台词，也不让人物自己解说行为动机。",
      "少用「漂亮、邪魅、玩味、占有欲、窒息感」这类笼统词；与其给情绪下定义，不如写一样东西的具体变化（冰块化了，桌上留下一圈水渍）。",
      "这些只是去套话；要不要写心理活动、要不要用镜头感写法，由所选文风决定。",
    ].join("\n"),
  },
  {
    id: "dialogue-voice",
    displayName: "对白与段落",
    source: "《AI角色扮演「机械化八股与高频词句」拦截指令》（精简改写）",
    kind: "craft",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: [],
    priority: 80,
    content: [
      "不给每句台词都配一组动作和神态；对白可以独立存在，状态靠语气和措辞带出来。",
      "不同人物说话要能分辨：用词、句长、口头习惯各不相同；现代背景的日常对话用现代人会说的话。",
      "日常对话允许废话、打岔、重复确认和跑题，不是每句都要推进剧情或传递情绪；不写大段独白式的情感剖析。",
      "段落长短服从内容密度，不为了整齐拉平字数；开场可以从动作、对话或人物的念头切入，不固定从感官清单开场。",
    ].join("\n"),
  },
  {
    id: "emotion-dynamics",
    displayName: "情感反馈与层次",
    source: "《情感维度》（精简改写）",
    kind: "character",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: ["伤害", "冲突", "争吵", "吵架", "虐", "控制", "囚", "病娇", "黑化", "背叛", "报复", "道歉", "愧疚", "折磨", "痛苦", "恨"],
    priority: 60,
    content: [
      "人物不是只会执行动作的木偶：对方的疼痛、恐惧、沉默或反抗，会在人物心里引起真实的变化——迟疑、找理由、改变做法、内心冲突，变化方式由人物的核心性格决定。",
      "人物很少把自己当成单面的坏人。伤害了对方时，不写「我这样都是因为爱你」式的扁平套路，而是写意图与结果之间的落差，以及人物怎样合理化、否认或面对这个矛盾。",
      "目标伤害到对方时，人物会调整：退后、道歉、换成更隐蔽的方式，或者真的后悔——看人设。多用潜台词、细小表情和「想要的」与「看到对方受苦时的反应」之间的拉扯。",
    ].join("\n"),
  },
  {
    id: "armor-break",
    displayName: "防御与破甲",
    source: "《破甲世界书 · 通用完整版》（精简改写）",
    kind: "character",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: ["嘴硬", "高冷", "傲娇", "冷漠", "疏离", "防备", "心结", "创伤", "坦白", "真心", "告白", "重逢", "破防", "逞强", "伪装", "面具"],
    priority: 55,
    content: [
      "每个人都有自己的「甲」：冷漠、理性、玩笑、强势、退让、嘴硬、完美、疏离、讨好……甲保护的是各自害怕的东西（受伤、失控、被看穿、被抛弃）。先认出人物的甲，再写它怎么被打开。",
      "打开是过程，不是开关：社交面具 → 情绪防线 → 真实想法 → 脆弱面 → 核心伤口，一层一层来，不跳步；越往里越需要信任的积累或足够强的情境。",
      "触发要有来由：反复追问、被戳破的真话、预期被推开时对方没走、对方先示弱、深夜独处、久别重逢、积累到最后一根稻草。突然崩塌之前要有铺垫。",
      "露出真心后人物往往会后悔、找补、重新穿上甲，但下一次打开得更快——这才像真人。破甲是让人物露出人味，不是让人物崩溃给读者看。",
    ].join("\n"),
  },
  {
    id: "relationship-boundary",
    displayName: "关系的边界",
    source: "书房原创",
    kind: "relationship",
    scope: STUDYROOM_WRITING_SCOPE,
    enabled: true,
    triggerKeys: ["喜欢", "恋爱", "暧昧", "亲密", "情侣", "吃醋", "约会", "同居", "结婚", "婚", "心动", "表白"],
    priority: 50,
    content: [
      "亲密关系里的双方都是独立的人：尊重拒绝，不把「不要」写成暗示；关心通过具体选择表达，不把照顾写成控制、查岗或占有。",
      "关系的推进来自真实互动，不靠强行误会、故意冷落或无休止的拉扯；双方都有表达和回应的空间。",
      "不写露骨性行为；需要时用场景切换、事后的细节或留白处理。",
    ].join("\n"),
  },
];

/** 每次请求带的写作规范总字数上限，避免把所有条目都塞进去（常驻四条约 1400 字，留余量给关键词条目）。 */
const DEFAULT_BUDGET = 2600;

/**
 * 组合本次写作要带的规范：只在 scope 为书房写作时返回内容。
 * 常驻条目 + 关键词命中的条目，按 priority 排序、按 id 去重，超出预算的低优先级条目不带。
 */
export function composeWritingWorldbook(
  scope: WritingScope | string,
  contextText: string,
  budget = DEFAULT_BUDGET,
): { block: string; ids: string[] } {
  if (scope !== STUDYROOM_WRITING_SCOPE) return { block: "", ids: [] };
  const text = contextText || "";
  const seen = new Set<string>();
  const picked: WritingWorldbookEntry[] = [];
  let used = 0;
  const candidates = WRITING_WORLDBOOK.filter(
    (entry) =>
      entry.enabled &&
      entry.scope === STUDYROOM_WRITING_SCOPE &&
      (entry.triggerKeys.length === 0 || entry.triggerKeys.some((key) => text.includes(key))),
  ).sort((a, b) => b.priority - a.priority);
  for (const entry of candidates) {
    if (seen.has(entry.id)) continue;
    if (used + entry.content.length > budget) continue;
    seen.add(entry.id);
    picked.push(entry);
    used += entry.content.length;
  }
  if (picked.length === 0) return { block: "", ids: [] };
  const block = [
    "【书房内置写作规范（只管通用写作质量。优先级：用户本次的要求、人物与剧情设定 > 用户选的文风（管写法）和作品／角色关联的世界书（管设定）> 本规范；冲突时本规范让步）】",
    ...picked.map((entry) => `〔${entry.displayName}〕\n${entry.content}`),
  ].join("\n");
  return { block, ids: picked.map((entry) => entry.id) };
}
