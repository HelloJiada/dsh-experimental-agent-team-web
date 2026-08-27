# 活动面板重设计 · 双主题配色（亮/暗）+ 部队职位角色映射方案

> 任务：t3 / t5 / t7 设计（designer 输出设计方案，供 engineer 实现）
> 范围：`src/client/ActivityPanel.module.css`、`preview-panel.html`、`src/client/artwork.ts`、角色展示层
> 原则：只动**展示层**，不动数据层——`member.role` 的规范键（`researcher`/`engineer`…）保持英文原样，因为它同时被 `src/members.ts` 的 prompt（`with the role: ${member.role}`）、`src/intelligence.ts` 的 `role !== 'captain'` 过滤、`src/tools.ts` 的 `agent_teams_add_member` 参数消费。中文化只发生在 UI 渲染时。亮/暗双主题通过 `@media (prefers-color-scheme)` 只覆盖 `--at-*` token 值实现（见 §1.2.1）。

---

## 1. 白色基调配色方案

### 1.1 设计说明

- **背景**：纯白分层。面板主面 `#ffffff`，下沉/凸起卡片（成员折叠条、任务详情、徽章）用近白 `#fafbfc`，中性填充/hover 用更深的浅灰 `#f4f6f9`。三层之间靠 1px 极浅灰边框切分，不靠色块堆叠——这是"简约大气"的关键。
- **主色**：从亮蓝 `#4d6bfe` 换成**深海军蓝 `#2d5ca8`**（军蓝），低饱和、更稳重。仅用于状态点、派发树连线、运行中进度、焦点描边等**小面积强调**，不做大面积填充。白底对比度 ≈ 6.5:1（AA 达标）。
- **文本层级**：主 `#1b1f27`（近黑，不用纯黑避免生硬）→ 次 `#5a6474` → 弱 `#8f97a6`。
- **状态色**：保持可辨识但降饱和、加深，保证白底上做文字/填充都够对比：
  - 成功 `#15875a`（≈4.5:1）、警告 `#a4681a`（≈4.6:1）、危险 `#c23b42`（≈5.3:1），作 chip 填充配白字时均达标。
- **阴影**：浅而柔。**注意**：现样式用 `color-mix(label-primary …)` 生成阴影，白底下 label-primary 是白色 → 阴影会**不可见**，必须替换为显式 rgba。
- 头像 `drop-shadow(rgb(18 45 72 / 20%))` 在白底上表现良好，保持不变。

### 1.2 Token 映射表（新 `--at-*` 层 + 现有 `--dsw-alias-*` 桥接）

实现策略：在 `.badge, .panel` 作用域内新增一套插件自有 token（`--at-*`），并把现有 `--dsw-alias-*` 别名全部桥接到它。这样白底主题与宿主主题解耦，不污染全局。

| 用途 | 新 token | 值（HEX / 表达式） | 现有 token 桥接目标 |
|---|---|---|---|
| 面板主背景 | `--at-bg-panel` | `#ffffff` | `--dsw-alias-bg-module`、`--dsw-alias-bg-layer-1` |
| 凸起/下沉层（卡片、折叠条、徽章、任务详情） | `--at-bg-raised` | `#fafbfc` | `--dsw-alias-bg-module-platform`（**当前未桥接，需补**） |
| 中性填充 / hover | `--at-bg-fill` | `#f4f6f9` | `--dsw-alias-bg-fill-neutral` |
| 强调浅底（约 6–7% 主色混白） | `--at-bg-accent-soft` | `color-mix(in srgb, #2d5ca8 6%, #ffffff)` | 各处 `color-mix(business-primary X%, bg-module)` |
| 主边框 / 分隔线 | `--at-border` | `#e8ebf0` | `--dsw-alias-line-normal` |
| 强边框 / 连线 / 空进度段 | `--at-border-strong` | `#d9dee8` | `--dsw-alias-line-strong` |
| 主文本 | `--at-text-primary` | `#1b1f27` | `--dsw-alias-label-primary`（**当前未桥接，需补**） |
| 次文本 | `--at-text-secondary` | `#5a6474` | `--dsw-alias-label-secondary`（**当前未桥接，需补**） |
| 弱文本 | `--at-text-tertiary` | `#8f97a6` | `--dsw-alias-label-tertiary`（**当前未桥接，需补**） |
| 强调色（军蓝） | `--at-accent` | `#2d5ca8` | `--dsw-alias-state-business-primary`、`--dsw-alias-bg-fill-business`（**当前未桥接，需补**） |
| 强调 hover | `--at-accent-hover` | `#3568b8` | —（新增） |
| 强调按下 / 更深 | `--at-accent-strong` | `#244a8a` | —（新增） |
| 成功 | `--at-success` | `#15875a` | `--dsw-alias-state-success`、`--dsw-alias-bg-fill-success` |
| 警告 | `--at-warning` | `#a4681a` | `--dsw-alias-state-warning`、`--dsw-alias-bg-fill-warning` |
| 危险 | `--at-danger` | `#c23b42` | `--dsw-alias-state-danger`、`--dsw-alias-bg-fill-danger` |
| 强调底上文字 | `--at-on-accent` | `#ffffff` | `--dsw-alias-label-on-fill` |
| 徽章阴影 | `--at-shadow-badge` | `0 8px 24px rgb(23 32 48 / 8%)` | 替换 L55 `color-mix(label-primary …)` |
| 面板阴影（常态） | `--at-shadow-panel` | `0 12px 32px rgb(23 32 48 / 7%), 0 32px 72px rgb(23 32 48 / 11%)` | 替换 L119–121 |
| 面板阴影（拖拽/缩放） | `--at-shadow-active` | `0 16px 40px rgb(23 32 48 / 10%), 0 36px 80px rgb(23 32 48 / 14%)` | 替换 L129–131 |

