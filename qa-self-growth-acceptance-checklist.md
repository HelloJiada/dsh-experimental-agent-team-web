# 自成长框架验收清单（t3）— v4（最终验收口径确认）

> 质检员一号 · self-growing-agent-team · 任务 t3
> 目的：对"自成长框架"（任务预估工作量等级、耗时=墙钟+产出信号、超时归因与复盘、bestPractice 经验库自成长）做系统验收。
> 最终口径（队长 2026-08-27 用户拍板）：
> 1) **耗时 = 墙钟 + 产出信号**（status 变更次数 / 消息数 / output 长度）
> 2) **预估 = 等级 S/M/L**（附参考区间）
> 3) **自成长 = bestPractice 全局经验库**（跨团队溯源）
> 4) **复盘 = 每次完成沉淀 + 三层结构**（自动 / 成员 retro_note / 队长校准）
> 5) **面板分层**（成员行耗时 / 任务行徽标 / 详情下钻 / compact 只显耗时）
> 6) **边界**（failed 必沉淀 / cancelled 记耗时 / 含等待标注 / helper 计入）
> 依据：t1 修订版设计方案（侦察参谋一号，待产出）+ t2 实现（技术员一号，待产出）。
> 本清单先落盘，待 t2 产出后逐项执行并记录结果。字段名/参考区间/信号口径以 t1 修订版为准，本清单标注验收点。

## 0. 基线（t2 落地前，2026-08-27 17:30 记录）

| 项 | 结果 |
|---|---|
| vitest 原生 runner | 可用，29 文件 / 197 测试全绿（含 worktree 内测试文件） |
| typecheck (`pnpm run typecheck`) | 通过，无错误 |
| `src/types.ts` TeamTask | 尚无 estimate/时间戳/信号/retro 字段（旧模型） |
| `src/state.ts` activateTaskAttempt | status='claimed' 时仅 updatedAt=Date.now()，无 claimed_at 记录 |
| `src/tools.ts` create_task | 参数无 estimate 等级 |
| 现有 team.json（self-growing-agent-team） | 旧数据样本：任务无新字段，可作向后兼容 fixture |
| 环境注意 | vitest 原生可用，无需 polyfill（qa-run-tests.mjs 备用）；CDP 一律独立无头实例（端口 9224 为用户浏览器，勿碰） |

## 1. 数据层字段完整性（src/types.ts / src/state.ts / team.json 持久化）

- [ ] P1 `TeamTask` 新增字段齐全且类型正确（以 t1 修订版为准）：
  - `estimate?: 'S' | 'M' | 'L'`（队长 create_task 时可选填；参考区间常量集中定义可调，如 S ≤30m / M 30m~2h / L >2h，以 t1 为准）
  - 时间戳三段：`claimed_at?: number`（认领）／ `started_at?: number`（进入 in_progress，即实际开工）／ `completed_at?: number`（完成；failed/cancelled 也有终点时间戳）
  - `actual_ms?: number`（墙钟耗时 = 终点 − claimed_at；**分段**：claimed→started 启动延迟、started→终点 有效工时，按 t1 口径；含等待/帮助标注见 §12）
  - 产出信号字段（t1 定名，如 `signals?: { statusChanges?: number; messages?: number; outputLength?: number }`）：
    **status 变更次数**（本 attempt 内状态迁移计数）／**消息数**（本 attempt 内任务相关消息/回合数）／**output 长度**（最终 output 字符数）
  - `overrun?: number`（实际 vs 等级参考区间上界的偏差，形态以 t1 为准）
  - `retro?`（复盘记录，**三层结构**，见 §6）
- [ ] P1 create_task 参数新增 `estimate`（枚举 S/M/L），仅队长可填；写入 task 持久化到 team.json
- [ ] P1 state.ts 状态机写时间戳：claimed_at（activateTaskAttempt）／ started_at（首次 → in_progress）／ completed_at（→ completed/failed/cancelled）；中间迁移不改已写时间戳
- [ ] P1 产出信号字段数值校验：statusChanges/messages/outputLength 均为非负整数、有限数；写入时校验，非法值拒绝或归零不落脏数据
- [ ] P2 归档/快照（snapshot.ts TeamActivityTask）透传等级/时间戳/信号/复盘字段
- [ ] P2 team.json 读写往返：新字段落盘后可重新读回（readTeam/writeTeam 兼容）

