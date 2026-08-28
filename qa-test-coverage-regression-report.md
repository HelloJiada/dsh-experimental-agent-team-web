# 测试覆盖与回归风险审查报告

审查人：质检员一号（framework-audit / t3）
审查时间：2026-08-28
审查对象：`@deepseek-ai/dsh-experimental-agent-team-web`（工作区 /Users/jade/Desktop/dsh-experimental-agent-team-web，HEAD d0798a8）

## 0. 执行方法

1. 真实运行测试：`vitest run --configLoader runner`（默认配置）与 `--exclude '.claude/**'` 对照运行
2. v8 覆盖率：新增 devDep `@vitest/coverage-v8@4.1.11`，`vitest run --coverage --coverage.provider=v8 --coverage.include='src/**'`
3. 人工走查：全部 24 个主仓测试文件、无测试模块源码、最近 5 个提交（ddd485a / 90944b4 / 87702b9 / 4a1822f / d0798a8）的 diff

## 1. 测试计数完整性（高风险，先修）

**`pnpm test` 报告的 "362 tests / 41 files" 是虚高的**：

- 其中 **86 tests / 17 files 来自 `.claude/worktrees/agent-a868bf34e7840d4c3/`** —— 一个残留的子代理 worktree（分支 `worktree-agent-a868bf34e7840d4c3`，指向**旧 commit 3e43345**，旧架构：projection / dependency-dag / AgentTeamActivityPanel）。
- 原因：vitest 默认 include 通配 `**/*.{test,spec}.?(c|m)[jt]s?(x)` 会扫入 `.claude/**`，而 `vitest.config.ts` 未排除。
- **主仓真实测试数 = 276 tests / 24 files**（排除 .claude 后实测）。
- 影响：
  - 提交信息 "362 tests green"（4a1822f）与真实主仓测试数不符；
  - `package.json` 的 `prepack` = `build && test`，发布/CI 被**无关旧代码**的测试绿灯/红灯门控（worktree 删除、分支漂移都会改变发布门状态）；
  - worktree 里那些测试测的是旧代码，对本包当前代码无任何保护作用。
- 修复：`vitest.config.ts` 增加 `exclude: ['**/.claude/**']`（或显式 include `src` / `tests`）。

## 2. v8 覆盖率总览（主仓 276 测试，include=src/**）

| 范围 | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| 全部 | 46.53% | 44.79% | 43.42% | 47.83% |
| src/（服务端核心） | 59.39% | 55.43% | 62.27% | 60.10% |
| src/client/（面板层） | **18.97%** | **18.08%** | **12.35%** | **19.73%** |

## 3. 盲区清单（按风险分级）

### P0 — 零覆盖且为核心/高变更模块

| 模块 | 行数 | 覆盖 | 说明 |
|---|---|---|---|
| client/ActivityPanel.tsx | 1377 | **0%** | 面板全部 JSX/交互逻辑无测试；旧版面板曾有 17 个测试（见 §6） |
| tools.ts | 1975 | 33.55% | 13 个工具仅 4 个有集成测试（见 §5） |
| members.ts | 577 | **24.28%** / branch 16.27% | 角色行为模板、团队记忆注入、成员生命周期（spawnMember / interruptMember / memberWelcome / modelSelection / resolveMemberLlmSelection）基本未测；最近两次提交大改此模块 |
| client/activity-monitor.ts | 412 | **0%**（0/32 函数） | 活动轮询、快照订阅/发布层 |
| client/activity-model.ts | 185 | **0%** | 依赖 DAG 布局几何、环安全遍历（面板核心计算） |
| command.ts | 148 | **0%** | `/agent-teams` 命令激活、buildActivationDirective、invokedAgentTeamsGoal |
| index.ts | 282 | **0%** | 插件入口 apply()、Web 路由、服务注入 |
| client/index.tsx | 87 | **0%** | 客户端入口 apply() |
| client/AgentTeamsCard.tsx | 115 | **0%** | 团队卡片渲染与打开面板事件 |
| client/agent-teams-card-definition.ts | 117 | **0%** | create 参数解析、ConversationNode 定义 |
| client/session-navigation.ts | 41 | **0%** | openAgentTeamMember 的 rc.8/legacy 降级分支 |
| client/task-helping.ts | 18 | **0%** | helper 徽标（终结态兜底分支） |
| event-types.ts | — | **0%** | 事件类型模块 |

### P1 — 部分覆盖，关键分支缺失

- **client/panel-geometry.ts 45.94% stmts / 9.75% branch**：parsePanelLayout / panelUsesAutoHeight / panelMaximumHeight / floatPanelLayout / dockPanelLayout / movePanelLayout / resizePanelLayout 全部未测（拖动、缩放、自动高度 = 面板交互几何，4/41 分支）。
- **snapshot.ts 57.3%**：collectTeamsActivity / collectArchivedTeamsActivity（归档数据采集端）未测；`.agent-team-web/archive/` 已有 11 个真实归档团队，采集逻辑却无保护。
- **state.ts 62.02%**（1045 行）：仅计时/兼容字段有测（state-timing.test.ts）；门禁落盘、awaitingInput 派生、删除、归档等大量分支未测。
- **scheduler.ts 70.9%**：kick/派单真链路被集成测试的 stub 短路隔离（成员一律 running），核心调度路径未测。
- **client/task-timing.ts 80.89%**：taskElapsedMs 的 approx 回退分支（50-53）、memberTimingState 空任务分支（77-83）未覆盖。
- **suggest.ts 100% stmts / 92.45% branch**：成员挑选 tie-break（199-200）与空任务兜底（248）分支未覆盖。

