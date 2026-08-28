# 角色重构与自成长闭环验收清单（t4）— v1

> 质检员一号 · self-evolve-role-system · 任务 t4（attempt b462610f-b4ed-4eb3-92ef-48ae235f5498）
> 目的：对「角色体系重构 + 自成长闭环强化」做系统验收。
> 依据：docs/role-system-redesign-decision.md（决策记录 v2）+ t1 落地设计（侦察参谋一号）+ t2 实现（技术员一号）+ t3 实现（技术员二号）。
> 本清单先落盘，待 t2/t3 产出后逐项执行并记录结果。
> 环境注意：rolldown 问题以队长环境验证为准；CDP 一律独立无头实例，勿碰用户浏览器。

## 0. 基线（t2/t3 落地前，2026-08-28 10:05 记录）

| 项 | 结果 |
|---|---|
| vitest 全量测试 | 34 文件 / 252 测试全绿（含 worktree 内测试文件） |
| typecheck (`pnpm run typecheck`) | 通过，0 错误 |
| build (`pnpm run build`，tsdown/rolldown v1.1.5) | 成功（host ESM lib/index.js + client CJS lib/client.js） |
| agent_teams_* 工具数 | 13 个（create/add_member/remove_member/create_task/reassign_task/claim_task/update_task/review_task/send_message/status/retro_review/best_practices/delete） |
| 角色体系现状 | 旧体系：8 执行角色 × 2（DEFAULT_MAX_EXEC_PER_ROLE=2）、member-naming 自动编号（技术员 一号）、persona 无角色差异、add_member/index 描述 8 角色 18 上限、无记忆注入、无「待校准」 |
| best-practices.json | 不存在（冷启动态，无经验库） |
| 兼容样本 | 本团队自身：技术员 一号 + 技术员 二号 同角色 2 人（旧规则创建），任务 t1-t4 在跑 —— 是「旧团队已有编号成员」的活体兼容样本 |

## 1. 角色收敛（验收点 1）

- [ ] P1 `DEFAULT_MAX_EXEC_PER_ROLE = 1`（src/role-limits.ts），config 默认 `maxExecPerRole: 1`（src/index.ts）
- [ ] P1 member-naming 去编号：缺省名/纯角色名 → 直接用角色标题（`resolveMemberName(undefined,'engineer',0) === '技术员'`，不再生成 技术员 一号）
- [ ] P1 tools.ts add_member description 更新：不再提「auto-numbered name」；role 参数描述 5 执行角色（researcher/data/engineer/qa/designer）+ reviewer 任务级 + commissar 监督；security/docs/operator 明确降级为自定义角色（不预设不占席位）
- [ ] P1 index.ts 系统提示协议段更新：5 执行角色 + 2 监督、每角色默认 1 人、推荐路径（researcher→engineer→qa）非强制流水线、人数上限文案与 5 角色一致
- [ ] P1 旧团队兼容：已有编号成员名（技术员 一号）不改名、不破坏 —— 显式名原样保留、client isRoleName 仍识别编号名、本团队自身继续正常运转（调度/消息/状态）
- [ ] P2 client/roles.ts + locales.ts 角色展示同步（5 角色标题；security/docs/operator 的处理与降级一致）

## 2. 差异化 prompt（验收点 2）

- [ ] P1 members.ts memberPersona 按角色注入专属行为模板：
  - researcher：先读代码/文档 → 根因+方案 → 自检后移交
  - engineer：按方案实现 → 自测 → 附 diff 摘要
  - qa：先出清单 → 逐项验证 → pass/驳回+证据
  - designer：视觉方案含具体值
  - data：定指标 → 采集 → 可复核报告
- [ ] P1 自定义角色/无角色有通用兜底模板，不崩
- [ ] P2 新增测试覆盖 persona 按角色差异（如 members.test.ts 或等价断言）

## 3. 团队记忆注入（验收点 3）

- [ ] P1 加成员时按角色注入 best-practices 相关条目（成员 persona/welcome 或 add_member 路径）
- [ ] P1 冷启动（best-practices.json 不存在/为空）不注入、不报错 —— 本环境即冷启动态，可直接验证
- [ ] P2 注入内容与角色相关（如按 role 过滤），可测试

## 4. 复盘闭环（验收点 4）

- [ ] P1 面板对「high 任务已完成但无 retro_note 或未经队长校准（retro_review 无 verdict）」显示「待校准」
- [ ] P1 locales.ts 有「待校准」i18n 文案；ActivityPanel 渲染逻辑存在且有测试
- [ ] P2 校准后（retro_review useful/useless/revised）「待校准」消失/更新

## 5. 无回归（验收点 5）

