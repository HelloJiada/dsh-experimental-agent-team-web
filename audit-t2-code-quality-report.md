# AgentTeam 框架代码质量与潜在 Bug 审查报告（任务 t2）

- 审查人:技术员一号（engineer）
- 审查范围:src/ 全部服务端模块(17 个) + 关键 client 纯函数模块;测试基线:41 个测试文件 / 362 个用例全部通过(vitest run,exit 0)
- 审查维度:纯函数纯度 / 边界条件 / 时间处理 / 并发安全 / 错误处理 / 已知缺口
- 严重度:P1(高)=0,P2(中)=7,P3(低)=6,P4(提示)=5

---

## 一、P2 中等问题(7 个)

### P2-1 update_task 仅写 output 时丢弃 signals.turns 计数
- 位置:`src/tools.ts:1077-1083`(对比 `1084-1090` 的 signal_note 分支保留了 turns)
- 复现路径:claim → `update(status=in_progress)`[turns=1] → `update(output=...)`[turns 被整个对象替换、字段消失] → `update(status=completed)`[turns=(undefined??0)+1=1]。真实状态变更 2 次,面板只见 turns=1。
- 根因:`else if (args.output !== undefined)` 分支重建 signals 对象时只保留 selfReport 与 outputBytes,漏掉 turns;而 `if (args.status !== undefined)` 分支与 signal_note 分支都保留 turns——三个分支口径不一致。
- 修复建议:output-only 分支改为 `{ turns: task.signals?.turns, outputBytes: args.output.length, ...selfReport?{selfReport}:{} }`,并补一条工具级测试(见第六节)。

### P2-2 best-practices 全局库"读-改-写"非原子,跨团队并发丢条目
- 位置:`src/tools.ts:1123-1124`(update_task 蒸馏)与 `1606-1617`(retro_review);`src/best-practices.ts:76-96`(writeBestPractices 只在写入段加 `best-practices:${stateRoot}` 锁)
- 复现路径:团队 A、B 同时 terminal 各自任务。A 读库 v1 → B 读库 v1 → A 写 v1+A → B 写 v1+B,A 的经验条目被覆盖丢失。readBestPractices 全程无锁,锁只保护 write 本身,不保护 read-modify-write 周期。
- 修复建议:在 best-practices.ts 提供原子入口(如 `mutateBestPractices(stateRoot, fn)`),把"读→upsert→写"整体放入 `withTeamLock('best-practices:…')` 内;tools 侧改为调用该入口。

### P2-3 upsertBestPractice 保留旧 verdict,重试任务的新经验被旧校准污染
- 位置:`src/best-practices.ts:99-119`
- 复现路径:任务 t1 attempt1 生成经验 E1 → 队长校准 useless(剔除语义)→ 任务被 reassign 重试,attempt2 生成新 retro/新 practice E2 → upsert 按 (teamId, taskId) 合并,**verdict='useless' 原样保留**、practice 换成 E2 → E2 永远被 `selectBestPracticesForRole` 过滤、也再不会出现在校准列表,新经验静默作废。
- 同理 verdict='useful' 时,E2 未经复核即被当作"已确认经验"注入成员 persona。
- 修复建议:合并时若 practice 文本变化,verdict 重置为 'pending'(或条目 key 带上 attempt,按 attempt 区分新旧经验)。

### P2-4 调度器帮助派单成功后向 owner 邮箱追加消息未加锁
- 位置:`src/scheduler.ts:437`(`appendMailbox(stateRoot, team.id, ticket.ownerName, message)`,位于团队锁外;锁内版本见 324 行)
- 复现路径:帮助派单落地 → 通知 owner 的邮箱 append;同时另一成员 send_message 也向同一 owner 邮箱 append(在团队锁内)。appendMailbox 是"读整文件→拼→原子写"的读-改-写,两条并发路径可能读到同一旧内容,后写覆盖先写 → 一条消息丢失。
- 修复建议:该处包一层 `withTeamLock(teamLockKey(...))`;或让 appendMailbox 内部自带按文件路径的串行化(与 withTeamLock 同构的 per-file promise chain)。

