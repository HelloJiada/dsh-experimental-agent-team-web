# R-13~R-22 阶段 D/E 验收清单（质检员一号）

对应任务：t9（R-17/R-18，警卫员一号）→ t10（R-19/R-20/R-21，警卫员一号）；t11（R-13/R-14，技术员一号）→ t12（R-15/R-16，技术员一号）。
本清单基于 HEAD fd41f98 实测代码建立；实施后逐项对照验证，结论同步政委做独立实测。

---

## 阶段 E：安全硬化（t9/t10，警卫员一号）

### 验收点 ① R-17 路由鉴权裁剪（t9）

**现状基线（已实测，对应 t4 H-1）**
- `GET /plugins/agent-team-web/state`（index.ts:198-220）：**无鉴权**，返回 `{ teams: snapshots }`。
- `TeamActivitySnapshot`（snapshot.ts:106-125）暴露敏感字段：
  - `captainSessionId`（111 行，来自 state.captainSessionId 266 行）——队长会话泄露；
  - `members[].id`（230 行）= 成员子代理会话 id——子代理地址泄露；
  - `captainInbox: TeamActivityMessage[]`（99-103 行）含 `content` 全文——收件箱内容泄露；
  - 另含 `bestPractices`、`intelligence`、`calibration`（面板自成长区块所需）。
- `POST /plugins/agent-team-web/close`（handleCloseTeam）：t4 指出"仅凭泄露值授权即可归档任意团队"。

**验收点**
1. /state 响应体**不含**：captainSessionId、成员会话 id（member.id）、收件箱消息 content（或整体裁剪 captainInbox）；
2. **面板数据完整**：teamId/name/description、members（name/role/status/activity 等面板渲染字段）、tasks（id/subject/status/assignee/estimate/timing/signals/retro）、archived=1 时归档团队、intelligence/bestPractices/calibration 若面板消费则保留——用一个"响应字段白名单断言"锁住完整性（不允许"剪秃"导致面板白屏）；
3. 鉴权方案（若为会话绑定/信任栅栏）：未授权调用被拒（401/403 或等价），合法调用正常；/close 同样受控，不能凭任意泄露值归档团队；
4. 若裁剪 member.id 影响面板导航（openMember 依赖会话 id），方案须自洽（如改为仅暴露导航所需最小引用或走已鉴权通道）——以实施文档为准，但必须有用例锁定"面板导航所需数据仍在"；
5. 回归：现有 close-route.test.ts（16 用例）与 client-bundle.spec.ts 绿。

### 验收点 ② R-18 成员工具面 deny + 状态目录隔离（t9）

**现状基线（已实测）**
- members.ts:29-36 `MEMBER_DENIED_TOOLS` 已 deny 6 个：create / add_member / remove_member / reassign_task / create_task / delete；
- members.ts:456 spawnMember 已应用 `toolFilter: { deny: [...] }`；
- 成员仍共享完整文件面（t4 H-2："state 只读"仅劝告无强制，可直改 team.json 绕过门禁与 attempt_id）；tools.ts 的 requireCaptain 是运行时兜底。

**验收点**
1. deny 生效：成员（非队长/非政委）工具清单不含被 deny 工具——**spawn 级断言**（startContinuable 收到的 toolFilter 内容）或运行时等价断言；
2. 运行时兜底不回归：成员直接调用被 deny 工具 → 被拒（requireCaptain 路径），错误信息可操作；
3. **不破坏正常协作**：成员仍可用 claim_task / update_task（自己的 attempt）/ send_message / status；政委仍可用 review_task；队长工具面不受影响——用正常协作全链路用例锁定（认领→更新→完成）；
4. 状态目录隔离（若实施）：成员视角看不到/写不了 team.json 直改路径（只读投影或权限收紧），且现有成员工作流（通过工具操作）不受影响；
5. deny 清单与角色职责一致性：commissar 不被 deny review_task；成员不被误 deny 协作必需工具；
6. 回归：tools-suggest-gate / tools-intermediate-cycle / scheduler 测试全绿。

### 验收点 ③ R-20 经验注入门控（t10）

**现状基线（已实测）**
- members.ts:389 persona 注入 "Team memory (from the global best-practices library…)"；
- best-practices.ts:216-236 `selectBestPracticesForRole`：角色匹配 + **排除 useless** + 冷启动守卫（<MIN 样本 → []）+ verdict 排序（useful>revised>pending）+ 上限 MAX 条。
- 注入内容源自成员 retro_note（t4 M-2：跨团队提示注入向量）。

