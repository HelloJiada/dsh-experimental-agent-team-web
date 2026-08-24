import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AgentTeamWorkspace } from './AgentTeamWorkspace.js'

export { AgentTeamWorkspace } from './AgentTeamWorkspace.js'
export type {
  AgentTeamMemberView,
  AgentTeamMessageView,
  AgentTeamTaskView,
  AgentTeamView,
} from '../contract.js'

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'agent-team',
    order: 80,
    label: () => 'Team',
  }, AgentTeamWorkspace))
}
