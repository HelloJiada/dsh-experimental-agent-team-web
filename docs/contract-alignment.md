# 与上游 dsh-agent-teams 的契约对齐报告

日期：2026-08-25

本报告基于对上游仓库 `NanmiCoder/dsh-agent-teams`（main 分支）源码的直接核对：

- `src/event-types.ts`：上游 session 事件类型（`agent-teams/*`）
- `src/types.ts`：上游 durable Team 状态类型
- `src/events.ts`：事件发射语义

## 关键发现

**我们 vendored 的 `team/*` 事件与上游运行时实际发射的 `agent-teams/*` 事件不一致。** 在本轮之前，本 bundle 的 projection 只识别 `team/member`、`team/task`、`team/message/queued`、`team/message/delivered`，而真实上游运行时不会发射这些事件——它发射的是下面 7 种 `agent-teams/*` 事件。也就是说，直接对接上游时本 dashboard 会显示空状态。

## 上游事件契约（权威）

| 事件 | payload（字段） |
| --- | --- |
| `agent-teams/team-created` | teamId, captainSessionId, name, description? |
| `agent-teams/member-added` | teamId, memberId, name, role? |
| `agent-teams/member-removed` | teamId, memberId |
| `agent-teams/task-created` | teamId, taskId, subject, dependencies[], assignee? |
| `agent-teams/task-updated` | teamId, taskId, status, assignee?, output?, attempt?, attemptId? |
| `agent-teams/message-sent` | teamId, messageId, from, to, content, ts |
| `agent-teams/team-deleted` | teamId |

上游任务状态词表：`pending | claimed | in_progress | completed | failed | cancelled`。
上游成员/消息以 **名字**（`captain` 或成员名）寻址，而非 session id。

上游 `src/events.ts` 的发射语义：事件只在宿主 harness 已识别该类型时才追加到 captain 的 Session（否则跳过并 debug 日志），磁盘状态（`.agent-teams/`）才是 activity panel 的权威来源。

## 我们 vendored 契约（原）

| 事件 | payload |
| --- | --- |
| `team/member` | version, teamId, member: TeamMemberSnapshot |
| `team/task` | version, teamId, task: TeamTaskSnapshot |
| `team/message/queued` | version, teamId, message: TeamMessageSnapshot |
| `team/message/delivered` | version, teamId, messageId, targetId |

任务状态词表（原）：`pending | in_progress | completed | deleted`。

## 差异与映射（本轮实现）

| 上游概念 | 本 bundle 处理 |
| --- | --- |
| `team-created` | 设置 teamId / hasTeamEvents；历史条目“团队创建” |
| `member-added` | 折叠为 TeamMemberSnapshot（phase `active`，role → description） |
| `member-removed` | 从成员表移除 |
| `task-created` | 折叠为 TeamTaskSnapshot（revision 1，dependencies → blockedBy，assignee 名字 → ownerId） |
| `task-updated` | 合并更新，revision +1；状态经 `UPSTREAM_TASK_STATUS` 映射 |
| `message-sent` | 折叠为 TeamMessageSnapshot（from/to 名字 → senderId/targetId，content → text block，delivery `quiet`） |
| `team-deleted` | 仅历史条目“团队已删除”（只读视图保留最后状态） |

### 任务状态映射

| 上游 | 本 bundle | 说明 |
| --- | --- | --- |
| pending | pending | |
| claimed | pending + ownerId | “已认领”用 owner 存在性表达 |
| in_progress | in_progress | |
| completed | completed | |
| failed | failed（新增） | terminal，不可 action，readiness `failed` |
| cancelled | cancelled（新增） | terminal，不可 action，readiness `cancelled` |

本轮为承载上游词表，`AgentTeamTaskStatus` 与 `AgentTeamTaskReadiness` 各新增 `failed` / `cancelled`，并贯通到：

- 任务洞察分类（terminal 任务不参与 blocked/stalled/orphaned/ready，不进入 topInterventions）
- 快速筛选（新增 Failed / Cancelled 维度）
- UI tone（failed → danger，cancelled → neutral）
- 历史时间线 tone

### 消息投递语义

上游事件不携带 `deliveredAt`/`readAt`（这些在磁盘状态里）。因此 `message-sent` 折叠为 `delivery: quiet, delivered: false`，并调整消息风险分级：**quiet + 未送达不再视为 medium 风险**（quiet 是 best-effort，消息已持久化到目标邮箱，等待读取），避免真实上游数据在 dashboard 上产生永久“待送达”噪音。

## 名字 → id 解析规则

`assignee` / `from` / `to` 中的 `captain` → 当前 teamId；成员名 → 从已折叠成员表中按 name 查找；无法解析时回退到 teamId（作为已知的唯一 session），并在集成时注意该近似。

## 兼容性策略

- 本 bundle 现在**同时消费** vendored `team/*` 事件（既有生产方/测试）与上游 `agent-teams/*` 事件（真实运行时）。
- 适配逻辑集中在 `src/upstream.ts`（纯函数，独立可测）。
- 事件历史（coalescing）同样覆盖上游事件。

## 已知边界

1. 上游事件为 best-effort：若宿主 harness 不识别 `agent-teams/*` 类型，运行时不会把它们写进 Session log，此时 dashboard 依赖的 committed 事件可能不存在（上游也以磁盘状态为准）。
2. `failed` / `cancelled` 已进入我们的视图词表，但上游 `TeamTask` 的 `output` / `attempt` / `attemptId` / `handoffId` / `reassigning` / 时间戳等字段未进入视图（本 bundle 只读展示，无需执行语义）。
3. 上游 `team-deleted` 我们只记录历史，不清空视图。
4. 上游事件引用引用方式为 raw `SessionEventMap` 声明合并（`src/upstream.ts`），与上游 zero-import 的做法一致。

## 核对来源

- https://github.com/NanmiCoder/dsh-agent-teams/blob/main/src/event-types.ts
- https://github.com/NanmiCoder/dsh-agent-teams/blob/main/src/types.ts
- https://github.com/NanmiCoder/dsh-agent-teams/blob/main/src/events.ts
