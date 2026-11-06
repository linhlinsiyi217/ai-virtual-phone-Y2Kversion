# AGENTS.md — 项目协作准则（所有 AI 必读）

本文件是给所有参与本仓库的 AI 看的硬性规则。动手前先读完。

## 一、仓库与分支

- 唯一主仓库：`linhlinsiyi217/ai-virtual-phone-Y2Kversion`，只改 `main`
- 不修改、不推送：`ai-virtual-phone123float`
- 冲突时：**不要删除用户已有实现**；把冲突点列出来，给用户选项由他决定

## 二、融合来源与优先级

| 来源 | 提供什么 |
|---|---|
| `linhlinsiyi217/float-0217` | 书房（已合入） |
| `xiaolongbao0709/ai-virtual-phone` | 功能完整基线（小卷、工坊、剧情等） |
| `doremy1203/doremy.float.phone` | 聊天音效、剧情增强、收藏 |
| `jianchu-in/momo.float.phone` | 剧情外观、收藏、访谈、记忆修复 |

优先级：书房 > 其他已有应用 > 原本音乐应用 > Y2K 原始应用。
冲突时以 Y2K 的结构和外观为准，不覆盖核心功能。

## 三、每次推送必须同时更新更新日志（硬性）

只要这次推送会部署到 Vercel，就必须在同一个提交里做完下面三件事，缺一不可：

1. `public/update-log.json` 最前面插入一条新记录（新的 `id`、递增的 `version`、
   当天日期、标题，以及按应用分组的改动）
2. `package.json` 的 `version` 与日志里最新一条一致
3. 文案要求：
   - **更新弹窗**：每条改动是一句话标题 + 一句灰字解释
   - **更新公告**：同上，能让人一眼知道这次改了什么、影响哪里
   - **更新日志**：写详细的大白话，说清「以前什么样、现在什么样」；
     **不许出现代码、文件名、样式词、英文缩写**

提交前本地执行：

```bash
node scripts/check-changelog.mjs
```

不通过就不要提交。

## 四、界面规范（黑白极简）

完整规范见 `docs/` 下的黑白界面说明书。要点：

- 只用这些颜色：`--ui-bg` 白、`--ui-ink` 近黑、`--ui-muted` 灰、
  `--ui-group` 雾灰、`--ui-line` 细线、`--ui-green` 仅表示开启/成功
- 分组卡片圆角 24px，组内条目用 0.5px 发丝线分隔，组间距 24px
- 列表条目：17/24 大标题 + 14/21 灰字说明
- 禁止彩色玻璃图标、禁止大面积渐变与拟态阴影
- 桌面应用图标允许用户换成图片，改样式不得破坏换图

## 五、每次改动后

```bash
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
```

只允许存在已知的存量错误（`components/chat/share-destination-sheet.tsx` 与
`components/desktop-shell.tsx` 各一处），新增错误必须清零。