### P2 — 轻微

events.ts 75%（55-58 未覆盖）、types.ts 83.33%、best-practices.ts 89.28%（71/91-92 未覆盖）、close-route.ts 92.77%（125/225-227/237 未覆盖）。

## 4. 现有 276 个测试的质量评估

**结论：现有测试质量整体良好，问题在"没测到"而非"测了但空心"。**

- 逐文件统计 it/expect 比例，最低的 panel-geometry.test.ts 也有 9 it / 12 expect；未发现 `expect(true).toBe(true)`、空 it 块等空洞断言。
- 纯函数层边界用例扎实，抽样核验：
  - archive-filter.test.ts：时间窗口上边界恰好命中保留、无锚点团队在具体区间被排除、noRetro 语义钉死（无完成态任务不算缺复盘）、组合筛选、确定性。
  - task-timing.test.ts：S 等级 15m 预算 warn/over 边界（1.5×）、L 等级回落、纯空白 retro_note 视为无经验、approx 近似标志、retroDetailText 完整展示（本次复盘展示修复的回归保护）。
  - task-intermediate.test.ts（客户端）：终结态残留标记兜底不显示、与派生 reviewRequired 正交、待复核优先于待输入。
  - state-timing.test.ts：finalizeTaskTiming 幂等、提前完成负 overrun、无 claimedAt 旧任务不产生损坏数据、损坏复盘记录读取即抛错。
  - suggest.test.ts：平票固定顺序、歧义词命中计数决胜（数据分析→data）、英文大小写、版本后缀归一、移除成员排除、负载均衡。
  - close-route.test.ts / tools-suggest-gate.test.ts：真实磁盘状态目录 + 桩 ctx 的集成模式，断言落盘结果与邮箱文件内容。
- **弱项是覆盖盲区**（见 §3/§5/§6），特别是工具层 9/13、面板层 0%、members.ts 24%。

## 5. 工具级集成测试覆盖（13 个工具）

`src/tools-suggest-gate.test.ts`（383 行，9 用例）+ `src/close-route.test.ts` 覆盖情况：

| 工具 | 集成测试 | 覆盖内容 |
|---|---|---|
| agent_teams_create_task | ✅ | 建议字段（命中/指定 assignee/无命中/qa 映射）+ 建议不落盘不派单 |
| agent_teams_status | ✅ | 建议字段 + renderStatus「建议分配给」文本 |
| agent_teams_update_task | ⚠️ 仅门禁拦截路径 | blockedByReview 落盘 → 政委 pass/reject 放行 → completed；正常完成/failed/cancelled、signal_note、无活跃政委分支未测 |
| agent_teams_review_task | ✅ | pass/reject/非政委拒绝 |
| agent_teams_create | ❌ | 无任何集成测试 |
| agent_teams_add_member | ❌ | 角色上限、commissar 唯一、最佳实践记忆注入、provider/model 选择均未测 |
| agent_teams_remove_member | ❌ | 无 |
| agent_teams_reassign_task | ❌ | attempt 作废/队长接管语义未测 |
| agent_teams_claim_task | ❌ | 认领计时、重复认领未测 |
| agent_teams_send_message | ❌ | 邮箱落盘未测 |
| agent_teams_retro_review | ❌ | 队长校准、best-practices 入库未测 |
| agent_teams_best_practices | ❌ | 查询/渲染（renderBestPractices 未覆盖）未测 |
| agent_teams_delete | ❌ | 归档迁移未测 |

另：tools.ts 中未覆盖的辅助函数包括 roleMemoriesFor、captainLockKey、waitForMemberIdle、steerCaptainReport、memberRuntime。

## 6. 面板层测试

- **ActivityPanel.tsx：0% 覆盖**。`@testing-library/react` 已装（devDeps），但没有任何针对本组件的 JSX 测试。
- archive-filter / task-intermediate / task-timing / task-review 均为**纯函数单测**（质量好），但面板的接线未测：中间态徽标渲染条件、归档筛选 UI 交互、DependencyMap（hover/keyboard/pin 焦点、边渲染）、面板开合/拖动/缩放、health/loadBar 计算。
- **历史回退证据**：旧架构（worktree commit 3e43345）面板曾有 17 个测试 —— `AgentTeamActivityPanel.test.tsx`（10）+ `AgentTeamConversationSummary.test.tsx`（3）+ `activity-panel-view.test.ts`（4）。面板重构为 ActivityPanel 后这些测试随旧代码留在 worktree，当前面板测试覆盖实际是**回退到 0**。

