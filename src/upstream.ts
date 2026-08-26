/**
 * Adapter that folds the upstream `dsh-agent-teams` runtime's session events
 * (`agent-teams/*`) into this bundle's vendored projection state.
 *
 * The upstream runtime records durable team mutations on the captain's
 * Session as best-effort events (see upstream `src/events.ts`); this module
 * lets the dashboard consume that real contract in addition to the vendored
 * `team/*` events. Where the upstream payload carries names instead of
 * session ids (`assignee`, `from`, `to`), ids are resolved against the
 * folded member map, with `captain` meaning the owning session.
 */
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type {
  TeamId,
  TeamMemberSnapshot,
  TeamMessageSnapshot,
  TeamTaskSnapshot,
} from './agent-team-types.js'
import { TeamId as brandTeamId, UPSTREAM_TASK_STATUS } from './agent-team-types.js'
import type { AgentTeamHistoryEntry, AgentTeamProjectionState } from './projection.js'

export type UpstreamAgentTeamEventType = keyof SessionEventMap & `agent-teams/${string}`

export const UPSTREAM_TEAM_EVENT_TYPES: readonly UpstreamAgentTeamEventType[] = [
  'agent-teams/team-created',
  'agent-teams/member-added',
  'agent-teams/member-removed',
  'agent-teams/task-created',
  'agent-teams/task-updated',
  'agent-teams/message-sent',
  'agent-teams/team-deleted',
]

export function isUpstreamTeamEventType(type: string): boolean {
  return (UPSTREAM_TEAM_EVENT_TYPES as readonly string[]).includes(type)
}

interface TeamCreatedData {
  readonly teamId: TeamId
  readonly captainSessionId: string
  readonly name: string
  readonly description?: string
}

interface MemberAddedData {
  readonly teamId: TeamId
  readonly memberId: string
  readonly name: string
  readonly role?: string
}

interface MemberRemovedData {
  readonly teamId: TeamId
  readonly memberId: string
}

interface TaskCreatedData {
  readonly teamId: TeamId
  readonly taskId: string
  readonly subject: string
  readonly dependencies: readonly string[]
  readonly assignee?: string
}

interface TaskUpdatedData {
  readonly teamId: TeamId
  readonly taskId: string
  readonly status: string
  readonly assignee?: string
  readonly output?: string
  readonly attempt?: number
  readonly attemptId?: string
}

interface MessageSentData {
  readonly teamId: TeamId
  readonly messageId: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly ts: number
}

interface TeamDeletedData {
  readonly teamId: TeamId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Opens one team record. */
    'agent-teams/team-created': TeamCreatedData
    /** Records one team member. */
    'agent-teams/member-added': MemberAddedData
    /** Records one member removal. */
    'agent-teams/member-removed': MemberRemovedData
    /** Records one task creation. */
    'agent-teams/task-created': TaskCreatedData
    /** Records one task transition. */
    'agent-teams/task-updated': TaskUpdatedData
    /** Records one mailbox message. */
    'agent-teams/message-sent': MessageSentData
    /** Closes one team record after deletion. */
    'agent-teams/team-deleted': TeamDeletedData
  }
}

function dataOf<T>(event: SessionEvent): T {
  return event.data as unknown as T
}

export function effectiveCaptainSessionId(state: AgentTeamProjectionState): SessionId | null {
  if (state.captainSessionId !== undefined && state.captainSessionId !== null) {
    return state.captainSessionId
  }
  return state.teamId === null ? null : brandSessionId(state.teamId)
}

function memberIdForName(state: AgentTeamProjectionState, name: string): SessionId | null {
  if (name === 'captain') return effectiveCaptainSessionId(state)
  for (const member of Object.values(state.members)) {
    if (member.name === name) return member.id
  }
  return null
}

/**
 * Applies one upstream `agent-teams/*` event to the projection state.
 * Returns `null` for unrecognized event types. History bookkeeping is left to
 * the caller (`appendHistory`), matching the vendored-event path.
 */
