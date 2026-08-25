# @deepseek-ai/dsh-experimental-agent-team-web

中文 | [English](README.md)

## 项目状态

**实验性项目。** 本包面向实验与内部使用，依赖仍可能演进的 DSH 接口，只支持下文说明的兼容版本线。

## 项目概览

这是一个供 DeepSeek Harness（DSH）Web Profile 按需启用的外部 Bundle。它为兼容 Profile 加入一个只读的 Agent Team 智能工作台，而不会把 Team UI 纳入默认的 `dsh web` Profile。

它提供：

- 对已提交 Agent Team 记录的 Host session projection；
- 当前 session 的活动徽标与轻量 transcript 摘要入口；
- 通过 shell overlay 打开的非模态 Team 活动监视器；
- 成员、任务和 Team 邮箱状态的只读展示；
- 基于已提交记录推导出的团队健康度、风险提醒、建议动作和排序后的干预优先级；
- 依赖链风险传播与成员负载分析；
- 消息投递风险分级；
- 快速筛选计数与推导出的 Team 时间线；
- 聚焦当前活动、阻塞工作、优先级与成员状态的紧凑监视摘要；
- 任务依赖 DAG 可视化（纯 SVG 分层依赖图，节点状态着色、owner 归属、点击高亮依赖/下游）；
- 有界事件历史时间线（同实体合并计数、上限 100 个实体）、时间线摘要统计、滚动里程碑窗口（按行数/按时间）与 command-bridge 建议层；
- 宿主可消费的 Command Bridge 计划 envelope（`commandPlan` DTO：版本、优先级计数、带具体 target 的命令列表，只读、可 JSON 序列化）；
- 对上游 `dsh-agent-teams` 运行时 `agent-teams/*` session 事件的适配（含 failed / cancelled 任务状态）；
- 真实 Profile 联调核对清单与确定性端到端回放测试（见 [docs/verification-checklist.md](docs/verification-checklist.md)）；
- 当前 session 没有已提交 Team 记录时的空状态。

它不提供 UI 内修改、仅在运行时存在的 Agent 实时状态、独立 Team dashboard 路由、默认纳入 `dsh web`，也不承诺兼容任意版本的 DSH。

## 架构

Host Bundle 注册 `agentTeam` session projection。浏览器 Bundle 注册当前 session 的活动徽标和轻量 transcript 摘要入口；二者都会通过 DSH 的 shell-overlay slot 打开非模态 Team 活动监视器。该监视器消费 projection DTO，聚焦 active/blocked 工作、优先级和成员，不再嵌入旧的完整 dashboard。

Projection 同时消费 vendored `team/*` 事件词表与上游 `dsh-agent-teams` 的 `agent-teams/*` session 事件（适配层见 `src/upstream.ts`）；逐字段对比见 [docs/contract-alignment.md](docs/contract-alignment.md)。

Bundle 默认不启用：随包提供的 `cordis.patch.yml` 以 `sessionProjections` injection 插入它。未启用该 Bundle 的普通 Profile 不会获得本包提供的 Team UI。

## 数据权威来源

Lead/root session 的已提交 Agent Team event log 是 Team 数据的唯一权威来源。Projection 只暴露 UI 所需的已提交事实，并在此基础上推导可解释的洞察：

- 当前 session 没有已提交 Team 记录时为 `null`；
- 存在已提交 Team 记录时为 Team view object。

浏览器不会维护第二份权威数据、不以 demo 或 mock 数据作为运行时兜底，也不会补造已提交记录中没有的事实。UI 为只读；对于已有数据的 committed Team records，目前并未以真实样本验证其数据状态。

## 为什么这样做

我们不只和“执行编排能力”竞争，而是尝试在 Captain 决策视角上超越基础 Agent Team 面板：

- 更清晰的团队健康度与风险评分；
- 从 committed Team facts 推导出的可执行摘要；
- 对阻塞、stalled、orphaned、ready、进行中、待处理、已完成任务的分组观察；
- 对邮箱未送达风险的显式暴露；
- 依赖链 fan-out 分析与干预优先级排序；
- 快速筛选计数与 Team 时间线，便于快速扫描；
- 在不遮挡 conversation 的前提下突出当前 active/blocked 工作的活动监视器；
- 有界事件历史时间线（同实体合并计数、上限 100 个实体）、摘要统计与滚动里程碑窗口（按行数/按时间）；
- command-bridge 建议层：从 committed facts 推导带具体 target id 的可执行命令建议，并打包为宿主可消费的 `commandPlan` envelope（执行需宿主 runtime 工具层，本 bundle 保持只读）。

