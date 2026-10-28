// lib/study-room/forum-prompt.ts — 书友圈（论坛）的请求组装层。
//
// 为什么单独一个文件：
//  论坛有多个真实生成入口（首页帖子、评论、回复），以前每个入口自己拼一个提示词字符串，
//  结果用户规则里的「自动帖子类型 / 每次生成几条 / 内容边界」根本没进请求——改设置等于没改。
//  这里统一成一份 builder：所有入口都经过 buildForum*Messages()，产出模型**实际收到的
//  messages 数组**（system + user），检查脚本据此断言规则、作者资料与活人感规则真的传到了供应商。
//
// 供应商差异：
//  不同供应商对 system 角色的支持不一样。这里不靠「谁支持就发、不支持就悄悄丢掉」，
//  而是先按统一形状组装，再交给 adaptMessagesForProvider() 做**显式转换**，
//  转换结果仍然是一次合法请求，文本一个字都不少。
//
// 与私聊的关系：这是论坛规则。一对一书房私信走 lib/study-room/dm.ts 的私聊规则，两者不共用。

// 本文件刻意不 import 任何运行时模块：检查脚本用 Node 直接加载它（不经过打包器的 @/ 路径别名）。
// 「当前配置属于哪种协议」的判断放在 forum.ts（forumMessagesFor），那里复用公共 API 层的规则。

/** 用户本人在书友圈里的固定 id（与 forum.ts 的 USER_ID 一致，这里重复写死避免反向 import）。 */
const USER_ID = "user";

/** 提示词版本：调试日志只记这个版本号，不记正文（见 forumRequestMeta）。 */
export const FORUM_PROMPT_VERSION = "forum-prompt/2026-10-08.1";

/** 论坛的基础活人感规则。这部分稳定、与具体任务无关，放在 messages 最前面（也是缓存前缀）。 */
export const FORUM_HUMANLIKE_BASE = [
  "【任务】",
  "为本应用的书友圈生成指定类型和数量的帖子或评论。每位作者是有固定身份和阅读偏好的虚构书友。",
  "只输出当前接口要求的数据结构，不输出执行说明、分析过程或模型身份声明。",
  "",
  "【发言依据】",
  "按提供的书友资料、帖子上下文、书籍资料及用户规则发言。",
  "没有给出的阅读经历、私人互动、原文引用或剧情细节，不要编成已经发生的事实。",
  "只听说一本书时就按听说的立场表达，不假装读完。允许不确定、没看懂、保留意见。",
  "",
  "【口吻与差异】",
  "每位书友有自己的用词、关注点、句子长度和情绪强度。",
  "认真分析的人可以写长评，随口接话的人可以只写一两句；不要所有人都热情、都爱用网络梗、都在最后问一个问题。",
  "作者身份和已有公开互动应前后一致。",
  "",
  "【内容】",
  "优先写一个具体感受、争议、疑问或阅读细节，再按需要展开。",
  "评论要回应本帖具体内容，回复要回应所回复的那个人；不要把主帖换词复述。",
  "可以同意、反对、补充、追问或暂时没有结论。不要每条都凑成完整议论文。",
  "",
  "【书写习惯】",
  "论坛不限制格式：正常使用标点，长评允许分段写满一段话，引用书名、作者名、角色名都正常写。",
  "不要为了显得像真人而刻意去掉句号或引号，也不要刻意塞错字、颜文字、哈哈或装熟的称呼。",
  "短评可以只有一两句，长评可以成段，按内容需要决定，不设固定行数。",
  "",
  "【去 AI 腔】",
  "不要无缘由地使用「这不仅是……更是……」「引发深刻思考」「值得我们反思」等泛泛总结；",
  "不要每帖固定开头、三点分析和升华结尾。",
  "具体表达优先于抽象赞美，不强行安慰、说教或抖机灵。",
  "",
  "【边界与剧透】",
  "遵守用户的内容边界、剧透设置和来源信息。",
  "根据内容真实标记剧透，不为凑帖子数量捏造剧情、引用、热度或参与人数。",
  "",
  "【输出前检查】",
  "检查是否不同作者却同一个腔调，是否同批次重复结构或观点，是否捏造事实，是否符合用户设置的类型和数量，以及结构字段是否完整。",
  "直接输出结果，不展示检查过程。",
].join("\n");

