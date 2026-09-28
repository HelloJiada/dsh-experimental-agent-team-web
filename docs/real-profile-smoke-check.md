# 真实 Profile 快速冒烟验证（本 bundle + Team 活动监视器）

日期：2026-08-25

这是一份**最小可执行**的真机联调流程：目标不是覆盖所有边界，而是在几分钟内确认

1. 本 bundle（`@deepseek-ai/dsh-experimental-agent-team-web`）已在 Web Profile 中生效；
2. DSH `0.1.7-rc.2` 的插件和 Client 依赖已解析，本 bundle 的 Team 活动监视器已正确注入；
3. AgentTeam 设置 section 可见、可保存（如设置服务已安装）；
4. Captain 可启动成员，成员能看到 AgentTeams 工具并收发消息；
5. `.agent-team-web/` 磁盘状态与 `/plugins/agent-team-web/state` 快照可读取；
6. Captain 侧的 current-session 活动入口与轻量监视器能准确反映这些真实数据。

本文件只保留最短路径；完整发布前验证流程见 [releasing.md](releasing.md)。
截至此文档更新，DSH `0.1.7-rc.2` 只在依赖/类型与自动化测试层面目标化，真实 profile 冒烟尚未执行；请将以下流程作为运行时验证，不要将构建通过视为已完成运行时兼容证明。

## 0. 安装

在 Web Profile 中安装本 bundle（agent-team-web runtime 已内置于本 bundle，无需单独安装上游包）：

```bash
# 安装本 bundle（示例：release tarball）
cd ~/.dsh/profiles/web
pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-0.1.32.tgz
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
- 当前 DSH 包线为 `0.1.7-rc.2`；确认插件在实际 profile 加载并检查版本解析
- 确认 AgentTeam 设置 section 出现且可保存
- 触发创建团队并确认成员可见 AgentTeams 工具、成功启动并收件
- 注册模式默认 `lazy`；若成员工具未继承，记录实际 child composition 后再验证 `eager` 模式

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
3. **监视器摘要**：Now / Progress / Command 与成员、任务状态不是空值；存在 blocked/stalled 工作时，任务流可展开查看依赖；
4. **布局**：宽屏默认停靠，可切换为可拖动、可缩放的悬浮面板；在 ≤960px 下为紧凑安全边距 overlay；
5. **成员导航**：点击成员会打开其已有 session；
6. **内容边界**：归档历史默认折叠，需要时展开查看筛选器、任务依赖和完整详情。

## 5. 若 Team 视图为空，先排查这三个问题

### A. 磁盘状态或 `/state` 路由不可用

本 bundle 不把 `agent-team-web/*` 写入 Session；面板以磁盘状态为真源。先确认：

```bash
curl -s http://127.0.0.1:3080/plugins/agent-team-web/state
```

应返回含 `teams` 的 JSON；同时当前 workspace 下应存在 `.agent-team-web/<teamId>/team.json`。

### B. bundle 没有注入到 profile

确认 patch 已生效，并且 `dsh --profile web --dump-config` 中能看到 `agent-team-web`。

### C. 当前会话与团队 captain session 不匹配

面板只显示当前会话拥有的团队。回到执行 `/agent-teams` 的主会话，并确认 `/state` 返回的
`captainSessionId` 与当前 session 一致；必要时强制刷新客户端 bundle。

## 6. 无真机时的替代验证

如果当前没有真实 Profile 环境，可先跑仓库内的测试套件（骨架断言、包布局、客户端 surface 注册）：

```bash
pnpm test
```

这不会替代真机联调，但能保证示例 patch、文档与构建产物的引用一致（详见 `tests/profile-skeleton.spec.ts` 等）。
