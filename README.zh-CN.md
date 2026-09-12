# @deepseek-ai/dsh-experimental-agent-team-web

[English](README.md) | 中文

## 状态

**实验性。** 本包用于实验与内部使用,遵循可能演进的 DSH 接口。

## DSH 兼容性

版本 0.1.19 使用本包自包含的 AgentTeams 内核，已针对公开 DSH `0.1.3-alpha.2` 包线，以及以源码方式运行 `pnpm dsh web` 的 DSH `0.1.5-rc.2` 实测验证；不需要未发布的官方实验性 Agent Teams 包或本地 DSH checkout。

在 `0.1.5-rc.2` 上请设置 `registration: eager`（详见 `docs/compatibility.md`）：该 harness 让子 agent 加入**父的 preset**、而不是继承**父 agent 的 scope**，按需加载无法把团队工具交付给成员。`eager` 把整面注册进全局层（v0.1.14 形态），代价是每个会话约 4.9k tokens/请求。

## 概览

一个外部 DeepSeek Harness(DSH)插件包:让当前会话成为多智能体团队的队长——创建可续聊的成员子 Agent、把目标拆成带依赖的任务、通过直达邮箱消息协调成员,并提供实时活动面板与会话内团队卡片。

提供能力:

- **按需加载**:默认只注册一个 `agent_teams_activate` 工具和一段两行提示,14 个团队工具与队长协议在激活时才装进**当前会话自己的作用域**(实测把未激活会话的每次请求开销从约 4,900 tokens 降到约 270 tokens)。注册留在会话作用域,工具体的 DSH 服务访问走插件根 ctx——会话作用域解析不到本插件注入的 `subagents`/`agents`(见 `docs/compatibility.md`)。三种激活入口等价且幂等:自然语言(「用 AgentTeams 做 X」→ 模型调 `agent_teams_activate`)、`/agent-teams <目标>` 斜杠命令(含 pre-step 手势边界,无命令裁决的 headless 面同样可用)。若 harness 让子 agent 加入**父的 preset** 而不是继承**父 agent 的 scope**(DSH `0.1.5-rc.2` 即如此),成员拿不到工具,需改用 `registration: eager` 把整面注册进全局层(v0.1.14 形态,每个会话约 4,900 tokens/请求),详见 `docs/compatibility.md`;
- 完整 `agent_teams_*` 工具集(建队/加成员/建任务/认领/更新/转派/移除/发消息/状态/模式切换/删除,以及 `agent_teams_retro_review`、`agent_teams_best_practices`),激活后对队长**及其成员**可见(成员子作用域继承队长的注册;`registration: eager` 下改为从全局层继承);
- 磁盘为唯一真源的团队内核 — `.agent-team-web/<teamId>/team.json` + 邮箱 inbox,原子写入 + 按团队加锁;
- 事件驱动的共享任务调度器,自动把就绪任务派给空闲成员并响应 `agent/status`;
- 信息性 `agent-team-web/*` 会话事件写入队长会话;
- 服务端快照路由(`GET /plugins/agent-team-web/state`,`?archived=1`),Web 客户端每秒轮询一次;
- shell overlay 中的浮动**活动面板**(健康/进度、队长节点、委派树、任务依赖 DAG),支持拖拽/缩放/停靠/收起与布局持久化;
- 会话内**团队卡片**,把 `agent_teams_create` 工具调用折叠成聊天节点,并通过 window 事件重新唤起浮动面板;
- 成员/队长/动作状态的鲸鱼图集(`assets/agent-team-web/`)。

## 设置中心

DSH 设置页内置 **AgentTeam** section(`settings.section` 槽位,含导航专属棋盘图标),两张卡片管理模型调度与角色档位:

- **模型调度授权**:按 provider 粒度开关模型授权(`enabledModels`,复合键 `${provider}/${model}`);deepseek-official 恒授权锁定「默认」徽。授权与角色预设联动——未授权 provider 的模型不出现在角色预设下拉。
- **角色预设**:每角色一行(中文名 + mono id),模型下拉按 provider 分组(optgroup),推理等级下拉可换;右上角「恢复默认」一键清空全部覆盖。行右侧**查看按钮**(眼睛图标,对齐 DSH Agent 预设交互)弹出角色职责说明——slogan + 工作方式 + 交付物 + 核心准则(中文全量版,数据源 `client/roles.ts` ROLE_DUTY)。
- **三源链**:角色档位 = settings 覆盖 → profile `roleLlmDefaults` → 内置默认表 `DEFAULT_ROLE_LLM`,上层未设置自动回落下层;「恢复默认」= 清空覆盖回落链尾。
- **授权联动自动重分配**:授权变化(或页面初始化)自动按档位表重分配角色模型+思考深度(`ROLE_AUTO_ASSIGN_TABLE`),手动覆盖(`auto` 标记区分)不被覆盖,目标未授权回退 deepseek;结果带 `auto:true` 标记可被后续重算。
- **通用能力适配**:`NO_REASONING_EFFORT_PROVIDERS` 能力表 + `supportsReasoningEffort()` 统一查表——不支持 reasoning effort 的模型(如 cc-switch GPT-5.6)不写 effort、禁用推理等级下拉;新增不支持模型只需在能力表追加 provider id。