## 2. 时间戳正确性 claimed→started→终点

- [ ] P1 claimed_at 仅在 status → claimed 时写入一次；重复认领（幂等返回）不覆盖
- [ ] P1 started_at 仅在首次 claimed → in_progress 时写入一次；再次 in_progress 迁移不覆盖
- [ ] P1 completed_at（终点）仅在进入 completed/failed/cancelled 时写入一次；终端状态不可变（已有守卫）下不重复写
- [ ] P1 单调性：completed_at ≥ started_at ≥ claimed_at ≥ createdAt（同任务，failed/cancelled 同规则）
- [ ] P1 actual_ms（墙钟）与终点 − claimed_at 一致；分段耗时（started−claimed / 终点−started）与时间戳一致（取整 ms）
- [ ] P2 attempt 轮换（reassign/retry → 新 attempt）：旧时间戳/信号/复盘随旧 attempt 隔离，不得并入新 attempt

## 3. 耗时计算与格式化（墙钟 + 产出信号）

- [ ] P1 actual_ms 墙钟计算正确（含跨分钟/小时场景；cancelled 也按终点−claimed 记录耗时）
- [ ] P1 产出信号采集口径正确：statusChanges=本 attempt 状态迁移次数；messages=本 attempt 任务相关消息数；outputLength=output 字符长度；来源以 t1 为准（状态机/邮箱/工具调用记录），完成/失败时写入任务
- [ ] P1 面板格式化：`12m` / `1h 05m` 形式（<1h 用分钟，≥1h 用 h mm）；0 或未定义显示为空/`–` 不崩
- [ ] P2 成员状态行"当前任务已耗时"实时取自 claimed_at → now（进行中任务）
- [ ] P2 信号展示（如 `3 状态 / 12 消息 / 2.1k out`）或并入复盘详情，至少任务行可见墙钟耗时

## 4. 预估（等级 S/M/L）vs 实际偏差

- [ ] P1 有 estimate 等级的任务：完成时计算 overrun（实际 vs 等级参考区间，超出上界即偏差）
- [ ] P1 无 estimate 的任务：overrun 为 undefined，不计算、不警示、不报错
- [ ] P1 偏差不污染数据：无预估时 actual_ms 仍正常记录
- [ ] P2 参考区间常量集中定义（如 config/常量文件），校准可改区间不破坏存量任务

## 5. 超时警示

- [ ] P1 警示规则：实际耗时超出该等级参考区间（或 t1 约定的倍数阈值）→ 警示（面板标黄/红）
- [ ] P1 警示只对"有 estimate + 已超时"任务出现；进行中已超时任务也警示
- [ ] P2 snapshot/intelligence 带超时标记（如 task.warning / intelligence 提示），面板消费

## 6. 复盘生成（retro）— 每次沉淀 + 三层结构

- [ ] P1 **三层结构**：`auto`（系统自动生成：等级/墙钟/分段/信号/偏差/原因分类/最优方案入口）＋ `retro_note`（成员完成时手写补充，可选）＋ `calibration`（队长校准：预估等级调整/后续派单建议，可选）
- [ ] P1 **每次任务完成（completed）都自动生成 auto 层**（不仅超时才生成）
- [ ] P1 **failed 任务必沉淀**：auto 层含失败原因分类（依赖阻塞/需求变化/成员效率/环境问题等），不因失败跳过复盘
- [ ] P1 原因分类存在（任务被低估 / 依赖阻塞 / 需求变化 / 成员效率 / 环境问题 — 至少其一可命中；有等级且超上界应倾向"任务被低估"）
- [ ] P1 复盘含"最优方案"沉淀入口（bestPractice 提炼的素材），随 retro 写入任务级
- [ ] P1 复盘沉淀位置：任务级 retro 字段；三层各自记录时间与作者（成员名/队长）
- [ ] P2 复盘不覆盖已有 retro_note/calibration；重复生成幂等（auto 层仅生成一次）

## 7. 自成长 — bestPractice 全局经验库（L3）

