# Agent Team Web 超越计划

日期：2026-08-25

## 目标

将当前项目从“只读 Team 视图 Bundle”升级为“可观察、可分析、可指挥的 Agent Team 工作台”，并在不破坏宿主 DSH 契约的前提下，逐步超越 `dsh-agent-teams` 的核心体验。

## 我们当前的位置

当前仓库已经具备三块基础：

1. Team 事件类型契约；
2. Host 侧 session projection；
3. Client 侧 Team conversation view。

但现状仍偏只读观测：

- 没有任务健康度分析；
- 没有可视化的关键指标；
- 没有阻塞、积压、消息延迟等洞察；
- 没有 Captain 视角的优先级提示；
- 没有独立 dashboard；
- 没有 runtime 协调与控制能力。

## 对竞品的判断

`dsh-agent-teams` 当前优势在于：

- 具备完整的 Team protocol 与调度能力；
- 有更产品化的活动面板；
- 有 slash command、归档、成员唤醒、任务依赖调度等完整链路。

但它也有明显机会点：

- 更偏“执行协调”，不一定更强于“团队态势洞察”；
- Captain 的决策辅助空间仍很大；
- 团队健康、风险、吞吐、阻塞的解释层可以做得更强；
- 对历史趋势、异常检测、工作建议的表达可以更智能。

## 超越策略

我们不直接复制对方全部能力，而是按三阶段超越：

### Phase 1：把只读视图升级为 Team Intelligence Workspace

目标：让 Captain 一眼看清团队是否健康、哪里堵住、下一步该干什么。

本阶段能力：

- 团队健康概览卡；
- 任务吞吐与积压指标；
- 阻塞任务识别；
- 未投递消息识别；
- 成员负载与失败状态提示；
- 自动生成优先行动建议；
- 风险清单与异常摘要；
- 更结构化的 Team 视图布局。

### Phase 2：把 Team 视图升级为可操作工作台

目标：不仅看见状态，还能驱动协作。

计划能力：

- 任务筛选、搜索、分组；
- 会话内 Captain 操作入口；
- 面向宿主工具的 command bridge；
- 团队历史与快照对比；
- 独立 Team dashboard route；
- 更细粒度的消息与依赖关系视图。

### Phase 3：把工作台升级为增强型指挥系统

目标：即使底层 runtime 与对方相近，我们仍凭“更好的决策辅助”和“更强的可解释性”超越对方。

计划能力：

- 自动识别 stalled / overloaded / orphaned work；
- 对任务依赖图做风险传播分析；
- 生成 Captain briefing；
- 生成可解释的 intervention suggestions；
- 历史趋势、团队效率对比与异常检测；
- 跨会话 Team 资产沉淀。

## 迭代记录

### 第一轮（Phase 1 核心切片，已完成）

1. 扩展 projection view，新增 Team 洞察字段；
2. 在 Client Team 视图里增加概览、告警、建议、任务分组与消息风险展示；
3. 更新 README / 中文 README，明确项目从“只读列表”升级为“只读智能工作台”；
4. 补充基础测试，锁定 projection 洞察逻辑。

### 第二轮（intelligence 深化，已完成）

1. 新增任务 readiness 分类（ready / blocked / orphaned / stalled）；
2. 新增成员负载分级（idle / focused / stretched / overloaded）；
3. 新增 Captain Briefing 输出；
4. 补充任务诊断与成员负载测试。

### 第三轮（intelligence 深化 + 产品完成度，已完成）

1. 新增依赖链 fan-out 分析（dependencyDepth）与干预优先级排序（interventionPriority）；
2. 新增 Top Interventions 摘要；
3. 新增消息投递风险分级（low / medium / high）；
4. 新增快速筛选计数（任务 / 成员 / 消息）；
5. 新增派生 Team 时间线（成员 / 任务 / 消息条目）；
6. 工作台 UI 同步新增相关区块；
7. 补充对应测试。

### 第四轮（可交互 dashboard，已完成）

