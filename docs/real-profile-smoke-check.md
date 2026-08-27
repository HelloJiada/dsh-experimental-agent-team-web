# 真实 Profile 快速冒烟验证（本 bundle + Team 活动监视器）

日期：2026-08-25

这是一份**最小可执行**的真机联调流程：目标不是覆盖所有边界，而是在几分钟内确认

1. 本 bundle（`@deepseek-ai/dsh-experimental-agent-team-web`）已在 Web Profile 中生效；
2. 本 bundle 的 Team 活动监视器已被正确注入；
3. `agent-team-web/*` best-effort session 事件已被宿主识别；
4. Captain 侧的 current-session 活动入口与轻量监视器能准确反映真实数据。

完整核对表见 [verification-checklist.md](verification-checklist.md)。本文件只保留最短路径。

## 0. 安装

在 Web Profile 中安装本 bundle（agent-team-web runtime 已内置于本 bundle，无需单独安装上游包）：

```bash
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

## 4. 打开活动监视器做 60 秒冒烟检查

至少确认以下 6 项：

1. **活动入口**：当前 session 存在 active 或 blocked 工作时，活动徽标与 transcript 轻量摘要出现；
2. **打开方式**：点击任一入口都能打开非模态监视器，conversation 保持可见；
3. **监视器摘要**：健康度 / 成员数 / active/blocked 任务数不是空值；若存在 blocked/stalled 工作，Top Interventions 不为空；
4. **布局**：宽屏默认停靠，可切换为可拖动、可缩放的悬浮面板；在 ≤960px 下为紧凑安全边距 overlay；
5. **成员导航**：点击成员会打开其已有 session；
6. **内容边界**：默认面板不显示完整 timeline、筛选器、DAG 或 command explorer；这些与 `commandPlan` envelope 仍可作为 projection/detail DTO 供宿主消费。

## 5. 若 Team 视图为空，先排查这三个问题

### A. 宿主没有识别 `agent-team-web/*`

runtime 的 session 事件是 **best-effort**。如果宿主的 `KNOWN_SESSION_EVENT_TYPES` 不包含 `agent-team-web/*`，那么：

- `.agent-team-web/` 磁盘状态可能存在；
- 但本 bundle 读不到 committed event log；
- 活动入口不会显示。

### B. bundle 没有注入到 profile

确认 patch 已生效，并且 `dsh --profile web --dump-config` 中能看到 `agent-team-web`。

### C. 当前会话还没有 committed Team records

有时队伍刚启动、还没写入 committed 事件。等到至少出现建队 / 加成员 / 建任务事件后再刷新视图。

## 6. 无真机时的替代验证

如果当前没有真实 Profile 环境，可先跑仓库内的测试套件（骨架断言、包布局、客户端 surface 注册）：

```bash
pnpm test
```

这不会替代真机联调，但能保证示例 patch、文档与构建产物的引用一致（详见 `tests/profile-skeleton.spec.ts` 等）。