**验收点**
1. 门控收紧（以实施文档为准）：注入仅限已验证条目（useful/revised；pending 是否允许注入须有明确决策并测试）；
2. **提示注入防护**：恶意 retro_note 内容（如 "ignore previous instructions"）不得原样注入他人 persona 造成越权——至少要有来源标注+门控，注入内容被包在明确框架内；用例覆盖恶意样本；
3. 现有守卫不回归：角色匹配、冷启动（<2 样本不注入）、上限 3 条、useless 排除——best-practices.test.ts（14 用例）与 members-persona.test.ts 全绿；
4. 注入对正常成员（无经验库时）降级为通用 persona——不崩、不注入空模板。

### 验收点 ④ R-19/R-21 低危加固（t10，顺带）

- R-19 文件权限（t4 M-1：team.json 0644 世界可读 → 0600/0640）：写盘后权限断言；
- R-21 其余低危项以实施文档为准，逐项对照。

---

## 阶段 D：补测（t11/t12，技术员一号）

### 验收点 ⑤ R-13 9 工具集成测试断言质量（t11）

覆盖工具：create / add_member / remove_member / reassign_task / claim_task / send_message / retro_review / best_practices / delete（tools.ts 33.55% 的零覆盖面）。测试基建复用 tools-suggest-gate 的桩 ctx + 磁盘状态模式（桩面扩展见 qa-test-coverage-regression-report.md §8 / 我的桩梳理消息）。

**断言质量最低要求（逐工具）**
1. **磁盘落盘断言**：每个工具至少一个用例断言落盘结果（team.json / inbox/*.jsonl / best-practices.json / archive/），不能只断言返回值；
2. **错误分支**：每个工具至少一个失败用例——权限（非队长调 create/delete/retro_review 等）、未知成员/任务、参数非法、状态非法迁移；断言错误信息可操作；
3. 关键语义用例（我此前映射的）：
   - create：团队目录+team.json 创建、重复团队报错；
   - add_member：角色上限（maxExecPerRole=1）、commissar 唯一、**spawnMember 4 个前置校验失败分支**（provider 缺失/不支持 persona/不支持 toolFilter）、best-practices 记忆注入；
   - claim_task：认领计时（claimedAt 落盘）、重复认领拒绝；
   - reassign_task：**stale-attempt 语义**（旧 attempt_id 更新被拒）；
   - send_message：邮箱落盘（inbox/*.jsonl 内容断言）；
   - retro_review：校准写 best-practices.json + verdict 生效；
   - best_practices：查询返回 + renderBestPractices 文本；
   - delete：团队迁入 archive/（quiesce 桩：成员离线以快速通过 waitForMemberIdle）；
   - remove_member：成员 status=removed 落盘 + 其任务/helper 引用清理（t7 已有部分，补全工具级）。
4. 负路径必红自检：新建行为锁定用例（修复前无此工具测试，谈不上必红；但**行为契约**要与实现一致——如 remove_member 的 requeue 语义、reassign 的 attempt 作废）。

### 验收点 ⑥ R-14 update_task 分支补测（t11）

- 正常完成路径（非门禁）：completed 后 retro 生成、actualMs/overrunMs 结算、signals 最终值；
- failed / cancelled 路径；signal_note 独立分支；无活跃政委门禁报错（已有 1 例，补全）。

### 验收点 ⑦ R-15 ActivityPanel JSX 测试（t12）

- 中间态徽标渲染（blockedReview/awaitingInput/calibration）、归档筛选 UI 交互、DependencyMap 基础渲染、面板开合；
- 纯函数提取建议：taskTone/healthLevel/loadBarFor/compactTaskLabel/taskSummary 可先单测（若未提取则组件测试覆盖）；
- testing-library 已装未用——验收时不强制全组件，但至少覆盖"徽标条件→渲染结果"映射与筛选交互。

### 验收点 ⑧ R-16 members 补测（t12）

- spawnMember / interruptMember / memberWelcome / modelSelection / resolveMemberLlmSelection / withPending（members.ts 24.28% 的零覆盖面）；
- **docs 角色 persona 用例**（4a1822f 恢复 docs 模板后 members-persona.test.ts 仍缺 docs 用例——此前 t3 已指出）。

---

## 放行判据（每任务）

- 每个修复/补测点存在负路径或契约锁定用例（修复前必红 or 行为契约与实现一致）；
- 全量 vitest + typecheck 绿（当前基线 301 tests / 27 files）；
- 我逐项核对后同步政委独立实测，门禁 pass 后放行。

（本清单由质检员一号基于 HEAD fd41f98 实测代码建立，2026-08-28）
