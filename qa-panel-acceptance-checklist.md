# 面板 UI 排版优化 · 验收清单（质检员一号 · t3）

> 对象：`src/client/ActivityPanel.module.css`、`src/client/ActivityPanel.tsx`、`preview-panel.html`、`src/client/roles.ts` / `locales.ts` / `artwork.ts`
> 依据：`design-panel-redesign.md` §4 验收清单 + 队长验收维度（间距一致性 / 对齐 / 视觉层级 / compact 模式 / 双主题 / 无功能回归）
> 验收方式：静态代码复查 + 测试运行 + 无头 Chrome 视觉抽检（独立实例，不碰用户浏览器 9224）

## A. 间距一致性（Spacing Consistency）

- [ ] A1 间距 token 化：同层级元素使用一致的 gap/padding 值，未出现同义间距乱用（如 3px/4px 混用、7px/8px 混用导致栅格破碎）
- [ ] A2 垂直节奏：区块间间距 ≥ 区块内间距，卡片内 padding 与外层 gap 层级分明（内紧外松）
- [ ] A3 卡片内边距一致：同类卡片（memberRow / priorityCard / taskDetail）padding 横向/纵向值统一
- [ ] A4 徽章/chip 行高与文字基线一致，不与相邻元素错位
- [ ] A5 折叠条/展开态间距过渡平滑，无跳变

## B. 对齐（Alignment）

- [ ] B1 成员行：头像、姓名、职位小字、状态点左对齐基准一致（grid 列模板统一）
- [ ] B2 领导层（队长 | 政委）：两卡等高、内容基线对齐（grid `align-items`）、头像尺寸一致
- [ ] B3 进度总览：segments / legend / summary 三行左对齐，图例间距一致
- [ ] B4 派发树连线与节点对齐：连线锚点居中于节点边缘，无 1px 错位
- [ ] B5 面板右缘内容不贴边：padding-right 与 padding-left 对称（无单侧贴边）
- [ ] B6 窄面板（320–388px）下无横向溢出/裁切，文本 ellipsis 生效

## C. 视觉层级（Visual Hierarchy）

- [ ] C1 三层背景区分：面板主面 / 凸起卡片 / 中性填充 三档可辨识（白底 `#ffffff` / `#fafbfc` / `#f4f6f9`）
- [ ] C2 文字三档：主/次/弱（`#1b1f27` / `#5a6474` / `#8f97a6`）字号或字重有区分，主标题不弱于正文
- [ ] C3 主色军蓝 `#2d5ca8` 仅作小面积强调（状态点/连线/焦点描边），无大面积亮蓝填充
- [ ] C4 阴影柔和可见：badge / panel / dragging 三档阴影存在且层级递进（`--at-shadow-*`）
- [ ] C5 分割线极浅灰（`#e8ebf0`），不喧宾夺主；强调元素（P1 徽章等）通过边框/底色突出
- [ ] C6 交互态（hover/focus）有明确视觉反馈，focus 描边为军蓝

## D. Compact 模式（≤960px 视口）

- [ ] D1 `compactPanelForBounds` 触发后面板为 inset overlay（四周 12px margin），无手势（拖拽/缩放禁用）
- [ ] D2 compact 下内容自适应：领导层单列堆叠（`@media (max-width: 640px)`），无半宽挤压
- [ ] D3 compact 下无横向滚动条、无内容裁切，文字 ellipsis
- [ ] D4 docked 面板宽度 320–640 区间：最小宽 320 不破版（B6 覆盖）

## E. 双主题（亮/暗，prefers-color-scheme）

- [ ] E1 暗色下 token 值切换正确：主面 `#1e1f22` / 凸起 `#202125` / 填充 `#2a2c30` / 边框 `#2e3136` / 强调 `#5b8dd9`
- [ ] E2 `--dsw-alias-*` 桥接声明在亮暗两模式下完全一致（仅 `--at-*` 值被覆盖，无重复定义）
- [ ] E3 暗色下无残留白底元素（所有用 `--dsw-alias-bg-module-platform` 的面均已桥接）
- [ ] E4 暗色文本对比度 ≥4.5:1（主 `#f5f6f8` / 次 `#b9bdc6` / 弱 `#8b90a0`），状态色提亮（`#3ecf7f` / `#f0a83c` / `#f0606a`）
- [ ] E5 暗色阴影为黑系（`rgb(0 0 0 / 45–60%)`），拖拽/缩放态可见
- [ ] E6 亮↔暗切换无闪烁残留（同一 media query 内 body/stage 一并覆盖）

