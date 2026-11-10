# 更新日志规则（所有 AI 必读，改任何东西之前先读）

本项目每次有用户看得到的改动，都必须在**同一次提交**里完成这三件事：
1. 在 `public/update-log.json` 最前面新增一条记录（新的 id，格式 YYYYMMDD-N；版本号升高）。
2. 内容只能根据这次真正改了什么来写（对照 `git diff` / `git log`），用大白话，说清楚之前什么样、现在什么样，**不许写代码、文件名、样式词**，不许照抄参考图或别的项目。
3. 运行 `npm run check:changelog`，通过后才能说“做完了”。

禁止：删除或绕开更新系统（UpdateCenter、update-log.json、version.json、scripts/check-changelog.mjs、.githooks、changelog-gate）；使用 `--no-verify` 或 `SKIP_LOG`（只有主人本人可以用）。
完整说明见 `UPDATE_POPUP_GUIDE.md`。回复主人时用大白话，最后一句写：“更新日志：已写入 v版本号”。

---

## 附：本仓库的协作约定（保留）

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

## 四、界面规范（黑白极简）

- 只用：`--ui-bg` 白、`--ui-ink` 近黑、`--ui-muted` 灰、`--ui-group` 雾灰、`--ui-line` 细线、`--ui-green` 仅表示开启/成功
- 分组卡圆角 24px，组内 0.5px 发丝分隔线，组间距 24px
- 列表条目 17/24 大字 + 14/21 灰字
- 禁止彩色玻璃图标、大面积渐变与拟态阴影
- 桌面图标可换图片，改样式不得破坏换图

## 五、每次改动后

```bash
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
```

只允许存量错误（`share-destination-sheet.tsx`、`desktop-shell.tsx` 各一处），新增必须清零。

## 六、当前进行中的工作（每次接手先看这里）

1. 已合入：书房、剧情增强、收藏、档案室、聊天提示音、NovelAI 生图、合并版现实桥
2. 待合入的应用（来自 doremy 2026-11-06 主分支，逐个合、逐个写日志）：
   - 照片墙（自由摆放 + 涂鸦）
   - 一起看（支持某站与小红书）
   - 生活系统（行程、地点切换、线下聊天室）
   - 设备兼容诊断
3. 黑白界面精修（依据 docs 里的说明书）：
   - 已完成：设置首页、数据管理模块块、全局 token
   - 待做：资源库首页与二级页、桌面图标间距、各二级页统一列表样式
   - 要求：**进入二级页后也必须保持同一套黑白风格**，不能回落到旧样式
4. 说明书里尚未开始：虚拟账号、应用假登录、好友码、二维码

改任何一项之前，先确认它是否在上面这份清单里；不在就先问主人，不要顺手重排别的页面。

### 生活系统（唯一未合的应用）卡点清单

doremy 2026-11-06 主分支的 lib/life、components/life 已试合过一轮，缺下列接口，
补完才能合，否则类型错误会从 16 条涨到 37 条：

1. `lib/chat-storage.ts` 缺 `resolveSessionCharacterId`
   依赖链：`resolveSessionCharacterIdentity` + `loadChatContacts`
2. `lib/push-bailout-client.ts` 缺四个函数：
   `armLifeSceneProactiveBailout`、`cancelLifeSceneProactiveBailouts`、
   `reconcileIdleReconnectWithLifeScenes`、`suspendIdleReconnectForLifeScene`
3. `lib/settings-storage.ts` 缺 `USER_IDENTITIES_UPDATED_EVENT`（一个事件名常量）
4. 生成请求函数缺 `appId` 参数（生活系统按应用区分调用来源）

补法：从 doremy origin/main 的对应文件里搬这几个声明，别整份替换 Y2K 的同名文件。

### Tutu 版（Tutumaver-float-phone）合并规则与批次

主人已确认：
- **禁止改动**：书房、桌面入口清单、聊天界面外观
- **手记 → iCity**：按 Tutu 原样替换
- **新应用一次性合并、一次提交**：lysn、twitter、photos、sms
- **新接口**：相册识图、内容翻译、Fish Audio、ElevenLabs
- **一起听等能力**：并入现有「音乐」「相册」应用内部的合适位置，只加按钮与入口，不重构这两个应用
- 全局性删改（如开屏动画）未定，动之前必须再问

合并顺序：新接口 → 新应用（一批）→ 滑动置顶/隐藏/删除 → AI 行为设置页 → 音乐/相册内嵌一起听。
每个应用都要先核对 lib 依赖，缺什么补什么，不允许删现有实现。

### Tutu 第一批依赖清单（实测）

试合并 lysn / twitter / photos 时，需要补齐以下 lib 模块（缺一个就会连带报错）：

- `lib/lysn-calendar-context`
- `lib/lysn-celebrations`
- `lib/lysn-engine`
- `lib/lysn-identity`
- `lib/lysn-message`
- `lib/lysn-notification`
- `lib/lysn-profile-autonomy`
- `lib/lysn-storage`
- `lib/media-resolver`
- `lib/photo-library-storage`
- `lib/photo-library-types`
- `lib/photo-library-usage`
- `lib/photo-library-vision`
- `lib/photo-stack-utils`
- `lib/photo-story-caption`
- `lib/photo-story-data`
- `lib/photo-url-import`
- `lib/role-social-sources`
- `lib/social-identity`
- `lib/social-post-time`
- `lib/twitter-engine`
- `lib/twitter-metrics`
- `lib/twitter-storage`
- `lib/twitter-thread`
- `lib/twitter-world-engine`
- `lib/weverse-storage`

直接整批拷入会从 16 条存量错误涨到 52 条，说明这批模块之间还有二次依赖。做法：先合 `photo-library-*` 与 `social-*` 两组底层，再合 lysn/twitter/photos 界面。

### 部署目标（主人已确认，不要改）

- **唯一固定项目：`ai-virtual-phone-y2-kversion-jeir`**
- 域名：`https://ai-virtual-phone-y2-kversion-jeir.vercel.app`
- 不再向 `-rwe1`、`-re7q`、`-mkae`、无后缀 / delta 等项目部署或配置
- APK 的 `SHELL_SITE_URL` 也要指向这个域名

### 硬性禁令（主人反复强调，违反过多次）

1. **禁止把任何功能、页面、配置回退到"原始版本"**。用户已经改好的东西（工坊→Claude、手记→iCity、设置定制等）一律不动。
2. 需要撤销某个改动时，只撤销**那一次具体改动**，不许 `git reset`、不许整文件覆盖、不许"回滚到某个提交的状态"。
3. 修 bug 只做最小范围修改；改之前先看 `git log` 和当前文件，确认不会覆盖用户已做的定制。
4. 任何"恢复默认""重置""还原""revert 到原版"的动作，必须先向主人说明影响范围并取得同意。

### 界面改动必须走 oil-ui（主人定的长期规则）

- 任何**页面、组件、弹窗、动效**的改动，动手前先加载并遵循 `oil-ui` 技能（已装：`~/.agents/skills/oil-ui`；
  DSH 原生插件 `dsh-oil-ui` 也装了）。
- 流程：先在同屏对比里给出 2–3 个真正拉开差距的方向 → 主人选定 → 再落地写代码 → 用真实截图核对。
- 不允许不参考 oil-ui 就凭感觉改样式；改完要给截图或对比页作为证据。
- 纯逻辑、接口、文案、数值调整不需要走 oil-ui。