- [ ] P1 typecheck 通过
- [ ] P1 全量测试绿（基线 34 文件 / 252；t2/t3 后重跑对比；新增测试覆盖新增逻辑；受影响的 role-limits/member-naming 测试已同步更新）
- [ ] P1 build 成功重建 lib（lib/index.js、lib/client.js、lib/types/*）
- [ ] P1 现有 13 工具行为不变：create_task（estimate_level/dependencies/risk/milestone）、update_task（attempt/retro_cause/retro_note）、review_task 门禁、reassign/claim/stale-attempt、status、best_practices、retro_review、send_message、create/delete 全链路仍绿（既有测试覆盖）
- [ ] P1 既有功能回归：commissar 门禁、依赖 DAG、helper、attempt 轮换、scheduler 派单测试仍绿

## 结论模板

- 通过 / 有条件通过 / 不通过
- 必改项（P1 未过项清单）
- 建议项（P2）
- 验证证据（测试名/文件/命令输出摘要）

---

## 验收执行记录（2026-08-28，质检员一号 · 补充）

> 实现于本轮工作树落盘（t2/t3 进行中时逐步落地，截至本记录时变更集 18 改 + 2 新文件）。
> 验证方式：代码审查 + 全量测试 + typecheck + build + e2e 脚本（qa-role-refactor-e2e.mjs，35 项断言）。

### 逐项结果

| 节 | 验收项 | 结果 | 证据 |
|---|---|---|---|
| §1 | 角色收敛 | ✅ | role-limits.ts DEFAULT_MAX_EXEC_PER_ROLE=1；member-naming.ts 缺省名→角色标题（技术员），第 2 名同角色才编号（技术员 二号），旧编号名原样保留；tools.ts add_member 描述 5 预设行为角色 + security/docs/operator「非预设，按需传自定义角色」；index.ts usage 段 5 角色每角色默认 1 人 + 推荐路径非强制流水线；roles.ts 预设表移除 security/docs/operator（降级回退原始文本）；本团队（技术员 一号/二号 旧编号）持续正常运转 |
| §2 | 差异化 prompt | ✅ | members.ts ROLE_BEHAVIOR_TEMPLATES（researcher 先读→根因+方案→自检移交 / engineer 按方案实现→自测→diff 摘要 / qa 清单→验证→pass/驳回+证据 / designer 具体值 / data 指标→采集→可复核报告 / reviewer / commissar）；memberPersona 注入 Role behavior 段；自定义角色无模板不崩；members-persona.test.ts 7 项覆盖 |
| §3 | 团队记忆注入 | ✅ | best-practices.ts selectBestPracticesForRole（按角色精确匹配、冷启动守卫 MIN=2、useful/revised 优先、上限 3 条）；members.ts persona 注入 Team memory 段（空则无）；tools.ts add_member 与 commissar 自动创建同路径注入；best-practices.test.ts +5 项；本环境 best-practices.json 不存在（冷启动）→ 不注入不报错 |
| §4 | 复盘闭环（待校准） | ✅ | retro.ts retroPendingCalibration（high/critical + completed/failed + 无 retro_note + 无 captainVerdict）；snapshot.ts 透出 pendingCalibration；client task-timing.ts taskPendingCalibration + locales 「待校准」/详情文案 + ActivityPanel 任务行徽标与详情标注 + CSS chip；lib/client.js 已含「待校准」（构建后 grep 命中 2 处）；retro.test.ts +8 项、task-timing.test.ts +5 项 |
| §5 | 无回归 | ✅ | typecheck 0 错误；全量 36 文件 / 287 测试全绿（基线 34 文件 / 252 → +35 新增，含 members-persona.test.ts 7 项、member-memory.test.ts 4 项、best-practices +5、retro +8、task-timing +5、member-naming/role-limits 同步更新）；build 成功（rolldown v1.1.5，host ESM 224.75 kB + client CJS 160.29 kB，lib/ 已重建）；13 工具名称与参数不变（tools.ts diff 仅新增记忆注入调用）；commissar 门禁/依赖 DAG/attempt 轮换/scheduler 既有测试仍绿 |

### 发现与建议

1. **P1（既有缺陷，非本轮回归）**：`agent_teams_update_task` 输出 schema 与返回值不同步 —— execute 返回含 `started_at`/`signals`/`actual_ms`/`retro` 等字段，但声明 schema 仅 task_id/status/output/attempt/attempt_id 且 additionalProperties:false，导致**每次调用在工具输出层报「invalid output」错误**（状态实际已持久化）。验收过程中本人两次调用均命中。影响：成员看到虚假错误、可能重试导致 signals.turns 重复计数。建议修复：schema 补齐 started_at/signals/output 派生字段（与 claim_task 等工具一致）。
2. **P2**：locales.ts 仍保留 role.security/docs/operator 文案键（已不被 roles.ts 引用，无害，可留作自定义角色翻译兜底或清理）。
3. **P2**：`MIN_MEMBER_MEMORY_SAMPLES=2` 与复盘校准口径一致，但经验注入只作用于「新加入成员」；存量成员（含本团队）不重注入 —— 符合「加成员时」验收口径，如需补注入可后续加刷新机制。
4. **环境**：build 在本环境（rolldown v1.1.5）通过；按队长口径以队长环境验证为准，如队长环境 rolldown 版本不同以队长为准。

### 结论：**通过**（P1 全部通过；发现 1 条既有 P1 缺陷建议修复，不阻塞本轮验收）
