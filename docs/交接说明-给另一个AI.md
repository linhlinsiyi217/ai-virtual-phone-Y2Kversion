# Y2K 小手机 · 交接说明（给接手的 AI）

> 看这一份就够了。先读「铁律」和「已知坑」，再动手。

## 0. 一页速览

| 项 | 值 |
|---|---|
| 仓库 | `github.com/linhlinsiyi217/ai-virtual-phone-Y2Kversion` |
| 分支 | `main`（唯一，只推这个） |
| 线上站点 | `https://ai-virtual-phone-y2-kversion-jeir.vercel.app` |
| Vercel 项目 | `ai-virtual-phone-y2-kversion-jeir`（projectId `prj_og2J1B8IW2xC1mFo4PwIjfI96VHX`） |
| 当前版本 | **1.8.49** |
| 技术栈 | Next.js 15 / React 19 / TypeScript / Tailwind 4 / Dexie(IndexedDB) / PWA |
| 安卓壳 | `android-shell/`（WebView 包壳，GitHub Actions 打 APK） |

---

## 1. 访问与部署

### 1.1 代码

```bash
git clone https://<TOKEN>@github.com/linhlinsiyi217/ai-virtual-phone-Y2Kversion.git
cd ai-virtual-phone-Y2Kversion
```

需要的 GitHub 权限：该仓库 Contents = Read and write。

### 1.2 确认线上到底跑的是哪一版

```bash
curl https://ai-virtual-phone-y2-kversion-jeir.vercel.app/version.json
```

返回的 `version` 就是线上版本。**每次推完必须核对这个**，不要相信"我推上去了"。

### 1.3 推了但线上没变（今天真实踩过）

推了 1.8.46 / 1.8.47 / 1.8.48 三个版本，GitHub 上都有提交，但 Vercel 部署列表里**一条都没有**，线上一直停在 1.8.45。

应对：用 Vercel API 手动触发一次部署（需要 Vercel Token）：

```bash
curl -X POST https://api.vercel.com/v13/deployments \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"ai-virtual-phone-y2-kversion-jeir",
       "project":"prj_og2J1B8IW2xC1mFo4PwIjfI96VHX",
       "target":"production",
       "gitSource":{"type":"github","ref":"main","repoId":1414212693}}'
```

查部署状态：

```bash
curl "https://api.vercel.com/v6/deployments?projectId=prj_og2J1B8IW2xC1mFo4PwIjfI96VHX&limit=5" \
  -H "Authorization: Bearer $VERCEL_TOKEN"
```

`state` 为 `READY` 即完成；`ERROR` 表示构建失败，需要看日志。

### 1.4 只部署这一个项目

不要再往 `-rwe1`、`-re7q`、`-mkae`、delta 这些重复项目部署，会把每日部署额度耗光。

---

## 2. 铁律（违反必返工）

1. **每次用户可见的改动，必须在同一次提交里写更新日志**
   - `public/update-log.json` 最前面加一条：新 `id`（`YYYYMMDD-N`）、版本号比上一条大
   - 正文用大白话写「之前什么样、现在什么样」，**不写文件名、不写技术词**
   - 提交前跑 `npm run check:changelog`，不过就提交不了
   - 禁止 `--no-verify` / `SKIP_LOG`
2. **禁止把用户改好的东西回退成原版**（工坊→Claude、手记→iCity、设置定制、聊天外观等）
   - 撤销只能撤"那一次改动"，不许 `git reset`、不许整文件覆盖
3. **视觉基准 = 小笼包（`xiaolongbao0709/ai-virtual-phone`）原版**
   - 不再做黑白极简、不加灰度滤镜、不把彩色图标换成灰线
4. **界面改动先走 `oil-ui` 流程**：先给 2–3 个方向 → 用户选 → 再落地 → 用真实截图核对
5. **提交前跑类型检查**，基线固定 **16 条**（全在 `components/chat/share-destination-sheet.tsx`）
   ```bash
   node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
   ```
6. **改外观只动被点名的那个界面**，不要借"统一风格"去重排别的页面

---

## 3. 已完成（1.8.49 为止）