### P2-5 移除政委后无法按标准路径重新添加(名称永久被占)
- 位置:`src/tools.ts:478`(名字查重不看 status)vs `481`(角色查重看 status);死路入口在 `tools.ts:1055` 的错误文案("add one with agent_teams_add_member(role=commissar) first")
- 复现路径:remove_member('政委') → 政委 status='removed' → 门禁任务完成被拦截,报错引导重加政委 → add_member(role='commissar', 名字缺省解析为 '政委') → 名字查重命中已移除成员 → 拒绝。唯一的变通是传自定义名(如 name='政委二号'),未文档化且不直观。
- 修复建议:名字查重排除 `status === 'removed'` 的成员(邮箱历史由 retired 索引另行处理);或禁止移除政委并在 remove_member 报错。

### P2-6 awaitingInput 中间态半成品:调度器不尊重、标记永不可清除
- 位置:置位 `tools.ts:707`;派单 `scheduler.ts:105-111`(nextReadyTask 不检查 awaitingInput);认领 `tools.ts:884-930`(claim_task 不检查);全代码无任何清除 awaitingInput 的路径(任务描述也不可改,而 `taskAwaitingInput` 按描述派生兜底)
- 复现路径:create_task 描述含"待确认:目标平台" → 任务标记 awaitingInput → 空闲成员仍被自动派单认领 → 成员因缺输入停滞;标记永久显示"待输入"。
- 修复建议:二选一——(a) nextReadyTask/claim_task 跳过 awaitingInput 任务,并增加"队长确认输入"的清除机制(如 update_task 增加 `input_answered` 参数或任务描述可编辑);(b) 若仅为展示性标记,明确文档化并至少让调度器不派单。

### P2-7 移除/删除/归档成员时不清除其遗留的 helper 标记
- 位置:`tools.ts:596-601`(remove_member)、`1791-1797`(delete)、`close-route.ts:128-137`(prepareTeamForArchive)——三处都只处理 `assignee === member.name`,不处理 `helper === member.name`
- 复现路径:成员 H 正以 helper 身份协助任务 t(owner 停滞)→ 队长移除 H → t.helper / helperSince 残留 → `isHelppableTask`(scheduler.ts:132)永远拒绝再帮助 t;快照持续显示"helped by 已移除成员";t 的 helperEver 永久为 true(复盘标注"有 helper 介入"虽属实,但后续帮助通道被堵死)。
- 修复建议:三处移除路径统一追加 `if (task.helper === member.name) { task.helper = undefined; task.helperSince = undefined }`。

---

## 二、P3 低等问题(6 个)

### P3-1 单个团队文件损坏毒化整个工作区的 agent_teams_* 工具
- 位置:`state.ts:220-234`(readTeam 校验失败抛错)+ `tools.ts:181-196`(findTeamByCaptain/Participant 遍历全部团队目录,任一损坏即抛);对比 `snapshot.ts:363`(collectTeamsActivity 对坏团队 skip+log)
- 影响:一次半截直写(Windows 降级路径崩溃)或手工编辑出错,该工作区所有团队的所有工具不可用,且 delete 也走同一查找,无工具级恢复路径。
- 修复建议:find* 循环内对单个团队 readTeam 失败 skip+logger.warn(与面板一致),或提供显式的团队级恢复/删除工具。

### P3-2 旁路(经验库)写失败阻塞主路径(任务终结)落盘(按政委复核修正)
- 位置:`tools.ts:1123-1124`(readBestPractices + writeBestPractices)先于 `1131`(writeTeam)执行;库写抛错会中止整个 update_task
- 真实问题:经验库(旁路增强)写失败时,任务的终结状态(completed/failed + retro + signals)根本不会被持久化到 team.json——不是"任务已落盘、经验丢失",而是"任务从未落盘"。影响:任务在磁盘/面板上保持 in_progress,成员收到与"已完成"事实矛盾的报错;若库文件持续不可写(磁盘满/权限),任务将永远无法终结——每次重试都在同一处失败,旁路功能反过来锁死核心流程。
- 重试行为:重试时从磁盘重读,任务未终结、retro 未生成,会重新走完整终结分支并重新蒸馏——因此原稿"经验永久丢失"的表述不成立,修正为上述"旁路阻塞主路径"问题。
- 修复建议:(a) 调整顺序:先 writeTeam 持久化任务终结,再 best-effort 写经验库(try/catch → logger.warn,失败不阻塞主路径);(b) 至少把 writeBestPractices 移到 writeTeam 之后并降级为告警。