## F. 无功能回归（Functional Regression）

- [ ] F1 拖拽/缩放/停靠/悬浮几何逻辑未回归：`panel-geometry` 测试全绿
- [ ] F2 角色映射未回归：`roles-artwork` 测试全绿（中英文职位关键词、未知角色兜底）
- [ ] F3 任务依赖 DAG 布局（compactDagLayout 常量）未被 CSS 改动破坏
- [ ] F4 数据层零改动：`snapshot.ts` / `tools.ts` / `members.ts` / `intelligence.ts` / `state.ts` 无 diff
- [ ] F5 `member.role` 规范键保持英文原样，中文化仅发生在 UI 渲染（`roleTitle`）
- [ ] F6 无政委的既有团队：`data-leadership='solo'`，队长卡全宽，零视觉回归
- [ ] F7 面板在真实 GUI（dsh web）挂载无 JS 报错；preview-panel.html 控制台无 error

## H. 设计评审量化验收点（design-panel-layout-review.md §E，t1 产出）

- [ ] H1 `.delegationSection` 建立 `display:flex; flex-direction:column; gap:10px`，各子区块（commandLayer/progressOverview/prioritySection/milestoneRow/membersToggle/delegationTree）间距统一 10px；`.delegationTree` 原 `padding-top:9px` 归零（避免 19px 双倍间距）
- [ ] H2 `.panelHead` 内边距对称 `0 14px`（原 `0 14px 0 16px`），与内容区 14px 左缘对齐
- [ ] H3 `.emptyHint` / `.closeError` 水平内边距统一 14px
- [ ] H4 `.team` padding 改为 `12px 14px 14px`（原底 16px）
- [ ] H5 ≤640 media query 中 `.assignmentLine` padding-left = 60px（与成员名起点一致，消除 53px 的 7px 错位）
- [ ] H6 微字号收敛：10.5px→10px（teamStats/memberStatusLine/memberCount/membersToggle）、9.5px→9px（legend/label/line/empty/pill/hint）、8px→8.5px（reviewChip/helpingChip）；全面板仅 10/9/8.5 三档微字号（加面板级 11+）
- [ ] H7 `.reviewChip`/`.helpingChip` 与 `.assignmentChip` 等高（inline-flex + min-height 16px + line-height 16px）
- [ ] H8 成员行右侧簇：TSX 新增 `.memberRight` wrapper（memberState + loadBar + memberCount 成簇），删除 `.memberState{margin-left:auto}`；无 loadBar 时计数仍在右缘
- [ ] H9 圆角收敛：taskDetail 9→8、review/helping chip 3→4；圆角档位 = 16/10/8/6/4/2
- [ ] H10 过渡统一：微交互 120ms、显隐 150ms，无孤立 140ms；`.membersToggle` hover 有 transition；按压缩放 badge 0.97 / iconButton 0.94 / memberRow 0.99
- [ ] H11 幽灵类名 `.archivedWrap` 从 TSX 删除（C-3）
- [ ] H12 ≤960 media query：`.team` padding `12px 12px 14px`、`.delegationTree` margin-left 12px / padding-left 15px、`.memberBranch` width 15px（641–960 全宽模式树缩进与 ≤640 一致）
- [ ] H13（可选/若采纳）`.memberInitial` 38px；`.healthChip strong` tabular-nums；成员行列宽 48px 联动（assignmentLine 63px）；teamStats margin-left:auto
- [ ] H14 preview-panel.html 与模块 CSS 同步：若 CSS 有 H 项改动，preview 内嵌 CSS 需同步；preview 演示面板停靠在舞台右侧（当前实测在左上角 0,0，盖住对话占位区——**预存缺陷**，验收时复核是否已修）

## G. 构建与测试

- [ ] G1 `pnpm typecheck` 通过（或等价 tsc --noEmit）
- [ ] G2 面板相关单元测试全绿（panel-geometry / roles-artwork / task-review）
- [ ] G3 `pnpm build` 通过，`lib/types/client/*` 同步生成（若本轮要求）
- [ ] G4 preview-panel.html 在无头 Chrome 中渲染无异常，截图留档

## 验收结论模板

- 判定：通过 / 有条件通过 / 不通过
- 通过项：A# / B# / ...
- 问题项：条目 + 证据（行号/截图）+ 严重级（阻塞 / 次要 / 建议）
- 附：截图文件清单（亮色 / 暗色 / compact / 窄宽）
