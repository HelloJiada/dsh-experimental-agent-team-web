import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from '../src/projection.js'
import { suggestCommands } from '../src/commands.js'
import { timelineMilestonesView } from '../src/timeline-milestones.js'
import { upstreamTeamLifecycleEvents } from './fixtures/upstream-team-lifecycle.js'

/**
 * Deterministic end-to-end replay of a realistic upstream `agent-teams/*`
 * lifecycle (see tests/fixtures/upstream-team-lifecycle.ts). This stands in
 * for a live DSH profile run and locks the full pipeline: events → projection
 * → view → insights → summary → timeline → command suggestions.
 */
describe('agentTeam end-to-end replay of the upstream lifecycle', () => {
  it('folds the whole lifecycle into a coherent Captain view', () => {
    let state = initAgentTeamProjection()
    for (const event of upstreamTeamLifecycleEvents) {
      state = applyAgentTeamEvent(state, event)
    }

    const view = viewAgentTeam(state)
    expect(view).not.toBeNull()

    // Team identity and members (names resolved to session ids).
    expect(view?.teamId).toEqual(SessionId('team-docs'))
    expect(view?.members.map(member => member.name).sort()).toEqual(['Alice', 'Bob', 'lead'])
    const alice = view?.members.find(member => member.name === 'Alice')
    expect(alice?.sessionId).toEqual(SessionId('session-writer-1'))

    // Tasks: spec completed, impl failed, docs cancelled, follow-up blocked
    // (depends on the failed impl task).
    expect(view?.tasks).toHaveLength(4)
    expect(view?.tasks.find(task => task.id === 'task-spec')?.status).toBe('completed')
    expect(view?.tasks.find(task => task.id === 'task-impl')?.status).toBe('failed')
    expect(view?.tasks.find(task => task.id === 'task-docs')?.status).toBe('cancelled')
    const followUp = view?.tasks.find(task => task.id === 'task-followup')
    expect(followUp?.status).toBe('pending')
    expect(followUp?.blockedBy).toEqual(['task-impl'])
    expect(followUp?.ownerId).toEqual(SessionId('session-researcher-1'))

    // Insights: terminal work is marked terminal, follow-up is blocked.
    const failed = view?.taskInsights.find(insight => insight.taskId === 'task-impl')
    expect(failed?.readiness).toBe('failed')
    const cancelled = view?.taskInsights.find(insight => insight.taskId === 'task-docs')
    expect(cancelled?.readiness).toBe('cancelled')
    const blocked = view?.taskInsights.find(insight => insight.taskId === 'task-followup')
    expect(blocked?.readiness).toBe('blocked')
    expect(blocked?.severity).toBe('high')
  })

  it('derives an honest summary, timeline, and commands from the replay', () => {
    let state = initAgentTeamProjection()
    for (const event of upstreamTeamLifecycleEvents) {
      state = applyAgentTeamEvent(state, event)
    }
    const view = viewAgentTeam(state)
    if (view === null) throw new Error('expected a non-null view')

    // Summary counts.
    expect(view.summary.taskCount).toBe(4)
    expect(view.summary.completedTaskCount).toBe(1)
    expect(view.summary.blockedTaskCount).toBe(1)
    expect(view.summary.pendingTaskCount).toBe(1)
    expect(view.summary.memberCount).toBe(2)
    expect(view.summary.failedMemberCount).toBe(0)
    expect(view.summary.healthScore).toBeGreaterThanOrEqual(0)
    expect(view.summary.healthScore).toBeLessThanOrEqual(100)

    // Quiet upstream messages fold as undelivered but LOW risk.
    expect(view.summary.messageCount).toBe(3)
    expect(view.summary.undeliveredMessageCount).toBe(3)
    expect(view.summary.highRiskMessageCount).toBe(0)
    expect(view.messageRisks.every(risk => risk.riskLevel === 'low')).toBe(true)

    // Terminal work is not actionable; the blocked follow-up leads.
    expect(view.summary.topInterventions.join(' ')).not.toContain('Implement API')
    expect(view.summary.topInterventions.join(' ')).not.toContain('Ship docs')
    expect(view.summary.topInterventions[0]).toContain('Follow-up review')

    // Timeline: one coalesced row per entity, 16 events total.
    expect(view.timeline).toHaveLength(10)
    expect(view.timelineSummary.totalEvents).toBe(16)
    expect(view.timelineSummary.memberEvents).toBe(3)
    expect(view.timelineSummary.taskEvents).toBe(4)
    expect(view.timelineSummary.messageEvents).toBe(3)
    expect(view.timelineSummary.coalescedEntries).toBe(3)
    expect(view.timelineSummary.firstSeq).toBe(1)
    expect(view.timelineSummary.lastSeq).toBe(16)
    expect(view.timelineSummary.latestTitle).toContain('Follow-up review')

    // Milestone windows: 10 rows → two windows of 8 + 2, most recent first.
    expect(view.timelineMilestones).toHaveLength(2)
    const recent = view.timelineMilestones[0]
    expect(recent?.startSeq).toBe(15)
    expect(recent?.endSeq).toBe(16)
    expect(recent?.entryCount).toBe(2)
    expect(recent?.eventCount).toBe(2)
    expect(recent?.headline).toContain('Follow-up review')
    const earlier = view.timelineMilestones[1]
    expect(earlier?.entryCount).toBe(8)
    expect(earlier?.eventCount).toBe(14)
    expect(earlier?.taskEvents).toBe(9)
    expect(earlier?.memberEvents).toBe(3)
    expect(earlier?.messageEvents).toBe(2)
    // The failed task is the most significant entry in the earlier window.
    expect(earlier?.headline).toContain('task-impl')
    expect(earlier?.headlineTone).toBe('danger')

    // Time-mode windows (1s buckets): fixture times 1000-2500 split into
    // bucket 1 (1000-1999) and bucket 2 (2000-2999).
    const timeWindows = timelineMilestonesView(view.timeline, { mode: 'time', windowMs: 1000 })
    expect(timeWindows).toHaveLength(2)
    expect(timeWindows[0]?.startSeq).toBe(11)
    expect(timeWindows[0]?.endSeq).toBe(16)
    expect(timeWindows[0]?.entryCount).toBe(6)
    expect(timeWindows[1]?.startSeq).toBe(1)
    expect(timeWindows[1]?.endSeq).toBe(9)
    expect(timeWindows[1]?.entryCount).toBe(4)

    // Command bridge: unblock the blocked follow-up; no restarts or
    // redeliveries (no failed members, no high-risk messages).
    const commands = suggestCommands(view)
    const unblock = commands.find(command => command.kind === 'task:unblock')
    expect(unblock?.targetId).toBe('task-followup')
    expect(commands.some(command => command.kind === 'member:restart')).toBe(false)
    expect(commands.some(command => command.kind === 'message:redeliver')).toBe(false)

    // The plan envelope is stable and matches the derived suggestions.
    expect(view.commandPlan.version).toBe(1)
    expect(view.commandPlan.generatedFromTeamId).toEqual(SessionId('team-docs'))
    expect(view.commandPlan.total).toBe(commands.length)
    expect(view.commandPlan.highPriorityCount).toBeGreaterThanOrEqual(1)
    expect(view.commandPlan.commands[0]?.kind).toBe('task:unblock')
    expect(JSON.parse(JSON.stringify(view.commandPlan))).toMatchObject({
      total: commands.length,
      commands: expect.any(Array) as unknown,
    })
  })
})
