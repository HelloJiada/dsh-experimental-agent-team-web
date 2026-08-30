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
 * ③captain 选 cc-switch(GPT-5.6)时 effort 置空(t8 适配:不支持 reasoning)。
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
    const agent = payload.agent
    const agentId = agent.id
    // 在该 agent 的 scoped context 上注册 waterfall(仅收到自己的请求)。
    const disposeRequest = agent.ctx?.on(
      'agent/request',
      async (_payload: unknown, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig> => {
        const resolved = await next()
        if (!shouldRouteFor(agentId, captainConfig)) return resolved
        const selected = captainConfig()
        if (selected === undefined) return resolved
        if (selected.provider === undefined || selected.model === undefined) return resolved
        // t8:cc-switch(GPT-5.6)不支持 reasoning effort → 不写 effort。
        const { reasoningEffort: _inherited, ...withoutInherited } = resolved
        return {
          ...withoutInherited,
          provider: selected.provider,
          model: selected.model,
          ...selected.reasoningEffort !== undefined && selected.provider !== 'cc-switch'
            ? { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }
            : {},
        }
      },
    )
    // agent disposed 时清理该 agent 的监听与标记。
    const disposeDisposed = agent.ctx?.on('agent/disposed', () => {
      disposeRequest?.()
      unmarkCaptainAgent(agentId)
    })
    // scoped ctx 卸载时兜底清理。
    return () => {
      disposeRequest?.()
      disposeDisposed?.()
      unmarkCaptainAgent(agentId)
    }
  })
  return () => {
    disposeCreated?.()
    captainAgentIds.clear()
  }
}
