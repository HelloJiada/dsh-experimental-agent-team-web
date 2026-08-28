# 修复包验收清单（R-24~R-36，t5~t10）— QA 基线

> 质检员 · self-growth-verify 团队 · 修复包四条线：技术员 t5→t8 串行（行为修复）、侦察参谋 t9（代码质量）、警卫员 t10（安全/环境），均 high risk（政委门禁）。
> 依据：docs/audit-final-consolidated.md §3.6 低危表（R-23~R-36 定义）+ 队长验收重点六项。
> 方法：清单先行 → 各批交付后逐项核验（命令/输出/文件摘录）→ 结论同步政委。

## 验收重点六项（队长指定）

| # | R | 问题定义（审计原文） | 验收断言 | 状态 |
|---|----|--------------------|---------|------|
| ① | R-25 | estimate_level 与 estimate_ms 冲突时复盘摘要自相矛盾（retro.ts:146-149,195,210-227） | **✅ 通过**：resolveTaskTiming+buildTaskRetro 同源 estimateBudgetMs（等级优先）；冲突用例实证（S+20m/18m → +3m 超时无"提前"矛盾；10m → "提前 5m"；仅等级 M/50m → +5m）；types.ts 注释同步 | ✅ t5, 2026-08-28 |
| ② | R-28 | suggest 中文角色不归一 → 建议分配选不到成员（suggest.ts:162-164 vs role-limits.ts:27-49） | **✅ 通过**：suggest 复用 role-limits canonicalExecRole（中文军职映射统一）；技术员→engineer、侦察参谋→researcher、质检员-v2→qa 命中 + 中英同桶负载均衡（suggest.test.ts +4）；本地 canonicalRoleKey 删除单一来源 | ✅ t6, 2026-08-28 |
| ③ | R-24 | status 邮箱"未展示即已读"竞态（ack 二次读取，tools.ts:1505-1510,1536 → 现 1609-1616） | **✅ 通过**：ack 集合=展示读同一数组（成员 callerUnreadIds/队长 captainInbox），二次读取消除；测试：后到 m2 不误 ack（jsonl readAt 逐行断言）、队长不碰成员邮箱 | ✅ t7, 2026-08-28 |
| ④ | R-26 | 团队锁持有期间 await LLM/spawn/政委唤醒（秒级阻塞同队工具，tools.ts:500-530、commissar-gate.ts:69） | **✅ 通过**：add_member 两段式（锁内校验→锁外 LLM/spawn→锁内复核+孤儿退休）；门禁拆 append（锁内持久化）/wake（锁外网络）；并发测试断言 spawn/followup 挂起 300ms 期间 status 150ms 内完成 | ✅ t7, 2026-08-28 |
| ⑤ | R-31 | kick 扇出在工具关键路径（update_task/status/create_task/remove_member 均 await，tools.ts:615,745,1183,1397） | **✅ 通过**：kick 六处 fire-and-forget（add_member kickMember/remove_member/create_task/reassign kickMember/update_task/status 队长侧），失败 warn 不阻塞；慢 kickMember 挂起 300ms 不阻塞 create_task（150ms race + 落盘断言） | ✅ t8, 2026-08-28 |
| ⑥ | R-33 | 工具类代码质量：suggestAssigneeForTask 死 import、signals/retro 序列化重复、renderStatus/renderBestPractices 可拆 render.ts（tools.ts:90,1151-1180,1456-1481,1842-1975） | **✅ 通过**：死 import 清理；serializeSignals/serializeRetro 收敛 render.ts（形状逐字段一致）；renderStatus/renderBestPractices 移入；tools.ts -204 行；零漂移=全量 482/482 + typecheck 0 + build 成功；render.test.ts 5 用例 | ✅ t9, 2026-08-28 |

## 批次内其余项（同批核验）

