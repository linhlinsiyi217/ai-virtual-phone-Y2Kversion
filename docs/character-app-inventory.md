# 角色应用现状盘点（第 0 步 · 只读）

> 盘点日期：2026-11-09
> 盘点对象：`components/phone-character-app.tsx`（2977 行）、`components/character/*`、`lib/character-*`、`lib/npc-generator.ts`、`lib/brief-persona.ts`、`styles/character.css`（1478 行 / 178 条顶层类规则）
> 本步只读，未修改任何业务代码。唯一新增文件即本文档。

**一句话结论**：现有角色应用是「照片墙画布 + 绝密档案卡」风格，交互和视觉与设计稿的黑白苹果风完全不同；数据模型只有 7 个可编辑字段。设计稿里有一部分栏目（签名、线上风格、开场白、配置方案、OOC 补丁、风控报告、面具、世界书绑定、AI 四步建议）在代码中**并不存在真实数据**，见第 7、8 节。

---

## 1. 入口与文件清单

| 项目 | 位置 | 说明 |
| --- | --- | --- |
| 桌面入口 | `components/desktop-shell.tsx:4071` 附近 | `activeApp === "characters"` 时渲染 `<PhoneCharacterApp onClose={...} />` |
| 应用定义 | `lib/desktop-config.ts:125` 左右 | id `characters`，图标 `users`，title「角色」 |
| 主组件 | `components/phone-character-app.tsx` | 列表画布、档案详情、全部弹层都在这一个文件 |
| 世界卷宗 UI | `components/character/world-tabs.tsx` | `WorldTabStrip` / `WorldCaseSheet` / `NewWorldSheet` |
| 关系弹窗 | `components/character/relation-dialogs.tsx` | `RelationLinkDialog` / `RelationPairSheet` |
| 样式 | `styles/character.css` | 在 `app/globals.css:15` 全局引入 |
| 独立路由 | `app/characters/page.tsx` | **占位页**，只显示“角色中心页面重做中”，不渲染角色应用 |

依赖的共享组件（非角色专属，不得删改）：`components/page-shell.tsx`、`components/confirm-dialog.tsx`、`components/icon-glyph.tsx`、`lib/theme` 等。

---

## 2. 页面与视图

主组件用状态机切换（`phone-character-app.tsx:163`）：

```ts
view = { type: "list" | "detail", id: string | null, isEditing?: boolean }
```

- `list` → 画布页（开发内部称 archives canvas）
- `detail` → 档案页
- `detail + isEditing` → 编辑态（新建时 `id === null`）
- 切换时叠加 `FlipTransitionOverlay`（照片飞出 → 翻转，约 800ms；`:349`）

### 2.1 画布页（`CharListView`，从 `:1008` 起）

| 区域 | 内容 | 位置 |
| --- | --- | --- |
| `PageShell` 顶栏 | 左：返回桌面；右：恢复视角（仅排版模式）、编辑排版 | `:1029-1063` |
| 世界卷宗标签条 | 每个卷宗一个 tab（名称 + 成员数，当前 tab 带 ✎），末尾「+ 新建世界」 | `world-tabs.tsx:11` |
| 无限画布 | `translate + scale` 变换；人物拍立得可拖动/旋转/缩放，`zIndex` 由点击更新；背景道具可拖拽 | `:470-700`，样式 `.char-infinite-canvas` |
| 拍立得人物卡 | 头像、名字、微信 ID、旋转角、拍立得比例（`polaroidStyle` 0-1）、编辑态删除按钮 | `:1150-1300` |
| 关系连线 | 同世界内 `from→to` 关系，合并为一条线，标签并列；点线打开关系细目 | `:485-560`、`:1237` |
| 拉线模式 | 点“关系”进入，点 A 再点 B 输入标签 | `:1125`、`:1406` |
| 空状态 | “CREATE 建人 · NPC 生成配角 · 或从别的卷宗拖人进来” | `:1134` |
| 底部胶囊条 | IMPORT / CREATE / PROPS（仅排版模式）/ NPC | `:1064-1084` |
| 待放置提示 | 新建或导入后回到画布，点一下落位 | `pendingPlacementChar`，`:167` |
| 删除投递（punched hole） | 排版模式下把卡拖到“碎纸口”删除，带二次确认 | `:1300-1360` |
| 卷宗切换限制 | 可把角色转移到其他卷宗（卡片菜单「转移世界」） | `:1201`、`:1578` |