## 7. 回归风险（最近改动影响面）

最近改动（87702b9 角色收敛 / 4a1822f docs 恢复+复盘展示修复+改进 3/4/5 / d0798a8 顺序整理 / ddd485a 旧任务计时回退）波及：members.ts、roles.ts、suggest.ts、snapshot.ts、state.ts、tools.ts、types.ts、ActivityPanel.tsx、activity-monitor.ts、locales.ts、task-timing.ts、task-intermediate.ts、archive-filter.ts、member-naming.ts、role-limits.ts。

### 7.1 运行环境实测缺陷（本次会话 3 次复现）

`agent_teams_update_task` 调用**均报错** `returned invalid output: "value.started_at" is not a declared property; "value.signals" is not a declared property`，但**更新实际已落盘**（t3 状态/output 正确更新）。

- src/tools.ts 与 lib/index.js 的 update_task output schema 均已声明 started_at/signals（87702b9 声称已修复），说明**运行中的 harness 进程（9:48 启动，早于 10:17 修复重建）加载的是修复前的插件副本**。
- 影响：所有团队成员每次 update_task 都会收到报错文本（可能误判更新失败）；本地代码侧 schema 正确，**重启 harness 重新加载插件即可**。
- 这是"最近改动是否影响其他模块"的典型证据：修复进了源码与构建产物，但**部署中的运行副本未同步**。

### 7.2 角色系统多表漂移风险

角色标题/映射存在 4 处独立来源，需同步维护：
1. `client/roles.ts` ROLE_TITLE_KEY（权威，被 member-naming.ts 复用）
2. `suggest.ts` ROLE_TITLES（6 预设角色标题独立副本）
3. `role-limits.ts` ZH_EXEC_ROLE_KEY（中文标题→canonical key 独立副本）
4. `members.ts` ROLE_BEHAVIOR_TEMPLATES（行为模板表）

已发现漂移实例：
- **role-limits.ts:23 注释仍写 "The 5 preset behavioral roles"**，docs 恢复为第 6 个预设后未更新（d0798a8 只修了 roles.ts 的注释）。
- **docs 行为模板（members.ts:308）无 persona 测试**：members-persona.test.ts 覆盖 engineer/researcher/qa/designer/data/reviewer/commissar/security/无角色，唯独没有 docs 用例 —— 4a1822f 的核心改动（docs 角色恢复）缺直接测试。
- suggest.ts 的 docs 关键词（编写/撰写/手册/README/changelog）与工程师关键词互斥性无测试保护。

### 7.3 快照新字段的消费链路

- blockedByReview / awaitingInput / pendingCalibration：state→snapshot 派生有部分覆盖（snapshot.ts 57.3%），面板消费端（ActivityPanel）0%。
- 归档链路：filter 端 97.87% 覆盖，但**采集端**（collectTeamsActivity / collectArchivedTeamsActivity）0% —— 数据进不来，过滤再准也无用。

### 7.4 低风险项

- ddd485a 旧任务 updatedAt 回退：task-timing/retro 有专门用例，风险低。
- d0798a8 仅 roles.ts 键序调整，roles-artwork.test.ts 覆盖映射，风险低。

## 8. 补测建议（按优先级）

**P0（先修）**
1. `vitest.config.ts` 排除 `.claude/**`，修正测试计数与发布门控。
2. 补齐 9 个零覆盖工具的工具级集成测试（复用 tools-suggest-gate 的桩 ctx + 磁盘状态模式）：至少覆盖 create、add_member（角色上限/唯一性/记忆注入）、claim_task、reassign_task（attempt 作废）、delete（归档）、send_message（邮箱落盘）、retro_review、best_practices、remove_member。
3. update_task 正常完成/failed/cancelled 路径 + signal_note 分支。
4. ActivityPanel JSX 测试（testing-library 已就绪）：中间态徽标渲染、归档筛选交互、DependencyMap 基础渲染；或先将 taskTone / healthLevel / loadBarFor / compactTaskLabel / taskSummary 等纯函数提取单测。

**P1**
5. activity-model（compactDagLayout 几何、taskStages、relatedTaskIds 环安全）、panel-geometry（float/dock/move/resize/autoHeight/parsePanelLayout）、activity-monitor（轮询与快照合并）、snapshot 的 collectTeamsActivity / collectArchivedTeamsActivity。
6. members.ts：spawnMember / interruptMember / memberWelcome / modelSelection + **docs 模板 persona 用例**。
7. state.ts：门禁落盘、awaitingInput 派生、删除/归档分支。
8. command.ts：buildActivationDirective / invokedAgentTeamsGoal。

**P2**
9. scheduler kick 真链路（解除 stub running 短路，验证自动派单）。
10. suggest tie-break 分支、events.ts、best-practices 未覆盖行。

## 9. 附带变更说明

- 本次审查为运行 v8 覆盖率，新增 devDependency `@vitest/coverage-v8@4.1.11`（package.json + pnpm-lock.yaml 有 diff）。如需保持工作区干净，可 `pnpm remove @vitest/coverage-v8`；建议保留以便后续覆盖回归。
