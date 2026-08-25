# 真实 Profile 端到端验证清单（上游 `dsh-agent-teams` 联调）

本文档把「在真实 DSH Profile 中安装上游 `dsh-agent-teams` + 本 bundle 做端到端验证」整理成可执行的步骤与预期对照。在没有真实 Profile 的环境里，可用仓库内的确定性回放测试代替（见下文「可执行回放」）。如果你只想先做 3–5 分钟的最小确认，先看 [real-profile-smoke-check.md](real-profile-smoke-check.md)。

## 0. 前置条件

- 一个可运行的 DSH Web Profile（已装 `@deepseek-ai/dsh-client-runtime` 等 Host 包）；
- 上游 Agent Teams runtime 包（`dsh-agent-teams`，按该仓库 README 安装）；
- 本 bundle（`@deepseek-ai/dsh-experimental-agent-team-web`）。

## 1. 关键前提：宿主必须识别 `agent-teams/*` 事件类型

上游 runtime 的事件是 **best-effort**：只有宿主把 `agent-teams/*`（7 种）纳入其 `KNOWN_SESSION_EVENT_TYPES` 时，事件才会作为 session 事件落盘；否则磁盘状态 `.agent-teams/` 仍是权威，但本 bundle 的 projection 读不到事件流，dashboard 会显示空状态。

验证方法：跑一个真实团队流程后，检查 lead session 的 committed event log 中是否出现 `agent-teams/*` 事件。

## 2. 安装与启用

```bash
# 在 profile 目录（如 ~/.dsh/profiles/web）
pnpm add <dsh-agent-teams 包>
pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-0.1.0.tgz
```

在 profile patch 中按需启用本 bundle（与包内 `cordis.patch.yml` 一致）：

```yaml
- insert:
    - id: agent-team-web
      name: "@deepseek-ai/dsh-experimental-agent-team-web"
      inject:
        - sessionProjections
```

## 3. 跑一个真实团队流程（captain 会话）

按以下顺序操作（任选一条链路，尽量覆盖所有状态）：

1. 创建团队（`team-created`）
2. 加入 2 名成员（`member-added`）
3. 创建 3 个带依赖的任务（`task-created`，如 spec → impl → docs）
4. claim / 推进任务（`task-updated`: claimed → in_progress）
5. 完成其中一个任务（completed），让另一个失败（failed）、一个取消（cancelled）
6. 用 captain 给成员发消息（`message-sent`）
7. 再创建一个依赖失败任务的新任务（验证 blocked 派生）

## 4. 打开 Team 视图逐项核对

| 检查点 | 预期 |
| --- | --- |
| 概览：健康度、成员数、任务数 | 与 committed 事件一致，健康度在 0–100 |
| 概览：Captain Briefing / Top Interventions | 阻塞任务出现在干预首位；failed / cancelled 任务**不**出现在干预里 |
| 任务：状态与洞察 | `completed` / `failed` / `cancelled` / `blocked` 正确；terminal 任务 readiness 为 failed / cancelled |
| 任务：owner 解析 | 上游按名字寻址，成员加入后再建任务时 owner 能解析到 session id |
| 成员：负载分级 | 持有 in_progress 任务的成员为 focused/stretched 等 |
| 消息：风险 | 上游消息为 quiet + 未送达 → **low** 风险（不会刷「待送达」噪音）；目标成员 failed 时才是 high |
| 时间线：摘要统计 | 事件总数 = 合并前事件数；合并条目数与实体数一致；序号范围连续；最新里程碑为最后事件 |
| 时间线：里程碑窗口 | 按 8 行滚动窗口分组、最近窗口置顶；headline 取最显著事件（danger > warn > good），如 failed 任务；窗口内分布与事件数正确 |
| 时间线：窗口切换 | 「按行数 / 按时间」切换后窗口分布随模式变化；时间模式按 1h 桶聚合，无时间戳行归入最早桶 |
| Command Bridge | 有 `task:unblock` 指向阻塞任务；无 failed 成员则无 `member:restart`；无 high 风险消息则无 `message:redeliver` |
| Command Bridge：计划 envelope | 概览页可展开查看 `commandPlan` JSON：`version: 1`、`generatedFromTeamId` 为团队 id、`total`/优先级计数与命令列表一致、每条命令带具体 `targetId` |
| Command Bridge：执行契约 | 宿主侧消费规范见 [docs/command-bridge-execution.md](command-bridge-execution.md)：6 种命令词表、逐 kind 执行语义、幂等与安全建议 |

## 5. 已知边界（验证时逐条确认）

- 事件是 best-effort：`KNOWN_SESSION_EVENT_TYPES` 未含 `agent-teams/*` 时 dashboard 为空；
- 名字 → id 解析是近似：`captain` → 团队 session；成员按 name 折叠查找；未知名字回退到团队 id（见 `docs/contract-alignment.md`）；
- `output` / `attempt` / `attemptId` / `handoffId` 与时间戳暂不进入视图；
- `team-deleted` 只进入历史时间线，视图保留删除前最后状态；
- 事件历史按实体合并、上限 100 个实体；
- dashboard 只读，Command Bridge 仅建议、不执行。

## 6. 可执行回放（无真实 Profile 时的替代验证）

仓库内置确定性回放，等价于把真实流程的事件流灌进完整管线（事件 → projection → view → 洞察 → 命令建议）：

```bash
pnpm vitest run --configLoader runner tests/e2e-replay.spec.ts
```

- fixture：`tests/fixtures/upstream-team-lifecycle.ts`（16 条真实形状的上游事件）
- 预期结果对照：见 `tests/e2e-replay.spec.ts` 中的断言（团队身份、任务状态、terminal readiness、quiet 消息 low risk、干预排序、时间线摘要、命令建议）。