### P3-3 status 的成员邮箱"未展示即已读"竞态窗口
- 位置:`tools.ts:1505-1510`(展示读)与 `1536`(ack 集合重读)之间到达的新消息会被 ack,但从未在 member_inboxes 展示;若其 live 投递也已失败(纯 mailbox 投递),成员将永远看不到该消息。
- 修复建议:只 ack 展示过的那批 message id(复用第一次读取的数组),不要二次读取。

### P3-4 estimate_level 与 estimate_ms 冲突时复盘摘要自相矛盾
- 位置:`retro.ts:146-149`(overrunMs 用 estimatedMs)、`195`(overran 用等级预算)、`210-227`(摘要偏差文本用 estimatedMs)
- 复现:create_task 同时给 estimate_level='S'(预算 15m)与 estimate_ms=20m,实际 18m → overran=true("任务超时完成")但摘要写"提前 2 分钟"。两个口径打架。
- 修复建议:摘要偏差与超时判定统一使用同一预算口径(等级优先);两者都缺时才各用各的。

### P3-5 团队锁持有时间跨越网络操作
- 位置:`tools.ts:500-530`(add_member 在团队锁内 await LLM resolveCallConfig + startContinuable)、`1053` + `commissar-gate.ts:69`(update_task 门禁在团队锁内 await 政委 live 唤醒)
- 影响:上述操作可能耗时秒级,期间同团队所有工具(含 status)被阻塞。
- 修复建议:锁内只做状态判定与持久化;spawn / live 唤醒移到锁外(复用 reassign 的"锁内准备 → 锁外执行 → 锁内校验提交"两段式模式)。

### P3-6 进程内锁不覆盖多进程共享同一 workspace
- 位置:`state.ts:32, 40-51`(locks 为进程本地 Map)
- 影响:两个 harness 进程(如同一 workspace 的双实例)并发写 team.json/邮箱/retired 索引时,atomic rename 保证不损坏文件,但不保证不丢"后写覆盖先写"的更新。
- 修复建议:文档化"单进程"假设;如需多进程,改用文件锁(mkdir 哨兵 + 过期重试)。

---

## 三、P4 提示项(5 个)

1. `tools.ts:1893` renderStatus 只把 `{ claimedAt }` 传给 taskElapsedMs,缺 updatedAt 回退 → 旧团队 in_progress 任务显示 "used 0m" 而非近似耗时(快照路径 249 行有回退,展示路径没有)。
2. `vitest.config.ts` 无 include/exclude,把 `.claude/worktrees/agent-*/` 内的重复测试副本也一并执行(41 文件 362 用例中有重复),套件耗时翻倍且副本可能过期。
3. `intelligence.ts:11-14` 使用 `.js` 导入扩展名,其余模块用 `.ts` —— 风格不一致(可正常工作,建议统一)。
4. `state.ts:887` `removeTeamDir` 无调用方(死导出;delete/close 均走 archiveTeamDir)。
5. 文案一致性:`tools.ts:1765` delete 描述为 "deletes the team's state directory" 实际执行归档(与 close-route 语义一致,建议改文案);`tools.ts:1734` best_practices 的 `total` 是过滤后计数,与"库总量"语义有偏差。

---

## 四、六个重点维度的结论

### 1) 纯函数纯度 —— 合格
retro.ts / suggest.ts / best-practices.ts / archive-filter.ts 均为真纯函数:无 I/O、无模块级可变状态、确定性可单测。唯一的非确定性是 `buildTaskRetro` / `upsertBestPractice` / `updateBestPracticeVerdict` / `distillBestPractice` / `filterArchivedTeams` 的 `now = Date.now()` 默认参——全部提供显式 `now`/时间参数,测试可注入,属可接受模式。
- 注意点:suggest.ts 关键词为子串匹配,英文词存在误命中('qa' ⊂ equal/squad、'data' ⊂ database、'write' ⊂ rewrite、'code' ⊂ encode),置信度按命中计数,风险低可容忍;中文词无此问题。
- 进程级隐藏状态(locks / parkedAttempts / memberQueues / skippedEventTypes)均受控、有界、有清理逻辑,无泄漏迹象。