| 模块 | 内容 |
|---|---|
| 启动 | 开屏动画已删；登录门控已关（聊天直接进） |
| 桌面 | 图标恢复原样；进出应用记住滚动位置；左滑退出已撤（会误触） |
| 设置 | 换回小笼包结构；补回 6 项（通话浮窗/感知/操作设备/日历/截屏/小组件）；更新日志入口；删掉「绑定虚拟账号」；预设未绑定时回退最近使用 |
| 外观 | 「界面与动效」入口已删 |
| 聊天 | 停止黑白+苹果风两层覆盖，回归小笼包外观；心声卡片（点气泡头像打开，按"回合"归属，可翻面看数值）；一起听卡片支持跨行标签 |
| 角色库 | 按 TRAe 版本整体替换（modal-kit 弹窗体系 + 专用样式）；侧边栏四项可点 |
| 美化工坊 | 首页重做（分组标签 + 圆圈问号 + 按下纯黑）；类名参考每行补中文说明；**心声美化**并入工坊（多套、两段提示词、字段、模板、动效、预览、导入导出） |
| 心声 | 提示词可自定义并**真的注入生成请求**；卡片按用户模板渲染；导出为票据 PNG、从图片导入 |
| 小卷 | 换角色头像；批量改角色（预览+确认+自动备份）；更新我的资料（网名/真名/性别/签名/简介/外貌）；人设文档解析器（中英混排多格式）；角色名截断字段尾巴 |
| 资料页 | 「从文档导入」按钮（本地解析，不经过小卷） |
| 现实桥 | 文件与 doremy 同源；云端未配置时可一键跳去配置 |
| 安卓壳 | 重定向留在 WebView 内（不再跳浏览器）；站点固定 jeir；保存文件到下载目录的桥接；常驻通知按真实原因显示 |

---

## 4. 未完成（按优先级）

### P0 —— 用户最在意，优先做

**4.1 现实桥按钮流程没打通**
- `components/reality-bridge-app.tsx` 与 doremy 的**完全同源**，说明"界面照搬"这件事本身已完成
- 真正的问题是：`ready`（云端是否配置）为 false 时，大量按钮 `disabled`，用户点了没反应
- 已经加了"云端未配置 · 去设置里配"的跳转，但**每个分区里的按钮还没逐个核对**
- 做法：grep `disabled`（13 处），逐个确认禁用条件是否合理；不该禁用的放开，该禁用的给一句提示

**4.2 心声卡片的自定义模板只做了"能渲染"**
- 模板里的 `{{心情}}`/`{{好感度}}` 来自状态值，目前只对齐了"好感度"，其他字段名要靠状态值键名匹配
- 动效（上浮/淡入/弹性）**保存了但没有真正应用到弹窗动画上**
- 模板中间还缺"真实预览图"（票据的中间栏现在是占位框）

**4.3 票据只接了「心声」一类**
- 编码/解码已通（`lib/ticket-png.ts`：PNG tEXt 块写入 + 读取）
- 需要按 `type` 扩展：`worldbook` / `preset` / `regex` / `character` / `theme`
- 每类只换"中间预览"和"右侧模块清单"，数据格式不变

### P1

**4.4 小卷：表情包导入没做**
- 需求：收图 → 转格式（HEIC/超大 → webp）→ 去重 → 命名 → 分组入库
- 现有基础：`lib/css-asset-tools.ts` 已有导入/压缩/裁切能力，表情包库在 `components/chat/sticker-manager`

**4.5 小卷：新建"我的资料"（多身份）没做**
- 目前只能改当前那份；用户要能"再建一份人设"
- 存储层已支持多份：`loadUserIdentities()` / `saveUserIdentities()`，UI 在"其他资料 → 新增"

**4.6 二维码：生成 / 识别 / 加角色**
- 依赖已有 `qrcode`；识别需要引入解码库（如 `jsqr`）
- 需求：① 上传图片识别二维码/好友码 ② 角色卡侧栏生成二维码 ③ 扫码加角色

**4.7 锁脸参考图只做了开关**
- 人设页有"肖像画"开关和"上传肖像"
- 生图时**没有真正把参考图传给接口**；要按用户用的生图接口决定方案（支持图生图就用参考图，不支持就把外貌描述固定进提示词）

### P2（大工程，单独排期）

**4.8 生活系统**
缺 4 个底层接口，补齐前合入会让类型错误从 16 条涨到 37 条：
1. `lib/chat-storage.ts` 缺 `resolveSessionCharacterId`
2. `lib/push-bailout-client.ts` 缺 4 个函数（arm/cancel/reconcile/suspend LifeSceneProactiveBailout）
3. `lib/settings-storage.ts` 缺 `USER_IDENTITIES_UPDATED_EVENT`
4. 生成请求函数缺 `appId` 参数

**4.9 momo 的「访谈现场 + 记忆修复」**
- 10 个文件已在 `/root/workspace/merge-prep` 分支 `merge/momo-interview-memory` 备好
- 合进去后类型错误从 16 涨到 50，因为要 momo 自己那版共享模块（`interview-magazine-types` 等）
- 做法：先比对 `interview-magazine-types` 与我们的差异，**合并导出符号**而不是整份覆盖

