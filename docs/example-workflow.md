# 端到端示例：Agent Team Dashboard 工作流

日期：2026-08-25

本文用一个可复现的示例串联本 bundle 的完整数据通路：从 committed Team 事件 → host projection → 派生洞察 → 交互式 dashboard → command bridge 建议。

## 1. 环境准备

在一个已提供以下包的 DSH Web Profile 中启用本 bundle：

- `@deepseek-ai/dsh-experimental-agent-team`
- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-invariants`

启用方式见 [../README.md](../README.md) 的 “Enable in a DSH profile”。

## 2. 让 Team 产生 committed 事件

假设 Lead/root session（`session-lead`）上产生了以下 committed Team 事件（顺序即 seq）：

1. `team/member`：成员 `Researcher`（`session-worker-1`）加入，phase `active`
2. `team/member`：成员 `Builder`（`session-worker-2`）加入，phase `active`
3. `team/task`：任务 `Spec API`（`task-spec`），status `pending`，无依赖
4. `team/task`：任务 `Implement API`（`task-impl`），status `pending`，blockedBy `[task-spec]`
5. `team/task`：任务 `Ship docs`（`task-docs`），status `in_progress`，owner `session-worker-1`
6. `team/message/queued`：lead → `session-worker-1`，delivery `wakeup`
7. `team/member`：`Researcher` 状态更新为 `failed`
8. `team/task`：`Ship docs` 更新 rev，status 仍 `in_progress`

## 3. Projection 推导出的东西

`viewAgentTeam` 会把上述事实折叠成 dashboard 所需数据：

### 健康度与风险
- `failedMemberCount = 1` → 健康度扣分
- `blockedTaskCount = 1`（`task-impl` 依赖 `task-spec`）
- `undeliveredMessageCount = 1`（wakeup 消息未送达，且目标成员 failed → 消息风险 high）
- `healthScore` 低于 80 → `statusLabel = 存在风险`
- `alerts` 会包含：失败成员、阻塞任务、未送达消息、高风险消息

### 任务洞察与干预优先级
- `task-impl` → readiness `blocked`（severity high）
- `task-spec` → readiness `ready`，`dependencyDepth = 1`（一个下游）→ 杠杆优先排序后成为 `P1`
- `task-docs` → readiness `stalled`（in_progress 但无进一步完成信号）
- `topInterventions[0]` 形如：`P1 · Spec API（ready，依赖 1 下游）`

### 成员负载
- `Builder` 无任务 → `idle`
- `Researcher` 持有 in_progress 任务但 failed → `stretched`/`overloaded` 判定视任务数而定

### 历史时间线（coalescing 生效）
- `Researcher` 的两次 `team/member` 事件合并为 1 条，`count = 2`，tone `danger`
- `Ship docs` 的两次 `team/task` 事件合并为 1 条，`count = 2`，显示最新 rev
- 消息 queued + （后续）delivered 会合并为 1 条

## 4. Dashboard 各标签页看到什么

- **概览**：健康度指标卡、Captain Briefing、Top Interventions、风险清单
- **任务**：筛选 chips（Ready / Blocked / Stalled / Orphaned / 已完成…）+ 搜索；默认显示全部任务，点 `Blocked` 只剩 `task-impl`
- **成员**：按负载筛选 + 名字搜索
- **消息**：高风险 / 待送达 / Wakeup 筛选；`消息风险` 列表把 wakeup 未送达标为 high
- **时间线**：合并后的历史条目，每条带 `#seq`、`×count`（多次更新时）、`t=time`；顶部新增摘要统计卡（事件总数 / 任务、成员、消息事件分布 / 合并条目数 / 序号范围 / 最新里程碑）；下方为滚动里程碑窗口，可切换「按行数（8/窗）/ 按时间（1h/窗）」，最近窗口置顶，headline 取最显著事件

## 5. Command Bridge 建议（示例）

同一份数据会派生出以下命令建议（不执行，仅供宿主 runtime 工具层消费），并打包为只读的 `commandPlan` envelope（版本 + 优先级计数 + 命令列表，JSON 可序列化，UI 上可展开查看）：

| kind | label | targetId | priority |
| --- | --- | --- | --- |
| `task:reassign` | 重新分配任务「Implement API」的依赖或 owner | `task-impl` | high |
| `task:claim` | 认领任务「Spec API」 | `task-spec` | high（杠杆优先） |
| `member:restart` | 重启成员「Researcher」 | `session-worker-1` | high |
| `message:redeliver` | 重发高风险消息 | `session-worker-1` | high |

## 6. 验证清单

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run test` 全绿（45 个用例）
- [ ] `pnpm run build` 产出 host ESM + client CJS bundle
- [ ] 在真实 Profile 中打开 Team 视图，五个标签页可切换、筛选可用
- [ ] 概览页 Command Bridge 可展开查看宿主可消费的 `commandPlan` JSON payload

真实 Profile + 上游 `dsh-agent-teams` 的逐项联调核对见 [docs/verification-checklist.md](verification-checklist.md)；无真实 Profile 时可用 `pnpm vitest run --configLoader runner tests/e2e-replay.spec.ts` 做确定性回放验证。

## 边界说明

- 本 bundle 是只读投影 + 洞察层，不执行任何命令；
- timeline 保留最近 100 条**实体级**历史（同实体事件合并计数），非完整事件流；
- 独立 dashboard URL 路由需要宿主 Web shell 提供路由接入点，当前未提供。