## 自成长框架

面板不仅是实时监视器,还让队长获得时间/工作量可见性,并让框架从每个任务中学习:

- **耗时追踪**:每个任务记录 `claimedAt` / `startedAt` / `completedAt`;面板显示成员当前任务的已耗时与任务总耗时。
- **工作量预估**:`agent_teams_create_task` 支持可选 `estimate_level`(`S` / `M` / `L`,参考区间 `S≤15m` / `M≤45m` / `L>45m`,集中可调);完成后面板显示"预估 vs 实际"与超时徽标(>1× 警示 / >1.5× 超时)。
- **产出信号**:任务同时记录状态变更次数、消息数、输出长度——避免把墙钟时间误判为实际产出。
- **每次完成自动复盘**:每个终态任务自动提炼复盘(实际 vs 预估、原因分类、最优方案提示);成员可追加 `retro_note`,队长可通过 `agent_teams_retro_review` 校准。
- **全局 best-practice 经验库**:提炼的经验沉淀到 `.agent-team-web/best-practices.json`(跨团队、可溯源到来源团队/任务),经过去重,可经 `agent_teams_best_practices` 查询;按角色×等级的校准提示反哺队长后续预估(冷启动守卫,样本不足时不下结论)。

## 架构

- **宿主包**(`src/index.ts`):装配一次进程级运行时(调度器、成员档位/状态守卫、退休成员守卫),并注册常驻的激活入口(提示段 + `agent_teams_activate`);14 个工具与队长协议段由 `src/activation.ts` 在激活时装进调用方 agent 的 `agent.ctx`,`/agent-teams` 命令 + 手势边界、快照与图集 HTTP 路由在根层注册。
- **浏览器包**(`src/client/index.tsx`):在 `shell.overlay` 槽注册活动面板、在 `conversation.chat.node` 注册团队卡片、注册隐藏命令视图;面板轮询快照路由(无长连接)。

内核以磁盘为真源;会话事件仅信息性;团队删除即归档(而非物理删除),面板可恢复历史。

## 历史会话诊断

成员会话记录存放在 DSH Session 中,其磁盘格式可能随 harness 版本变化。当当前
reader 无法打开较旧的成员会话时,面板**不会**隐藏团队:仍从 `.agent-team-web/`
展示 durable 的团队、任务与归档摘要,并给出简短诊断横幅——说明原因,以及可复制
且已脱敏的诊断信息(不含文件路径、token 或原始会话内容)。成员行保持可点击,
临时失败可直接重试;打开成功后横幅自动清除。插件**绝不**读取、改写或迁移原始
会话日志,恢复交由 DSH 自身处理。

## 协作模式

`agent_teams_create` 支持可选参数 `mode`：

- **`light`（轻量）**——不创建政委，且拒绝 gated 任务（`risk=high|critical` 或
  `milestone=true`）。适合风险低、一个执行者就够的小目标。
- **`standard`（标准，默认，也是既有团队的行为）**——随团队创建政委，gated 任务
  必须拿到政委 `pass` 才能完成。
- **`governed`（治理）**——同样有复核门禁，且政委不可被移除。

模式只能收紧：`agent_teams_set_mode` 只允许 `light → standard` 或
`light → governed`（缺失政委时一并创建），一切降级都被拒绝。gated 任务始终要求
在岗政委，因此任何模式都不会接受「永远无法复核」的工作。

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
pnpm add https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases/latest/download/deepseek-ai-dsh-experimental-agent-team-web-0.1.19.tgz
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

重启 DSH Web 进程(GUI),然后激活队长协议——两种方式等价:

```
/agent-teams <目标>
```

或直接用自然语言(模型会先调 `agent_teams_activate`,该工具返回协议并装好工具面):

```
用 AgentTeams 帮我 <目标>
```

示例:`/agent-teams review the last 20 commits from performance, security, and product perspectives`

激活是按会话的、幂等的:激活前 `agent_teams_*` 工具不存在,激活后从下一个 step 起可见(队长与成员都可见);未激活的会话只付提示的约 270 tokens/请求。

右上角会浮出**活动面板**:成员状态、任务进度、**每个成员当前任务已耗时**、预估 vs 实际与超时徽标,点击任务详情可下钻查看复盘与最佳实践经验。

### 升级

新版本发布后重跑第 1 步即可——`releases/latest` 地址会自动重定向到最新
tarball,无需改 URL。(若上面文件名仍带旧版本号,到
[Releases](https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases)
页面查看当前资产名即可。)

---

Release tarball: `deepseek-ai-dsh-experimental-agent-team-web-0.1.19.tgz`
