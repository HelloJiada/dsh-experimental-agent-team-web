/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTeamView } from '../contract.js'
import {
  OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT,
} from './activity-panel-events.js'
import { AgentTeamConversationSummary } from './AgentTeamConversationSummary.js'

const qualifyingTeam = {
  teamId: 'lead-session',
  summary: {
    healthScore: 75,
    statusLabel: 'Working',
    inProgressTaskCount: 1,
    blockedTaskCount: 0,
  },
  activeTasks: [{}],
  blockedTasks: [],
} as unknown as AgentTeamView

afterEach(() => {
  window.dispatchEvent(new Event(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT))
})

describe('AgentTeamConversationSummary', () => {
  it('renders no full dashboard for an empty projection', () => {
    render(<AgentTeamConversationSummary useProjection={() => null} />)

    expect(screen.queryByRole('button', { name: /open team activity/i })).toBeNull()
  })

  it('dispatches the stable open event from its action', () => {
    const listener = vi.fn()
    window.addEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, listener)

    render(<AgentTeamConversationSummary useProjection={() => qualifyingTeam} />)
    fireEvent.click(screen.getByRole('button', { name: /open team activity/i }))

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, listener)
  })

  it('does not render dashboard-only controls', () => {
    render(<AgentTeamConversationSummary useProjection={() => qualifyingTeam} />)

    expect(screen.queryByText(/Timeline/i)).toBeNull()
    expect(screen.queryByText(/Filters/i)).toBeNull()
    expect(screen.queryByText(/Command plan/i)).toBeNull()
  })
})
