import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamMessageId, TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'

export type AgentTeamMemberRole = 'lead' | 'teammate'
export type AgentTeamMemberPhase = 'provisioning' | 'active' | 'failed'
export type AgentTeamTaskStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: AgentTeamMemberRole
  readonly phase: AgentTeamMemberPhase
  readonly sessionId: SessionId
}

export interface AgentTeamTaskView {
  readonly id: TeamTaskId
  readonly subject: string
  readonly description: string
  readonly status: AgentTeamTaskStatus
  readonly ownerId: SessionId | null
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly revision: number
}

export interface AgentTeamMessageView {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
  readonly delivered: boolean
}

export interface AgentTeamView {
  readonly teamId: SessionId
  readonly leadMemberId: SessionId
  readonly members: AgentTeamMemberView[]
  readonly tasks: AgentTeamTaskView[]
  readonly messages: AgentTeamMessageView[]
}