### 2.2 档案页（`CharArchiveView`，从 `:1778` 起）

结构：`char-archive-frame` + 右上角 `CLASSIFIED` 印章 + 页眉（角色卡 / ID）+ 左右两栏 + 底部操作条。

| 区块 | 字段 / 控件 | 位置 |
| --- | --- | --- |
| 照片 | 头像预览、上传图片（转 dataURL）、粘贴图片 URL、编辑态遮罩 | `:2040-2111` |
| 姓名 | `TARGET NAME / CODENAME`，编辑为输入框 | `:2116-2133` |
| 状态行 | `Status`（只读：ACTIVE / EDITING）、`WeChat`（只读 `wechatID`）、`Update`（`updatedAt` 前 10 位） | `:2135-2150` |
| 标签 | `Tags` 芯片列表，编辑态可增删（Enter 添加） | `:2155-2186` |
| 时区 | `Timezone`，编辑态打开时区选择器（可搜索、支持自定义） | `:2187-2202`、`:2494` |
| 人设 | `PERSONA / TRAITS` 多行文本（只读时分段显示，空时 `NO DATA AVAILABLE.`） | `:2205-2226` |
| 性格 | `PERSONALITY`，有内容或编辑态时显示 | `:2228-2250` |
| 简量人设 | `BRIEF PERSONA / 简量人设`，按钮「AI 生成 / 重新生成」，说明注入同世界有关系角色上下文，过期提示 | `:2252-2290` |
| 操作条 | 历史版本、编辑、保存、取消 | `:2320-2350` |
| 历史版本抽屉 | 列表（Vn、来源 manual / mascot / 说明、时间），可恢复、删除 | `:2380-2450` |

弹窗 / 确认：

| 弹窗 | 触发 | 内容 | 位置 |
| --- | --- | --- | --- |
| 保存角色卡（版本选择） | 已存在角色点保存 | 「备份旧卡再保存 / 直接覆盖」 | `:2351` |
| 未保存确认 | 编辑中点取消/返回 | 「确定要放弃编辑吗？」 | `:2552` |
| 删除角色确认 | 点删除 | 文案确认 | 档案页内 |
| 恢复版本确认 | 历史版本点恢复 | 确认后切换并覆盖当前 | `:2395` |
| 删除版本确认 | 历史版本点删除 | 二次确认 | `:2395` |
| 时区选择器 | 编辑态点时区 | 搜索框 + 常用/全部时区列表 | `:2494` |
| 图片 URL 输入 | 编辑态点头像 | 输入框 + OK | `:2080-2108` |

### 2.3 弹层清单（画布侧）

| 名称 | 触发 | 内容 / 字段 | 位置 |
| --- | --- | --- | --- |
| 拍立得比例选择 | IMPORT / CREATE | 两种比例预览卡片 | `:1478` |
| 道具选择 | PROPS | 内置道具分组（植物、家具、装饰等） | `:1503` |
| 转移卷宗 | 卡片菜单 | 卷宗列表单选 | `:1578` |
| 世界卷宗详情 `WorldCaseSheet` | 点当前 tab 的 ✎ | 卷宗名称、世界观描述、成员数、关系列表、删除确认 | `world-tabs.tsx:60` |
| 新建卷宗 `NewWorldSheet` | 点「+ 新建世界」 | 卷宗名称 | `world-tabs.tsx:126` |
| 拉线 `RelationLinkDialog` | 拉线模式点第二张卡 | 「A 是 B 的 ___」+ 输入标签 | `relation-dialogs.tsx:10` |
| 关系细目 `RelationPairSheet` | 点关系线 | 两人全部关系逐条「剪断」 | `relation-dialogs.tsx:54` |
| NPC 生成器 `NpcGeneratorSheet` | 底部 NPC | 目标角色、生成数量、附加要求 → 生成 → 预览（可勾选收录、可编辑、可重新生成）→ 确认落库；「加好友后允许自动发朋友圈」开关 | `:2796` |
| 导入失败 | 导入 JSON/PNG 解析失败 | 错误标题 + 原因 | `:1357` |
| 提示条 | 各类操作 | `onNotice` 文本 | 由壳层提供 |

