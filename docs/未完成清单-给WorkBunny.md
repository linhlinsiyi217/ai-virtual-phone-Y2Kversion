# Y2K 小手机 · 未完成与未验证清单（交接给 WorkBunny）

> 这份文档只做一件事：**把"还没真正做好"的东西一条条列清楚**，包括需求原话、我改到哪一步、代码在哪、怎么验证、可能坏在哪。
>
> 凡是我没有亲眼看到效果的，一律算"未完成"，不写在"已完成"里。

---

## 0. 怎么用这份文档

1. 先读第 2 节「铁律」和第 8 节「已知坑」，能少走很多弯路
2. 从第 4 节 P0 开始做，一条一条来，**做完一条验证一条**
3. 每条都给了验证方法；看不到效果就不算做完
4. 用户只认结果：**界面上没变化 = 没做**

---

## 1. 项目坐标与部署

| 项 | 值 |
|---|---|
| 仓库 | `github.com/linhlinsiyi217/ai-virtual-phone-Y2Kversion` |
| 分支 | `main`（唯一） |
| 线上站点 | `https://ai-virtual-phone-y2-kversion-jeir.vercel.app` |
| Vercel 项目 | `ai-virtual-phone-y2-kversion-jeir`，projectId `prj_og2J1B8IW2xC1mFo4PwIjfI96VHX`，repoId `1414212693` |
| 当前线上版本 | 写文档时是 **1.8.64** |
| 技术栈 | Next.js 15 / React 19 / TS / Tailwind 4 / Dexie / PWA |
| 安卓壳 | `android-shell/`，GitHub Actions 打 APK |

### 必做：推完必须核对线上版本

```bash
curl https://ai-virtual-phone-y2-kversion-jeir.vercel.app/version.json
```

**这个项目真实发生过**：连续推了 1.8.46 / 47 / 48 三个版本，GitHub 上都有提交，Vercel 部署列表里一条都没有，线上一直停在 1.8.45。后来用 API 手动触发才生效。

### 手动触发部署

```bash
curl -X POST https://api.vercel.com/v13/deployments \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"ai-virtual-phone-y2-kversion-jeir",
       "project":"prj_og2J1B8IW2xC1mFo4PwIjfI96VHX",
       "target":"production",
       "gitSource":{"type":"github","ref":"main","repoId":1414212693}}'
```

查状态：`GET /v6/deployments?projectId=...&limit=5`，`state=READY` 才算完。

---

## 2. 铁律

1. **每次用户可见改动必须写更新日志**：`public/update-log.json` 最前面加一条（新 id `YYYYMMDD-N`、版本号升高），正文用大白话写「之前什么样、现在什么样」，跑 `npm run check:changelog` 通过才能提交。禁止 `--no-verify` / `SKIP_LOG`。
2. **禁止回退用户改好的东西**（工坊→Claude、手记→iCity、设置定制等）。撤销只能撤那一次改动。
3. **视觉基准 = 小笼包原版**（`xiaolongbao0709/ai-virtual-phone`）。不做黑白极简、不加灰度、不把彩色图标换成灰线。
4. **界面改动先走 oil-ui 流程**：先出 2–3 个方向 → 用户选 → 再落地 → 截图核对。
5. **提交前跑类型检查，基线固定 16 条**（全在 `components/chat/share-destination-sheet.tsx`）：
   ```bash
   node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
   ```
6. **只部署 jeir 项目**，不要碰 `-rwe1 / -re7q / -mkae` / delta。

---

## 3. 我真正确认过的（只有这些）

| 事 | 证据 |
|---|---|
| 部署链路可用、能手动触发、能查版本 | 多次用 version.json 核对到具体版本号 |
| 类型检查基线 16 条 | 每次提交前跑，稳定 16 |
| `character-archive.css` 空规则导致整站构建失败 → 已修 | 本地 `next build` 从失败变成功，Vercel 从 ERROR 变 READY |
| 1.8.56 / 1.8.58 / 1.8.59 上线 | version.json 亲眼读到 |
| 交接文档、票据规范、心声提示词文档已写入仓库 | 文件存在 |

**除此之外，下面第 4–6 节的所有东西，我都没有在真机上验证过效果。** 这一点必须按"未完成"处理。

---

## 4. P0：做了但没验证 / 明显还有问题

### 4.1 心声弹窗（点气泡头像）

**用户需求原话**：「点一下 AI 的那个头像，它就会有」「每一轮里点哪条气泡旁的头像，都是同一个心声」「点空白处回到聊天」「默认样式就做成图 5 那样」。

