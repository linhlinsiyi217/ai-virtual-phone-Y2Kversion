"use client";

// G4 HTML 互动卡片气泡：把用户在「剧情」App 里编辑的 HTML/CSS 小片段作为聊天消息发送，
// 气泡内用 sandbox iframe 渲染，可点击、可输入（真正的「互动」），
// 同时样式与脚本都被隔离在卡片里，拿不到小手机与站点的任何数据。

import { useState } from "react";
import { Code2, Maximize2, Minimize2 } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";

/** iframe 高度分档，避免超长内容把消息流撑爆 */
const HEIGHT_STEPS = [180, 260, 380] as const;

export function HtmlInteractiveBubble({ msg }: { msg: ChatMessage }) {
    const [stepIndex, setStepIndex] = useState(0);
    const height = HEIGHT_STEPS[Math.min(stepIndex, HEIGHT_STEPS.length - 1)];
    const html = msg.content || "";

    // srcdoc 里套一个基础样式，让片段不用自己写 font-family 也好看
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;padding:10px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.6;color:#1c1c1e;background:#fff;}
button{font-size:13px;padding:6px 12px;border:none;border-radius:8px;background:#5b4ddb;color:#fff;cursor:pointer;}
input,textarea,select{font-size:13px;padding:6px 8px;border:1px solid rgba(0,0,0,.15);border-radius:8px;}
</style></head><body>${html}</body></html>`;

    return (
        <div className="bubble html-interactive-bubble">
            <div className="html-interactive-head">
                <Code2 size={14} strokeWidth={1.8} />
                <span>HTML 互动卡</span>
                <button
                    type="button"
                    className="html-interactive-resize"
                    aria-label={stepIndex >= HEIGHT_STEPS.length - 1 ? "收起高度" : "展开高度"}
                    onClick={() => setStepIndex(i => (i >= HEIGHT_STEPS.length - 1 ? 0 : i + 1))}
                >
                    {stepIndex >= HEIGHT_STEPS.length - 1 ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
                </button>
            </div>
            {/* allow-scripts 与 allow-same-origin 互斥：脚本能跑，但拿不到父页面任何东西 */}
            <iframe
                className="html-interactive-frame"
                title="HTML 互动卡片"
                sandbox="allow-scripts allow-forms allow-pointer-lock"
                srcDoc={doc}
                style={{ height }}
            />
        </div>
    );
}
