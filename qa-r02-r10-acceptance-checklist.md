# R-02~R-10 修复包验收清单（质检员一号）

对应实施任务：t6（R-02/R-03/R-04）→ t7（R-05/R-06/R-07）→ t8（R-08/R-09/R-10），全部 high risk 走政委门禁。
本清单为验收视角基线，基于实施前代码（HEAD d80387a）实测定位；实施后逐项对照验证。

---

## 验收点 ① awaitingInput 清除路径（R-02，t6）

**现状基线（已实测）**
- `state.ts:810 descriptionAwaitingInput()`：描述含提示词（待确认/待输入/请确认…或独立成行的 ?/？）→ true；空描述 false。
- `state.ts:830 taskAwaitingInput()`：`task.awaitingInput === true || descriptionAwaitingInput(description)`（派生兜底，旧任务免迁移）。
- `tools.ts:707`：create_task 命中提示词时置位 `awaitingInput: true`。
- **无任何清除路径**（update_task 不处理该字段；终结分支只清 blockedByReview）。
- **scheduler.ts 全文无 awaitingInput 引用** → 派单逻辑不区分"等待输入"任务，会派给空闲成员。

**验收点（逐项应有过或用例）**
1. 清除机制语义明确并有测试：
   - update_task 提供清除途径（如显式参数、更新描述后重算、或开始执行即视为已提供输入——以实施文档为准）；
   - **派生兜底交互是核心陷阱**：仅清 flag 不够——若描述仍含"待确认"，`taskAwaitingInput` 会再次返回 true。用例必须覆盖"清除后描述仍有提示词"与"清除后描述同步更新"两种路径的最终判定；
   - 清除后持久化：write→read 后仍为 false；快照不再透出 awaitingInput。
2. 调度器不再派单待输入任务：
   - 空闲成员不会 claim/被派发 awaitingInput 任务；
   - 非 awaitingInput 任务正常派发（不误伤）；
   - helper 派单（nextHelpTask）同样跳过 awaitingInput 任务（等待输入的任务不需要 helper 推）；
   - 队长手动 assignee 指定不受影响（队长决策权保留）。
3. 优先级与终结语义不变：
   - `taskIntermediateFlag` 仍 blockedReview > awaitingInput；
   - 任务终结时 awaitingInput 兜底清除（与 blockedByReview 同款，tools.ts:1118）。
4. 回归：现有 client/task-intermediate.test.ts（9 用例）、src/task-intermediate.test.ts（13 用例）保持绿。

## 验收点 ② 依赖环拒绝（R-03，t6）

**现状基线（已实测）**
- create_task 仅校验依赖**存在**（tools.ts 依赖不存在即抛错），**无环检测**：先建 t1→依赖[t2] 不可能（t2 不存在）；但 a→b、再建 b→a 即成环；间接环 a→b→c→a 同样可能。
- 客户端 relatedTaskIds 有环安全遍历，但那是展示层兜底，服务端应拒绝成环。

**验收点**
1. 直接环（b 依赖 a，再建 a 依赖 b）→ 拒绝，错误信息含"环/cycle"与涉及任务 id；
2. 自依赖（dependencies 含自身 id）→ 拒绝（纵深防御，即便存在性校验先拦）；
3. 间接环（a→b→c→a）→ 拒绝；
4. 合法 DAG（链式/星形/深链）→ 正常创建；
5. **无部分写入**：被拒绝的 create_task 不落盘任何任务，team.json 与 taskSeq 不变（断言磁盘）；
6. 若 update_task/reassign_task 允许改依赖，环校验同样覆盖（以实施范围为准）；
7. 错误信息可操作（告诉队长如何改）。

## 验收点 ③ signals.turns 保真（R-07，t7）

**现状基线（已实测，t2 P2-① 确认）**
- `tools.ts:1097-1101` 状态变更分支：`turns: (signals?.turns ?? 0) + 1` ✓
- `tools.ts:1103-1108` **output-only 分支：`task.signals = { selfReport?, outputBytes }`——turns 被整体丢掉**（不止不 +1，而是重置为 undefined）← 主 bug
- `tools.ts:1110-1115` signal_note 分支：turns 保留但 outputBytes 取旧值或 0。

