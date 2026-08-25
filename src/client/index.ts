import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import '@deepseek-ai/dsh-client-ui-layout/client'
import { AgentTeamActivityPanel } from './AgentTeamActivityPanel.js'
import { AgentTeamConversationSummary } from './AgentTeamConversationSummary.js'

export { AgentTeamActivityPanel } from './AgentTeamActivityPanel.js'
export { AgentTeamConversationSummary } from './AgentTeamConversationSummary.js'
export type {
  AgentTeamMemberView,
  AgentTeamMessageView,
  AgentTeamTaskView,
  AgentTeamView,
} from '../contract.js'

export const inject = ['slots']

type ClientContext = Omit<Context, 'sessions'> & { readonly sessions: ISessions }

export function apply(ctx: ClientContext): void {
  const openMember = (memberId: string): void => {
    const sessionId = memberId as SessionId
    const address = ctx.sessions.subagentAddress(sessionId)
    if (address !== undefined) {
      ctx.sessions.openSubagent(address)
      return
    }
    ctx.sessions.open(sessionId)
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-team-activity',
    order: 80,
    inject: () => ({ openMember }),
  }, AgentTeamActivityPanel))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'agent-team',
    order: 80,
    label: () => 'Team',
  }, AgentTeamConversationSummary))
}