export function applyUpstreamEvent(
  state: AgentTeamProjectionState,
  event: SessionEvent,
): AgentTeamProjectionState | null {
  switch (event.type) {
    case 'agent-teams/team-created': {
      const data = dataOf<TeamCreatedData>(event)
      return {
        ...state,
        teamId: brandTeamId(data.teamId),
        captainSessionId: brandSessionId(data.captainSessionId),
        hasTeamEvents: true,
      }
    }
    case 'agent-teams/member-added': {
      const data = dataOf<MemberAddedData>(event)
      const member: TeamMemberSnapshot = {
        id: brandSessionId(data.memberId),
        name: data.name,
        description: data.role ?? '',
        provider: '',
        context: 'fresh',
        phase: 'active',
      }
      return {
        ...state,
        teamId: state.teamId ?? brandTeamId(data.teamId),
        hasTeamEvents: true,
        members: { ...state.members, [data.memberId]: member },
      }
    }
    case 'agent-teams/member-removed': {
      const data = dataOf<MemberRemovedData>(event)
      const members = { ...state.members }
      delete members[data.memberId]
      return {
        ...state,
        teamId: state.teamId ?? brandTeamId(data.teamId),
        hasTeamEvents: true,
        members,
      }
    }
    case 'agent-teams/task-created': {
      const data = dataOf<TaskCreatedData>(event)
      const task: TeamTaskSnapshot = {
        id: data.taskId as never,
        revision: 1,
        subject: data.subject,
        description: '',
        status: 'pending',
        ownerId: data.assignee !== undefined ? (memberIdForName(state, data.assignee) ?? undefined) : undefined,
        blockedBy: data.dependencies.map(dependency => dependency as never),
        writeScopes: [],
      }
      return {
        ...state,
        teamId: state.teamId ?? brandTeamId(data.teamId),
        hasTeamEvents: true,
        tasks: { ...state.tasks, [data.taskId]: task },
      }
    }
    case 'agent-teams/task-updated': {
      const data = dataOf<TaskUpdatedData>(event)
      const previous = state.tasks[data.taskId]
      const mappedStatus = UPSTREAM_TASK_STATUS[data.status] ?? previous?.status ?? 'pending'
      const ownerId = data.assignee !== undefined
        ? (memberIdForName(state, data.assignee) ?? undefined)
        : previous?.ownerId
      const task: TeamTaskSnapshot = {
        id: data.taskId as never,
        revision: (previous?.revision ?? 0) + 1,
        subject: previous?.subject ?? data.taskId,
        description: previous?.description ?? '',
        status: mappedStatus,
        ownerId,
        blockedBy: previous?.blockedBy ?? [],
        writeScopes: previous?.writeScopes ?? [],
      }
      return {
        ...state,
        teamId: state.teamId ?? brandTeamId(data.teamId),
        hasTeamEvents: true,
        tasks: { ...state.tasks, [data.taskId]: task },
      }
    }
    case 'agent-teams/message-sent': {
      const data = dataOf<MessageSentData>(event)
      const captainSessionId = effectiveCaptainSessionId(state)
      const message: TeamMessageSnapshot = {
        id: data.messageId as never,
        senderId: memberIdForName(state, data.from) ?? captainSessionId ?? brandSessionId(data.teamId),
        senderName: data.from,
        targetId: memberIdForName(state, data.to) ?? captainSessionId ?? brandSessionId(data.teamId),
        delivery: 'quiet',
        content: [{ type: 'text', text: data.content }],
      }
      return {
        ...state,
        teamId: state.teamId ?? brandTeamId(data.teamId),
        hasTeamEvents: true,
        messages: { ...state.messages, [data.messageId]: message },
      }
    }
    case 'agent-teams/team-deleted': {
      return { ...state, teamId: state.teamId ?? brandTeamId(dataOf<TeamDeletedData>(event).teamId), hasTeamEvents: true }
    }
    default:
      return null
  }
}

/** Builds a timeline history entry for an upstream event (no state mutation). */
export function upstreamHistoryEntryOf(event: SessionEvent): AgentTeamHistoryEntry | null {
  const seq = event.seq
  const time = typeof event.time === 'number' ? event.time : 0
  switch (event.type) {
    case 'agent-teams/team-created': {
      const data = dataOf<TeamCreatedData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'member',
        type: event.type,
        title: `团队创建 ${data.name}`,
        detail: `captain ${data.captainSessionId}`,
        tone: 'good',
        entityKey: `team:${data.teamId}`,
        count: 1,
      }
    }
    case 'agent-teams/member-added': {
      const data = dataOf<MemberAddedData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'member',
        type: event.type,
        title: `成员加入 ${data.name}`,
        detail: data.role !== undefined ? `role ${data.role}` : 'role -',
        tone: 'good',
        entityKey: `member:${data.memberId}`,
        count: 1,
      }
    }
    case 'agent-teams/member-removed': {
      const data = dataOf<MemberRemovedData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'member',
        type: event.type,
        title: `成员移除 ${data.memberId}`,
        detail: 'removed',
        tone: 'warn',
        entityKey: `member:${data.memberId}`,
        count: 1,
      }
    }
    case 'agent-teams/task-created': {
      const data = dataOf<TaskCreatedData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'task',
        type: event.type,
        title: `任务创建 ${data.subject}`,
        detail: `status pending`,
        tone: 'neutral',
        entityKey: `task:${data.taskId}`,
        count: 1,
      }
    }
    case 'agent-teams/task-updated': {
      const data = dataOf<TaskUpdatedData>(event)
      const tone: AgentTeamHistoryEntry['tone'] =
        data.status === 'completed' ? 'good'
          : data.status === 'failed' ? 'danger'
            : data.status === 'cancelled' ? 'neutral'
              : data.status === 'in_progress' ? 'warn'
                : 'neutral'
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'task',
        type: event.type,
        title: `任务更新 ${data.taskId}`,
        detail: `status ${data.status}`,
        tone,
        entityKey: `task:${data.taskId}`,
        count: 1,
      }
    }
    case 'agent-teams/message-sent': {
      const data = dataOf<MessageSentData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'message',
        type: event.type,
        title: `消息 ${data.from} → ${data.to}`,
        detail: '已记录到邮箱',
        tone: 'neutral',
        entityKey: `message:${data.messageId}`,
        count: 1,
      }
    }
    case 'agent-teams/team-deleted': {
      const data = dataOf<TeamDeletedData>(event)
      return {
        id: `${event.type}:${seq}`,
        seq,
        time,
        kind: 'member',
        type: event.type,
        title: '团队已删除',
        detail: `team ${data.teamId}`,
        tone: 'danger',
        entityKey: `team:${data.teamId}`,
        count: 1,
      }
    }
    default:
      return null
  }
}