> 桥接写法示例（放 `.badge, .panel` 块内）：
> ```css
> .badge, .panel {
>   --at-bg-panel: #ffffff;
>   --at-bg-raised: #fafbfc;
>   --at-bg-fill: #f4f6f9;
>   --at-border: #e8ebf0;
>   --at-border-strong: #d9dee8;
>   --at-text-primary: #1b1f27;
>   --at-text-secondary: #5a6474;
>   --at-text-tertiary: #8f97a6;
>   --at-accent: #2d5ca8;
>   --at-accent-hover: #3568b8;
>   --at-accent-strong: #244a8a;
>   --at-success: #15875a;
>   --at-warning: #a4681a;
>   --at-danger: #c23b42;
>   --at-on-accent: #ffffff;
>   --at-shadow-badge: 0 8px 24px rgb(23 32 48 / 8%);
>   --at-shadow-panel: 0 12px 32px rgb(23 32 48 / 7%), 0 32px 72px rgb(23 32 48 / 11%);
>   --at-shadow-active: 0 16px 40px rgb(23 32 48 / 10%), 0 36px 80px rgb(23 32 48 / 14%);
>
>   /* 现有别名全部桥接（含当前缺失的 5 个） */
>   --dsw-alias-bg-module: var(--at-bg-panel);
>   --dsw-alias-bg-module-platform: var(--at-bg-raised);
>   --dsw-alias-bg-fill-neutral: var(--at-bg-fill);
>   --dsw-alias-bg-fill-business: var(--at-accent);
>   --dsw-alias-bg-fill-success: var(--at-success);
>   --dsw-alias-bg-fill-warning: var(--at-warning);
>   --dsw-alias-bg-fill-danger: var(--at-danger);
>   --dsw-alias-state-business-primary: var(--at-accent);
>   --dsw-alias-state-success: var(--at-success);
>   --dsw-alias-state-warning: var(--at-warning);
>   --dsw-alias-state-danger: var(--at-danger);
>   --dsw-alias-label-primary: var(--at-text-primary);
>   --dsw-alias-label-secondary: var(--at-text-secondary);
>   --dsw-alias-label-tertiary: var(--at-text-tertiary);
>   --dsw-alias-label-on-fill: var(--at-on-accent);
>   --dsw-alias-line-normal: var(--at-border);
>   --dsw-alias-line-strong: var(--at-border-strong);
> }
> ```
> 原桥接里的 `--dsw-static-neutral-bluish-*` 兜底引用与 `color-mix` 双色合成可以整体删掉，由 `--at-*` 层取代（宿主主题已不是变量来源）。

### 1.2.1 暗色主题 token 值表（`@media (prefers-color-scheme: dark)`，t7）

**设计说明**：亮色（默认块）为已定的白底方案；暗色通过 `prefers-color-scheme` 媒体查询**只覆盖 `--at-*` token 值**——`--dsw-alias-*` 别名桥接声明完全不动（它们引用 `var(--at-*)`，自动跟随）。所有 `color-mix(--at-accent X%, --at-bg-*)` 表达式同样自动适配，无需逐处改。暗色值参考 preview-panel.html 原有暗色 palette（`#17181a/#1e1f22/#202125/#2a2c30`、文本 `#f5f6f8/#b9bdc6/#8b90a0`、状态提亮 `#3ecf7f/#f0a83c/#f0606a`）协调。

