// app/api/study-room/style/route.ts — 文风的**服务端组合入口**。
//
// 为什么要经过服务端：完整文风规则只保存在 lib/server/writing-styles.ts，
// 浏览器拿不到它；这里在调用模型之前把「文风 + 强度 + 写作任务」组合成完整提示词，
// 再把模型返回的正文原样给回客户端。
//
// 说明：写作要用的是用户自己在设置里绑定的 API（存在浏览器里），
// 因此请求体里会带上该配置——它只发到用户自己的这份部署，不经过第三方。

import { NextResponse } from "next/server";

import { simpleLLMCall } from "@/lib/api-helpers";
import type { ApiConfig } from "@/lib/settings-types";
import {
  PROMPT_GUARD,
  STRENGTH_LABEL,
  composeStyleBlock,
  findStyle,
  styleMeta,
  type StyleStrength,
} from "@/lib/server/writing-styles";
import { STUDYROOM_WRITING_SCOPE, composeWritingWorldbook } from "@/lib/study-room/writing-worldbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRENGTHS: StyleStrength[] = ["light", "standard", "dense"];

export async function GET() {
  return NextResponse.json({ styles: styleMeta(), strengths: STRENGTH_LABEL });
}

type PreviewBody = {
  task: "preview" | "chapter";
  styleId: string;
  strength?: StyleStrength;
  /** 预览用的题材/设定片段，或写下一章时的全部上下文 */
  brief?: string;
  chapterNumber?: number;
  targetWords?: number;
  apiConfig?: ApiConfig;
};

export async function POST(request: Request) {
  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const style = findStyle(body.styleId);
  if (!style) {
    return NextResponse.json({ error: "没有这套文风" }, { status: 404 });
  }
  const strength: StyleStrength = STRENGTHS.includes(body.strength as StyleStrength)
    ? (body.strength as StyleStrength)
    : "standard";
  if (!body.apiConfig?.apiKey || !body.apiConfig?.defaultModel) {
    return NextResponse.json({ error: "还没有可用的模型配置" }, { status: 400 });
  }

  const styleBlock = composeStyleBlock(style, strength);

  const task =
    body.task === "preview"
      ? [
          `请用这套文风写一段 300–500 字的试写，作为风格样例。`,
          body.brief?.trim() ? `题材与设定：${body.brief.trim()}` : "题材自定，写一个能体现这套文风的场景即可。",
          "只输出正文，不要标题、不要说明。",
        ]
      : [
          `请写第 ${body.chapterNumber ?? 1} 章的正文。`,
          "第一行用「第N章 标题」的格式给出本章标题，之后是正文；不要写解说或自我评价。",
          body.targetWords ? `篇幅控制在 ${body.targetWords} 字左右。` : "",
          body.brief?.trim() ?? "",
        ];

  // 书房写作规范：这个接口只服务书房写书，范围在这里写死，不看请求体；设定与前文用来匹配关键词
  const worldbook = composeWritingWorldbook(STUDYROOM_WRITING_SCOPE, body.brief ?? "").block;
  const prompt = [worldbook, styleBlock, PROMPT_GUARD, "", ...task].filter(Boolean).join("\n");

  try {
    const result = await simpleLLMCall(
      body.apiConfig,
      [{ role: "user", content: prompt }],
      {
        temperature: body.task === "preview" ? 0.9 : 0.85,
        max_tokens: body.task === "preview" ? 900 : Math.min(Math.max((body.targetWords ?? 2000) * 2, 800), 8000),
        label: `studyroom-style-${body.task}`,
      },
    );
    if (result.error || !result.content) {
      return NextResponse.json({ error: result.error || "模型没有返回内容" }, { status: 502 });
    }
    // 只把生成结果给浏览器；规则本身不返回
    return NextResponse.json({ text: result.content, style: style.name, strength });
  } catch {
    return NextResponse.json({ error: "生成失败，请稍后再试" }, { status: 502 });
  }
}
