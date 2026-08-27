/**
 * AgentTeams session event types — pure types only, zero imports.
 *
 * This file intentionally imports nothing: both the host program (the
 * emitter in `events.ts`) and the browser program (the Conversation Node
 * definition) must be able to load these types and the `SessionEventMap`
 * declaration merge without pulling in host-side `Context` augmentations
 * (dsh-session's index declares `Context.sessions: SessionStore`, which
 * collides with the browser runtime's `ISessions` under the same name).
 * @module dsh-agent-team-web/event-types
 */

/** Opens one team record: the captain created the team. */
export interface AgentTeamsTeamCreatedData {
  readonly teamId: string
  /** The captain session that owns this team (UI follows it). */
  readonly captainSessionId: string
  readonly name: string
  readonly description?: string
}

/** Records one member after its continuable subagent is spawned. */
export interface AgentTeamsMemberAddedData {
  readonly teamId: string
  readonly memberId: string
  readonly name: string
  readonly role?: string
}

/** Marks one member removed. */
export interface AgentTeamsMemberRemovedData {
  readonly teamId: string
  readonly memberId: string
}

/** Records one task in the team's task list. */
export interface AgentTeamsTaskCreatedData {
  readonly teamId: string
  readonly taskId: string
  readonly subject: string
  readonly dependencies: readonly string[]
  readonly assignee?: string
}

/** Records one task status/assignee/output transition. */
export interface AgentTeamsTaskUpdatedData {
  readonly teamId: string
  readonly taskId: string
  readonly status: string
  readonly assignee?: string
  readonly output?: string
  readonly attempt?: number
  readonly attemptId?: string
}

/** Records one commissar gate review verdict on a task. */
export interface AgentTeamsTaskReviewedData {
  readonly teamId: string
  readonly taskId: string
  readonly verdict: 'pass' | 'reject'
  readonly comment?: string
}

/** Records one captain calibration of a task retrospective (L3 third layer). */
export interface AgentTeamsRetroReviewedData {
  readonly teamId: string
  readonly taskId: string
  readonly verdict: 'useful' | 'useless' | 'revised'
  readonly cause?: string
}

/** Closes one team record: the team was deleted. */
export interface AgentTeamsTeamDeletedData {
  readonly teamId: string
}

/** Records one mailbox message sent between team agents. */
export interface AgentTeamsMessageSentData {
  readonly teamId: string
  readonly messageId: string
  /** `captain` or a member name. */
  readonly from: string
  /** `captain` or a member name. */
  readonly to: string
  readonly content: string
  readonly ts: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one team record.
     * @param data - stable team identity and display name.
     */
    'agent-team-web/team-created': AgentTeamsTeamCreatedData
    /**
     * Records one team member.
     * @param data - team identity, member child session, and display identity.
     */
    'agent-team-web/member-added': AgentTeamsMemberAddedData
    /**
     * Records one member removal.
     * @param data - team identity and the member's child session id.
     */
    'agent-team-web/member-removed': AgentTeamsMemberRemovedData
    /**
     * Records one task creation.
     * @param data - team identity, task id, subject, dependencies, assignee.
     */
    'agent-team-web/task-created': AgentTeamsTaskCreatedData
    /**
     * Records one task transition.
     * @param data - team identity, task id, and the new status/assignee/output.
     */
    'agent-team-web/task-updated': AgentTeamsTaskUpdatedData
    /**
     * Records one commissar gate review verdict.
     * @param data - team identity, task id, verdict, and optional comment.
     */
    'agent-team-web/task-reviewed': AgentTeamsTaskReviewedData
    /**
     * Records one captain calibration of a task retrospective.
     * @param data - team identity, task id, calibration verdict, optional new cause.
     */
    'agent-team-web/retro-reviewed': AgentTeamsRetroReviewedData
    /**
     * Records one mailbox message.
     * @param data - team identity, sender, recipient, and content.
     */
    'agent-team-web/message-sent': AgentTeamsMessageSentData
    /**
     * Closes one team record after deletion.
     * @param data - stable team identity.
     */
    'agent-team-web/team-deleted': AgentTeamsTeamDeletedData
  }
}

/** The full set of `agent-team-web/*` event names. */
export type AgentTeamsEventType =
  | 'agent-team-web/team-created'
  | 'agent-team-web/member-added'
  | 'agent-team-web/member-removed'
  | 'agent-team-web/task-created'
  | 'agent-team-web/task-updated'
  | 'agent-team-web/task-reviewed'
  | 'agent-team-web/retro-reviewed'
  | 'agent-team-web/message-sent'
  | 'agent-team-web/team-deleted'