| 用途 | token | 亮色值（默认） | **暗色值（media query 覆盖）** | 说明 |
|---|---|---|---|---|
| 面板主背景 | `--at-bg-panel` | `#ffffff` | `#1e1f22` | 深色主面（对齐 preview 原 bg-module） |
| 凸起/下沉层（卡片/折叠条/徽章/任务详情） | `--at-bg-raised` | `#fafbfc` | `#202125` | 比主面略亮以弹出（对齐原 bg-layer-1） |
| 中性填充 / hover | `--at-bg-fill` | `#f4f6f9` | `#2a2c30` | 对齐原 bg-fill-neutral |
| 强调浅底（tint） | —（inline `color-mix`） | accent 6–7% 混白 | accent 8–10% 混 `#1e1f22` | 暗色下 tint 比例略升保证可感知（选做） |
| 主边框 / 分隔线 | `--at-border` | `#e8ebf0` | `#2e3136` | 深灰细边框 |
| 强边框 / 连线 / 空进度段 | `--at-border-strong` | `#d9dee8` | `#3a3e45` | 深灰偏亮边框 |
| 主文本 | `--at-text-primary` | `#1b1f27` | `#f5f6f8` | 对齐原 label-primary |
| 次文本 | `--at-text-secondary` | `#5a6474` | `#b9bdc6` | 对齐原 label-secondary |
| 弱文本 | `--at-text-tertiary` | `#8f97a6` | `#8b90a0` | 对齐原 label-tertiary（暗底 ≈6:1） |
| 强调色（军蓝） | `--at-accent` | `#2d5ca8` | `#5b8dd9` | 暗色提亮到可读（用户建议值，暗底 ≈5.1:1） |
| 强调 hover | `--at-accent-hover` | `#3568b8` | `#6d9be0` | 更亮一档 |
| 强调按下 / 更深 | `--at-accent-strong` | `#244a8a` | `#4a7cc9` | 略深一档 |
| 成功 | `--at-success` | `#15875a` | `#3ecf7f` | 提亮（对齐 preview 原值） |
| 警告 | `--at-warning` | `#a4681a` | `#f0a83c` | 提亮 |
| 危险 | `--at-danger` | `#c23b42` | `#f0606a` | 提亮 |
| 强调底上文字 | `--at-on-accent` | `#ffffff` | `#ffffff` | 不变 |
| 徽章阴影 | `--at-shadow-badge` | `0 8px 24px rgb(23 32 48 / 8%)` | `0 8px 24px rgb(0 0 0 / 45%)` | 暗色加重但柔和 |
| 面板阴影（常态） | `--at-shadow-panel` | `0 12px 32px rgb(23 32 48 / 7%), 0 32px 72px rgb(23 32 48 / 11%)` | `0 12px 32px rgb(0 0 0 / 45%), 0 32px 72px rgb(0 0 0 / 55%)` | 对齐 preview 原 rgba(0,0,0,.5/.55) |
| 面板阴影（拖拽/缩放） | `--at-shadow-active` | `0 16px 40px rgb(23 32 48 / 10%), 0 36px 80px rgb(23 32 48 / 14%)` | `0 16px 40px rgb(0 0 0 / 50%), 0 36px 80px rgb(0 0 0 / 60%)` | — |

**ActivityPanel.module.css 实现写法**（在 `.badge, .panel` 桥接块**之后**追加；`--dsw-alias-*` 桥接行原样保留）：

```css
/* 暗色主题：只覆盖 --at-* token 值，别名桥接声明不动，双主题自动切换 */
@media (prefers-color-scheme: dark) {
  .badge, .panel {
    --at-bg-panel: #1e1f22;
    --at-bg-raised: #202125;
    --at-bg-fill: #2a2c30;
    --at-border: #2e3136;
    --at-border-strong: #3a3e45;
    --at-text-primary: #f5f6f8;
    --at-text-secondary: #b9bdc6;
    --at-text-tertiary: #8b90a0;
    --at-accent: #5b8dd9;
    --at-accent-hover: #6d9be0;
    --at-accent-strong: #4a7cc9;
    --at-success: #3ecf7f;
    --at-warning: #f0a83c;
    --at-danger: #f0606a;
    --at-on-accent: #ffffff;
    --at-shadow-badge: 0 8px 24px rgb(0 0 0 / 45%);
    --at-shadow-panel: 0 12px 32px rgb(0 0 0 / 45%), 0 32px 72px rgb(0 0 0 / 55%);
    --at-shadow-active: 0 16px 40px rgb(0 0 0 / 50%), 0 36px 80px rgb(0 0 0 / 60%);
  }
}
```

