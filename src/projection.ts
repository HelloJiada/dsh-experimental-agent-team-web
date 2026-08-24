import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type {
  TeamMemberSnapshot,
  TeamMessageSnapshot,
  TeamTaskSnapshot,
} from './agent-team-types.js'
import type {
  AgentTeamMemberView,
  AgentTeamMessageView,
  AgentTeamTaskView,
  AgentTeamView,
} from './contract.js'

export interface AgentTeamProjectionState {
  readonly teamId: SessionId | null
  readonly hasTeamEvents: boolean
  readonly members: Record<string, TeamMemberSnapshot>
  readonly tasks: Record<string, TeamTaskSnapshot>
  readonly messages: Record<string, TeamMessageSnapshot>
  readonly delivered: Record<string, true>
}

const memberStateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict()

const taskStateSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: z.string().min(1).optional(),
  blockedBy: z.array(z.string().min(1)),
  writeScopes: z.array(z.string()),
}).strict()

const contentBlockSchema = z.object({ type: z.string().min(1) }).passthrough()

const messageStateSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string(),
  targetId: z.string().min(1),
  delivery: z.enum(['quiet', 'wakeup']),
  content: z.array(contentBlockSchema),
}).strict()

const stateSchema = z.object({
  teamId: z.string().min(1).nullable(),
  hasTeamEvents: z.boolean(),
  members: z.record(z.string(), memberStateSchema),
  tasks: z.record(z.string(), taskStateSchema),
  messages: z.record(z.string(), messageStateSchema),
  delivered: z.record(z.string(), z.literal(true)),
}).strict() as unknown as z.ZodType<AgentTeamProjectionState>

export function initAgentTeamProjection(): AgentTeamProjectionState {
  return {
    teamId: null,
    hasTeamEvents: false,
    members: {},
    tasks: {},
    messages: {},
    delivered: {},
  }
}

function isTeamEventType(type: string): boolean {
  return type === 'team/member'
    || type === 'team/task'
    || type === 'team/message/queued'
    || type === 'team/message/delivered'
}

function teamIdOf(state: AgentTeamProjectionState, event: SessionEvent): SessionId | null {
  const data = event.data as { readonly teamId?: string }
  if (data.teamId !== undefined) return brandSessionId(data.teamId)
  return state.teamId
}

function sameTeamOrUnset(state: AgentTeamProjectionState, teamId: SessionId): boolean {
  return state.teamId === null || state.teamId === teamId
}

export function applyAgentTeamEvent(
  state: AgentTeamProjectionState,
  event: SessionEvent,
): AgentTeamProjectionState {
  if (!isTeamEventType(event.type)) return state
  const teamId = teamIdOf(state, event)
  if (teamId === null || !sameTeamOrUnset(state, teamId)) return state

  switch (event.type) {
    case 'team/member': {
      const member = (event.data as { readonly member: TeamMemberSnapshot }).member
      return {
        ...state,
        teamId,
        hasTeamEvents: true,
        members: { ...state.members, [member.id]: member },
      }
    }
    case 'team/task': {
      const task = (event.data as { readonly task: TeamTaskSnapshot }).task
      return {
        ...state,
        teamId,
        hasTeamEvents: true,
        tasks: { ...state.tasks, [task.id]: task },
      }
    }
    case 'team/message/queued': {
      const message = (event.data as { readonly message: TeamMessageSnapshot }).message
      return {
        ...state,
        teamId,
        hasTeamEvents: true,
        messages: { ...state.messages, [message.id]: message },
      }
    }
    case 'team/message/delivered': {
      const messageId = String((event.data as { readonly messageId: string }).messageId)
      return {
        ...state,
        teamId,
        hasTeamEvents: true,
        delivered: { ...state.delivered, [messageId]: true },
      }
    }
    default:
      return state
  }
}

function memberComparator(left: AgentTeamMemberView, right: AgentTeamMemberView): number {
  if (left.role !== right.role) return left.role === 'lead' ? -1 : 1
  return left.name.localeCompare(right.name)
}

function taskRank(status: AgentTeamTaskView['status']): number {
  switch (status) {
    case 'in_progress':
      return 0
    case 'pending':
      return 1
    case 'completed':
      return 2
  }
}

function memberView(member: TeamMemberSnapshot): AgentTeamMemberView {
  return {
    id: member.id,
    name: member.name,
    role: 'teammate',
    phase: member.phase,
    sessionId: member.id,
  }
}

function taskView(task: TeamTaskSnapshot): AgentTeamTaskView {
  if (task.status === 'deleted') throw new Error('deleted tasks must be filtered before view conversion')
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    ownerId: task.ownerId ?? null,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
    revision: task.revision,
  }
}

function messageView(message: TeamMessageSnapshot, deliveredIds: ReadonlySet<string>): AgentTeamMessageView {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    targetId: message.targetId,
    delivery: message.delivery,
    content: [...message.content],
    delivered: deliveredIds.has(message.id),
  }
}

export function viewAgentTeam(state: AgentTeamProjectionState): AgentTeamView | null {
  if (!state.hasTeamEvents || state.teamId === null) return null
  const deliveredIds = new Set(Object.keys(state.delivered))
  const lead: AgentTeamMemberView = {
    id: state.teamId,
    name: 'lead',
    role: 'lead',
    phase: 'active',
    sessionId: state.teamId,
  }
  const members = [
    lead,
    ...Object.values(state.members).filter(member => member.id !== state.teamId).map(memberView),
  ].sort(memberComparator)
  const tasks = Object.values(state.tasks)
    .filter((task): task is TeamTaskSnapshot & { status: 'pending' | 'in_progress' | 'completed' } => task.status !== 'deleted')
    .map(taskView)
    .sort((left, right) => taskRank(left.status) - taskRank(right.status) || left.id.localeCompare(right.id))
  const messages = Object.values(state.messages)
    .map(message => messageView(message, deliveredIds))
    .sort((left, right) => left.id.localeCompare(right.id))
  return {
    teamId: state.teamId,
    leadMemberId: state.teamId,
    members,
    tasks,
    messages,
  }
}

const memberViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(['lead', 'teammate']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  sessionId: z.string().min(1),
}).strict()

const taskViewSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  ownerId: z.string().min(1).nullable(),
  blockedBy: z.array(z.string().min(1)),
  writeScopes: z.array(z.string()),
  revision: z.number().int().positive(),
}).strict()

const messageViewSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string(),
  targetId: z.string().min(1),
  delivery: z.enum(['quiet', 'wakeup']),
  content: z.array(contentBlockSchema),
  delivered: z.boolean(),
}).strict()

const viewSchema = z.object({
  teamId: z.string().min(1),
  leadMemberId: z.string().min(1),
  members: z.array(memberViewSchema),
  tasks: z.array(taskViewSchema),
  messages: z.array(messageViewSchema),
}).strict().nullable() as z.ZodType<AgentTeamView | null>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeam: AgentTeamProjectionState
  }
}

export const agentTeamProjectionDefinition = {
  key: 'agentTeam',
  stateSchema,
  init: initAgentTeamProjection,
  apply: applyAgentTeamEvent,
  wire: {
    viewSchema,
    view: viewAgentTeam,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentTeam', AgentTeamProjectionState>
