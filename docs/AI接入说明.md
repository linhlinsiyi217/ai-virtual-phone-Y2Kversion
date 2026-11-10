# 让另一个 AI 接手这个项目

## 这是哪个项目

| 项 | 值 |
|---|---|
| 仓库 | `github.com/linhlinsiyi217/ai-virtual-phone-Y2Kversion` |
| 分支 | `main`（唯一，只推这个） |
| 线上站点 | `https://ai-virtual-phone-y2-kversion-jeir.vercel.app` |
| 部署项目 | Vercel 里的 `ai-virtual-phone-y2-kversion-jeir`（**只认这一个**） |
| 技术栈 | Next.js 15 / React 19 / TypeScript / Tailwind 4 / Dexie |

## 一、给它什么权限

### 方式 A：GitHub 令牌（要改代码时）

```
github.com/settings/tokens → Generate new token (fine-grained)
Repository access → Only select repositories → 勾 ai-virtual-phone-Y2Kversion
Permissions → Contents: Read and write
有效期建议 7 天
```

它就能：

```bash
git clone https://x-access-token:<TOKEN>@github.com/linhlinsiyi217/ai-virtual-phone-Y2Kversion.git
git checkout main
# 改代码
git add -A && git commit -m "..." && git push origin main
```

推上去 Vercel 自动构建。

### 方式 B：Vercel 令牌（只部署，不改代码）

```
vercel.com/account/tokens → Create Token（Scope 选团队）
```

用途：手动触发部署、查部署状态、读环境变量。

## 二、必须遵守的规则（会被钩子拦）

1. **每次提交都要写更新日志**
   - `public/update-log.json` 最前面加一条：新 `id`（`YYYYMMDD-N`）、版本号比上一条大
   - 内容用大白话写「之前什么样、现在什么样」，不写文件名和技术词
   - 提交前跑 `npm run check:changelog`，不过就提交不了
2. **不许用 `--no-verify` / `SKIP_LOG`** 绕过钩子
3. **不许把用户改过的东西回退成原版**（工坊、iCity、设置定制等）
4. **只在 `main` 上工作**，不推其他分支到 main
5. 只部署到 `jeir`，不要碰 `-rwe1`、`-re7q`、`-mkae`、delta 这些项目

## 三、两个已经踩过的坑

**① `styles/character-archive.css` 第 105 行附近**

那条 `@media(prefers-reduced-motion:reduce){.cat }` 是空规则，会让整站构建失败（页面直接打不开）。修过了，**不要从别的分支整份覆盖这个文件**。

**② 部署失败的排查顺序**

```bash
rm -rf .next
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--max-old-space-size=2560" npx next build
```

先本地跑通再推。只看 "BUILD SUCCESSFUL" 不算数，要看到 `✓ Compiled successfully` 和路由表。

## 四、提交前自检清单

```bash
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
```

- 存量错误固定 **16 条**（全在 `components/chat/share-destination-sheet.tsx`）
- 超过 16 条就是新增了，必须清零再提交
- 改了样式：跑 `node -e "require('postcss').parse(require('fs').readFileSync('styles/xxx.css','utf8'))"` 验证语法

## 五、接入后先做这三件事

1. `git log --oneline -15` 看最近改了什么，`cat AGENTS.md` 读规则
2. 跑一次 `tsc --noEmit` 确认基线是 16 条
3. 问清楚要改哪个界面，不要顺手重排别的页面

## 六、常用命令

```bash
# 类型检查
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit

# 更新日志校验
npm run check:changelog

# 本地构建
rm -rf .next && NEXT_TELEMETRY_DISABLED=1 npx next build

# 看线上版本
curl https://ai-virtual-phone-y2-kversion-jeir.vercel.app/version.json
```