**我做过的**：
- 新增组件 `components/chat/inner-voice-sheet.tsx`（白卡：头像 + 名字 + 时间 + 心声正文）
- 在 `components/chat/chat-room.tsx` 的消息头像上加 `onClick`，读取 `turnVoiceByMessageId`（按回合归属）
- 回合归属逻辑：`useMemo` 遍历 `displayMessages`，遇到 user 消息清空当前心声，遇到带 `innerMonologue` 的 assistant 消息设为当前

**为什么算未验证**：
- 用户多次反馈"点了没反应"
- 我曾把关闭回调错误接到"滑动进度回调"上，导致误触退出（已撤），说明这块改得比较乱
- 我从未在真机看到这个弹窗

**怎么验证**：
1. 发一条消息，等 AI 回复
2. 点回复气泡左边的小头像
3. 应该弹出白卡，点空白关闭
4. 同一轮里多条消息，点任意一条的头像都应该弹同一份

**可能坏在哪**：
- 那条消息根本没有解析出 `innerMonologue`（模型没写 `[内心]` 或写法不被识别）→ 代码里 `if (!turnVoice) return;` 直接静默
- 头像外层有其他点击处理抢了事件
- 建议：加一条兜底——没有心声时也给一句提示（"这一轮没有心声"），据此判断是"没数据"还是"没弹窗"

---

### 4.2 心声翻面看数值

**用户需求**：卡片点一下翻到背面，背面只显示好感度/占有欲/焦虑值数值条，不重复那句话。

**我做过的**：`inner-voice-sheet.tsx` 里加了 `flipped` 状态、正反两面、`rotateY` 动画；数值来自 `data.stateValues`。

**为什么算未验证**：没在真机看过翻转效果；且数值依赖消息上的 `stateValues`，很多消息没有。

**怎么验证**：点开头像卡片 → 再点卡片本身 → 应该翻面；没数值时应显示"这一轮没有状态数值"。

**可能坏在哪**：CSS `backface-visibility` 在某些 WebView 上不生效，出现两面文字重叠。备选方案：不改 3D，改成"点一下切换内容"。

---

### 4.3 思维链（思考过程）胶囊

**用户需求**：「固定会出现，不需要我自己去打开」「在 AI 气泡第一，也就是气泡最上面有一个 think 小椭圆标签，点击可以展开」。

**我做过的**：
- `lib/llm-provider-adapter.ts` 新增 `thinkingFormatInstruction()`：**无条件**注入一条系统消息，要求模型先输出 `<thinking>…</thinking>` 再回复
- `lib/chat-engine.ts`：`onlineThinkingEnabled` 改成恒 `true`，即总是用标签解析
- `components/chat/chat-room.tsx`：把原来的长条触发改成短标签「思考过程」
- `styles/chat.css`：`.chat-reasoning-trigger` 改成灰底圆角胶囊

**为什么算未验证**：这是最后一轮改的，没有任何真机效果确认。

**怎么验证**：发一条消息，看 AI 气泡上方有没有灰色「思考过程」胶囊；点开看有没有内容。

**可能坏在哪（很重要）**：
1. 模型忽略了系统指令、压根不输出 `<thinking>` → 胶囊不出现
2. 有些模型会**把标签内容当成正文输出**，导致气泡里直接出现思考文本
3. 强注入这条指令会影响所有对话的语气（模型多写了一段思考，可能挤占输出）
4. **模型原生 reasoning 路径被绕过了**（`onlineThinkingEnabled=true` 时不再用原生 `result.reasoning`）——如果某些模型原生思考更好，这里会退化

**建议**：先做成"软性要求 + 兜底"：指令发出后如果连续两条消息都没有 `<thinking>`，自动降级回原生 reasoning；并加一个设置项让用户能关掉。

---

### 4.4 心声美化页面（美化工坊内）

**用户需求**：放在美化工坊里；支持多套、改提示词（日常版 + 小剧场版）、改字段、改 HTML、选动效、预览、导入导出、恢复默认。

**我做过的**：
- `lib/inner-voice-style.ts`：类型、默认两套提示词、localStorage 存取、模板填充 `fillTemplate`、净化 `sanitizeTemplate`
- `components/settings/inner-voice-style-page.tsx`：分组卡片布局（样式/名称/提示词/字段/模板/预览 + 底部固定操作）
- `components/chat/chat-beauty-center.tsx`：首页加「心声美化」入口
- `styles/components.css`：`.ivs-*` 样式

**为什么算未验证**：整页视觉没看过；用户曾说"很丑、滑不动"（滑不动已改成单一滚动容器，但仍未验证）。