### 2) 边界条件 —— 良好,发现 3 个缺口
- 无 claimedAt:taskElapsedMs 回退 updatedAt、finalizeTaskTiming/resolveTaskTiming 不产损坏数据(state-timing.test.ts 有覆盖)✓
- 无预估/无预算:estimateBudgetMs → undefined → 不判超时;无预估任务仍生成复盘(cause=other)✓
- 无复盘:update_task 幂等;retro_review 报"no retrospective yet"✓
- 空依赖:可认领 ✓;依赖指向不存在的任务在 create_task 被拒 ✓;依赖指向 failed/cancelled 任务会永久阻塞,但可经 reassign 重试依赖本身恢复 ✓
- 并发认领:团队锁内重读,第二认领者被 assignee 校验拒绝;同 assignee 幂等返回同一 attemptId ✓
- attempt 轮换:invalidate 清 attemptId、reassign 两阶段用 handoffId 防旧结果覆盖 ✓
- 缺口:P2-6(awaitingInput 不拦截派单)、P2-7(移除 helper 残留)、P3-3(status ack 竞态)。

### 3) 时间处理 —— 合格
全链路统一毫秒、统一 Date.now()(无秒/毫秒混用);旧数据兼容通过"自成长字段全可选 + 按形状校验"实现,state-timing.test.ts 覆盖旧/新/损坏三类读取。唯一口径不一致是 P3-4(等级预算 vs 内部毫秒)。

### 4) 并发安全 —— 良好,1 个漏网
- 逐点核对 15 处 writeTeam 调用点全部在团队锁内 ✓;recordRetiredMemberIds 自带锁 ✓;createTeamDir 在 captain+team 双层锁内 ✓
- 锁顺序恒为 captain → team → best-practices,无反向嵌套,无死锁 ✓
- 唯一未加锁写路径:scheduler.ts:437 的 appendMailbox(P2-4)
- 跨进程假设未文档化(P3-6)。

### 5) 错误处理 —— 良好,2 个静默失败
- 工具抛错信息质量高且可操作(含中文提示、下一步指引)✓
- 吞错均带日志或文档化:steerCaptainReport→false、deliverToMember→false+warn、interruptMember→warn、appendTeamEvent→warn、retired 索引失败→catch 后继续(create/add_member 回滚路径)✓
- 真实静默失败:P3-2(旁路经验库写失败阻塞任务终结落盘,任务保持 in_progress)、P3-3(未展示消息被 ack)。

### 6) 已知缺口
- tools 级集成测试已部分补齐:`tools-suggest-gate.test.ts` 覆盖 create_task 建议字段、status 建议展示、门禁拦截→blockedByReview→pass/reject 全链路(该文件头部明确写"政委与 QA 指出的同一类缺口"的补强意图)。
- 仍未覆盖的 tools 级流程:claim→update 全生命周期(attempt_id 校验、signals turns、复盘生成+经验蒸馏)、reassign 两阶段(handoffId 校验、stale 拒绝)、send_message(邮箱租约/delivered 三态)、retro_review(useful/useless/revised 与库同步)、remove_member(requeue+helper 清理)、delete(归档+退休)。这些目前只靠 gitignored 的 qa-*.mjs 手工探针,不在自动化套件内。
- 本报告的 P2-1、P2-3、P2-6 三个 bug 均无测试覆盖,建议随修复补测试。

---

## 五、总体评价

框架代码质量整体高:纯函数边界清晰、JSON 边界校验完备(isTeamTask/isTeamState 等)、状态机严格(TASK_TRANSITIONS)、锁使用系统化且顺序一致、错误信息可操作、362 个用例全绿。未发现 P1(主线数据损坏/高危安全)问题;7 个 P2 集中在"闭环缺口"(中间态语义、并发原子性、状态清理)与"口径不一致",均为可快速修复的局部问题,建议按 P2-1→P2-7 顺序修复并补对应测试。
