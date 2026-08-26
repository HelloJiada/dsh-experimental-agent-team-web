import type { Context } from '@deepseek-ai/cordis'
import { agentTeamProjectionDefinition } from './projection.js'
import { sessionTeamConfigProjectionDefinition } from './session-team-config-projection.js'
import { registerSessionTeamConfigEventTypes } from './session-team-config-events.js'
import { registerUpstreamAgentTeamEventTypes } from './upstream-event-registration.js'

export { agentTeamProjectionDefinition } from './projection.js'
export { sessionTeamConfigProjectionDefinition } from './session-team-config-projection.js'
export type {
  AgentTeamMemberView,
  AgentTeamMessageView,
  AgentTeamTaskView,
  AgentTeamView,
} from './contract.js'
export type { AgentTeamProjectionState } from './projection.js'
export { TeamId } from './agent-team-types.js'

export const inject = ['sessionProjections']

export function apply(ctx: Context): void {
  registerUpstreamAgentTeamEventTypes()
  registerSessionTeamConfigEventTypes()
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(agentTeamProjectionDefinition)
    projectionCtx.sessionProjections.register(sessionTeamConfigProjectionDefinition)
  })
}