**已知缺口**：
- 「动效」选择保存了，但**没有真正应用到弹窗动画**
- 字段只能看不能增删（默认三个写死）
- 预览用的是示例数据，不是真实消息

---

### 4.5 票据 PNG 导出 / 导入

**用户需求**：把东西导出成一张票据图，图里带数据，别人保存这张图就能导入；导出要真的存进手机相册/下载目录。

**我做过的**：
- `lib/ticket-png.ts`：写 PNG `tEXt` 块（自己算 CRC）、读取、画票据（左票根/中预览/右模块清单）
- `lib/device-save.ts`：优先调安卓壳 `AndroidShell.saveBase64File`，失败退回浏览器下载
- `android-shell/.../MainActivity.kt`：新增 `saveBase64File`，Q 以上走 MediaStore 写 Downloads
- 心声美化页的导出按钮改成导出 PNG

**为什么算未验证**：
- 用户明确说过"导出根本没接进去"
- **必须装新 APK 才有保存能力**（旧包没有这个桥接方法）
- 票据中间那块"预览"目前是占位框，没有把真实卡片画进去

**怎么验证**：装最新 APK → 工坊 → 心声美化 → 导出 → 应该弹"已保存到下载目录"，去文件管理器能看到 PNG。

**已知缺口**：
- 只接了 `innerVoice` 一种类型；`worldbook / preset / regex / character / theme` 有结构没接
- 没有"记住上次保存文件夹"（安卓限制：只能稳定写 Downloads）
- 发给别人后能不能导入，未测试（导入路径：工坊 → 心声美化 → 导入 → 选 PNG）

---

### 4.6 现实桥

**用户需求**：「照搬外面那个仓库的界面，逻辑也要合住，不是说只合逻辑」「有些按钮我都点不开」。

**现状**：`components/reality-bridge-app.tsx` 与 doremy 仓库**完全同源**（3314 行，diff 为空）——所以"界面没搬"这个判断其实是错的，界面早就是那一版。

**真正的问题**：`ready`（云端是否配置）为 false 时，大量按钮 `disabled`，用户点了没反应。我加了「云端未配置 · 去设置里配」的跳转，但**每个分区里的按钮没逐个核对**。

**代码里 `disabled` 共 13 处**，逐个确认条件是否合理（别把不该禁用的禁了）：
```
grep -n "disabled" components/reality-bridge-app.tsx
```
（1324 / 1337 / 1349 / 1372 / 1402 / 2120 / 2666 / 2733 …）

---

### 4.7 小卷三项能力

**用户需求**：① 换角色头像 ② 批量改角色 ③ 人设文档导入（还要能认中英混排、各种模板）。

**我做过的**：
- 新工具「设置角色头像」：从用户最近上传的图里取一张，写进角色 `avatar`，写前自动备份
- 新工具「批量修改角色」：`names / field / value / append / apply`，默认只预览，`apply=true` 才写，每个角色改前备份
- 新工具「更新我的资料」：支持 `rawText`（原始文档）→ `lib/persona-doc-parser.ts` 解析 → 先返回识别结果，`apply=true` 才写
- `lib/persona-doc-parser.ts`：中英文标签别名表（Chinese name / Nickname / 真名 / 网名 / gender / height / archetype / identity / background…）
- 资料页加了「从文档导入」按钮（本地解析，不经过小卷）
- 角色名清洗：`lib/character-card-parser.ts` 的 `cleanName()` 截掉 `relation: …` 这类尾巴
- 角色卡里的裸词 `user` 统一成 `{{user}}` 宏

**为什么算未验证 / 明确出过问题**：
- 用户实测：小卷把**自己的人设文档**当成**创建角色**处理，建出一个叫「孟凡 relation: 大学室友，公开的二次元」的角色
- 说明**路由判断不可靠**（模型没按提示词走）；我加了前置规则「先判断这是谁的人设」，但没验证

**怎么验证**：
1. 给小卷发一份人设文档，说「这是我的人设」→ 应该走「更新我的资料」并先给识别结果
2. 说「帮我做个角色」→ 才建角色
3. 发图说「换成 XX 的头像」→ 角色库头像变化

**如果还是不听话**：说明纯提示词不可靠，需要在**代码层**做意图判断（例如：文本里出现「我的人设/我的资料/我自己」等词时，强制走 profile 工具，不把 `创建角色` 放进工具列表）。

---

### 4.8 预设 / 正则「免绑定」

**用户需求**：「不想每次弄预设、正则都要去配置绑定里点一遍」。

**我做过的**：
- 曾加过「没绑定就用最近在预设页打开过的那套」——**这个方案是错的，已经撤销**（它导致用户只想看一眼预设，就把聊天规则换掉了 → 角色开始替用户说话、掉格式）
- 现状：没绑定 → 用内置预设（安全）

