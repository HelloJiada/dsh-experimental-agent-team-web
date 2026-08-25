import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { qualifiesForActivityPanel } from './activity-panel-view.js'
import { openAgentTeamActivityPanel } from './activity-panel-events.js'

type AgentTeamConversationSummaryProps = Pick<ConvViewProps, 'useProjection'>

export function AgentTeamConversationSummary({ useProjection }: AgentTeamConversationSummaryProps): JSX.Element | null {
  const team = useProjection('agentTeam')

  if (team === undefined || team === null || !qualifiesForActivityPanel(team)) return null

  return (
    <section>
      <p>
        Team {team.teamId} · Health {team.summary.healthScore}/100 · {team.summary.statusLabel}
      </p>
      <p>
        {team.summary.inProgressTaskCount} active task{team.summary.inProgressTaskCount === 1 ? '' : 's'}
        {' · '}
        {team.summary.blockedTaskCount} blocked task{team.summary.blockedTaskCount === 1 ? '' : 's'}
      </p>
      <button type="button" onClick={openAgentTeamActivityPanel}>
        Open team activity
      </button>
    </section>
  )
}
