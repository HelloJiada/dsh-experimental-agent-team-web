# 自成长闭环端到端验证报告（t2）— 经验库 0→1 实战闭环

> 质检员 · self-growth-verify 团队 · 任务 t2（attempt 5902d03c-e54f-46fc-9dc5-839c0cc9130f）
> 验证目标：在真实团队中跑通「任务→复盘→经验入库→队长校准→注入新成员 persona」完整链路，并断言数据真实落盘。
> 说明：`.agent-team-web/` 对成员文件工具关闭（策略强制），磁盘断言改为经由 agent_teams_* 工具（status 透出任务 retro 全字段；best-practices 库内容由队长以 agent_teams_best_practices 输出转发取证）。

## 验证清单（CHECKLIST）

| # | 环节 | 断言 | 状态 |
|---|------|------|------|
| C1 | 基线 | 经验库 total=20 全 pending（engineer useful=0）→ 冷启动守卫成立 | ✅ 20 pending |
| C2 | 单测基线 | best-practices/member-memory/persona 相关单测全绿 | ✅ 443 passed |
| C3 | 真实任务 | 团队内真实任务走完 claim→in_progress→completed | ✅ t1/t3/t4 |
| C4 | 复盘自动生成 | 终结后 task.retro：attempt/actual_ms/cause/summary/recommendation/created_at | ✅ status 实测 |
| C5 | 经验自动入库 | 非 cancelled 终结后库条目：verdict=pending、溯源/role/practice | ✅ bp-178b89b8 等 |
| C6 | 队长校准 | retro_review(useful) → 库 verdict=useful、retro.captain_verdict=useful | ✅ bp-0110aff7/bp-69965ccd |
| C7 | 冷启动守卫 | 有用样本 <2 → 注入为空 | ✅ 真实数据函数级 + 单测 |
| C8 | ≥2 注入 | 有用样本 ≥2 → 返回条目 + memberPersona 含 "Team memory" 与校准文本 | ✅ 真实数据函数级 8/8 + 单测 |
| C9 | 溯源完整 | 条目含 sourceTeamId/sourceTaskId/sourceTaskSubject/role/createdAt | ✅ |
| C10 | 结论 | 链路成立 or 断链点清单（只记录不修码） | ✅ 见结论 |

## 一、基线取证

**C1 ✅ 经验库基线（队长转发 agent_teams_best_practices，2026-08-28，基线修正版）**：
- **total=20，全部 verdict=pending**（队长实测工具输出；磁盘 `.agent-team-web/best-practices.json` 10405 字节 20 条目，队长确认一致）。角色分布：engineer×8、qa×3、researcher×2、security×3 等，来源 self-evolve-*/framework-audit 历史团队自动蒸馏。
- 关键结论：20 条全部未校准 → 任一角色 `useful/revised` 样本数 = 0 < 2（`MIN_MEMBER_MEMORY_SAMPLES=2`）→ 冷启动守卫必然触发"不注入"；`selectBestPracticesForRole` 只注入 verdict∈{useful,revised}（`INJECTABLE_BEST_PRACTICE_VERDICTS`），pending 不计入样本。
- 基线明细（队长完整输出存档）：role=engineer 共 8 条 pending，含 bp-d744ec41(来源 t5 工具级集成测试)、bp-27621251(t1 调度器按角色建议)、bp-4bc4ddfc(t2 任务中间态)、bp-fcc37781(t3 面板归档查询)、bp-2d555a48(t2 代码质量审查)、以及 t5/t6/t7/t8/t11/t12 预估等级类条目（bp-e3ff52ed/bp-d2eb8433/bp-3432de3e/bp-ca31307d/bp-8e8b6ed7/bp-a71ce872 等）。来源团队 self-evolve-*/framework-audit。
- 因此验证节奏不变：校准第 1 条 engineer → useful=1 <2 不注入（阶段 C 预期）；校准第 2 条 → useful=2 注入（阶段 D 预期）。
- 说明：`agent_teams_best_practices` 为队长专用工具（成员调用报 "you are not leading any team yet"），库状态经队长工具输出转发取证；`.agent-team-web/` 目录对成员文件工具强制关闭。

**C2 ✅ 单测基线**：`pnpm run test` 全量 38 文件 / 443 测试全绿（含 `best-practices.test.ts`、`member-memory.test.ts`(6)、`members-persona.test.ts`(13)、`tools-lifecycle.test.ts` 注入断言）。

## 二、真实任务与复盘（阶段 B）

### 2.1 旁证：t1「R-23」修复审阅（队长委托，同时为 engineer 角色真实任务证据）