| R | 批次 | 定义 | 验收断言 | 状态 |
|----|------|------|---------|------|
| R-30 | t5 | 自动入库门槛过低：非 cancelled 终结任务恒入一条通用建议（recommendation 恒非空，tools.ts:1114-1127、retro.ts:229） | **✅ 通过**：recommendation=`cancelled || (on_time && 无 note) ? '' : 建议`；工具级测试：纯 on_time 无 note 库 0 条目；有 note 入库（retroNote 优先）；underestimated 无 note 通用建议入库 | ✅ t5, 2026-08-28 |
| R-29 | t6 | 成员白名单漏 retro_review/best_practices（members.ts:29-36） | **✅ 通过**：MEMBER_DENIED_TOOLS 补 retro_review/best_practices；tools-lifecycle 断言 spawn deny 清单含两项；运行期 requireCaptain 守卫保留 | ✅ t6, 2026-08-28 |
| R-32 | t8 | 面板 toolCalls 派生 O(邮箱×任务) 全量扫描（snapshot.ts:161-192） | **✅ 通过**：窗口=每邮箱最近 100 条 + 全任务提及后提前终止 + 正则预编译；3 新用例（121→100、提前终止计数 1、无提及无字段）；近似语义文档化（P2：重复提及可能低估） | ✅ t8, 2026-08-28 |
| R-35 | t8 | intelligence 将一切 in_progress 判 stalled（不看成员 activity，intelligence.ts:162-166） | **✅ 通过**：owner activity=working → ready/low/score 100 无 stalled 告警；idle/unknown → stalled/medium；3 新用例覆盖三态 | ✅ t8, 2026-08-28 |
| R-34 | t9 | 事件上报静默丢弃（无 warn/计数，events.ts:45-54） | **✅ 通过**：未识别事件 warn 一次/类型去重 + 累计计数；events.test.ts 2 用例绿；P2：模块级计数跨用例累计致顺序依赖，建议 beforeEach 重置 | ✅ t9, 2026-08-28 |
| R-36 | t9 | P4 清理：renderStatus 缺 updatedAt 回退、intelligence .js 导入、removeTeamDir 死导出、delete 文案与归档语义不符 | **✅ 通过**：updated_at 回退（taskElapsedMs claimedAt→updatedAt→0）+ render.test.ts；intelligence .js→.ts 统一；removeTeamDir 删除；delete 文案改"archives under archive/" | ✅ t9, 2026-08-28 |
| R-23补 | t10 | 坏团队跳过补 warn（state 层静默 → 调用层/日志补告警） | **✅ 通过**：state.ts onSkipped 可选回调（id+错误、不传零变化、守卫不放松、ENOENT 不误报）；tools.ts warnSkippedTeamDir 接入 13 调用点；state-find-warn.test.ts 10/10、全量 461 绿、typecheck 0 | ✅ 2026-08-28 |
| live注入方案 | t10 | maxExecPerRole=1 下 live spawn 注入不可达（t2 发现） | **✅ 通过**：docs/live-injection-verify-plan.md 方案 A（patch+2 重启+三观察面+恢复回归）可行写明成本；方案 B（现有检查面复用）零成本已全绿；未改配置未重启 | ✅ 2026-08-28 |
| R-17补测 | t12 | 覆盖盲区补测（snapshot 采集端/panel-geometry/command/scheduler 真链路） | **✅ 通过**：+32 用例（采集端 7 含坏团队 skip+warn、panel-geometry 11 含钳制数值、command 13 含防伪造/边界、scheduler 真链路 1 解除 stub 短路）；纯测试零生产代码变更；全量 525/525、typecheck 0 | ✅ t12, 2026-08-28 |

## 横向门禁（每批必过）

- [ ] 全量测试绿（当前基线 38 文件/443 测试 + 本仓新增用例），typecheck 0 错
- [ ] R-33 重构批：重构前后测试数/结果一致（零漂移量化对比）
- [ ] 政委独立实测门禁 pass（每批 high risk）

## 基线事实（2026-08-28，审阅前）

- R-24 现状：tools.ts:1609-1616 先 readUnreadMailbox 展示（1573/1580）→ 再次 readUnreadMailbox 取 id（1611）→ acknowledgeMailbox（1613-1615）：二次读取存在"新消息未展示即 ack"窗口。
- R-26 现状：tools.ts:475 withTeamLock 回调内含 resolveMemberLlmSelection（510，await LLM）与 spawnMember（529）——锁内网络/子代理操作。
- R-31 现状：scheduler.kickTeam await 于 tools.ts:628(status)/769(create_task?)/1253(update_task)/1468(status 复查)。
- R-28 现状：suggest.ts:170 canonicalRoleKey 仅小写/去空白/去 v 后缀，无中文映射（vs role-limits ZH_EXEC_ROLE_KEY）。
- R-25 现状：resolveTaskTiming（retro.ts:137-150）overrunMs=actualMs-estimatedMs；budget 取 estimateBudgetMs（buildTaskRetro:194）——两者口径需同源。
- R-33 现状：tools.ts:93 suggestAssigneeForTask import、render 函数内联于 tools.ts（1456+）。

## 结论模板

- 通过 / 有条件通过 / 不通过（每批单独结论）
- 必改项（P1）清单 / 建议项（P2）
- 验证证据（命令/测试名/文件行号）
