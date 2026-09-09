/**
 * AgentTeams conversation card: a lightweight in-conversation summary shown
 * when a team is created — the captain's name, the member roster with whale
 * avatars, and an entry point that re-activates the top-right activity
 * panel (useful after the floater was closed, or when re-opening an old
 * session for review).
 *
 * The fold anchors to the Harness's durable `tool/call` + `tool/result`
 * records for `agent_teams_create`. Those are first-party session events, so
 * the card survives restarts without writing an out-of-repo event type.
 * @module dsh-agent-team-web/client/card
 */

import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Module-loading imports: the declaration merge below extends the Chat
// target's public keyed payload map and is erased from the bundle.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-session/types'

/** Final keyed Chat payload for the team summary card. */
export interface AgentTeamsCardData {
  readonly teamId: string
  /** The captain session that owns this team (panel follows it). */
  readonly captainSessionId: string
  readonly teamName: string
  readonly members: readonly {
    readonly id: string
    readonly name: string
    readonly role: string
  }[]
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Lightweight team summary card anchoring the conversation. */
    'agent-teams': AgentTeamsCardData
  }
}

/** Folded team record (the node's business state). */
export interface AgentTeamsNodeState {
  readonly teamId: string
  readonly name: string
  /** Exact captain id from the successful create result; empty means unbound. */
  readonly captainSessionId: string
  readonly accepted: boolean
}

/** Read the exact team reference returned by the successful create tool. */
export function parseAgentTeamsCreateResult(value: unknown): { teamId: string; name: string; captainSessionId: string } | undefined {
  const visit = (candidate: unknown): { teamId: string; name: string; captainSessionId: string } | undefined => {
    if (typeof candidate === 'string') {
      try { return visit(JSON.parse(candidate)) } catch { return undefined }
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const found = visit(item)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const record = candidate as Record<string, unknown>
    if (typeof record['team_id'] === 'string' && record['team_id'].trim() !== ''
      && typeof record['team_name'] === 'string' && record['team_name'].trim() !== ''
      && typeof record['captain_session_id'] === 'string' && record['captain_session_id'].trim() !== '') {
      return {
        teamId: record['team_id'].trim(),
        name: record['team_name'].trim(),
        captainSessionId: record['captain_session_id'].trim(),
      }
    }
    for (const nested of Object.values(record)) {
      const found = visit(nested)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(value)
}

/** Parse the only create-call fields the historic card owns. */
export function parseAgentTeamsCreateArgs(value: string): { teamId: string; name: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || !('name' in parsed) || typeof parsed.name !== 'string') {
      return undefined
    }
    const name = parsed.name.trim()
    if (name === '') return undefined
    const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return { teamId: cleaned === '' ? 'team' : cleaned, name }
  } catch {
    return undefined
  }
}

/** Durable first-party tool events folded into one keyed Chat node. */
export const agentTeamsCardDefinition: ConversationNodeDefinition<AgentTeamsNodeState> = {
  kind: 'agent-teams',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool/call' && event.data.name === 'agent_teams_create') {
      return parseAgentTeamsCreateArgs(event.data.arguments) === undefined
        ? null
        : { id: String(event.data.callId), role: 'start' }
    }
    if (event.type === 'tool/result' && event.data.message.source.kind === 'tool') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') {
      throw new Error('agent-teams card start requires agent_teams_create tool/call')
    }
    const parsed = parseAgentTeamsCreateArgs(match.event.data.arguments)
    if (parsed === undefined) throw new Error('agent-teams card start requires valid create arguments')
    return { teamId: '', name: parsed.name, captainSessionId: '', accepted: false }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const failed = match.event.data.error !== undefined
      || match.event.data.message.content.some((block) => block.type === 'tool-result' && block.isError === true)
    if (failed) return context.state
    for (const block of match.event.data.message.content) {
      const parsed = parseAgentTeamsCreateResult(block)
      if (parsed !== undefined) {
        return {
          ...context.state,
          teamId: parsed.teamId,
          ...(parsed.name === undefined ? {} : { name: parsed.name }),
          ...(parsed.captainSessionId === undefined ? {} : { captainSessionId: parsed.captainSessionId }),
          accepted: true,
        }
      }
      if (block.type === 'tool-result') {
        const nested = parseAgentTeamsCreateResult(block.content)
        if (nested !== undefined) {
          return {
            ...context.state,
            teamId: nested.teamId,
            ...(nested.name === undefined ? {} : { name: nested.name }),
            ...(nested.captainSessionId === undefined ? {} : { captainSessionId: nested.captainSessionId }),
            accepted: true,
          }
        }
      }
    }
    return context.state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const state = context.state as AgentTeamsNodeState
    if (!state.accepted) return null
    return {
      key: context.key,
      kind: 'agent-teams',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: {
        teamId: state.teamId,
        captainSessionId: state.captainSessionId,
        teamName: state.name,
        members: [],
      },
    }
  },
}
