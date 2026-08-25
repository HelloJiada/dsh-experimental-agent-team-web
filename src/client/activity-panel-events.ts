export const OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT = 'agent-team:open-activity-panel'

export function openAgentTeamActivityPanel(): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT))
}