---

## 5. 待合并的仓库（地址 + 要什么 + 卡点）

| 仓库 | 要什么 | 卡点 / 注意 |
|---|---|---|
| `xiaolongbao0709/ai-virtual-phone` | 功能基线（小卷、工坊、剧情）。**目前视觉也以它为准** | 我们仓库已有 971/972 个文件，但 667 个文件内容不同，是"同一功能两套实现"，要逐个比选，不能整仓覆盖 |
| `linhlinsiyi217/float-0217` | 书房 | 已合入 |
| `doremy1203/doremy.float.phone` | 聊天音效、剧情增强、收藏、现实桥 | 现实桥已同源；其余已合 |
| `jianchu-in/momo.float.phone` | 剧情外观、收藏、访谈现场、记忆修复 | 访谈/记忆见 4.9 |
| `jinyixuan9-tech/Tutumaver-float-phone` | X/Lysn/信息/照片四个新应用、iCity(手记)、翻译、Fish Audio、ElevenLabs | 已合应用与 iCity；**上游后续 bug 修复没摘** |
| `Yyk-Y2k/ai-virtual-phone-Y2Kversion` | 多身份/人设相关界面 | 未开始 |

### 关于"上游已修但没摘的 bug"

Tutu 仓库后续修了一批 bug，我们只合了功能、没跟修复。建议做法：

```bash
git clone --depth 50 https://github.com/jinyixuan9-tech/Tutumaver-float-phone.git /tmp/tutu
cd /tmp/tutu && git log --oneline -40        # 找出 "fix" 开头的提交
git show <sha> --stat                         # 只挑涉及我们已合模块的
```

只 cherry-pick **修复类**提交，不摘新功能；每摘一个跑一次 `tsc`，确认仍是 16 条。

---

## 6. 已知坑（都是真的踩过）

1. **`styles/character-archive.css` 第 105 行有个空规则**
   `@media(prefers-reduced-motion:reduce){.cat }` → 只有选择器没有内容，**会让整站构建失败、页面打不开**。
   修过了，但如果你从别的分支整份覆盖这个文件，它会回来。修法：补成 `.cat{animation:none!important}`。

2. **推了不等于上线**。见 1.3，必须查 `version.json`。

3. **本机 `next build` 会卡死**（手机环境内存不足，日志停在 "Creating an optimized production build"）。
   本机只跑 `tsc` + `postcss` 校验 CSS 语法；构建以 Vercel 为准，失败后从 Vercel 拿日志。

4. **心声输出必须包在 `[内心] ... [/内心]` 里**
   解析器只认这个壳（`lib/rich-message-parser.ts` 的 `extractBracketBlock(..., "内心")`）。
   如果给模型注入自定义提示词，必须同时规定这对标签，否则标签会原样显示在气泡里。

5. **一起听邀请标签要允许跨行**
   `lib/listen-together.ts` 的正则是 `[一起听邀请(?::([^\]]*))?]`，曾写成 `[^\]\n]*`，歌名换行就匹配不上，卡片不出现。

6. **模型会把整行塞进角色名**
   例如 `孟凡 relation: 大学室友`。`lib/character-card-parser.ts` 的 `cleanName()` 已加截断，新增解析逻辑时注意同样的坑。

7. **两套聊天外观覆盖层（黑白 + 苹果风）已停用**
   `app/globals.css` 里被注释掉的两行 import 是故意停的，不要恢复。

---

## 7. 交付前自检清单

```bash
# 1. 类型检查（必须仍是 16 条）
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit

# 2. 改了 CSS 就验语法
node -e "require('postcss').parse(require('fs').readFileSync('styles/xxx.css','utf8'))"

# 3. 更新日志
npm run check:changelog

# 4. 推完确认线上
curl https://ai-virtual-phone-y2-kversion-jeir.vercel.app/version.json
```

交付说明里要写清：改了哪些文件、动了哪些数据、哪些没做、测试结果。

---

## 8. 工作方法建议（省钱省时间）

1. **一次只做一件事**，做完验证再下一件；不要一口气改五个界面
2. **改之前先 `git log --oneline -15`**，确认没人正在改同一块
3. **不确定就去读代码**，不要凭印象改；这个项目里同名文件有好几套实现
4. **界面改动先出方案再写代码**（oil-ui 流程），用户已经明确要求过
5. **每次只推一个提交**，推完立刻查 `version.json`；没变就手动触发部署
6. **不确定就问用户**，尤其涉及"回退/重写/替换整份文件"时
