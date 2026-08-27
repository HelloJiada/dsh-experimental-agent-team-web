import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * A realistic private `agent-team-web/*` event log for one team lifecycle,
 * shaped exactly like this bundle's runtime emits (best-effort session
 * events; names instead of session ids in message/task payloads).
 *
 * Deterministic replay fixture for the whole pipeline (events → projection →
 * view → insights → commands) so it can be verified without a live DSH
 * profile. The expected view state is documented in
 * `docs/verification-checklist.md`.
 */
export const teamLifecycleEvents: SessionEvent[] = [
  // Open the team.
  {
    type: 'agent-team-web/team-created',
    seq: 1,
    time: 1000,
    data: {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
      description: 'Documentation squad',
    },
  },
  // Add two members.
  {
    type: 'agent-team-web/member-added',
    seq: 2,
    time: 1100,
    data: { teamId: 'team-docs', memberId: 'session-writer-1', name: 'Alice', role: 'writer' },
  },
  {
    type: 'agent-team-web/member-added',
    seq: 3,
    time: 1200,
    data: { teamId: 'team-docs', memberId: 'session-researcher-1', name: 'Bob', role: 'research' },
  },
  // Plan three dependent tasks.
  {
    type: 'agent-team-web/task-created',
    seq: 4,
    time: 1300,
    data: { teamId: 'team-docs', taskId: 'task-spec', subject: 'Spec API', dependencies: [], assignee: 'Bob' },
  },
  {
    type: 'agent-team-web/task-created',
    seq: 5,
    time: 1400,
    data: { teamId: 'team-docs', taskId: 'task-impl', subject: 'Implement API', dependencies: ['task-spec'], assignee: 'Alice' },
  },
  {
    type: 'agent-team-web/task-created',
    seq: 6,
    time: 1500,
    data: { teamId: 'team-docs', taskId: 'task-docs', subject: 'Ship docs', dependencies: ['task-impl'], assignee: 'Alice' },
  },
  // Spec is claimed and started.
  {
    type: 'agent-team-web/task-updated',
    seq: 7,
    time: 1600,
    data: { teamId: 'team-docs', taskId: 'task-spec', status: 'claimed', assignee: 'Bob' },
  },
  {
    type: 'agent-team-web/task-updated',
    seq: 8,
    time: 1700,
    data: { teamId: 'team-docs', taskId: 'task-spec', status: 'in_progress' },
  },
  // Captain asks Bob for the spec notes (quiet message).
  {
    type: 'agent-team-web/message-sent',
    seq: 9,
    time: 1800,
    data: { teamId: 'team-docs', messageId: 'msg-1', from: 'captain', to: 'Bob', content: 'please deliver spec notes', ts: 1800 },
  },
  // Implementation is claimed while the spec is still in progress.
  {
    type: 'agent-team-web/task-updated',
    seq: 10,
    time: 1900,
    data: { teamId: 'team-docs', taskId: 'task-impl', status: 'claimed', assignee: 'Alice' },
  },
  // Spec completes; Alice reports back.
  {
    type: 'agent-team-web/task-updated',
    seq: 11,
    time: 2000,
    data: { teamId: 'team-docs', taskId: 'task-spec', status: 'completed' },
  },
  {
    type: 'agent-team-web/message-sent',
    seq: 12,
    time: 2100,
    data: { teamId: 'team-docs', messageId: 'msg-2', from: 'Alice', to: 'captain', content: 'spec done', ts: 2100 },
  },
  // Implementation fails; docs task gets cancelled; a follow-up is planned
  // on top of the failed task (so it stays blocked).
  {
    type: 'agent-team-web/task-updated',
    seq: 13,
    time: 2200,
    data: { teamId: 'team-docs', taskId: 'task-impl', status: 'failed', output: 'flaky integration' },
  },
  {
    type: 'agent-team-web/task-updated',
    seq: 14,
    time: 2300,
    data: { teamId: 'team-docs', taskId: 'task-docs', status: 'cancelled' },
  },
  {
    type: 'agent-team-web/message-sent',
    seq: 15,
    time: 2400,
    data: { teamId: 'team-docs', messageId: 'msg-3', from: 'captain', to: 'Alice', content: 'what happened?', ts: 2400 },
  },
  {
    type: 'agent-team-web/task-created',
    seq: 16,
    time: 2500,
    data: { teamId: 'team-docs', taskId: 'task-followup', subject: 'Follow-up review', dependencies: ['task-impl'], assignee: 'Bob' },
  },
  // No team-deleted: the team stays live so the dashboard shows the full
  // working state (deletion is history-only, covered by the runtime's tests).
] as unknown as SessionEvent[]
