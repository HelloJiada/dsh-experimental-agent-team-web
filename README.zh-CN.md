# @deepseek-ai/dsh-experimental-agent-team-web

[English](README.md) | 中文

## 状态

**实验性。** 本包用于实验与内部使用,遵循可能演进的 DSH 接口。

## 概览

一个外部 DeepSeek Harness(DSH)插件包:让当前会话成为多智能体团队的队长——创建可续聊的成员子 Agent、把目标拆成带依赖的任务、通过直达邮箱消息协调成员,并提供实时活动面板与会话内团队卡片。

提供能力:

- `/agent-teams` 斜杠命令(含 pre-step 手势边界)激活队长协议;
- 完整 `agent_teams_*` 工具集(建队/加成员/建任务/认领/更新/转派/移除/发消息/状态/删除,以及 `agent_teams_retro_review`、`agent_teams_best_practices`);
- 磁盘为唯一真源的团队内核 — `.agent-team-web/<teamId>/team.json` + 邮箱 inbox,原子写入 + 按团队加锁;
- 事件驱动的共享任务调度器,自动把就绪任务派给空闲成员并响应 `agent/status`;
- 信息性 `agent-team-web/*` 会话事件写入队长会话;
- 服务端快照路由(`GET /plugins/agent-team-web/state`,`?archived=1`),Web 客户端每秒轮询一次;
- shell overlay 中的浮动**活动面板**(健康/进度、队长节点、委派树、任务依赖 DAG),支持拖拽/缩放/停靠/收起与布局持久化;
- 会话内**团队卡片**,把 `agent_teams_create` 工具调用折叠成聊天节点,并通过 window 事件重新唤起浮动面板;
- 成员/队长/动作状态的鲸鱼图集(`assets/agent-team-web/`)。

## 自成长框架

面板不仅是实时监视器,还让队长获得时间/工作量可见性,并让框架从每个任务中学习:

- **耗时追踪**:每个任务记录 `claimedAt` / `startedAt` / `completedAt`;面板显示成员当前任务的已耗时与任务总耗时。
- **工作量预估**:`agent_teams_create_task` 支持可选 `estimate_level`(`S` / `M` / `L`,参考区间 `S≤15m` / `M≤45m` / `L>45m`,集中可调);完成后面板显示"预估 vs 实际"与超时徽标(>1× 警示 / >1.5× 超时)。
- **产出信号**:任务同时记录状态变更次数、消息数、输出长度——避免把墙钟时间误判为实际产出。
- **每次完成自动复盘**:每个终态任务自动提炼复盘(实际 vs 预估、原因分类、最优方案提示);成员可追加 `retro_note`,队长可通过 `agent_teams_retro_review` 校准。
- **全局 best-practice 经验库**:提炼的经验沉淀到 `.agent-team-web/best-practices.json`(跨团队、可溯源到来源团队/任务),经过去重,可经 `agent_teams_best_practices` 查询;按角色×等级的校准提示反哺队长后续预估(冷启动守卫,样本不足时不下结论)。

## 架构

- **宿主包**(`src/index.ts`):注册工具、系统提示协议段、`/agent-teams` 命令 + 手势边界、快照与图集 HTTP 路由,并装配调度器。
- **浏览器包**(`src/client/index.tsx`):在 `shell.overlay` 槽注册活动面板、在 `conversation.chat.node` 注册团队卡片、注册隐藏命令视图;面板轮询快照路由(无长连接)。

内核以磁盘为真源;会话事件仅信息性;团队删除即归档(而非物理删除),面板可恢复历史。

## 并发模型

AgentTeams 假设**单个 harness 进程**独占一个 workspace 的团队状态目录(`.agent-team-web/`)。同一团队的所有变更由**进程内**按团队的 promise-chain 锁(`withTeamLock`,`src/state.ts`)串行化,因此 `team.json`、邮箱、best-practices 与 retired-members 索引的读-改-写循环在该进程内保持串行。

由该假设推出两点:

- **原子改名保完整性,不保不丢更新。** `atomicWriteText` 先写临时文件再改名落位,崩溃不会留下写了一半的 `team.json`;但若**两个** harness 进程共享同一 workspace,双方的进程内锁互不可见:后写会覆盖先写,更新被静默丢失(文件仍是合法 JSON,只是少了另一进程的变更)。
- **多进程共享需自行加文件锁。** 若必须让多个 harness 进程操作同一 workspace,请在全部 AgentTeams 活动外加 OS 级文件锁(例如 `mkdir` 哨兵目录 + 过期重试策略);仅靠进程内锁不够。

这是文档化的假设而非缺陷:单进程是受支持的部署形态,原子写层保证即使进程在写入中途崩溃,也绝不会看到损坏状态。

## 安装

### 1. 安装插件包

在 DSH Web profile 目录,直接安装已发布的 tarball(无需构建、无需拉取 monorepo)。
`releases/latest` 地址始终指向最新 Release:

```bash
cd ~/.dsh/profiles/web
pnpm add https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases/latest/download/deepseek-ai-dsh-experimental-agent-team-web-0.1.3.tgz
```

开发者/协作者也可用 git 或本地路径安装——仓库已提交 `lib/` 构建产物,无需构建:

```bash
# 本地路径安装(工作区 checkout)
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-experimental-agent-team-web
```

### 2. 在 profile patch 中启用

在 profile patch(如 `cordis.patch.yml`)中加入以下条目(完整骨架见
`examples/profile-patch.agent-team-web.yml`):

```yaml
- insert:
    - id: agent-team-web
      name: "@deepseek-ai/dsh-experimental-agent-team-web"
      inject:
        - sessionProjections
```

### 3. 重启 DSH

重启 DSH Web 进程(GUI),然后激活队长协议:

```
/agent-teams <目标>
```

示例:`/agent-teams review the last 20 commits from performance, security, and product perspectives`

右上角会浮出**活动面板**:成员状态、任务进度、**每个成员当前任务已耗时**、预估 vs 实际与超时徽标,点击任务详情可下钻查看复盘与最佳实践经验。

### 升级

新版本发布后重跑第 1 步即可——`releases/latest` 地址会自动重定向到最新
tarball,无需改 URL。(若上面文件名仍带旧版本号,到
[Releases](https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases)
页面查看当前资产名即可。)

---

Release tarball: `deepseek-ai-dsh-experimental-agent-team-web-0.1.3.tgz`