---

## 3. 字段清单

### 3.1 `Character`（`lib/character-types.ts`）

| 字段 | 类型 | 是否在角色应用内编辑 | 用途 |
| --- | --- | --- | --- |
| `id` | string | 否 | 主键 |
| `name` | string | 是 | 姓名 / 代号 |
| `avatar` | string \| null | 是 | dataURL 或图片链接 |
| `persona` | string | 是 | 人设正文（聊天系统提示核心） |
| `personality` | string | 是 | 性格补充 |
| `briefPersona` | string | 是 | 简量人设，注入同世界有关系角色 |
| `briefPersonaUpdatedAt` | string? | 是（自动） | 简量人设生成时间 / 过期判断 |
| `wechatID` | string | 否（自动生成） | 聊天微信号，只读展示 |
| `timeZone` | string | 是 | 时区，聊天时间语境 |
| `tags` | string[] | 是 | 标签 |
| `avatarHistory` | string[]? | **否**（聊天头像操作写入） | 头像历史，保存时必须保留 |
| `canvasX` / `canvasY` / `canvasRotate` / `canvasZIndex` | number | 拖拽时写入 | 画布坐标与层级 |
| `polaroidStyle` | 0 \| 1 | 新建时选择 | 拍立得比例 |
| `createdAt` / `updatedAt` | ISO string | 自动 | 时间戳 |

> 保存实现是 `{...existing, ...data, updatedAt}`（`:281-286`），因此 `avatarHistory`、`wechatID`、画布坐标不会丢。新界面必须沿用这种合并方式。

### 3.2 `CanvasBgItem`（`lib/character-types.ts`）

`id`、`type`、`emoji` / `imageUrl`、`x`、`y`、`scale`、`rotate`、`zIndex`、`label?`。

### 3.3 世界卷宗（`lib/character-world-storage.ts`）

- `CharacterWorldGroup { id, name, description, isDefault?, members: string[], relations: CharacterWorldRelation[], createdAt, updatedAt }`
- `CharacterWorldRelation { id, fromCharacterId, toCharacterId, label, createdAt }`
- 默认卷宗 id `world_default`，不可改名/删除；删除其他卷宗时角色并回默认。
- 用户身份节点前缀 `__user_identity__:`（关系线可连“我”）。

### 3.4 版本（`lib/character-version-storage.ts`）

`CharacterVersion { id, characterId, version, source: "manual" | "mascot" | ..., note?, data: Character, createdAt }`，每角色最多 30 个。

### 3.5 NPC 生成结果（`lib/npc-generator.ts`）

`GeneratedSupportingCharacter` 含 `name / avatar(可选) / persona / personality / briefPersona / tags / relationLabel / 朋友圈文案` 等；`materializeSupportingCharacter` 负责落库并写入双向关系。

### 3.6 编辑态局部状态（不持久化）

`avatar`、`name`、`persona`、`personality`、`briefPersona`、`timeZone`、`timeZoneSearch`、`tags`、`tagInput`、`urlInput`、各 `show*` 开关。

---

## 4. 存储位置

全部通过 `lib/kv-db.ts` 写入 IndexedDB（库名 `AiPhoneKvDB`，按当前登录身份隔离），不是 localStorage，也不是 Supabase。

| Key | 内容 | 读写方 |
| --- | --- | --- |
| `ai_phone_characters_v1` | `Character[]` | `character-storage.ts` |
| `ai_phone_bg_items_v1` | `CanvasBgItem[]` | `character-storage.ts` |
| `ai_phone_character_worlds_v1` | 世界卷宗 + 关系 | `character-world-storage.ts` |
| `ai_phone_character_versions_v1` | 角色版本 | `character-version-storage.ts` |
| `ai_phone_character_app_world_v1` | 当前打开的卷宗 id | `phone-character-app.tsx:65` |
| `ai_phone_character_world_layout_v1` | 看板坐标（`BoardPos`） | `character-world-layout.ts`，**目前无任何引用，属遗留死代码** |
| `ai_phone_moments_config_v1` | 朋友圈总开关 / 自动发帖 | 角色删除、NPC 落库时读取；`moments-storage.ts` |

事件：`CHARACTERS_UPDATED_EVENT = "chat-characters-updated"`、`CHARACTER_WORLDS_UPDATED_EVENT = "character-worlds-updated"`，用于跨组件刷新。