1. 新增纯筛选引擎 `src/filter.ts`（任务 / 成员 / 消息多维筛选 + 文本搜索）；
2. 工作台升级为标签页式 dashboard（概览 / 任务 / 成员 / 消息 / 时间线）；
3. 筛选 chips 与搜索框变为可交互控件，实时作用于列表；
4. Client bundle 正式依赖 `react` hooks，并更新 client bundle 契约测试；
5. 补充筛选引擎单元测试。

### 第五轮（历史化 timeline + command bridge，已完成）

1. projection 状态新增有界事件历史（最近 100 条 committed Team 事件，含 seq / time / tone）；
2. `timelineView` 优先基于事件历史生成时间线，无历史时回退到快照推导；
3. 新增 `src/commands.ts` command bridge 建议层（task:claim / task:reassign / task:unblock / member:restart / message:redeliver / message:broadcast），携带具体 target id；
4. dashboard 概览页新增 Command Bridge 区块，时间线页展示事件序号与时间；
5. 补充历史时间线与命令建议测试。

### 第六轮（历史容量/合并策略 + 端到端示例，已完成）

1. 事件历史改为**实体级合并（coalescing）**：同一 member / task / message 的连续事件合并为一条，带 `count` 计数（如任务多次 rev 更新、消息 queued+delivered、成员 phase 流转）；
2. 容量上限按**不同实体数**控制（100），最早实体被淘汰；
3. timeline 条目与 UI 增加合并计数展示（`×N`）；
4. 新增端到端示例文档 [docs/example-workflow.md](example-workflow.md)：事件 → 投影 → 洞察 → dashboard → command bridge 全链路；
5. 补充合并与容量测试（6 个历史用例全绿）。

### 第七轮（上游契约对齐 + 适配器，已完成）

1. 直接核对上游 `NanmiCoder/dsh-agent-teams` 源码（event-types / types / events），确认真实事件为 `agent-teams/*`（7 种），与我们 vendored 的 `team/*` 不一致；
2. 新增 `src/upstream.ts` 适配层：把上游 7 种事件折叠进 projection 状态，并把 `agent-teams/*` 类型并入 `SessionEventMap` 声明合并；
3. 任务状态词表扩展 `failed` / `cancelled`（terminal，不可 action），readiness、快速筛选、UI tone、时间线同步贯通；
4. 消息投递语义调整：上游消息折叠为 quiet + 未送达，quiet 未送达不再视为 medium 风险；
5. 新增契约对齐文档 [docs/contract-alignment.md](contract-alignment.md)（差异表 + 映射规则 + 边界）；
6. 新增 6 个上游适配器测试。

### 第八轮（时间线摘要统计，已完成）

1. 新增 `timelineSummaryView`，从历史/快照时间线推导事件总数、成员/任务/消息分布、合并条目数、序号范围、最近里程碑；
2. 扩展 `AgentTeamView` / projection schema，把时间线摘要作为稳定 DTO 暴露给前端；
3. 时间线标签页新增摘要统计卡片，帮助 Captain 先看“变化规模”和“最近发生了什么”，再下钻具体事件；
4. 补充 projection / history / upstream / view-fixture 测试，锁定历史合并与摘要字段行为。

### 第九轮（真实 Profile 端到端验证支撑，已完成）

1. 新增确定性端到端回放 fixture `tests/fixtures/upstream-team-lifecycle.ts`：一条 16 事件的真实形状上游 `agent-teams/*` 生命周期（建队 → 成员 → 带依赖任务 → claim/推进 → completed/failed/cancelled → 消息 → 失败依赖上的新任务）；
2. 新增 `tests/e2e-replay.spec.ts`：把整条事件流灌进完整管线（事件 → projection → view → 洞察 → 摘要 → 时间线 → 命令建议），锁定端到端行为（名字→id 解析、terminal readiness、quiet 消息 low risk、干预排除 terminal、时间线摘要、command bridge）；
3. 新增 [docs/verification-checklist.md](verification-checklist.md)：真实 Profile 安装 + 上游联调逐项核对清单（含 `KNOWN_SESSION_EVENT_TYPES` best-effort 前提、各标签页预期、已知边界、可执行回放替代方案）。

