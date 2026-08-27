# Command Bridge 宿主执行契约（`commandPlan` 消费规范）

日期：2026-08-25

本 bundle 是**只读投影 + 洞察层**：它永远不会自己执行命令。但 `AgentTeamView.commandPlan` 是一个**为宿主 runtime 工具层准备的稳定 DTO**——宿主侧在获得用户/Captain 授权后，可以读取 `commandPlan.commands` 并调用真实的 Agent Teams runtime 工具来执行。

本文档是宿主侧消费该 DTO 的规范。字段与语义以 [contract.ts](../src/contract.ts) 和 [commands.ts](../src/commands.ts) 为准，这里的描述用于对齐执行行为。

## 1. 数据来源与只读边界

- `commandPlan` 由 host projection 从 committed Team facts 推导，是纯函数 `commandPlanView(source)` 的输出；
- 每次视图刷新都会重新推导，`total`/优先级计数/`commands` 始终与当前 committed 状态一致；
- 宿主侧执行必须**先获得授权**，且执行产生的变更应通过 runtime 的正常通道（本 bundle 内置的 agent-team-web runtime）写回；
- 执行后应触发新的 committed 事件（如 `task-updated`），dashboard 会在下一轮 projection 中自动反映。

## 2. Envelope 字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `version` | `1` | envelope 契约版本；未来兼容性判断依据 |
| `generatedFromTeamId` | string | 生成该计划的团队 session id |
| `total` | number | `commands` 数量 |
| `highPriorityCount` / `mediumPriorityCount` / `lowPriorityCount` | number | 按优先级计数 |
| `commands[]` | 数组 | 每条命令（见下） |

## 3. 命令条目字段

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定命令 id（`cmd:<kind>:<targetId>`），可用于幂等/去重 |
| `kind` | 命令种类，见下方词表（`AGENT_TEAM_COMMAND_KINDS`） |
| `label` | 人类可读的展示文案 |
| `targetId` | 执行所需的具体目标 id（任务 id / 成员 session id / 消息 id） |
| `targetLabel` | 目标的展示名 |
| `priority` | `high` / `medium` / `low`（排序由 bundle 完成：高优先级在前） |
| `rationale` | 生成理由（可解释性） |

## 4. 命令词表与建议的宿主执行语义

词表是单一事实来源：`AGENT_TEAM_COMMAND_KINDS`（`src/commands.ts`），与类型 `AgentTeamCommandKind` 编译期一致，共有 6 种：

| kind | 触发条件（bundle 推导） | 建议的宿主执行语义（需 runtime 支持） |
| --- | --- | --- |
| `task:claim` | stalled 且无 owner 的任务 | 为 `targetId` 任务声明 owner（如 Captain 认领或指派给某成员） |
| `task:reassign` | orphaned 任务（owner 不在成员快照）或成员过载 | 把 `targetId` 任务重新分配给可见成员 |
| `task:unblock` | 任务被依赖阻塞 | 推进其前置依赖，或显式解除阻塞关系 |
| `member:restart` | 成员 phase = failed | 重启/替换该成员会话，或由 Captain 接管其任务 |
| `message:redeliver` | 高风险消息未送达 | 向 `targetId` 目标重发该消息 |
| `message:broadcast` | 目标成员状态异常 | 把消息改为广播给全体成员 |

> 注意：`member:restart` 的 `targetId` 是成员 session id；`message:redeliver` / `message:broadcast` 的 `targetId` 是消息目标 session id；`task:*` 的 `targetId` 是任务 id。宿主执行器应先用 `label`/`rationale` 二次确认，再按 `kind` 选择对应 runtime 工具。

## 5. 幂等与安全建议

- 每条命令的 `id` 稳定（基于 kind + targetId），宿主可用它做去重；
- 执行前校验 `targetId` 当前仍存在（视图可能已变化）；
- 执行失败不应重试高优先级命令超过有限次数，失败应回报给 Captain；
- 执行层必须是可审计的：记录命令 id、执行时间、结果，作为新的 committed 事实的一部分。

## 6. 最小消费示例（伪代码）

```ts
// 宿主工具层伪代码
async function applyCommandPlan(plan, authorize) {
  if (!authorize(plan)) return { applied: 0, rejected: 'no authorization' }
  let applied = 0
  for (const command of plan.commands) {
    const ok = await executeByKind(command.kind, command.targetId, command.targetLabel)
    if (ok) applied += 1
  }
  return { applied, total: plan.total }
}
```

## 7. 一致性守护

- 词表与类型的编译期一致性：`AGENT_TEAM_COMMAND_KINDS` 声明为 `readonly AgentTeamCommandKind[]`；
- zod schema（`commandSuggestionViewSchema.kind`）直接使用 `z.enum(AGENT_TEAM_COMMAND_KINDS)`；
- 测试 `tests/command-bridge-execution.spec.ts` 锁定：本文档覆盖全部 6 种 kind、字段与词表一致、envelope 可 JSON round-trip。