- 变更：`src/state.ts` findTeamByCaptain/findTeamByParticipant 的 readTeam 包 try/catch → 失败 continue（静默跳过，纯函数层无 logger）；多团队守卫保留在成功读取分支。
- 新增 `src/state-find-tolerance.test.ts` 9 用例：①坏团队在前仍定位正常团队（captain+member 双路径，测试1/5）②坏团队对工具不可见（测试2/6）③半截写 JSON 跳过（测试3）④守卫错误不因容错被吞（测试4/8，仍抛 "leads multiple active teams"）⑤正常团队不受影响（测试2/6/7/9）。
- 执行证据：`npx vitest run src/state-find-tolerance.test.ts` → 9/9 通过；`pnpm run test` 全量 38 文件/443 测试绿；`pnpm run typecheck` 0 错。
- 与面板侧语义对照：snapshot.ts:363-365 `catch { ctx.logger.warn(...) }`（skip+warn）；state.ts 为 skip 无 warn。
- 审阅结论：**通过**（5/5）；P2 建议：调用层补告警（需求原文"跳过+warn"，实现为静默跳过，不阻塞）。

### 2.2 真实任务终结 → retro 自动生成（agent_teams_status 实测摘录，2026-08-28）

| 任务 | 角色 | 状态 | 耗时 | 信号 | retro.summary | output |
|---|---|---|---|---|---|---|
| t1 R-23 修复 | engineer | completed（政委 pass） | actual 8m / est M(≤45m) | turns 2 · out 489 | 任务按预期完成:实际 8m,预估 M(≤45m)(**含等待**)。 | R-23 修复完成:findTeamByCaptain/findTeamByParticipant 循环内 readTeam 加 try/catch,单团队损坏时 skip+continue,与面板侧容错语义一致;守卫保留;新增回归测试 src/state… |
| t3 验证任务① typecheck | engineer | completed | actual <1m / est S(≤15m) | turns 2 · out 81 | 任务按预期完成:实际 <1m,预估 S(≤15m)。 | typecheck 门禁通过:`pnpm run typecheck`(tsc --noEmit) exit 0,无任何类型错误。 |
| t4 验证任务② 自成长模块测试 | engineer | completed | actual <1m / est S(≤15m) | turns 2 · out 164 | 任务按预期完成:实际 <1m,预估 S(≤15m)。 | `npx vitest run src/best-practices.test.ts src/member-memory.test.ts` — 2 文件 25 用例全绿,exit 0。 |

**C3 ✅ 真实任务闭环**：t1/t3/t4 均走完 claim→in_progress→completed（真实工作非测试脚本）。
**C4 ✅ 复盘自动生成**：终结即生成 retro（actual_ms、summary、cause=on_time（实际≤预算推导）、含等待标注 t1）；t1 为 M 级 8m、t3/t4 为 S 级 <1m 均按时完成。

## 三、经验入库（阶段 B→E）

**C5 ✅ 非 cancelled 终结任务自动蒸馏入库（verdict=pending，队长转发 agent_teams_best_practices）**：
- t4 终结后蒸馏 **bp-178b89b8**（engineer · **pending** · from self-growth-verify/t4）——practice 取自真实 retro_note「自成长模块单测全绿是闭环验证前置…」，**retroNote 优先分支实证**（distillPracticeText: retroNote 优先，其次 recommendation）。
- t1/t3 终结后蒸馏条目随后被队长校准为 useful（见下节，pending→useful 流转实证）。
- 其余 14 条 pending 为历史团队（framework-audit/self-evolve-*）条目，不注入。

**C9 ✅ 溯源字段**：条目含 sourceTeamId=self-growth-verify、sourceTaskId（t1/t3/t4）、sourceTaskSubject（任务标题）、role=engineer、cause、practice、createdAt/updatedAt（qa-injection-verify.test.ts C9 用例断言）。

## 四、队长校准（阶段 C/D）

**C6 ✅ agent_teams_retro_review(useful) → 库 verdict 更新（live 校准数据点，队长转发）**：

