# AgentTeams 成员静默根因调查记录（2026-08-27）

## 现象

团队 `privateize-agent-teams-audit` 中，四名成员（政委/侦察参谋/技术员/质检员）全部"认领任务后静默"：
被唤醒（idle→working→idle），但不产出任何工具调用、不回复、任务无输出。政委尤其明显——收到 3 次门禁复核指令始终未执行 `agent_teams_review_task`。

## 初步误判

曾复盘怀疑是"成员机制问题"或"模型能力问题"。**均不成立。**

## 根因（证据确凿）

**手动指定的 `cc-switch` provider 路由在本环境不可用，LLM 流式传输持续 TRANSPORT 失败。**

证据链：

1. 本次团队所有成员的 `provider=cc-switch, model=gpt-5.6-sol[1M]`（创建时手动传入；`agent_teams_add_member` 曾因 `no adapter registered for provider "openai"` 报错，遂改用 cc-switch）。
2. 成员会话日志（`~/.dsh/sessions/--Users-jade-Desktop-dsh-experimental-agent-team-web--/<subagentId>/session.jsonl.zstd`）显示每个回合：
   - `request/header` = `{"provider":"cc-switch","model":"gpt-5.6-sol[1M]",...}`
   - 随后 `llm/retry` 连续 5 次，全部失败：`"Anthropic stream ended before message_stop" (code: TRANSPORT)`
   - 回合以 `turn/end reason: error` 结束，**从未产出任何 assistant 工具调用**。
3. 消息投递正常：队长→成员消息全部写入 `inbox/*.jsonl`（885~2993 字节），成员确实被唤醒，只是 LLM 调用死在传输层。
4. 对照组：更早的 `refactor-design-team` 团队成员路由为 `deepseek-official`，inbox 有 31KB/10KB/6KB 双向往来，真实产出审计报告。
5. 当前会话 `~/.dsh/settings.yaml` 的 `agent-default-model` = `deepseek-official / deepseek-v4-flash`（reasoningEffort: high）。

## 验证（团队 route-smoke-test，验证完已删队）

- 用 `deepseek-official/deepseek-v4-flash` 显式创建成员：技术员一号秒回「OK，我的路由是 deepseek-official，回合执行正常」。
- 自动创建的政委（同样继承 deepseek-official）成功回复并执行回合。
- risk=high 任务 t1 走完完整闭环：技术员认领→in_progress→提交 completed 被门禁拦截→政委 `agent_teams_review_task(verdict=pass)`→"completion gate open"→技术员标记 completed。
- **结论：deepseek-official 路由下，成员回复、任务闭环、政委门禁复核全部正常。**

## 最终结论

> 根因是**手动给成员指定了本环境不可用的 `cc-switch` 路由（流式传输 TRANSPORT 失败）**，
> 不是成员机制、不是模型能力、不是政委不干活。政委每回合都被唤醒并发出请求，只是死在传输层。

## 操作规范（防复发）

1. `agent_teams_add_member`：除非用户明确要求不同路由，否则**不要手动传 provider/model**（默认继承队长当前路由 `deepseek-official/deepseek-v4-flash`）。
2. 成员静默时先查日志：解压成员会话 `zstd -d session.jsonl.zstd`，看 `llm/retry` 的 failure 是否 TRANSPORT/RATE_LIMIT 等传输层错误，再决定换路由重建，而不是反复向成员发消息。
3. 入队冒烟：成员加入后先发一条「回复 OK」验证回合可执行，再分配正式任务。
4. 队长自身工具调用避免传多余的 `sandbox_permissions`（当前已是 danger-full-access 时该参数会报 "not strictly wider"）。