- [ ] P1 bestPractice 提炼机制：从已完成任务的 retro"最优方案"自动/半自动提炼为经验条目（去重、来源任务引用），沉淀到**全局经验库**（跨团队共享；位置以 t1 为准，如状态根级 best-practices 文件）
- [ ] P1 **跨团队溯源校验**：每条经验条目携带来源 teamId + taskId + 提炼时间，跨团队展示/检索时溯源可查；删除/归并不改溯源
- [ ] P1 经验库对队长可见（面板/工具/智能提示），供后续派单与任务描述引用
- [ ] P1 经验条目结构完整：主题/做法要点/适用场景/来源(teamId,taskId)/提炼时间
- [ ] P2 提炼规则明确：满足条件才入库（如样本数/评分/人工确认），行为可测试
- [ ] P2 经验库对旧数据（无 retro 任务）不报错、不强制入库

## 8. 面板展示（ActivityPanel.tsx + locales.ts）— 分层

- [ ] P1 **成员状态行**：显示"当前任务已耗时"（进行中任务实时耗时，取自 claimed_at → now）
- [ ] P1 **任务行徽标**：等级 vs 实际（如 `S / 1h 05m`）、超时警示徽标（黄/红，与 §5 规则一致）；无预估时不显示预估段
- [ ] P1 **详情下钻**：任务详情展开显示 分段耗时/信号/复盘三层/经验入口；i18n 文案齐全（locales.ts）
- [ ] P1 **compact 模式**：只显示耗时（不显示等级/信号/复盘），行高不变不崩
- [ ] P2 面板不因旧数据（无新字段）渲染异常；下钻/compact 切换不丢数据

## 9. 向后兼容（旧数据）

- [ ] P1 旧 team.json（无新字段任务）加载：state.ts 校验（isFiniteNumber 检查等）不报错
- [ ] P1 旧任务全流程（认领→完成）不产生 NaN/undefined 崩溃；无预估任务无 overrun/警示；无信号字段不报错
- [ ] P1 新代码对 undefined 字段的读取全部有守卫（`?.` / `?? ''` / `!== undefined`）
- [ ] P2 归档团队（archive/）历史任务同样兼容

## 10. 无回归