**preview-panel.html 实现写法**（`:root` 定义 `--at-*` 亮色 + 别名桥接为 `var(--at-*)`，另加同款暗色 media query；预览专属底色/文字也在同一 media query 内覆盖）：

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* 与上表一致的 --at-* 暗色值（省略，同上） */
    --at-bg-panel: #1e1f22; /* …全部 18 项… */
  }
  body { background: #0f1012; }                                  /* 舞台底色（原暗色值） */
  .stage { background: radial-gradient(900px 500px at 80% -5%, rgba(91,141,217,.10), transparent 60%), #0f1012; }
  .conv { color: #6b7080; }                                      /* 对话占位文字（原值） */
  h1 { color: #b9bdc6; }
}
```

**对比度自检**（暗底 `#1e1f22` 上）：主文本 `#f5f6f8` ≈15:1、次 `#b9bdc6` ≈9:1、弱 `#8b90a0` ≈6:1、强调 `#5b8dd9` ≈5.1:1、成功/警告/危险 ≈8.5/8.5/5.4:1——全部 ≥4.5:1（AA）。

### 1.3 需要特别改动的点（白底下会失效的样式）

| 位置（ActivityPanel.module.css） | 现状 | 改为 |
|---|---|---|
| L55 `.badge` box-shadow | `color-mix(label-primary 14%, transparent)` → 白底不可见 | `var(--at-shadow-badge)` |
| L119–121 `.panel` box-shadow | 同上（12%/16% 白混色） | `var(--at-shadow-panel)` |
| L129–131 `[data-dragging]/[data-resizing]` | 同上 | `var(--at-shadow-active)` |
| L365–367 `.captainNode` 边框/背景 | `color-mix(business-primary 32%, line-normal)` / `7%` | 换 `--at-accent` 后自动变柔和钢蓝，保持表达式不变 |
| L562 `.progressSummary`、L608 `.membersToggle`、L1074 `.taskDetail` | `bg-module-platform`（此前未桥接 → 宿主暗色） | 桥接后自动变 `#fafbfc` |
| L766–768 `.stateArt` filter drop-shadow | `rgb(18 45 72 / 20%)` 暗色下几乎不可见 | 暗色 media query 内覆盖为 `rgb(0 0 0 / 45%)`（选做，非必须） |

---

## 2. 角色中文化 + 部队职位映射

### 2.1 映射表（依据 docs/team-roles-and-responsibilities.md 更新）

固定职位 3 个：**队长**（主官称谓，用户最终决定用"队长"，放弃"指挥官"及营长/团长方案）、**政委（独立监督者）**、**执行成员**。部队职位对照表（用户已确认，保持不变）：队长、政委、侦察参谋、技术员、质检员、文宣干事、警卫员、文书、情报分析员、后勤保障员。

| 规范键（canonical，数据层不变） | 职位（展示层） | 头像匹配需新增关键词 | 现有兜底关键词 |
|---|---|---|---|
| `captain` | 队长（用户最终决定，主官称谓） | —（固定 `LEAD_ART`，不走 `ROLE_ART`） | `t('captain.name')` |
| `commissar` | 政委（独立监督） | 政委、政治委员、commissar | —（监督节点，展示见 §2.5） |
| `researcher` | 侦察参谋 | 侦察、参谋 | 研究 / 调查 / 探索 / 调研 |
| `engineer` | 技术员 | 技术 | 工程 / 后端 / 服务 / 接口 / 开发 |
| `qa` | 质检员 | 质检 | 测试 / 质量 / 验证 |
| `designer` | 文宣干事 | 文宣、宣传、干事 | 设计 / 前端 / 主题 / 无障碍 |
| `security` | 警卫员 | 警卫 | 安全 / 审计 / 审查 / 风险 |
| `docs` | 文书 | 文书 | 文档 / 撰写 / 文案 / 写作 |
| `data` | 情报分析员 | 情报 | 数据 / 分析 / 指标 / 性能 |
| `operator` | 后勤保障员 | 后勤、保障 | 发布 / 构建 / 部署 / 运维 |

> 政委职责（规范第 5 节）：**目标监督、风险与纪律监督、质量监督、分歧上报**；核心权限：审查整体方案 / High-Critical 任务、抽查普通任务、退回不合格任务、临时暂停重大风险任务、向用户上报分歧。展示设计见 §2.5。

### 2.2 成员名称显示方案

- `member.name`：**保持原样，不翻译**。它是任务 `assignee` 匹配、邮箱寻址（`readUnreadMailbox` 按 name）、prompt 身份（`You are ${member.name}…`）的键，改名会破坏整条链路。队长命名成员成什么就显示什么。
- `member.role`：**展示层映射**为中文部队职位。位置不变——面板成员行 `.memberRole`（10px 弱化小字，紧跟姓名）、对话卡片 tooltip（`名字 · 职位`）。
- 未知角色：`roleTitle()` 回退显示原始 role 文本，绝不空白、绝不报错。
- 匹配逻辑：`memberArtUrl(name, role)` 把 name+role 拼起来跑正则，所以**中英文角色都能命中**——只要 `ROLE_ART` 加上 2.1 表的新关键词（见 §3 实现清单）。

### 2.3 是否需要同步到 artwork.ts 与 ActivityPanel 展示文案

- **是**。三处一起改：
  1. `src/client/artwork.ts`：`ROLE_ART` 每个 regex 补中文职位关键词（否则"文宣干事"这种既不含"设计"也不含英文关键词的职位会落到字母头像兜底）。
  2. `src/client/ActivityPanel.tsx` L558：`{member.role}` → `{roleTitle(member.role, t)}`。
  3. `src/client/AgentTeamsCard.tsx` L100：tooltip 同样走 `roleTitle`。
- 关键词**冲突检查**（已逐条验证，按现有数组顺序不会误匹配）：
  - `政委` / `政治委员` / `commissar`：与全部 8 个部队职位关键词互斥 ✓（建议放在 `ROLE_ART` **首位**，最高优先级，避免"政委"落入其它桶）
  - `侦察参谋`：不命中 data（数据/分析/指标/性能）→ 命中 researcher ✓
  - `技术员`：不命中 data/researcher/qa（qa 含"质检"）→ 命中 engineer ✓
  - `质检员`：命中 qa（质检），且在 engineer 之前 ✓
  - `文宣干事`：命中 designer（文宣）✓
  - `警卫员`：命中 security（警卫）✓
  - `文书`：命中 docs（文书）✓
  - `情报分析员`：命中 data（情报/分析）✓
  - `后勤保障员`：命中 operator（后勤/保障）✓

### 2.4 新增模块设计（roles.ts）

新建 `src/client/roles.ts`，遵循现有 locales 键集模式（zh 为 source of truth，en 补全）：

```ts
/** 规范角色键 → 部队职位文案键（zh/en 见 locales.ts 的 role.*）。 */
export const ROLE_TITLE_KEY: Record<string, AgentTeamsLocaleKey> = {
  captain: 'role.captain',
  researcher: 'role.researcher',
  engineer: 'role.engineer',
  qa: 'role.qa',
  designer: 'role.designer',
  security: 'role.security',
  docs: 'role.docs',
  data: 'role.data',
  operator: 'role.operator',
  commissar: 'role.commissar',
}

/** 成员角色展示文案：规范键命中则取本地化职位名，否则回退原始 role。 */
export function roleTitle(role: string, t: AgentTeamsTranslate): string {
  const key = ROLE_TITLE_KEY[role.trim().toLowerCase()]
  return key === undefined ? role : t(key)
}
```

locales.ts 新增键（zh）：

```ts
'role.captain': '队长', // 用户最终决定
'role.researcher': '侦察参谋',
'role.engineer': '技术员',
'role.qa': '质检员',
'role.designer': '文宣干事',
'role.security': '警卫员',
'role.docs': '文书',
'role.data': '情报分析员',
'role.operator': '后勤保障员',
'role.commissar': '政委',
```

en 同步：`Captain / Commissar / Recon Staff Officer / Technician / Quality Inspector / Cultural & Publicity Officer / Guard / Clerk / Intelligence Analyst / Logistics Support Staff`（仅保证键集完整，实际界面以中文为主）。

监督状态文案（新 locale 键 `commissar.state.*`，zh）：

```ts
'commissar.state.supervising': '监督中',
'commissar.state.standby': '随时待命',
'commissar.state.unknown': '状态未知',
// 扩展（等数据层有监督事件后再挂接）：
'commissar.state.reported': '分歧已上报',
'commissar.state.paused': '已暂停风险任务',
```

### 2.5 政委（独立监督者）展示设计（用户已确认）

**定位约束**（规范 §2 / §5）：政委是 Team 固定职位之一（独立监督者），**不是第二个队长**，不建立并行调度链、不负责日常派工、不设任务 Owner。因此：

- **不能**进入 `delegationTree`（那里有派发 chips，语义是"被派工的执行成员"，会错误暗示政委有任务）。
- **不能**显示 `done/total` 任务计数与 `assignmentLine`（政委无 Owner 任务）。

**领导层区域布局（用户已确认：队长 + 政委并排，成员列表在下）**：

```text
teamHead
└── commandLayer（领导层，两卡并排）
      ├── captainNode（队长）   └── commissarNode（政委）
    → ProgressOverview → 优先干预 / 里程碑
    → membersToggle + delegationTree（仅执行成员，位于领导层之下）
```

`.commandLayer` 样式：

```css
.commandLayer {
  display: grid;
  grid-template-columns: 1fr 1fr; /* 队长 | 政委 并排 */
  gap: 8px;
}
/* 窄面板压缩时纵向堆叠，避免半宽挤压 */
@media (max-width: 640px) {
  .commandLayer { grid-template-columns: 1fr; }
}
```

领导层卡片（captainNode / commissarNode 同构图，按半宽适配）：

| 项 | 方案 |
|---|---|
| 内层 grid | `grid-template-columns: 40px minmax(0, 1fr)`——半宽卡去掉原第三"状态"列，头像 40px（全宽时的 48px 略缩） |
| 名称行 | 队长：主标题"队长"；政委：主标题 `roleTitle(role)`（"政委"，英文名 'commissar' 同样显示"政委"），右侧职位小字 |
| 职位小字（`.memberRole` 位） | 队长：`统筹 · 拆解 · 派发 · 验收`（可选微调）；政委：`独立监督` |
| 状态 | 紧凑化为小圆点/脉冲点（忙态/监督中亮军蓝），文字状态并入状态行（政委走 `commissar.state.*`） |
| 摘要/职责行 | 单行 ellipsis 截断：队长 `captain.summary`；政委职责一行 `commissar.duty` |
| 边框/背景 | 两卡同款：`color-mix(--at-accent 32%, --at-border)` 边框 + `color-mix(--at-accent 5%, --at-bg-panel)` 浅底；政委卡可加 2px 左侧强调条做身份区分 |

#### 2.5.1 领导层实现规格（DOM 结构 + CSS，供 engineer 直接落地）

**JSX 结构**（`TeamSection`，替换现有单独渲染 captainNode 的写法）：

```tsx
const commissar = team.members.find((member) => member.role === 'commissar')
const execMembers = team.members.filter((member) => member.role !== 'commissar')

// delegationSection 内、ProgressOverview 之前：
<div className={css.commandLayer} data-leadership={commissar === undefined ? 'solo' : 'pair'}>
  <div className={css.captainNode}>
    <span className={css.captainAvatar}>
      <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
    </span>
    <span className={css.captainInfo}>
      <span className={css.captainLine}>
        <span className={css.captainName}>{t('captain.name')}</span>       {/* 队长 */}
        <span className={css.captainRole}>{t('captain.role')}</span>        {/* 统筹 · 拆解 · 派发 · 验收 */}
      </span>
      <span className={css.captainSummary}>{t('captain.summary', { tasks: assignedCount, members: execMembers.length })}</span>
    </span>
    <span className={css.captainState} data-busy={busyCount > 0} title={…}>
      <WorkGlyph active={busyCount > 0} />                                   {/* 半宽卡：仅图标，文字进 title */}
    </span>
  </div>

  {commissar !== undefined && (
    <div className={css.commissarNode} data-activity={commissar.activity}>
      <span className={css.captainAvatar}>
        {memberArtUrl(commissar.name, commissar.role) !== null ? (
          <img className={css.leadAvatar} src={memberArtUrl(commissar.name, commissar.role) ?? ''} alt="" aria-hidden />
        ) : (
          <span className={css.memberInitial}>{memberInitial(commissar.name)}</span>
        )}
        <img className={css.stateArt} data-activity={commissar.activity} src={ACTION_ART[commissar.activity]} alt="" aria-hidden />
      </span>
      <span className={css.captainInfo}>
        <span className={css.captainLine}>
          <span className={css.captainName}>{roleTitle(commissar.role, t)}</span>   {/* 政委 */}
          <span className={css.captainRole}>{t('commissar.dutyShort')}</span>       {/* 独立监督 */}
        </span>
        <span className={css.captainSummary} title={t('commissar.dutyFull')}>{t('commissar.duty')}</span>
      </span>
    </div>
  )}
</div>

// membersToggle 计数改用 execMembers.length（政委不计入"成员列表"）
// delegationTree 内 team.members.map(...) 改为 execMembers.map(...)
```

**CSS**（ActivityPanel.module.css 新增/调整）：

```css
/* 领导层容器：队长 | 政委 并排 */
.commandLayer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
/* 无政委的既有团队：队长恢复全宽（视觉零回归） */
.commandLayer[data-leadership='solo'] { grid-template-columns: 1fr; }
@media (max-width: 640px) { .commandLayer { grid-template-columns: 1fr; } }

/* 半宽卡：captainNode 由原 48px+状态列 收紧为 40px+图标状态 */
.commandLayer .captainNode,
.commissarNode {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 52px;
  padding: 6px 8px;
}
.commandLayer .captainNode .leadAvatar { width: 40px; height: 40px; }
.commandLayer .captainState { font-size: 0; }          /* 文字隐藏，仅留 WorkGlyph */
.commandLayer .captainState .workGlyph { width: 11px; height: 11px; }

/* 政委卡：同构图 + 左侧 2px 强调条 */
.commissarNode {
  position: relative;
  display: grid;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--at-accent) 32%, var(--at-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--at-accent) 5%, var(--at-bg-panel));
}
.commissarNode::before {
  position: absolute;
  top: 8px; bottom: 8px; left: 0;
  width: 2px;
  border-radius: 2px;
  background: var(--at-accent);
  content: '';
}
```

**行为规格（边界情况）**：

| 场景 | 行为 |
|---|---|
| 团队无政委（既有团队） | `data-leadership='solo'` → captainNode 全宽，与现状一致，**零视觉回归** |
| 多个政委（异常） | 取第一个 `find`，其余忽略（正常不会发生） |
| `busyCount`（队长忙态/徽章脉冲） | 只统计执行成员（`role !== 'commissar'` 且 working）；政委的 activity 只驱动政委卡自己的状态点 |
| `membersToggle` 计数 | 用 `execMembers.length`（政委常驻领导层，不重复计进"成员列表"） |
| `captain.summary` 参数 `members` | 用 `execMembers.length`（派发对象=执行成员） |
| historic / archived 团队 | 同一渲染路径；historic 快照 activity 固定 'idle' → 政委状态显示"随时待命" |
| 政委 loadBar | 无 Owner 任务 → `loadBarFor` 返回 null（total≤0），天然不显示负载条，数据层无需改 |

**政委职责文案**（新 locale 键）：

```ts
'commissar.duty': '监督目标 · 审查风险 · 把关质量 · 上报分歧', // 摘要/职责行（ellipsis 截断）
'commissar.dutyShort': '独立监督', // 职位小字（.memberRole 位）
'commissar.dutyFull': '目标监督、风险与纪律监督、质量监督、分歧上报（规范第 5 节）', // title/tooltip
'commissar.state.supervising': '监督中',
'commissar.state.standby': '随时待命',
'commissar.state.unknown': '状态未知',
// 扩展（等数据层有监督事件后再挂接）：
'commissar.state.reported': '分歧已上报',
'commissar.state.paused': '已暂停风险任务',
```

- 职责行对应规范第 5 节四项：目标监督 · 风险与纪律监督 · 质量监督 · 分歧上报
- tooltip/title 可给完整文案：`目标监督、风险与纪律监督、质量监督、分歧上报（规范第 5 节）`

**头像资源与命名方案**：

- 新增 artwork：**`member-commissar-v2.png`**——沿用现有 `member-<role>-v2.png` 命名模式（与 `ART_ALLOWLIST` 白名单风格一致，推荐此名）
- 源图：`/Users/jade/Downloads/orange_cat_15_clean/orange_cat_10.png`（256×256 RGBA，已核实存在，与设计标准尺寸一致）→ 复制为 `assets/agent-team-web/member-commissar-v2.png`
- **必须加入 `src/index.ts` 的 `ART_ALLOWLIST`（L201–210）**，否则路由 404 不展示
- 显示尺寸：领导层 40–44px（`leadAvatar` 规格）/ 对话卡片 30px
- 命名备选（不推荐）：`member-commissar-cat-v2.png` 更贴"猫"语义，但与现有 8 张 `member-*-v2.png` 模式不统一，故推荐 `member-commissar-v2.png`

**artwork.ts 政委关键词匹配方案**（政委 / political / commissar / 监督 / 审查）：

- 在 `ROLE_ART` **首位**新增（最高优先级）：

```ts
[/commissar|political|政委|政治委员|监督/, 'member-commissar-v2.png'],
```

- **`审查` 刻意不加入政委规则**，保留在 security 规则（`review|审查`）里——理由：现有 security 桶用"审查"兜底审计/审查类角色（如"安全审查员"），若政委规则含"审查"且置首，"安全审查"会被误配到政委头像；而 canonical 键 `commissar`/`political` + 中文"政委/政治委员/监督"已覆盖全部正常场景。
- 冲突检查（已验证）：
  - `政委`/`政治委员`/`commissar`/`political`/`监督` 与 8 个部队职位关键词互斥 ✓（"监督"不与任何职位冲突；qa 的"质检"不含"监督"）
  - 已知边界：自定义中文名若含"监督"（如"质量监督员"）会优先命中政委桶——可接受折衷（canonical 键 `qa` 仍能命中 qa 规则，仅名字含"监督"的纯中文自定义名受影响）
  - canonical 键 `commissar` 本身命中 `/commissar/`，英文角色名也能正确匹配 ✓

**数据流**：政委由 `agent_teams_add_member(role='commissar')` 创建（canonical 键，数据层零改动）；`TeamSection` 内 `team.members.find(m => m.role === 'commissar')` 检出并渲染领导层右侧卡，其余成员照常进派发树；historic / archived 卡片走同一渲染路径。

**对话卡片（AgentTeamsCard）**：政委作为成员出现在 roster 首位（排序建议），tooltip 显示"政委"；v1 不额外加徽章，面板才是监督身份的展示主面。

---

## 3. 实现清单（文件 / 行号）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | `src/client/ActivityPanel.module.css` | L21–39 `.badge, .panel` 桥接块 | 按 §1.2 整体替换：新增 `--at-*` 层 + 补齐缺失的 5 个别名桥接（`bg-module-platform`、`label-primary/secondary/tertiary`、`state-business-primary`），删除 `--dsw-static-neutral-bluish-*` 兜底与 color-mix 双色合成 |
| 2 | 同上 | L55 | `box-shadow` → `var(--at-shadow-badge)` |
| 3 | 同上 | L119–121 / L129–131 | 面板阴影 → `var(--at-shadow-panel)` / `var(--at-shadow-active)` |
| 4 | 同上 | L365–367、L562、L608、L1074 等 | 无需逐行改，桥接后自动生效（白底 + 军蓝 tint） |
| 5 | `preview-panel.html` | L9–19 `:root` | 换成 §1.2 同款白底 palette（`--at-*` + 别名，值一致） |
| 6 | 同上 | L8、L20–25 | `body` 背景 `#0f1012` → `#f4f6f9`；`.stage` 蓝色径向光 `rgba(77,107,254,.12)` → `rgba(45,92,168,.10)`；`.panel` 阴影 `rgba(0,0,0,.5/.55)` → `--at-shadow-panel`；`.conv`/`h1` 文字色 → `#8f97a6`/`#5a6474` |
| 7 | 同上 | L1362、L1374 及领导层区 | 演示数据 `memberRole`：`engineer` → `技术员`、`researcher` → `侦察参谋`；领导层并排 demo：队长卡 + 政委卡（政委 · 监督中 · 职责行 `commissar.duty`） |
| 8 | `src/client/artwork.ts` | L13–22 `ROLE_ART` | 每个 regex 追加 §2.1 新关键词（情报、侦察、参谋、技术、质检、文宣、宣传、干事、警卫、文书、后勤、保障）；**首位新增** `[/commissar\|political\|政委\|政治委员\|监督/, 'member-commissar-v2.png']`（`审查` 保留在 security 规则，见 §2.5） |
| 9 | `src/client/roles.ts` | 新建 | §2.4 的 `ROLE_TITLE_KEY`（含 `commissar`）+ `roleTitle()` |
| 10 | `src/client/locales.ts` | zh 约 L79 之后 / en 对应位置 | 新增 `role.*` 10 键 + `commissar.duty` + `commissar.state.*` 3–5 键（zh + en） |
| 11 | `src/client/ActivityPanel.tsx` | L49 import、L558 | `member.role` 渲染改为 `roleTitle(member.role, t)` |
| 12 | `src/client/AgentTeamsCard.tsx` | L22 import、L100 | tooltip `title` 改为 `member.role === '' ? member.name : \`${member.name} · ${roleTitle(member.role, t)}\`` |
| 13 | `src/client/ActivityPanel.tsx` | `TeamSection`（L441–590） | 按 §2.5.1 JSX：`const commissar = find(role==='commissar')`、`execMembers = filter(!commissar)`；新增 `.commandLayer`（`data-leadership='solo'/'pair'`）包裹 captainNode + commissarNode 并排；`busyCount`、`captain.summary` 的 members、`membersToggle` 计数、`delegationTree.map` 全部改用 `execMembers` |
| 14 | `src/client/ActivityPanel.module.css` | 新增/调整 | §2.5.1 CSS：`.commandLayer`（grid 两列、`[data-leadership='solo']` 单列、≤640px 堆叠）；`.captainNode` 半宽收紧（40px 头像、状态仅图标）；`.commissarNode`（40px 头像 + 左侧 2px 强调条） |
| 15 | `src/client/ActivityPanel.tsx` | L559–567 区域 | 政委节点隐藏 `done/total` 与 `assignmentLine`；状态文案按 activity 走 `commissar.state.*`，职位小字 `commissar.dutyShort`，摘要 `commissar.duty`，tooltip `commissar.dutyFull` |
| 16 | `assets/agent-team-web/member-commissar-v2.png` | 新增资源 | 复制 `/Users/jade/Downloads/orange_cat_15_clean/orange_cat_10.png`（256×256 RGBA，已核实）→ 命名 `member-commissar-v2.png` |
| 17 | `src/index.ts` | L201–210 `ART_ALLOWLIST` | 白名单新增 `'member-commissar-v2.png'`（不加则 404） |
| 18 | `src/client/ActivityPanel.module.css` | 桥接块后追加（t7） | 新增 `@media (prefers-color-scheme: dark) { .badge, .panel { … } }`，仅覆盖 §1.2.1 的 18 项 `--at-*` 暗色值；`--dsw-alias-*` 桥接行不动 |
| 19 | `preview-panel.html` | `:root` 后追加（t7） | 同款暗色 media query：`:root` 覆盖 `--at-*` 暗色值；同一查询内 `body` 背景 `#0f1012`、`.stage` 径向光 `rgba(91,141,217,.10)`、`.conv` `#6b7080`、`h1` `#b9bdc6` |
| 20 | `src/client/ActivityPanel.module.css` | L766–768（t7，选做） | `.stateArt` drop-shadow 暗色下覆盖为 `rgb(0 0 0 / 45%)` |

> 数据层（`src/snapshot.ts`、`src/tools.ts`、`src/members.ts`、`src/intelligence.ts`、`src/state.ts`）**零改动**。

## 4. 验收清单

- [ ] 面板/徽章/任务详情/折叠条全为白底分层，边框极浅灰，阴影柔和可见
- [ ] 主色为深海军蓝 `#2d5ca8`，无大面积亮蓝；运行中/忙态点、派发树连线、焦点描边均为军蓝
- [ ] 状态色（成功/警告/危险）在浅底与填充场景下均清晰可辨
- [ ] `preview-panel.html` 在浏览器打开即为白底效果；领导层并排显示"队长 | 政委"，演示成员职位显示"技术员 / 侦察参谋"
- [ ] `memberArtUrl('工程师', '技术员')` → `member-engineer-v2.png`；`('侦察参谋', 'researcher')` → `member-researcher-v2.png`；`('文宣干事', …)` → `member-designer-v2.png`；`(…, 'commissar')` 或 `('政委', …)` → `member-commissar-v2.png`
- [ ] 政委与队长**并排**显示在领导层（队长左、政委右，窄屏自动堆叠），成员列表在其下；政委无 `done/total`、无派发 chips；状态文案显示"监督中 / 随时待命 / 状态未知"之一
- [ ] **无政委的既有团队**：`data-leadership='solo'`，队长卡保持全宽，与现状零视觉回归
- [ ] `busyCount` / `membersToggle` 计数 / `captain.summary` 均只统计执行成员（政委不计入）
- [ ] 队长显示名为"队长"（`t('captain.name')` / `role.captain` locale 均为此值）
- [ ] `assets/agent-team-web/member-commissar-v2.png` 可由 `/plugins/agent-team-web/assets/` 正常访问（白名单已加，源图为橙猫 256×256）

### 暗色模式（t7）检查项

- [ ] 系统主题切到暗色（`prefers-color-scheme: dark`）后刷新：面板为深色分层（`#1e1f22` 主面 / `#202125` 凸起 / `#2a2c30` 填充），边框深灰（`#2e3136/#3a3e45`）
- [ ] 军蓝提亮为 `#5b8dd9`（状态点、派发树连线、焦点描边、忙态脉冲），暗底可读
- [ ] 文本三档亮灰（`#f5f6f8/#b9bdc6/#8b90a0`），暗底对比全部 ≥4.5:1；状态色提亮（`#3ecf7f/#f0a83c/#f0606a`）清晰可辨
- [ ] 阴影为黑色系加重但柔和（`rgb(0 0 0 / 45–60%)`），拖拽/缩放态阴影可见
- [ ] 双主题切换**只改 token 值**：`--dsw-alias-*` 桥接声明在亮/暗两模式下完全一致（无重复定义）；`color-mix(accent X%, bg)` 表达式自动跟随
- [ ] `preview-panel.html` 系统暗色下：舞台 `#0f1012`、面板深色、`.conv`/`h1` 灰阶协调
- [ ] 亮→暗切换无残留白底元素（含 `.badge`、`.taskDetail`、`.membersToggle` 等所有用 `--dsw-alias-bg-module-platform` 的面）
- [ ] 未知角色（如 `writer`）不崩溃，头像走字母兜底，职位显示原始文本
- [ ] `pnpm build` 通过；`lib/types/client/*` 同步生成