/** 只作定调，不要照抄。说明「有差异」和「同一个腔调」的区别。 */
const STYLE_EXAMPLES = [
  "【风格示例（只作定调，不要照抄，也不要每批都用同一组）】",
  "同一个话题下，不同人的发言应该长这样才对——长短不一样，态度也不一样：",
  "「刚看完第三章，主角那段的处理我觉得有点急，前面铺垫了那么久，收得太快了。有人同感吗？」",
  "「喜欢。」",
  "「不太同意楼上，我倒觉得收得挺利落，就是结尾那句有点用力。」",
].join("\n");

/** builder 需要的最小书友字段。做成结构类型，避免与 forum.ts 互相 import 成环。 */
export type ForumPromptNpc = {
  id: string;
  nickname: string;
  occupation?: string;
  background?: string;
  personality?: string;
  interests?: string[];
  readingTaste?: string;
  speechStyle?: string;
  relations?: string;
  age?: string;
  region?: string;
  shelfTitles?: string[];
  characterId?: string;
};

/** builder 会读到的用户规则字段；缺项按默认值处理，不让空值把规则整段吞掉。 */
export type ForumPromptRules = {
  feedTypes?: string;
  feedCount?: number;
  feedScope?: string;
  searchScope?: string;
  commentLength?: string;
  commentTone?: string;
  commentRelation?: string;
  commentFollowUp?: boolean;
  hotTopics?: string;
};

export type ForumRequestMessage = { role: "system" | "user" | "assistant"; content: string };

export type ForumTopicInput = {
  label: string;
  key?: string;
  bookTitle?: string;
  bookId?: string;
  prompt?: string;
};

const clean = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/** 一位书友的公开资料，写成模型能直接用的人话。 */
export function forumNpcCard(npc: ForumPromptNpc): string {
  const lines = [`昵称：${npc.nickname}`];
  if (clean(npc.occupation)) lines.push(`职业/领域：${clean(npc.occupation)}`);
  if (clean(npc.age)) lines.push(`年龄段：${clean(npc.age)}`);
  if (clean(npc.region)) lines.push(`常驻：${clean(npc.region)}`);
  if (clean(npc.background)) lines.push(`背景：${clean(npc.background)}`);
  if (clean(npc.personality)) lines.push(`性格：${clean(npc.personality)}`);
  if (npc.interests && npc.interests.length > 0) lines.push(`兴趣：${npc.interests.map(clean).filter(Boolean).join("、")}`);
  if (clean(npc.readingTaste)) lines.push(`阅读口味：${clean(npc.readingTaste)}`);
  if (clean(npc.speechStyle)) lines.push(`说话习惯：${clean(npc.speechStyle)}`);
  if (clean(npc.relations)) lines.push(`与其他书友/用户的关系：${clean(npc.relations)}`);
  if (npc.shelfTitles && npc.shelfTitles.length > 0) {
    lines.push(`公开书架上的几本：${npc.shelfTitles.map(clean).filter(Boolean).slice(0, 6).join("、")}`);
  }
  return lines.join("\n");
}

/** 用户当前生效的规则，逐条进 system。空字符串表示这一条没设，就不写进去。 */
export function forumRulesBlock(rules: ForumPromptRules, forComments: boolean): string {
  const lines: string[] = ["【用户当前设置的规则（必须生效）】"];
  if (forComments) {
    if (clean(rules.commentLength)) lines.push(`· 评论长度：${clean(rules.commentLength)}`);
    if (clean(rules.commentTone)) lines.push(`· 评论语气：${clean(rules.commentTone)}`);
    if (clean(rules.commentRelation)) lines.push(`· 关系把握：${clean(rules.commentRelation)}`);
    lines.push(
      rules.commentFollowUp === false
        ? "· 这一组设置里不允许反问：直接回应，不要反抛问题。"
        : "· 允许顺着内容追问一句（不是每一条都要问）。",
    );
  } else {
    if (clean(rules.feedTypes)) lines.push(`· 可以发的帖子类型：${clean(rules.feedTypes)}`);
    if (typeof rules.feedCount === "number" && rules.feedCount > 0) {
      lines.push(`· 本批帖子数量：一共 ${rules.feedCount} 条，不要多也不要少。`);
    }
  }
  if (clean(rules.feedScope)) lines.push(`· 内容边界：${clean(rules.feedScope)}`);
  if (clean(rules.searchScope)) lines.push(`· 相关度口径：${clean(rules.searchScope)}`);
  if (clean(rules.hotTopics)) lines.push(`· 近期大家在聊：${clean(rules.hotTopics)}`);
  return lines.length > 1 ? lines.join("\n") : "";
}

