/**
 * 队长路由覆盖(t12 扩展):AgentTeam 激活时,队长(指挥者)的 LLM 请求按
 * settings.roleDefaults['captain'] 路由——队长职责核心,用好模型(如 gpt)。
 *
 * 实现:监听 `agent/created`(每个 agent 创建时,scoped 到该 agent),在其
 * scoped context 上注册 `agent/request` waterfall——仅当该 agent 是 AgentTeam
 * 队长(captainAgentIds 集合命中)且 captain 配置存在时,改写 provider/model/
 * effort;其他 agent 与普通会话完全不受影响(原样 next())。
 *
 * 边界:①不改会话日志/header 记录(waterfall 是请求前改写,先例 core/agent
 * model-selection.ts);②「恢复默认」清空 captain 覆盖后,队长回落会话模型;
 * ③「恢复默认」清空 captain 覆盖后,队长回落会话模型。
 * ④captain 选 cc-switch(GPT-5.6)时 effort 照常写入(t13:支持 adaptive thinking)。
 * @module dsh-agent-team-web/captain-route
 */

import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** 已知的队长 agent id(agent_teams_create 成功时标记)。 */
const captainAgentIds = new Set<string>()

/** 标记某 agent 为 AgentTeam 队长(create 工具成功后调用)。 */
export function markCaptainAgent(agentId: string): void {
  captainAgentIds.add(agentId)
}

/** 取消队长标记(团队删除/归档时调用,释放内存)。 */
export function unmarkCaptainAgent(agentId: string): void {
  captainAgentIds.delete(agentId)
}

/** captain 配置读取器(settings scope 闭包,apply 期注入)。 */
type CaptainConfigReader = () => { provider?: string; model?: string; reasoningEffort?: string } | undefined

/** 当前是否对该 agent 应用队长路由(集合命中即视为队长;配置存在才覆盖)。 */
function shouldRouteFor(agentId: string, captainConfig: CaptainConfigReader): boolean {
  if (!captainAgentIds.has(agentId)) return false
  const config = captainConfig()
  return config?.provider !== undefined && config?.model !== undefined
}

/**
 * 注册队长路由覆盖:监听 agent/created,对每个 agent 的 scoped context 注册
 * agent/request waterfall——队长且配置存在时改写 provider/model/effort。
 * @param ctx - 插件 context(注入 agents)。
 * @param captainConfig - settings.roleDefaults['captain'] 读取器。
 * @returns 卸载函数。
 */
export function registerCaptainRoute(ctx: Context, captainConfig: CaptainConfigReader): () => void {
  const disposeCreated = ctx.on('agent/created', (payload: { agent: Agent }) => {
    installForAgent(payload.agent)
  })
  // t17:对 apply 时**已存在**的 agent(含当前队长会话)立即注册——当前会话在
  // DSH 启动时已创建,不会触发 agent/created,若不枚举注册则队长自己的
  // agent/request 监听永远缺失,队长请求不会走 gpt(实测 flash 98/gpt 19)。
  // 与 agent/created 监听互补:list() 覆盖存量,agent/created 覆盖增量。
  for (const agent of ctx.agents?.list?.() ?? []) {
    installForAgent(agent)
  }
  return () => {
    disposeCreated?.()
    captainAgentIds.clear()
  }

  /** 对单个 agent 注册 agent/request 路由覆盖(幂等:同 agent 只注册一次)。 */
  function installForAgent(agent: Agent): void {
    const agentId = agent.id
    if (installedAgents.has(agentId)) return
    installedAgents.add(agentId)
    const disposeRequest = agent.ctx?.on(
      'agent/request',
      async (_payload: unknown, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig> => {
        const resolved = await next()
        if (!shouldRouteFor(agentId, captainConfig)) return resolved
        const selected = captainConfig()
        if (selected === undefined) return resolved
        if (selected.provider === undefined || selected.model === undefined) return resolved
        // t13:cc-switch(GPT-5.6)经 anthropic-messages 适配器支持 adaptive
        // thinking,effort 不再置空(恢复写入)。
        const { reasoningEffort: _inherited, ...withoutInherited } = resolved
        return {
          ...withoutInherited,
          provider: selected.provider,
          model: selected.model,
          ...selected.reasoningEffort !== undefined
            ? { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }
            : {},
        }
      },
    )
    // agent disposed 时清理该 agent 的监听与标记。
    const disposeDisposed = agent.ctx?.on('agent/disposed', () => {
      disposeRequest?.()
      unmarkCaptainAgent(agentId)
      installedAgents.delete(agentId)
    })
  }
}

/** t17:已注册过 agent/request 监听的 agent id(防 list()+agent/created 重复注册)。 */
const installedAgents = new Set<string>()
