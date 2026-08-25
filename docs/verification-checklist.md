# 真实 Profile 端到端验证清单（上游 `dsh-agent-teams` 联调）

本文档把「在真实 DSH Profile 中安装上游 `dsh-agent-teams` + 本 bundle 做端到端验证」整理成可执行的步骤与预期对照。在没有真实 Profile 的环境里，可用仓库内的确定性回放测试代替（见下文「可执行回放」）。如果你只想先做 3–5 分钟的最小确认，先看 [real-profile-smoke-check.md](real-profile-smoke-check.md)。

## 0. 前置条件

- 一个可运行的 DSH Web Profile（已装 `@deepseek-ai/dsh-client-runtime` 等 Host 包）；
- 上游 Agent Teams runtime 包（`dsh-agent-teams`，按该仓库 README 安装）；
- 本 bundle（`@deepseek-ai/dsh-experimental-agent-team-web`）。

## 1. 关键前提：宿主必须识别 `agent-teams/*` 事件类型

上游 runtime 的事件是 **best-effort**：只有宿主把 `agent-teams/*`（7 种）纳入其 `KNOWN_SESSION_EVENT_TYPES` 时，事件才会作为 session 事件落盘；否则磁盘状态 `.agent-teams/` 仍是权威，但本 bundle 的 projection 读不到事件流，活动入口不会显示。

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

## 4. 打开当前 session 活动监视器逐项核对

| 检查点 | 预期 |
| --- | --- |
| 活动入口范围 | 只有当前 session 有 active 或 blocked 工作时出现活动徽标与 transcript 摘要；无符合条件工作时不出现 |
| 打开与布局 | 点击任一入口打开非模态监视器；宽屏默认停靠，可选悬浮、拖动和缩放；≤960px 为紧凑安全边距 overlay；几何仅本地浏览器持久化 |
| 监视器摘要 | 健康度、成员数、active/blocked 任务数与 committed 事件一致；Captain Briefing / Top Interventions 中阻塞任务优先，failed / cancelled 任务**不**出现 |
| 成员导航 | 点击成员打开已有成员 session；不创建新会话 |
| 默认内容边界 | 默认监视器不嵌入完整 timeline、筛选器、依赖 DAG 或 command explorer |
| 依赖图：DAG detail | `dependencyDag` DTO 保持可用：分层、状态、owner、依赖边数正确；这是 detail/projection 能力，不是默认监视器内容 |
| 任务：owner 解析 | 上游按名字寻址，成员加入后再建任务时 owner 能解析到 session id |
| 消息：风险 | 上游消息为 quiet + 未送达 → **low** 风险（不会刷「待送达」噪音）；目标成员 failed 时才是 high |
| 时间线与 Command Bridge DTO | 时间线摘要、里程碑窗口和 `commandPlan`（`version: 1`、团队 id、计数、具体 `targetId`）继续作为 projection/detail 能力可供宿主消费 |
| Command Bridge：执行契约 | 宿主侧消费规范见 [docs/command-bridge-execution.md](command-bridge-execution.md)：6 种命令词表、逐 kind 执行语义、幂等与安全建议 |

## 5. 已知边界（验证时逐条确认）

- 事件是 best-effort：`KNOWN_SESSION_EVENT_TYPES` 未含 `agent-teams/*` 时活动入口不会显示；
- 名字 → id 解析是近似：`captain` → 团队 session；成员按 name 折叠查找；未知名字回退到团队 id（见 `docs/contract-alignment.md`）；
- `output` / `attempt` / `attemptId` / `handoffId` 与时间戳暂不进入视图；
- `team-deleted` 只进入历史时间线，投影保留删除前最后状态；
- 事件历史按实体合并、上限 100 个实体；
- 活动监视器只读，Command Bridge 仅建议、不执行。

## 6. 可执行回放（无真实 Profile 时的替代验证）

仓库内置确定性回放，等价于把真实流程的事件流灌进完整管线（事件 → projection → view → 洞察 → 命令建议）：

```bash
pnpm vitest run --configLoader runner tests/e2e-replay.spec.ts
```

- fixture：`tests/fixtures/upstream-team-lifecycle.ts`（16 条真实形状的上游事件）
- 预期结果对照：见 `tests/e2e-replay.spec.ts` 中的断言（团队身份、任务状态、terminal readiness、quiet 消息 low risk、干预排序、时间线摘要、命令建议）。