**验收点**
1. output-only 更新后 turns 保持不变（不重置、不丢失）；
2. 状态变更每次 +1（连续 3 次状态变更 → 3）；
3. signal_note 更新后 turns 保持；
4. 组合序列：in_progress（turns=1）→ 仅 output（turns 仍 1）→ 仅 output（仍 1）→ completed（turns=2），outputBytes=最后一次 output 长度，selfReport 全程保留；
5. 无先验 signals 时 output-only：语义明确（turns undefined 或 0，二选一并测试），快照/面板渲染不崩；
6. 回归：state-timing、tools-suggest-gate、task-timing 测试全绿。

## 验收点 ④ helper 清理（R-06，t7）

**现状基线（已实测）**
- state.ts:141-149 / 196-200：attempt 轮换（invalidate/activate）已清 helper/helperSince/helperEver（按 attempt 语义，helperEver 属当前 attempt）。
- tools.ts:1118 终结分支只清 blockedByReview，**未见清 helper**。
- 客户端 taskHelper()（task-helping.ts）仅展示层隐藏终结任务的 helper，服务端数据仍残留。

**验收点**
1. 任务终结（completed/failed/cancelled）→ 磁盘上 helper/helperSince 清除（快照不再含 helper）；
2. helper 成员被移除（remove_member）→ 其在他任务上的 helper 引用一并清理；
3. 属主恢复工作 → helper stand-down 既有调度逻辑不回归，无 stale helper；
4. helperEver 语义保持：终结 retro 的 hasHelper 标注不受清理误伤（helper 清、helperEver 保留作审计；attempt 轮换语义以现有测试为准）；
5. 回归：scheduler.test.ts（20 用例）绿。

## 验收点 ⑤ 经验库并发原子性（R-08，t8）

**现状基线（已实测）**
- writeBestPractices 已有 withTeamLock + 临时文件 + 原子 rename（replaceFileAtomicOrDirect）；
- **但锁只覆盖"写"，不覆盖"读-改-写"全跨度**：调用方（tools.ts:1123/1606 的 retro_review 等）先 readBestPractices → upsert → writeBestPractices，两个团队并发时读到同一基线 → 后写覆盖先写 → 丢条目（t2 P2-②）。
- upsertBestPractice（best-practices.ts:99 起）合并时保留旧 verdict → 重试任务的新经验被旧校准污染（R-09，t8 同包）。

**验收点**
1. 并发原子性：两个团队（同一 stateRoot）并发 retro_review/经验入库 → **两条经验都在**（Promise.all 双写用例，断言最终数组含两条）；
2. 锁覆盖 RMW 全跨度（read+modify+write 在同一临界区内）——核对实现方式（如 lockedUpdateBestPractices(fn) 或调用方持锁）；
3. 读者永不见撕裂文件：并发读写下 readBestPractices 只返回旧全集或新全集；
4. R-09：同 sourceTaskId 重试任务的新经验 verdict 不被旧值污染（新经验无校准 → 不残留旧 useful/rejected）；
5. 文件权限/编码回归（BOM 兼容、可读）；
6. 回归：best-practices.test.ts（14 用例）、commissar-gate/retro 相关测试全绿。

---

## 测试充分性判据（t6 完成后先行审阅）

对每个修复点，最低要求：**修复对应的负路径用例（旧行为会失败的用例）存在**，且用"修复前代码跑该用例必红"自检。具体：
- R-02：至少 3 个新用例（清除途径、派生兜底陷阱、调度跳过），可落在 src/task-intermediate.test.ts / scheduler.test.ts / tools-suggest-gate.test.ts；
- R-03：至少 4 个新用例（直接环/自依赖/间接环/合法 DAG + 无部分写入断言），可落在 src/tools-suggest-gate.test.ts 或新建 tools-deps.test.ts；
- 若 t6 交付时上述用例缺失或只有 happy path，立即反馈队长与政委，不放行。

（本清单由质检员一号基于 HEAD d80387a 实测代码建立，2026-08-28）