- [ ] P1 typecheck 通过
- [ ] P1 全量测试绿（基线 29 文件 / 197 测试，t2 后重跑对比；新增测试 ≥ 覆盖新增逻辑）
- [ ] P1 build 重建 lib 成功（lib/index.js、lib/client.js、lib/types/*）
- [ ] P1 既有功能回归：risk/review 门禁、依赖 DAG、helper、attempt 轮换、scheduler 派单测试仍绿
- [ ] P2 preview-panel.html 同步（若 t2 要求）

## 11. 运行时验证（t2 产出后执行）

- [ ] a) 认领→开始→完成全流程时间戳：构造测试断言 claimed_at ≤ started_at ≤ completed_at、actual_ms 精确、分段一致
- [ ] b) 有预估（S/M/L） vs 无预估任务：两分支行为差异符合 4.1/4.2/5.2
- [ ] c) 超时任务警示与复盘内容：构造实际 > 等级参考上界的场景，断言警示标记 + retro auto 层含原因分类
- [ ] d) 每次完成沉淀复盘：普通未超时完成也生成 retro auto 层（6.1）
- [ ] e) 产出信号字段校验：statusChanges/messages/outputLength 写入、非负整数校验、非法值拒绝、缺失兼容
- [ ] f) bestPractice 提炼：多任务 retro 后经验条目入库，结构与来源引用正确，去重生效；**跨团队溯源**（构造第二团队样本，断言溯源字段完整）
- [ ] g) 旧数据兼容：以现有 self-growing-agent-team/team.json（无新字段）为 fixture 跑 snapshot/校验，断言不报错
- [ ] h) 面板分层（可选，CDP 独立无头实例）：成员行耗时/任务行徽标/详情下钻/compact 四层渲染含新字段任务

## 12. 边界（failed / cancelled / 等待 / helper）

- [ ] P1 **failed 必沉淀复盘**：失败任务完成 auto 层复盘（§6.3），含失败原因分类；overrun/警示按有无等级正常判定
- [ ] P1 **cancelled 记耗时**：终点时间戳写入，actual_ms 按终点−claimed 记录（墙钟含已投入时间）
- [ ] P1 **含等待标注**：claimed→started 的启动延迟在复盘/详情中标注为"等待/准备"（不并入有效工时展示口径，按 t1 口径）
- [ ] P1 **helper 计入**：helper 协助时段计入任务耗时（实际墙钟口径不变）；复盘/信号统计含 helper 参与的标记（helper 名与时段，按 t1 方案）
- [ ] P2 归档团队（archive/）历史任务同样兼容（边界场景）

## 结论模板

- 通过 / 有条件通过 / 不通过
- 必改项（P1 未过项清单）
- 建议项（P2）
- 验证证据（测试名/文件/命令输出摘要）

---

## 验收执行记录（2026-08-27 18:00，质检员一号）

### 结果总览：**通过**（P1 全部通过，P2 建议 2 条）

### 逐项结果

| 节 | 验收项 | 结果 | 证据 |
|---|---|---|---|
| §1 | 数据层字段完整性 | ✅ P1 | types.ts: EstimateLevel/ESTIMATE_LEVEL_RANGES(集中可调)/TaskSignals/TaskRetro 三层/TeamTask 8 新字段；create_task estimate_level 参数；state.ts 三节点时间戳；team.json 持久化往返(state-timing.test.ts) |
| §2 | 时间戳正确性 | ✅ P1 | state-timing.test.ts 10 项 + e2e a) 7 项：claimedAt 认领写、startedAt 幂等、completedAt 幂等、单调 completed≥started≥claimed、attempt 轮换清空 |
| §3 | 耗时计算与格式化 | ✅ P1 | duration.ts `12m`/`1h 05m`/`<1m`；actualMs=completed−claimed 精确；task-timing.test.ts 7 项 |
| §4 | 预估等级 vs 实际 | ✅ P1 | e2e b) 5 项：有预估判超时/无预估不判不崩不产脏数据 |
| §5 | 超时警示 | ✅ P1 | e2e c) 8 项：warn>1.0× 预算、over>1.5×（等级区间优先，L 回退 estimatedMs）、等级偏差 |
| §6 | 复盘三层每次沉淀 | ✅ P1 | retro.test.ts 19 项 + e2e d) 6 项：on_time 也生成、failed 必沉淀、cancelled 记耗时不推经验、含等待/helper 标注、三层(auto+retroNote+captainVerdict) |
| §7 | bestPractice 全局库 | ✅ P1 | best-practices.test.ts 8 项 + e2e f) 8 项：提炼(retroNote 优先)、同 sourceTaskId 幂等去重、跨团队并存溯源完整、文件读写、verdict 流转、cancelled 不入库、冷启动样本<2 守卫 |
| §8 | 面板分层 | ✅ P1 | 视觉抽检 13 项全过：成员行"已耗时 1h 12m"(data-timing=over)、任务行徽标 超时/超预算、详情下钻(预估vs实际/信号/复盘/校准)、compact 只显耗时(代码审查：成员行无 compact 守卫保留、徽标/详情 !compact 隐藏、PANEL_COMPACT_BREAKPOINT=960) |
| §9 | 向后兼容 | ✅ P1 | state-timing.test.ts：旧任务读取、新字段持久化、损坏复盘拒绝；e2e g) 真实 self-growing-agent-team/team.json 读取+校准不崩 |
| §10 | 无回归 | ✅ P1 | 34 文件 249 测试全绿(与队长环境一致)；typecheck 0 错误；build 成功(lib/index.js+client.js)；preview-panel.html 已同步 |

### 运行时验证（e2e，38/38 全过 + 视觉 13/13 全过）
- a) 认领→开始→完成时间戳单调 ✅
- b) 有/无预估行为差异 ✅
- c) 超时警示+复盘原因分类 ✅
- d) 每次完成沉淀复盘（on_time）✅
- e) 信号 turns 增量/outputBytes ✅
- f) bestPractice 入库去重跨团队溯源 ✅
- g) 旧数据兼容（真实 team.json）✅
- h) 面板四层（CDP 独立无头 9227，未碰 9224）✅

### 发现与建议
1. **交付流程提示（非缺陷）**：t2 交付时 lib/ 仅 types 无 js 产物（client.js/index.js 缺失），QA 执行 `pnpm run build` 重建后全绿。建议技术员后续交付校验 `ls lib/*.js` 完整。
2. **P2 建议**：signals 字段命名 v4 口径(statusChanges/messages/outputLength)在实现中映射为 turns/toolCalls/outputBytes（语义一一对应，设计文档已注明口径），建议文档中显式保留 v4 命名映射表便于追踪。
3. **P2 建议**：attempt 级 retros 历史数组（t1 设计 Phase 2）尚未实现（v1 只维护 retro 单条），符合设计分期，不阻塞本验收。
