/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTeamView } from '../contract.js'
import { OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT } from './activity-panel-events.js'
import { AgentTeamActivityPanel } from './AgentTeamActivityPanel.js'

type SessionState = {
  current: string | undefined
  byId: Record<string, { projectionValues?: { agentTeam?: AgentTeamView | null } }>
}

const task = (id: string, subject: string, status: 'in_progress' | 'pending' = 'in_progress') => ({
  id, subject, description: subject, status, ownerId: 'member-1', blockedBy: [], writeScopes: [], revision: 1,
})

function team(teamId: string, options: { active?: boolean; blocked?: boolean; priorities?: string[] } = {}): AgentTeamView {
  const active = options.active === false ? [] : [task(`${teamId}-active`, `${teamId} active`)]
  const blocked = options.blocked ? [task(`${teamId}-blocked`, `${teamId} blocked`, 'pending')] : []
  const priorityNames = options.priorities ?? ['First priority']
  const insights = priorityNames.map((subject, index) => ({
    taskId: `${teamId}-p${index + 1}`, subject, status: 'in_progress' as const, readiness: 'ready' as const,
    reasons: [`reason ${index + 1}`], severity: 'high' as const, ownerId: 'member-1',
    interventionPriority: index + 1, dependencyDepth: 0,
  }))
  return ({
    teamId, leadMemberId: 'member-1',
    members: [{ id: 'member-1', name: 'Ada', role: 'lead', phase: 'active', sessionId: 'member-1' }],
    tasks: [...active, ...blocked], messages: [], blockedTasks: blocked, activeTasks: active,
    pendingTasks: [], completedTasks: [], stalledTasks: [], orphanedTasks: [], readyTasks: active,
    taskInsights: insights,
    memberLoads: [{ memberId: 'member-1', memberName: 'Ada', level: 'focused', activeTaskCount: 1, pendingOwnedTaskCount: 0, stalledTaskCount: 0, orphanedTaskCount: 0 }],
    messageRisks: [], quickFilters: { taskFilters: [], memberFilters: [], messageFilters: [] },
    timeline: [], timelineSummary: { totalEvents: 0, memberEvents: 0, taskEvents: 0, messageEvents: 0, coalescedEntries: 0, firstSeq: null, lastSeq: null, firstTime: null, lastTime: null, latestTitle: null },
    timelineMilestones: [], dependencyDag: { nodes: [], edges: [], levels: 0 },
    commandPlan: { version: 1, generatedFromTeamId: teamId, total: 0, highPriorityCount: 0, mediumPriorityCount: 0, lowPriorityCount: 0, commands: [] },
    summary: { memberCount: 1, failedMemberCount: 0, taskCount: active.length + blocked.length, pendingTaskCount: 0, inProgressTaskCount: active.length, completedTaskCount: 0, blockedTaskCount: blocked.length, stalledTaskCount: 0, orphanedTaskCount: 0, readyTaskCount: active.length, overloadedMemberCount: 0, messageCount: 0, undeliveredMessageCount: 0, wakeupMessageCount: 0, highRiskMessageCount: 0, healthScore: 80, statusLabel: 'Working', overview: `${teamId} overview`, alerts: [], recommendedActions: [], captainBriefing: [], topInterventions: insights.map(item => `P${item.interventionPriority} · ${item.subject}`) },
  } as unknown) as AgentTeamView
}

const panelProps = (useSessions: unknown, openMember = vi.fn()): ComponentProps<typeof AgentTeamActivityPanel> =>
  ({ useSessions, useWorkspaces: vi.fn(), openMember }) as unknown as ComponentProps<typeof AgentTeamActivityPanel>

