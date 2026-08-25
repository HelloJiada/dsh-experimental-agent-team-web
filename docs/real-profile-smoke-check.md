# 真实 Profile 快速冒烟验证（AgentTeams + Team Dashboard）

日期：2026-08-25

这是一份**最小可执行**的真机联调流程：目标不是覆盖所有边界，而是在几分钟内确认

1. 上游 `@nanmicoder/dsh-agent-teams` 已在 Web Profile 中生效；
2. 本 bundle 的 Team dashboard 已被正确注入；
3. `agent-teams/*` best-effort session 事件已被宿主识别；
4. Captain 侧最关键的观察能力（概览 / 时间线 / Command Bridge）能看到真实数据。

完整核对表见 [verification-checklist.md](verification-checklist.md)。本文件只保留最短路径。

## 0. 安装

在 Web Profile 中安装上游 runtime 与本 bundle：

```bash
# 安装上游 AgentTeams runtime
dsh plugin --profile web add @nanmicoder/dsh-agent-teams@latest

# 安装本 bundle（示例：release tarball）
cd ~/.dsh/profiles/web
pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-0.1.0.tgz
```

Profile patch 可直接复用：

- [examples/profile-patch.agent-team-web.yml](../examples/profile-patch.agent-team-web.yml)

把其中的 `agent-team-web` insert 段合并进你的 profile patch。

## 1. 组合验证

先确认配置组合正确：

```bash
dsh --profile web --dump-config
```

最低应能在结果里看到：

- `@nanmicoder/dsh-agent-teams`
- `@deepseek-ai/dsh-experimental-agent-team-web`
- `sessionProjections` 注入链路里存在 `agent-team-web`

## 2. 启动 Web

```bash
dsh web
```

打开现有 Web GUI，进入一个新会话或可复用会话。

## 3. 触发一个最小真实团队

建议直接用 slash 命令或自然语言触发：

```text
/agent-teams review the last 20 commits from performance, security, and product perspectives
```

或：

```text
Use AgentTeams to review the last 20 commits from performance, security, and product perspectives. Return one consolidated report.
```

目标是尽快产生：

- `team-created`
- `member-added`
- `task-created`
- 至少一次 `task-updated`
- 至少一条 `message-sent`

## 4. 打开 Team 视图做 60 秒冒烟检查

至少确认以下 6 项：

1. **概览**：健康度 / 成员数 / 任务数不是空值；
2. **Top Interventions**：若存在 blocked/stalled 任务，列表不为空；
3. **时间线摘要**：序号范围、事件总数、最新里程碑存在；
4. **里程碑窗口**：能在「按行数 / 按时间」两种模式之间切换；
5. **Command Bridge**：能看到建议命令列表；
6. **`commandPlan` envelope**：概览页可展开 JSON，且包含 `version`、`generatedFromTeamId`、`commands[].targetId`。

## 5. 若 Team 视图为空，先排查这三个问题

### A. 宿主没有识别 `agent-teams/*`

上游 runtime 的 session 事件是 **best-effort**。如果宿主的 `KNOWN_SESSION_EVENT_TYPES` 不包含 `agent-teams/*`，那么：

- `.agent-teams/` 磁盘状态可能存在；
- 但本 bundle 读不到 committed event log；
- Team dashboard 会显示空状态。

### B. bundle 没有注入到 profile

确认 patch 已生效，并且 `dsh --profile web --dump-config` 中能看到 `agent-team-web`。

### C. 当前会话还没有 committed Team records

有时队伍刚启动、还没写入 committed 事件。等到至少出现建队 / 加成员 / 建任务事件后再刷新视图。

## 6. 无真机时的替代验证

如果当前没有真实 Profile 环境，可先跑仓库内的确定性回放：

```bash
pnpm vitest run --configLoader runner tests/e2e-replay.spec.ts
```

这不会替代真机联调，但能确认：

- upstream `agent-teams/*` 事件折叠正常；
- quiet 消息 low-risk 语义正常；
- 时间线摘要 / 里程碑窗口 / `commandPlan` envelope 都能正确产出。