**还没做**：正则同样只在绑定里生效，没绑定就是空数组。用户问过「要不要也做免绑定」，没回答。

**建议做法**：不要自动猜测。在预设/正则列表里加一个明确的「**设为全局默认**」按钮（写入 `bindingConfig.globalDefaults`），一步到位、语义清楚。

---

### 4.9 应用退出后回到原位置（滚动记忆）

**用户需求**：「我来到哪里，退出去再进来还应该在那里，不要一下子回到顶部」。

**我做过的**：
- `lib/scroll-memory.ts`：`startScrollTracking` 持续监听滚动，把 scrollTop 存进内存 map；切换应用时 `saveScrollLive` + `restoreScrollLive`（用 `scroll-behavior:auto` 瞬移）
- `components/desktop-shell.tsx`：`useEffect` 里安装监听 + 切应用时恢复

**为什么算未验证**：用户第一次反馈"还是会回到顶部"；我改成持续记录后**没有拿到第二次反馈**。

**可能坏在哪**：`findActiveScroller()` 是"找屏幕上面积最大的可滚动元素"，命中错元素就失效。更稳的做法是给每个应用的滚动容器加 `data-scroll-root` 标记，按标记定位。

---

### 4.10 APK 相关（都要装新包才生效）

| 改动 | 说明 |
|---|---|
| 站点固定 jeir | `android-shell/app/build.gradle` 里 `PRODUCTION_SITE`，预览地址会自动替换 |
| 重定向留在 WebView | `MainActivity.kt` 的 `shouldOverrideUrlLoading`：`isRedirect` 一律留在壳内，同域/同 vercel 域名也留 |
| 保存文件桥接 | `ShellBridge.saveBase64File` |
| 常驻通知文案 | `PushService.kt` 按真实原因分「未登录 / 站点连不上 / 云服务未配置」 |

打 APK：GitHub → Actions → **Build Android Shell APK** → 最近一次绿色 ✓ → 底部 Artifacts → 下载 `float-shell-release` → 解压安装。

---

## 5. P1：视觉与体验

### 5.1 美化工坊整体

- 首页已重做：分组标签（聊天/内容/参考）+ 圆圈问号 + 按下纯黑 + 彩色图标托盘
- 用户之前评价「太丑、滑不动」；滑不动已改成单一滚动容器（`.beauty-page-body { overflow: visible }`），**未验证**
- 其它子页（编辑器、类名参考、教程）**没有重做**，还是旧样子

### 5.2 类名参考

- 已给每行补中文说明（`lib/chat-beauty.ts` 的 `CHAT_BEAUTY_CLASS_GROUPS` 第三列）
- 还生成了全量清单：`docs/聊天界面类名清单.md`（742 个类名）
- **未接进页面**：页面里只显示手写的十几条，没有读那份全量清单

### 5.3 用户要的「深度自定义」

用户原话：「每个按钮、每个文字、每个图标，比如自己戳一个 Dock 栏，功能固定但样式、位置、文字都能改」。

现状：只能改 CSS（颜色/圆角/隐藏），**改不了文案、改不了 Dock 顺序**。

建议：加一层「可见文案配置」——把 Dock 五个标签、聊天室顶栏、输入框提示语抽成字段，存 localStorage，渲染时读。

---

## 6. P2：大工程

### 6.1 生活系统

缺 4 个底层接口，补齐前合入会让类型错误 16 → 37：
1. `lib/chat-storage.ts` 缺 `resolveSessionCharacterId`（依赖 `resolveSessionCharacterIdentity` + `loadChatContacts`）
2. `lib/push-bailout-client.ts` 缺 4 个函数：`armLifeSceneProactiveBailout` / `cancelLifeSceneProactiveBailouts` / `reconcileIdleReconnectWithLifeScenes` / `suspendIdleReconnectForLifeScene`
3. `lib/settings-storage.ts` 缺 `USER_IDENTITIES_UPDATED_EVENT`
4. 生成请求函数缺 `appId` 参数

做法：从 doremy `origin/main` 同名文件里**搬这几个声明**，不要整份覆盖。

### 6.2 momo 的访谈现场 + 记忆修复

- 10 个文件已备在 `/root/workspace/merge-prep`，分支 `merge/momo-interview-memory`
- 合进去 16 → 50 条错误，因为要 momo 自己那版 `interview-magazine-types` 等共享模块
- 做法：先 diff `interview-magazine-types` 的导出符号，**合并导出**而不是整份替换

### 6.3 二维码