/** 一位书友的隐藏背景（角色人设 + 关联世界书常驻条目）。只作背景，不照念。 */
export function forumBackgroundBlock(background: string | undefined): string {
  const text = (background ?? "").trim();
  return text ? `【这位书友的隐藏背景（不要直接念出来，只用来影响 TA 的立场与措辞）】\n${text}` : "";
}

export type ForumPostMessagesInput = {
  topic: ForumTopicInput;
  participants: ForumPromptNpc[];
  rules: ForumPromptRules;
  /** 按 npc.id 索引的隐藏背景 */
  backgrounds?: Record<string, string>;
  /** 已有的近期标题，用来避免同批撞车 */
  recentTitles?: string[];
};

/**
 * 首页帖子 / 一次多帖的请求组装。
 * 一条请求内为多位作者各写各自的帖子——不按作者拆成多次调用（那也是用户设置里「一次几条」的语义）。
 */
export function buildForumPostMessages(input: ForumPostMessagesInput): ForumRequestMessage[] {
  const { topic, participants, rules } = input;
  const count = typeof rules.feedCount === "number" && rules.feedCount > 0 ? Math.floor(rules.feedCount) : participants.length;
  const names = participants.map((npc) => npc.nickname).join("、");

  const system = [
    "你在模拟一个开放的读书论坛「书友圈」，几位书友正围绕一个话题发言。书友都是普通人，领域各不相同。",
    "这一批内容由模型生成，界面会保留 AI 标识。",
    "",
    FORUM_HUMANLIKE_BASE,
    "",
    STYLE_EXAMPLES,
    "",
    forumRulesBlock(rules, false),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  // 隐藏背景按内容去重：两位书友若挂同一个角色，同一份人设/世界书只注入一次。
  const seenBackground = new Set<string>();
  const people = participants
    .map((npc) => {
      const raw = (input.backgrounds?.[npc.id] ?? "").trim();
      let background: string | undefined = raw || undefined;
      if (raw) {
        if (seenBackground.has(raw)) background = "（与上面某位用的是同一份角色设定，不重复给出）";
        else seenBackground.add(raw);
      }
      return [forumNpcCard(npc), forumBackgroundBlock(background)].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const user = [
    `本轮话题：${clean(topic.label)}`,
    topic.bookTitle ? `相关书籍：《${clean(topic.bookTitle)}》（不要求大家都读过，可以只看过简介或听过）` : "",
    topic.prompt ? `发起人想聊的是：${clean(topic.prompt)}` : "",
    "",
    `本轮参与的书友（共 ${participants.length} 位）：`,
    people,
    "",
    `本批一共要产出 ${count} 条发言，由上面这些书友分别写（同一位可以写多条，但口吻要分得开）。`,
    input.recentTitles && input.recentTitles.length > 0
      ? `已有帖子的标题（不要与这些重复）：${input.recentTitles.slice(0, 8).map(clean).filter(Boolean).join(" / ")}`
      : "",
    "",
    "输出格式：只输出 JSON 数组，不要写解释、不要用代码块以外的任何包裹文字。每项字段：",
    '- author：必须是上面某一位的昵称，一字不差（不要写"某位书友"这类占位）。',
    '- kind：只能是 "post"（闲聊/讨论）、"review"（书评）、"recommend"（推荐）三者之一。',
    "- title：字符串，可留空；不要写剧情结局或关键反转。",
    "- body：正文，字符串，非空。",
    "- bookTitle：字符串，可留空。",
    "- spoiler：布尔值，含剧透写 true，否则 false。",
    `参与者昵称列表（author 只能从这里选）：${names}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export type ForumCommentMessagesInput = {
  post: {
    id: string;
    authorId: string;
    authorName: string;
    title?: string;
    body: string;
    bookTitle?: string;
    comments?: { id: string; authorId: string; authorName: string; body: string }[];
  };
  npc: ForumPromptNpc;
  rules: ForumPromptRules;
  /** 回复某一条评论时带上 */
  target?: { id: string; authorId: string; authorName: string; body: string };
  meName?: string;
  background?: string;
};

/** 评论 / 回复某条评论的请求组装。两者共用一套规则，只是有没有「在回谁」。 */
export function buildForumCommentMessages(input: ForumCommentMessagesInput): ForumRequestMessage[] {
  const { post, npc, rules, target } = input;
  const recent = (post.comments ?? [])
    .filter((comment) => !target || comment.id !== target.id)
    .slice(-6)
    .map((comment) => `- ${comment.authorName}：${comment.body.slice(0, 80)}`)
    .join("\n");

  const system = [
    `你在扮演读书论坛「书友圈」里的书友「${npc.nickname}」，现在要去回别人的帖子。`,
    "这一批内容由模型生成，界面会保留 AI 标识。",
    "",
    FORUM_HUMANLIKE_BASE,
    "",
    "【你是谁】",
    forumNpcCard(npc),
    input.meName ? `用户（楼主可能是 TA）的名字是「${input.meName}」。` : "",
    forumBackgroundBlock(input.background),
    "",
    forumRulesBlock(rules, true),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  const user = [
    target ? "下面是一条论坛评论，请以这个身份回一条评论。" : "下面是论坛里的一条帖子，请以这个身份回一条评论。",
    "",
    `楼主：${post.authorName}${post.authorId === USER_ID ? "（就是你认识的这位用户）" : ""}`,
    post.bookTitle ? `关联书籍：《${post.bookTitle}》` : "",
    post.title ? `标题：${post.title}` : "",
    `正文：${post.body.slice(0, 600)}`,
    recent ? `\n已有评论（不要重复这些说法，也不要模仿它们的句式）：\n${recent}` : "",
    target
      ? `\n你这次是回复 ${target.authorName}${target.authorId === USER_ID ? "（用户本人）" : ""} 的这条评论：「${target.body.slice(0, 200)}」。\n直接接着这一句说，不要另起话题。`
      : "",
    "",
    "如果内容透露了剧情走向、结局或关键反转，就在正文最开头写「[剧透]」（界面会自动遮住并打上剧透标记，正文里不要再重复写这个词）。",
    "只输出评论本身：不要加引号，不要写自己的昵称，不要写「[剧透]」以外的任何标记，不要输出 JSON。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── 供应商角色适配 ──

export type ForumProviderKind = "openai-compatible" | "anthropic" | "gemini";

/**
 * 把统一形状的 messages 转成 **simpleLLMCall 能原样发出去** 的形状。
 *
 * 为什么必须在这里转，而不是交给 simpleLLMCall：
 *  · Anthropic 分支会自己做一次「取出第一条 system 提到顶层」的转换——
 *    所以保持「一条 system + 一条 user」不变，它正好能正确处理；
 *  · Gemini 分支把**所有**角色都映射成 user/model 的 parts。如果照原样传一条 system，
 *    它会被转成第二个连续 user 段，Gemini 协议不接受连续同角色，请求会直接失败。
 *    所以 Gemini 走这里把 system 文本并进第一条 user（内容是拼接，一个字都不删）；
 *  · OpenAI 兼容（含中转/自定义地址）：原样透传，system 仍是 system 角色。
 *
 * 三条路径都不丢内容，也不靠「不支持就悄悄删掉」。
 */
export function adaptMessagesForProvider(
  messages: ForumRequestMessage[],
  kind: ForumProviderKind,
): ForumRequestMessage[] {
  if (kind === "openai-compatible" || kind === "anthropic") {
    // 两条路径都保持原形状：前者透传，后者由 simpleLLMCall 提到顶层 system。
    return messages.map((message) => ({ role: message.role, content: message.content }));
  }

  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const rest = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }) as ForumRequestMessage);
  if (!systemText) return rest;

  const firstUser = rest.findIndex((message) => message.role === "user");
  if (firstUser === -1) return [{ role: "user", content: systemText }, ...rest];
  return rest.map((message, index) =>
    index === firstUser ? { ...message, content: `${systemText}\n\n---\n\n${message.content}` } : message,
  );
}

// ── 输出预算与半截 JSON ──

/**
 * 一批帖子的输出上限，按条数放大。
 * 以前固定 1600：用户把「每次几条」调到 6–8 时，长书评很容易写到一半被截断，
 * 整个 JSON 数组解析失败，这一次付费请求就白花了。上限只是天花板，模型写完就停，不会因此变慢。
 */
export function forumFeedMaxTokens(count: number): number {
  const n = Math.max(1, Math.min(8, Math.floor(count) || 1));
  return Math.min(4000, 600 + n * 420);
}

/**
 * 从可能被截断的 JSON 数组里只取出**完整**的对象。
 * 半截的最后一项直接丢弃（半截 JSON 不能算一条帖子），已经写完整的前几项保留。
 * 能完整解析时与 JSON.parse 结果一致。
 */
export function completeJsonObjects(raw: string): unknown[] {
  const text = raw.trim();
  const start = text.indexOf("[");
  if (start === -1) return [];
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          // 这一项本身不合法，跳过，不影响其他项
        }
        objStart = -1;
      }
      if (depth < 0) break;
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

// ── 总时长上限 ──

/** 首页一批帖子 / 单条评论的总等待上限（不是承诺的完成时间，只是超过就停，不让请求无限挂着）。 */
export const FORUM_FEED_TIMEOUT_MS = 120_000;
export const FORUM_COMMENT_TIMEOUT_MS = 60_000;

/**
 * 把用户的「停止」和总时长上限合成一个 signal。
 * 不依赖 AbortSignal.any（部分手机浏览器还没有），手动转发。
 * 用完必须调用 done() 清掉计时器；timedOut() 用来区分「用户点了停止」和「等太久」。
 */
export function forumDeadline(userSignal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut && !userSignal?.aborted,
    done: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onAbort);
    },
  };
}

// ── 调试元数据 ──

export type ForumRequestMeta = {
  version: string;
  /** 上下文来源：home-feed / comment / comment-reply / npc / dm */
  source: string;
  roles: string[];
  systemChars: number;
  userChars: number;
  /** 粗略估算，只用于排查「注入了多少」，不是账单口径 */
  estimatedTokens: number;
  /** 进场的东西：书友数、是否带世界书背景、规则条数 */
  npcCount?: number;
  backgroundCount?: number;
  ruleFields?: string[];
  elapsedMs?: number;
};

/**
 * 调试日志只记这些元数据：提示词版本、上下文来源、体积、耗时。
 * 不记录密钥，也不记录完整正文（私信正文尤其不能进日志）。
 */
export function forumRequestMeta(
  messages: ForumRequestMessage[],
  source: string,
  extra?: { npcCount?: number; backgroundCount?: number; ruleFields?: string[]; elapsedMs?: number },
): ForumRequestMeta {
  const systemChars = messages.filter((m) => m.role === "system").reduce((sum, m) => sum + m.content.length, 0);
  const userChars = messages.filter((m) => m.role !== "system").reduce((sum, m) => sum + m.content.length, 0);
  return {
    version: FORUM_PROMPT_VERSION,
    source,
    roles: messages.map((m) => m.role),
    systemChars,
    userChars,
    estimatedTokens: Math.ceil((systemChars + userChars) / 2.5),
    ...extra,
  };
}

/** 只挑出「用户真的填过 / 真的改过」的规则字段名，用于调试元数据；空值不算。 */
export function forumRuleFields(rules: ForumPromptRules): string[] {
  return Object.entries(rules)
    .filter(([, value]) => {
      // 布尔项默认是开的，只有被用户关掉才值得记一笔
      if (typeof value === "boolean") return !value;
      if (typeof value === "number") return value > 0;
      return String(value ?? "").trim().length > 0;
    })
    .map(([key]) => key);
}

/** 只在开了调试开关时打印，且只打印元数据。 */
export function logForumRequest(meta: ForumRequestMeta): void {
  if (typeof console === "undefined") return;
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("ai_phone_debug_prompt") !== "1") return;
  } catch {
    return;
  }
  console.debug("[forum-prompt]", meta);
}