数据管理页（`lib/data-management/modules.ts`）把上述角色相关 key 列为可清理模块，改名/迁移时要同步。

---

## 5. 接口调用

角色应用**没有**调用本项目 `/api/*` 路由；所有持久化都是本地 IndexedDB。

| 能力 | 实现 | 网络行为 |
| --- | --- | --- |
| 生成配角 NPC | `lib/npc-generator.ts` → `simpleLLMCall()` | 用用户在设置里配置的模型（`settings-storage.ts` 的 API 配置 / 绑定），直接请求第三方 `baseUrl`（OpenAI 兼容 `/chat/completions`、Anthropic、Gemini 等），失败时回退其它已配置模型 |
| 生成简量人设 | `lib/brief-persona.ts` → `simpleLLMCall()` | 同上 |
| NPC 上下文 | `memory-service.ts` / `memory-injector.ts` | 读取该角色的核心记忆与长期记忆，注入提示词（不联网） |
| 道具 / 头像图片 | 本地内置 emoji、dataURL、用户填的 URL | 头像 URL 由浏览器直接加载 |

LLM 请求的输入包含：目标角色完整卡、同世界其他角色摘要、卷宗 `description`、关系文本（`formatCharacterRelationsForPrompt`）、核心/长期记忆、用户附加要求。

---

## 6. 下游依赖（改造时不能破坏）

| 依赖 | 说明 |
| --- | --- |
| `loadCharacters()` / `loadInteractableCharacters()` | 聊天（联系人、单聊、群聊）、朋友圈、小卷（mascot）、数据管理都读这个；返回结构不能变 |
| `avatarHistory` | 由聊天“换头像”写入；档案保存必须保留 |
| `wechatID` | 聊天按微信号索引；不能丢 |
| `timeZone` | 聊天时间/在线状态语境 |
| `removeCharacterChatReferences()` | 删除角色时同步清理聊天、朋友圈引用（`:316`） |
| `clearCharacterVersions()` | 删除角色时清理版本 |
| 世界关系 / `formatCharacterRelationsForPrompt()` | 注入所有角色提示词；关系图新 UI 应直接复用这份数据 |
| `canCharacterSeeMomentPost` 等可见性函数 | 朋友圈权限 |
| PNG / JSON 导入导出 | `parseCharacterFromJson/Png`、`exportCharacterAsJson/Png`，PNG 内嵌角色卡元数据；格式需保持兼容 |
| `CHAR_BLOCKED_FIELDS` | 导入时拒绝不支持字段（含 greeting 等） |
| 小卷写入版本 | `backupCharacterVersion(source: "mascot")` |

---

## 7. 设计稿 8 屏 ↔ 现有实现对照

| 预览名 | 设计稿内容 | 现有实现 | 差距 |
| --- | --- | --- | --- |
| `library` | 左侧栏 + 档案卡双列 + 搜索/筛选 + 新建 | 无限画布 + 拍立得 + 底部胶囊 | 布局完全不同；可复用 `Character` 数据、卷宗概念、头像/姓名/标签 |
| `profile` | 档案页：大图、签名、基础信息、标签、人设、完整度 | 现有档案页（照片 + 7 字段 + 版本） | 签名、线上风格、开场白、面具、完整度均无数据 |
| `soul` | 灵魂工作台：核心人设、配置方案（按模型）、OOC 补丁、风控报告、世界书绑定 | 仅 `persona` / `personality` / `briefPersona` | 除人设外全部不存在；世界书是学习房功能，未绑定角色 |
| `relations` | 关系图/关系列表 | 画布红线 + `RelationPairSheet` + 卷宗关系数据 | 数据齐全，只差新视觉与图布局 |
| `suggest1` / `suggest3` | AI 四步建议（标签 → 人设 → 关系 → 落库） | 无 | 完全不存在；只有 NPC 生成器（`NpcGeneratorSheet`）和小卷填字段 |
| `motion` | 动效/交互规范页 | 无 | 纯展示，可直接照设计稿做 |
| `features` | 功能与取舍清单 | 无 | 纯展示，可直接照设计稿做 |

---

## 8. 第 5 节「保留」清单实况

