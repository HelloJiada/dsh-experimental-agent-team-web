import type { Context } from '@deepseek-ai/cordis'
import { agentTeamProjectionDefinition } from './projection.js'
import { registerUpstreamAgentTeamEventTypes } from './upstream-event-registration.js'

export { agentTeamProjectionDefinition } from './projection.js'
export type {
  AgentTeamMemberView,
  AgentTeamMessageView,
  AgentTeamTaskView,
  AgentTeamView,
} from './contract.js'
export type { AgentTeamProjectionState } from './projection.js'

export const inject = ['sessionProjections']

export function apply(ctx: Context): void {
  registerUpstreamAgentTeamEventTypes()
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(agentTeamProjectionDefinition)
  })
}