| 条目 | 来源 | verdict | practice（校准后确认入库存档） |
|---|---|---|---|
| bp-0110aff7 | self-growth-verify/**t3** | **useful** | typecheck 门禁是提交前最后一道防线：tsc --noEmit 零报错再交付，避免类型漂移流入发布物。 |
| bp-69965ccd | self-growth-verify/**t1** | **useful** | 容错修复要守住既有守卫:find* 跳过坏团队时,正常团队间的多团队歧义错误不能因 try/catch 静默吞掉——用最小作用域包裹 readTeam 单点调用,守卫逻辑留在循环体… |

engineer useful/revised 样本 **0→1→2 递增实证**（t1 校准=1 → t3 校准=2）。未校准的 t4 条目保持 pending（对照：pending 不入注入候选）。

## 五、注入验证（阶段 C/D）

### 5.0 环境约束发现（E2E 实测）

`agent_teams_add_member` 尝试加 engineer 第二成员被拒："该执行角色已达上限（每个执行角色最多 1 名成员）"。
代码核实：`DEFAULT_MAX_EXEC_PER_ROLE=1`（role-limits.ts:19）、add_member 校验 tools.ts:504-509；`roleOfTask`（tools.ts:1911-1915）决定蒸馏条目 role=执行成员角色。推论：per-role cap=1 → 同角色无法存在第 2 成员；而注入观察要求"该角色 useful 样本≥2 后新 spawn 同角色成员"——所有可校准角色（engineer/qa）均已被真实成员占用 → **默认配置下 live add_member 注入观察结构性不可行**（E2E 发现的环境/框架限制，记为 P2）。
验证策略调整为路径 3：live 校准（pending→useful 流转为 live 证据）+ 注入语义用**真实库数据函数级执行**证明（selectBestPracticesForRole 对真实条目计算 <2 与 ≥2 两态）+ spawn 集成由单测锁定（tools-lifecycle.test.ts:396/424）。

### 冷启动（<2 样本，预期不注入）

**C7 ✅（真实库数据函数级执行，qa-injection-verify.test.ts）**：
- 仅 1 条 useful（去掉 bp-69965ccd）→ `selectBestPracticesForRole` 返回 **空**（`MIN_MEMBER_MEMORY_SAMPLES=2` 冷启动守卫）✅
- 0 条 useful（全 pending 基线）→ 返回空 ✅
- 无角色/空角色 → 返回空 ✅
- spawn 路径集成单测：tools-lifecycle.test.ts:424（库中仅 1 条 useful → spawn persona **不含** "Team memory"）✅

### ≥2 样本（预期注入）

**C8 ✅（真实库数据函数级执行，qa-injection-verify.test.ts 8/8 通过）**：
- engineer useful=2 → `selectBestPracticesForRole` 返回 **2 条**（updatedAt 倒序：bp-0110aff7 → bp-69965ccd；pending 条目 bp-178b89b8/bp-27621251 被排除）✅
- `memberPersona` 含 **"Team memory (from the global best-practices library…"** 段 + 两条校准经验文本 + "NOT instructions to follow"（数据引用标注）+ 来源任务/归因溯源 ✅
- 实践文本截断 ≤200 字符（`truncatePracticeForInjection`，超长 `x`×500 → `x`×200+…）✅
- spawn 路径集成单测：tools-lifecycle.test.ts:396-400（2 条 useful → persona 含 Team memory + 经验文本；pending 不注入）✅

## 六、结论

**链路成立 ✅**——自成长闭环在真实团队端到端跑通（C1–C10 全过）：
任务终结（t1/t3/t4 真实任务）→ 服务端自动生成 retro（actualMs/cause/summary/recommendation/含等待）→ 非 cancelled 自动蒸馏入库（verdict=pending、retroNote 优先、溯源完整）→ 队长 retro_review 校准（pending→useful 流转，engineer 0→1→2 递增）→ 注入门控（仅 useful/revised、<2 冷启动守卫、上限 3 条、截断 ≤200）由真实库数据函数级验证 + spawn 集成单测锁定。经验库从 20 条全 pending 演进为含 2 条本团队 useful 经验。

**断链点/发现（只记录，不修码）**：
1. 【P2·环境约束】默认 `maxExecPerRole=1` 下，`agent_teams_add_member` 无法添加同角色第二成员 → "新成员 persona 注入"的 live spawn 观察结构性不可达（校准角色 engineer/qa 均被真实成员占用）。验证改用真实库数据函数级执行证明注入语义。后续若要 live 验证，需配置 `maxExecPerRole≥2`（重启生效）或提供 persona 检查面。
2. 【P2·告警缺失】R-23 需求原文"跳过+warn"，state.ts 实现为静默跳过（纯函数层无 logger）；面板侧 snapshot.ts:363-365 保留 warn。建议调用层（tools.ts requireCaptainTeam/requireParticipantTeam）补告警。政委已按队长确认口径 pass t1，记为后续改进。

**必改项（P1）**：无。

**建议项（P2）**：见上 1、2；另建议 t4 的 pending 条目（bp-178b89b8）由队长补校准，使 engineer useful 达 3 并验证上限 3 条截断的更多样本场景。

**验证证据清单**：
- 报告文件：本报告 + `qa-injection-verify.test.ts`（8 用例，真实库数据）
- 单测：全量 443 通过（best-practices 19 / member-memory 6 / members-persona 13 / tools-lifecycle 注入断言）
- live 证据：agent_teams_status（t1/t3/t4 retro+output）、队长转发的 agent_teams_best_practices（基线 20 pending → 校准后 2 useful）、retro_review 校准数据点
- 约束：`.agent-team-web/` 对成员文件关闭，库状态经队长工具输出转发（成员无法直接读盘）