### 第十轮（事件历史滚动窗口 + 里程碑摘要，已完成）

1. 新增 `timelineMilestonesView`：把合并后的时间线按滚动窗口（默认每窗 8 条合并行）分组，按时间序切窗、最近窗口置顶输出；
2. 每个窗口派生：事件分布（成员/任务/消息）、序号范围、行数/事件数、**里程碑标题**（按 tone 显著性取头条：danger > warn > good > neutral，同级别取最新）；
3. 扩展 `AgentTeamView` / projection schema，`timelineMilestones` 作为稳定 DTO 暴露；时间线标签页新增「里程碑窗口（滚动摘要）」区块；
4. 补充 2 个窗口化单元测试 + e2e 回放断言（16 事件 → 10 行 → 2 窗口：最近窗口 2 行/2 事件、较早窗口 8 行/14 事件，headline 取 failed 任务）。

### 第十一轮（按时间窗口聚合里程碑 + 共享纯模块，已完成）

1. 里程碑窗口支持 `time` 模式：按 `windowMs`（默认 1h）时间桶聚合，无时间戳的行归入最早桶；count/time 双模式共用同一派生逻辑；
2. 把 `timelineMilestonesView` 下沉到**零运行时依赖**的 `src/timeline-milestones.ts`（仅类型导入），host projection 与 client dashboard 共享同一实现，客户端不把 zod/projection 栈拖进浏览器 bundle（client external 仍只有 react + react/jsx-runtime）；
3. 时间线标签页新增「按行数（8/窗）/ 按时间（1h/窗）」切换，客户端用共享模块实时重算窗口；
4. 新增 time 模式单元测试 + e2e 回放时间桶断言（fixture 1000–2500ms → 2 个 1s 桶）。

### 第十二轮（Command Bridge 计划导出契约，已完成）

1. 命令建议正式化为**宿主可消费的计划 envelope**：`AgentTeamCommandPlanView`（`version` / `generatedFromTeamId` / `total` / 高中低优先级计数 / `commands[]`，每条命令带具体 `targetId`），随 `AgentTeamView` 作为稳定 DTO 由 host projection 计算并下发；
2. 纯函数 `commandPlanView(source)`：接受收窄的 `AgentTeamCommandPlanSource`（teamId + members + taskInsights + memberLoads + messageRisks），避免视图自引用；`suggestCommands` 同步改为接收该 source 类型；
3. 客户端不再自行推导命令，改为直接消费 DTO 中的 `commandPlan`（bundle 体积下降，external 仍只有 react + react/jsx-runtime）；Command Bridge 区块新增计划摘要行与「宿主可消费的命令计划（只读 envelope）」JSON 展开块；
4. 新增 2 个计划 envelope 测试（计数/JSON 可序列化、空计划）+ e2e 回放断言（`generatedFromTeamId`、`task:unblock` 居首、JSON round-trip）。

### 第十三轮（真实 Profile 集成骨架 + 冒烟验证，已完成）

1. 新增可直接复用的 profile patch 骨架 `examples/profile-patch.agent-team-web.yml`（上游插件安装命令、bundle 安装、`KNOWN_SESSION_EVENT_TYPES` best-effort 前提、最小真实团队提示词、验证点清单）；
2. 新增最短路径真机冒烟指南 [docs/real-profile-smoke-check.md](real-profile-smoke-check.md)：安装 → `dsh --profile web --dump-config` 组合校验 → 触发真实团队 → 60 秒 6 项冒烟检查 → 空视图三排查（宿主不识别 `agent-teams/*` / bundle 未注入 / 会话暂无 committed 记录）；
3. 新增静态一致性测试 `tests/profile-skeleton.spec.ts` + `package-layout` 扩展：锁定例子/指南内容与 tarball 打包清单（`examples` 与两份 docs 进入发布产物）；
4. `package.json` `files` 增加 `examples` 与 `docs/verification-checklist.md`、`docs/real-profile-smoke-check.md`。