需求：① 上传图片识别二维码/好友码 ② 角色卡侧栏生成二维码 ③ 扫码加角色。

现状：项目里有 `qrcode`（生成），**没有解码库**（识别要引入 `jsqr` 之类）；"扫码加角色"还缺分享数据格式。

### 6.4 锁脸参考图

现状：人设页有「肖像画」开关 + 「上传肖像」，但**生图时没有把参考图传给接口**。

做法：看用户实际用的生图接口——支持图生图就把 `portraitUrl` 作为参考图；不支持就把 `portraitDescription` 固定进提示词。

---

## 7. 待合并仓库

| 仓库 | 要什么 | 卡点 |
|---|---|---|
| `xiaolongbao0709/ai-virtual-phone` | 功能基线，**也是视觉基准** | 971/972 文件已有，但 667 个文件内容不同，需逐个比选 |
| `jianchu-in/momo.float.phone` | 访谈现场、记忆修复 | 见 6.2 |
| `jinyixuan9-tech/Tutumaver-float-phone` | X/Lysn/信息/照片、iCity | 应用已合；**上游后续 bug 修复没摘**（做法见下） |
| `doremy1203/doremy.float.phone` | 现实桥、剧情、收藏 | 现实桥已同源；其余已合 |
| `linhlinsiyi217/float-0217` | 书房 | 已合 |
| `Yyk-Y2k/ai-virtual-phone-Y2Kversion` | 多身份/人设界面 | 未开始 |

### 摘上游修复的做法

```bash
git clone --depth 60 https://github.com/jinyixuan9-tech/Tutumaver-float-phone.git /tmp/tutu
cd /tmp/tutu && git log --oneline -60 | grep -i "fix"
git show <sha> --stat        # 只挑涉及我们已合模块的
```
只 cherry-pick **修复类**提交，每摘一个跑 `tsc` 确认仍是 16 条。

---

## 8. 已知坑（带位置）

1. **`styles/character-archive.css` 空规则** → 整站构建失败
   `@media(prefers-reduced-motion:reduce){.cat }` 只有选择器没有内容。修过，但**从别的分支整份覆盖这个文件会回来**。
2. **推了不等于上线**：见第 1 节，必须查 version.json。
3. **本机 `next build` 会卡死**（手机内存不足，日志停在 "Creating an optimized production build"）。本机只跑 `tsc` + postcss 校验；构建以 Vercel 为准。
4. **心声必须包在 `[内心] … [/内心]`**：解析器 `lib/rich-message-parser.ts` 只认这个壳（`extractBracketBlock(text,"内心")`）。给模型注入自定义提示词时必须同时规定这对标签。
   - 已加兼容：`normalizeFieldStyleInnerVoice()` 会把 `[心情:]` / `[心声:]` / `[好感度:]` 三行收拢成标准块
5. **一起听邀请标签要允许跨行**：`lib/listen-together.ts` 的正则必须是 `[^\\]]*`，曾写成 `[^\\]\\n]*`，歌名换行就丢卡片。
6. **模型会把整行塞进角色名**：`cleanName()` 已截断 `relation:` 之类尾巴。
7. **两套聊天外观覆盖层已停用**：`app/globals.css` 里被注释的 `chat-monochrome-ui.css`、`chat-social-apple.css` 是**故意停的**，不要恢复。
8. **不要整仓覆盖任何共享模块**：这个项目同名文件有多套实现（小笼包 / doremy / momo / Tutu 各一版），覆盖会连带崩一片。

---

## 9. 接手建议（按这个顺序）

1. 先跑 `curl .../version.json` 确认线上版本，再跑 `tsc` 确认 16 条
2. **先做 4.3 思维链验证**：这是用户刚提、且最容易判断真假的一条
3. 再做 4.1/4.2 心声（用户最在意，且反复出问题）
4. 然后 4.6 现实桥按钮（用户说"点不开"）
5. 4.5 票据、4.7 小卷、4.9 滚动
6. 视觉类（第 5 节）放后面，因为要先定方向

**每条都要**：改 → 部署 → 查 version.json → 让用户看一眼 → 拿到反馈才算完。

---

## 10. 一句话总结

这份项目里所有**代码层面**的东西基本都在，缺的是**验证**和**细节打磨**。
最危险的不是"没写"，而是"写了但没生效 / 生效了但不对"——历史上已经出现过：
- 推了三个版本但根本没部署
- 心声卡片改错位置（点空白就退出应用）
- 自动换预设导致角色替用户说话
- 心声标签原样显示在气泡里
- CSS 一条空规则让整站打不开

所以：**每次改完，先证明它真的生效，再谈下一步。**