| 设计稿功能 | 代码现状 | 真实数据 | 备注 |
| --- | --- | --- | --- |
| 网名 / 称呼 | 有 `name` | 有 | 直接映射 |
| 个性签名 | 无 | 无 | 需新增可选字段 |
| 线上风格 | 无 | 无 | 需新增可选字段 |
| 开场白 | 无（导入被 `CHAR_BLOCKED_FIELDS` 明确拒绝） | 无 | 需新增可选字段，且与聊天开场逻辑要另行定义 |
| 关系网 | 有（卷宗 `relations`） | 有 | 新增关系图视图 |
| 同步生成 NPC | 有（`NpcGeneratorSheet`，可选是否自动发朋友圈） | 有 | 保留并换皮 |
| 关联世界书 | 无 | 无 | 世界书属学习房，角色侧无绑定 |
| 核心人设 + 字数 | 有 `persona`（无字数统计） | 有 | 加字数显示即可 |
| 配置方案（按模型） | 无 | 无 | 需新功能，超出本次范围 |
| OOC 补丁 / 指令专业化 | 无 | 无 | 需新功能 |
| 风控报告 | 无 | 无 | 需新功能 |
| 面具名称 | 无 | 无 | 需新增可选字段 |
| 头像图片 / 链接 | 有（上传 / URL / 聊天换头像） | 有 | 保留 |
| AI 建议与填充 | 无（只有简量人设 AI 生成） | 部分 | 需新功能 |
| 关联角色生成 | 有 | 有 | 与 NPC 生成同源 |
| **档案完整度** | 无 | 可计算 | 建议按 name/avatar/persona/personality/briefPersona/tags/timeZone 加权 |
| **关系图** | 无（有数据） | 有 | 建议用卷宗 relations + 默认世界 |

---

## 9. 旧样式范围

- `styles/character.css`：1478 行，178 条顶层类规则，前缀主要为 `char-`（档案/画布/弹窗）与 `wt-`（卷宗/纸片弹窗/底部胶囊）。
- 引入点：`app/globals.css:15`。
- 使用者：仅 `components/phone-character-app.tsx`、`components/character/world-tabs.tsx`、`components/character/relation-dialogs.tsx`（`public/game-builtins/doudizhu.html` 里的 `wt-` 是独立命名空间，不受影响）。
- 组件内还混用了大量 Tailwind 原子类与内联样式（档案页尤其多），替换时需一并清掉。
- 不可删的共享类：`page-shell` / `page-body`、`confirm-*` 等来自共享组件的样式。

---

## 10. 改造风险与不可动清单

1. **数据键与类型不能改**：`ai_phone_characters_v1` 等 key、`Character` 字段名、版本结构都要保持，否则聊天/朋友圈/小卷/数据管理全部失效。
2. **保存必须合并旧对象**，保留 `avatarHistory`、`wechatID`、画布坐标。
3. **删除角色要保留** `removeCharacterChatReferences` + `clearCharacterVersions` 调用。
4. **导入导出兼容**：JSON / PNG 字段、`CHAR_BLOCKED_FIELDS`。
5. **事件名**：`chat-characters-updated`、`character-worlds-updated` 仍要派发。
6. **关系数据**直接复用 `CharacterWorldRelation`，不要另建一套，否则提示词注入和朋友圈可见性会分叉。
7. **小卷联动**：`mascot` 会写角色字段与版本，新界面保存路径要兼容 `source: "mascot"`。
8. `lib/character-world-layout.ts` 无人引用，可在后续清理时删除，但本次不涉及。

---

## 11. 第 0 步结论 / 需要你确认

1. **设计稿有、代码没有的栏目**：个性签名、线上风格、开场白、面具、配置方案、OOC 补丁、风控报告、世界书绑定、AI 四步建议。按你第 6 条“只做保留清单里的功能”，这些要么新增可选字段（空态呈现），要么这一版先不显示。请确认采用哪种。
2. **档案完整度**：计划用现有 7 个字段（姓名、头像、人设、性格、简量人设、标签、时区）加权，权重按设计稿的百分比分配，可吗？
3. **关系图**：用当前卷宗的 `relations` 渲染（同世界才连线），默认卷宗 `world_default` 也显示，可以吗？

以上确认后我再按第 1 步建新分支、接设计稿样式表、做 `/dev/ui-preview`。