### 第十四轮（Command Bridge 宿主执行契约，已完成）

1. 命令词表单一事实来源：`AGENT_TEAM_COMMAND_KINDS`（6 种，编译期与 `AgentTeamCommandKind` 联合类型一致），zod schema 的 `kind` 直接使用 `z.enum(AGENT_TEAM_COMMAND_KINDS)`；
2. 新增 [docs/command-bridge-execution.md](command-bridge-execution.md)：宿主 runtime 工具层消费 `commandPlan.commands` 的规范——envelope 字段、逐 kind 触发条件与建议执行语义、幂等/审计/安全建议、最小消费伪代码；
3. 新增 `tests/command-bridge-execution.spec.ts`（2 用例）：词表恰为 6 种且无重复、文档覆盖全部 kind 与关键字段；
4. `docs/command-bridge-execution.md` 进入 tarball（`package.json` files + `package-layout` 测试同步）。

### 第十五轮（任务依赖 DAG 投影能力，已完成）

1. 新增零依赖纯模块 `src/dependency-dag.ts`：Kahn 拓扑分层（level = 依赖源起的最长路径），环回退到末尾列；`dependencyDagView(tasks, memberNames)` 产出节点（level/position/tone/ownerName/下游 fan-out 深度）与去重边；
2. 契约新增 `AgentTeamDagNodeView` / `AgentTeamDagEdgeView` / `AgentTeamDagView`，`AgentTeamView.dependencyDag` 作为稳定 DTO 由 host projection 计算并下发（含 zod schema）；
3. 提供 DAG detail 表达：纯 SVG 分层图可按层、状态、owner 与依赖/下游关系呈现；零新增外部依赖，client external 仍只有 react + react/jsx-runtime；
4. 新增 6 个 DAG 单元测试（链式分层、fan-in/fan-out、未解析依赖、环回退、owner 与 tone、空图）+ e2e 回放断言（spec→impl→docs 三层、followup 二层、owner Bob、danger tone、深度 3）。

### 第十六轮（当前 session 浮动活动面板，已完成）

1. Team UI 从嵌入式完整 dashboard 转为当前 session 的活动徽标、transcript 轻量摘要入口和 shell-overlay 非模态监视器；
2. 徽标仅在 active/blocked 工作存在时显示；宽屏默认停靠、可选拖动/缩放悬浮，≤960px 使用紧凑安全边距 overlay，几何仅在各浏览器本地持久化；
3. 监视器聚焦健康度、优先级、active/blocked 工作与成员状态；点击成员打开已有 session；默认不嵌入完整 timeline、筛选、DAG 或 command explorer；
4. DAG、时间线和 Command Bridge 保持为稳定 projection/detail DTO，供需要下钻的宿主体验使用。

## 后续建议

1. 独立 dashboard route（需宿主 Web shell 提供路由接入点，当前 slot 系统无该能力）；
2. 宿主侧按 [docs/command-bridge-execution.md](command-bridge-execution.md) 实现 `commandPlan.commands` 执行层（bundle 侧契约与规范已就绪）；
3. 在真实 Profile 中按 [docs/real-profile-smoke-check.md](real-profile-smoke-check.md) 做一次真机冒烟、再按 [docs/verification-checklist.md](verification-checklist.md) 走完整核对表（确定性回放已就绪，真机验证仍待执行）；
4. 可按宿主需求把 DAG、里程碑或 Command Bridge detail 接入专门的下钻体验，而不扩充默认活动监视器。

## 设计原则

- 浏览器不伪造权威事实；
- 所有洞察都来自 committed Team records 的推导；
- UI 可聪明，但数据来源必须可解释；
- 对宿主契约保持保守兼容；
- 先做 Captain 决策增强，再决定是否下沉到 runtime 控制层。

## 成功标准

本轮成功后，当前项目应满足：

- 能用 committed Team records 自动生成健康摘要；
- 能突出未投递消息、阻塞任务、失败成员；
- 能给出可解释的下一步建议；
- UI 信息密度明显高于基础列表；
- README 能准确反映新定位。