分阶段计划见 [docs/product-roadmap.md](docs/product-roadmap.md)。

## 环境要求与兼容性

请在提供以下 Host 包的 DSH Profile 中使用本包：

- `@deepseek-ai/dsh-experimental-agent-team`
- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-invariants`

`react` 以及 Cordis、DSH Client 与 session 接口都是由兼容 Host 环境提供的 peer dependencies。当前支持的兼容版本线为 Plugin `0.1.x` 搭配 DSH `0.1.x`，且仅限实验性使用。Team event shape、session projection contract 或 Client slot interface 发生变化时，本包可能需要同步更新。详见 [docs/compatibility.md](docs/compatibility.md)。

## 安装

使用者安装的是预构建 Bundle；安装时无需从源码构建，也无需拉取 DeepSeek Harness monorepo。

### Release tarball

下载对应 GitHub Release 附带的 tarball，再将其安装到 DSH Profile：

```bash
cd ~/.dsh/profiles/web
pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-0.1.0.tgz
```

Release 产物名为 `deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz`。

### Git 安装

仓库已提交构建后的 `lib/` 产物，因此也可直接从 Git 安装。请在已提供兼容 DSH 包的环境中执行：

```bash
cd ~/.dsh/profiles/web
pnpm add git+ssh://git@github.com/HelloJiada/dsh-experimental-agent-team-web.git
```

Profile 必须已经具备 Agent Team runtime 包；本 Bundle 不会安装它。

## 在 DSH Profile 中启用

在 Profile patch 中加入这条按需启用的 Bundle 配置。它与包内的 `cordis.patch.yml` 一致：

```yaml
- insert:
    - id: agent-team-web
      name: "@deepseek-ai/dsh-experimental-agent-team-web"
      inject:
        - sessionProjections
```

本包 manifest 中的 `dsh.client.inject` 用于声明 Client injection 要求，并不是 module-table external 声明。

真实 Profile 的最小联调路径见 [docs/real-profile-smoke-check.md](docs/real-profile-smoke-check.md)，可复用的 profile patch 骨架见 [examples/profile-patch.agent-team-web.yml](examples/profile-patch.agent-team-web.yml)，完整核对表见 [docs/verification-checklist.md](docs/verification-checklist.md)；宿主侧消费 `commandPlan.commands` 的执行规范见 [docs/command-bridge-execution.md](docs/command-bridge-execution.md)。

## 使用方式

在兼容 conversation 中，只有当前 session 存在 active 或 blocked Team 工作时才会显示 Team 活动徽标。点击徽标，或点击 transcript 中的轻量 Team 摘要，即可打开监视器。

宽屏时监视器默认停靠；可选切换为可拖动、可缩放的悬浮面板。在 960px 及以下，它会变为带安全边距的紧凑 overlay。面板几何信息只保存在各浏览器本地。该监视器仅用于查看，不能在 UI 中修改成员、任务或邮箱状态；点击成员会打开该成员已有的 session。

监视器默认不展示完整 timeline、筛选器、依赖 DAG 或 command explorer。依赖 DAG 仍作为 projection 的细节能力保留，供需要它的宿主体验消费。

## 构建、检查与打包

维护者执行：

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test
pnpm pack
```

`pnpm pack` 会执行 `prepack`（`build` 与 `test`），并生成 `deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz`。请将这个预构建 tarball 附加到 GitHub Release。发布验收流程，包括检查打包后的 Client 产物，见 [docs/releasing.md](docs/releasing.md)。

## Client Bundle 协议

`lib/client.js` 是浏览器 classic-script/CJS factory bundle，不是 ESM 浏览器入口。它通过以下形式注册 `@deepseek-ai/dsh-experimental-agent-team-web`：

```js
window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-experimental-agent-team-web", factory: (require) => { /* ... */ } })
```

DSH module table 提供共享的 Host runtime dependencies。当前构建的 Client 中，实际 runtime external 为 `react` 与 `react/jsx-runtime`（活动监视器 UI 使用 hooks）；不要将其与 `dsh.client.inject` metadata 混为一谈。

## 已知限制

- Team 活动监视器仍然只读。
- 没有实时 runtime-status channel。
- 监视器位于 shell overlay，不提供独立 dashboard URL 路由。
- Team facts 仅来自 Lead/root session 的已提交 event log。
- 本包仍属实验性项目，依赖兼容的 DSH Host contracts，不兼容任意 DSH 版本。

## 许可证

MIT