function harness(initial: SessionState, width = 1200) {
  let state = initial
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  const useSessions = <T,>(selector: (value: SessionState) => T): T => selector(state)
  const view = render(<AgentTeamActivityPanel {...panelProps(useSessions)} />)
  return { ...view, setState(next: SessionState) { state = next; view.rerender(<AgentTeamActivityPanel {...panelProps(useSessions)} />) } }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AgentTeamActivityPanel', () => {
  it('renders neither badge nor panel for absent, completed-only, or non-current teams', () => {
    const view = harness({ current: undefined, byId: {} })
    expect(screen.queryByRole('button', { name: /team activity/i })).toBeNull()
    view.setState({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('done', { active: false }) } } } })
    expect(screen.queryByRole('button', { name: /team activity/i })).toBeNull()
    view.setState({ current: 'one', byId: { one: {}, other: { projectionValues: { agentTeam: team('other') } } } })
    expect(screen.queryByRole('button', { name: /team activity/i })).toBeNull()
  })

  it('renders a badge for a collapsed qualifying current-session team', () => {
    harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })
    fireEvent.click(screen.getByRole('button', { name: /collapse team activity/i }))
    expect(screen.getByRole('button', { name: /open team activity/i })).toBeTruthy()
  })

  it('expands from badge and collapses back to badge', () => {
    harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })
    fireEvent.click(screen.getByRole('button', { name: /collapse team activity/i }))
    fireEvent.click(screen.getByRole('button', { name: /open team activity/i }))
    expect(screen.getByRole('complementary', { name: /team activity/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /collapse team activity/i }))
    expect(screen.getByRole('button', { name: /open team activity/i })).toBeTruthy()
  })

  it('renders at most three priority rows in existing ranked order', () => {
    harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one', { priorities: ['Zulu', 'Alpha', 'Mike', 'Extra'] }) } } } })
    const rows = screen.getAllByTestId('activity-priority')
    expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual(['Zulu', 'Alpha', 'Mike'])
    expect(rows).toHaveLength(3)
  })

  it('uses only the current session projection after session switching', () => {
    const view = harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } }, two: { projectionValues: { agentTeam: team('two') } } } })
    expect(screen.getByText('one overview')).toBeTruthy()
    view.setState({ current: 'two', byId: { one: { projectionValues: { agentTeam: team('one') } }, two: { projectionValues: { agentTeam: team('two') } } } })
    expect(screen.getByText('two overview')).toBeTruthy()
    expect(screen.queryByText('one overview')).toBeNull()
  })

  it('delegates member activation to openMember', () => {
    const openMember = vi.fn(); let state: SessionState = { current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } }
    const useSessions = <T,>(selector: (value: SessionState) => T): T => selector(state)
    render(<AgentTeamActivityPanel {...panelProps(useSessions, openMember)} />)
    fireEvent.click(screen.getByRole('button', { name: /open member Ada/i }))
    expect(openMember).toHaveBeenCalledWith('member-1')
    state = state
  })

  it('hides drag and resize affordances in compact geometry', () => {
    const view = harness({ current: undefined, byId: {} }, 960)
    view.setState({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })
    expect(screen.getByRole('complementary').getAttribute('data-compact')).toBe('true')
    expect(screen.queryByTestId('panel-drag-handle')).toBeNull()
    expect(screen.queryByTestId('panel-resize-handle')).toBeNull()
  })

  it('releases pointer capture from the drag handle and recovers when capture is lost', () => {
    harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })
    const handle = screen.getByTestId('panel-drag-handle')
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const hasPointerCapture = vi.fn(() => true)
    Object.assign(handle, { setPointerCapture, releasePointerCapture, hasPointerCapture })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })
    expect(screen.getByRole('complementary').getAttribute('data-dragging')).toBe('true')
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 110, clientY: 110 })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(hasPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(screen.getByRole('complementary').getAttribute('data-dragging')).toBe('false')

    fireEvent.pointerDown(handle, { button: 0, pointerId: 8, clientX: 100, clientY: 100 })
    fireEvent(handle, new Event('lostpointercapture', { bubbles: true }))
    expect(screen.getByRole('complementary').getAttribute('data-dragging')).toBe('false')
  })

  it('survives localStorage get/set failures with default layout', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })).not.toThrow()
    expect(screen.getByRole('complementary').getAttribute('data-panel-mode')).toBe('docked')
  })

  it('opens in response to the stable activity event', () => {
    harness({ current: 'one', byId: { one: { projectionValues: { agentTeam: team('one') } } } })
    fireEvent.click(screen.getByRole('button', { name: /collapse team activity/i }))
    fireEvent(window, new CustomEvent(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT))
    expect(screen.getByRole('complementary')).toBeTruthy()
  })
})
