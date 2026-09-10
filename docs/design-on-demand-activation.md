# 设计:按需加载(on-demand activation)

> 状态:已实现(`src/activation.ts`)。本文记录为什么这么做、机制依赖哪些宿主契约、
> 实测收益,以及**尚未被测试覆盖**的部分,便于后续回归时判断风险面。

## 1. 问题:未使用的会话也在付费

改造前,插件在 `apply()` 里做两件全局的事:

1. `ctx.tools.register(...)` × 14 —— 14 个 `agent_teams_*` 工具的 schema;
2. `ctx.systemPrompt.section({ name: 'agent-teams:usage', text: 完整队长协议 })`
   —— 一段 5.5k 字符的协议正文。

两者都在**插件根上下文**注册,于是这个 profile 下**每个 workspace、每个会话、
每一次请求**都驮着它们,哪怕该会话从不使用 AgentTeams。

实测(方法:把注册项按 `{name, description, parameters}` 序列化取字符数 ÷ 4,
与会话 `request/header` 的统计口径一致):

| | 字符 | ≈ tokens/请求 |
|---|---|---|
| 14 个工具 schema | 13,544 | 3,386 |
| 协议 section | 6,098 | 1,525 |
| **合计** | **19,642** | **4,911** |

会话日志侧也印证了这一点:两场**一次都没调用** AgentTeams 的普通对话
(09-09 11:39 / 18:40,分别 63 次与 112 次工具调用,agent_teams 调用数均为 0),
头部却各带 13 个 `agent_teams_*` 工具定义。

## 2. 机制:装进「调用方 agent 自己的作用域」

宿主契约(逐条在 harness 源码/测试中核实,路径相对 `deepseek-harness/`):

| 依赖的契约 | 证据 |
|---|---|
| `Agent.ctx` 是公开 API,agent-local,随 agent 释放回卷 | `packages/core/agent/src/runtime-types.ts:173-174` |
| 工具注册按其 `ctx` 的 scope 分层;`agent.ctx.tools.register` 只进该 agent 的层 | `packages/core/tools/src/index.ts:1021-1052` |
| 子 scope **继承**祖先 scope 的注册(成员因此有团队工具) | `packages/core/tools/tests/scoped.spec.ts:215-219` |
| 作用域 section 同名**遮蔽**全局 section(且被遮蔽的 provider 不求值) | `packages/core/system-prompt/src/index.ts:441-446,568-569`;`system-prompt/tests/scoped.spec.ts:66-79` |
| 每步重新组装工具面,故中途注册下一步即生效 | harness 侧:scope 层按需创建/销毁;本机会话日志:同一会话内工具集合确实变化(含禁用某插件后当场少 8 个工具) |
| **同形态的现成先例** | `packages/experimental/tool-agent-team/src/index.ts:159-172`(`const scoped = agent.ctx` + `scoped.tools.register` + `scoped.systemPrompt.section`) |

⚠️ `restrict()` **不能**用来做「全局默认隐藏」:`tools/src/index.ts:1064` 明确
拒绝无 scope 的调用("a context-global restriction would mask every agent")。
所以本设计不注册全局再隐藏,而是**根本不全局注册**。

### 结构

```
apply(ctx)                                   # src/index.ts
├── installAgentTeamsRuntime(ctx, config)    # 进程级 hook,只装一次(零模型可见成本)
│     调度器 / 成员档位运行时 / 成员状态守卫 / 退休成员守卫
└── registerAgentTeamsActivation(ctx, ...)   # 常驻的两个小件(见下)
      ├── 提示 section "agent-teams:usage"  (~605 字符)
      └── 工具 agent_teams_activate          (~461 字符)

activateAgentTeams(agent, config, order, runtime)   # src/activation.ts,幂等
├── registerAgentTeamsTools(agent.ctx, ...)  # 14 个工具 → 该 agent 的层
└── agent.ctx.systemPrompt.section({
        name: 'agent-teams:usage', text: 完整协议 })  # 同名遮蔽提示段
```

三个激活入口都落到同一个幂等函数:

- `agent_teams_activate` 工具(自然语言路径;工具结果只回一句很短的话,协议由
  遮蔽后的 section 提供,不重复灌进上下文);
- `/agent-teams <goal>` 斜杠命令(handler 拿到 `invocation.agent`);
- `agent/pre-step` 手势边界(无命令裁决的 headless 面;payload 直接带 `agent`)
  —— 激活发生在该 step 的请求组装**之前**。

### 为什么运行时留在根层

`installAgentTeamsRuntime` 里的四个安装是进程级 hook:**没有模型可见成本**,但
必须活过单个队长会话。若挪到激活期:第二次激活会重复包装 subagent 的
`followup`、起第二个调度器;并且队长作用域释放时会连带拆掉别的会话要用的调度器。

## 3. 收益(实测)

| | tokens/请求 |
|---|---|
| 改造前(所有会话) | 4,911 |
| 改造后 · 未激活会话 | 267(激活工具 115 + 提示 151) |
| 改造后 · 已激活会话 | 与改造前相同 + 一次约 75 tokens 的激活结果 |

**未激活会话削减 94.6%。**

## 4. 已知边界 / 未覆盖项

- **`toolOrder` 兼容性**:`toolOrder` 里点名一个「完全没注册」的工具会让
  assembly 失败(`system-prompt/src/index.ts:216-219`;`wireSchemas` 的
  `knownNames` 是**过滤前**集合,所以「注册了但被 restrict 掉」仍满足校验)。
  本设计未激活时这 14 个名字**不在**注册表里,因此**若某个 profile 的
  system-prompt 配置在 `toolOrder` 中列出这些名字,未激活会话会组装失败**。
  本机 `~/.dsh` 全部配置与该 profile 的 node_modules 中均无 `toolOrder`
  (已核查),故当前无影响。要支持这种配置,可改用「全局注册 + 每 agent
  `deny` 限制」的形态(代价是复杂度和一个 agent 创建竞态)。
- **会话中途注册进 `agent.ctx` 没有 harness 专用测试**:现有测试覆盖的是
  scope 创建期(`setup`)与 `agents.create()` 之后、首轮之前。机制上没有
  session-start 闸门,且 MCP 客户端在运行期整代替换工具面;本机日志也显示工具
  集合在同一会话内变化过。但「第 N 轮注册 → 第 N+1 轮可见」目前靠的是机制推断
  与实测,不是 harness 自带断言。
- **重启/热重载中途的团队**:注册随 agent 作用域存活,进程重启后需要再次激活
  才会恢复工具面(团队状态在磁盘上不受影响)。提示段已说明可再次调用
  `agent_teams_activate`。
- **成员继承**由 harness 保证(见上表),本仓库的 `activation.test.ts` 用桩层
  验证的是「注册到哪一层」,不是继承本身。

## 5. 回归锚点

`src/activation.test.ts` 锁的是**成本分界**这个契约本身:

- 根层只有「提示段 + 激活工具」,14 个团队工具一个都不在;
- `TEAM_TOOL_NAMES` 与实际注册集**逐字一致**(这条抓到过一次真实缺陷:协议末尾
  的 `Tools:` 行漏了 `agent_teams_set_mode`,而工具其实注册了);
- 激活装进调用方 agent 的层,根层不变(其他会话继续只付提示);
- 重复激活幂等(false、不抛 duplicate);
- 两个 agent 各自独立;
- 无 `exec.agent` 时明确报错,不静默成功。
