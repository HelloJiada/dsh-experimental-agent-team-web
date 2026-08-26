import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import {
  DEFAULT_SESSION_TEAM_CONFIG,
  sessionTeamConfigMutationViewSchema,
  sessionTeamConfigSnapshotSchema,
  sessionTeamConfigViewSchema,
  sessionTeamModelCatalogViewSchema,
} from './session-team-config.js'
import type {
  SessionTeamConfigMutationView,
  SessionTeamConfigSnapshot,
  SessionTeamConfigView,
  SessionTeamModelCatalogView,
} from './session-team-config.js'

export interface SessionTeamConfigState {
  readonly revision: number
  readonly config: SessionTeamConfigSnapshot
  readonly catalog: SessionTeamModelCatalogView | null
  readonly lastMutation: SessionTeamConfigMutationView | null
}

const stateSchema = z.object({
  revision: z.number(),
  config: sessionTeamConfigSnapshotSchema,
  catalog: sessionTeamModelCatalogViewSchema.nullable(),
  lastMutation: sessionTeamConfigMutationViewSchema.nullable(),
}).strict() as z.ZodType<SessionTeamConfigState>

export function initSessionTeamConfigProjection(): SessionTeamConfigState {
  return {
    revision: 0,
    config: DEFAULT_SESSION_TEAM_CONFIG,
    catalog: null,
    lastMutation: null,
  }
}

export function applySessionTeamConfigEvent(
  state: SessionTeamConfigState,
  event: SessionEvent,
): SessionTeamConfigState {
  switch (event.type) {
    case 'agent-team/configured': {
      const data = event.data as {
        readonly requestId: string
        readonly config: SessionTeamConfigSnapshot
      }
      return {
        ...state,
        revision: event.seq,
        config: data.config,
        lastMutation: { requestId: data.requestId, kind: 'saved' },
      }
    }
    case 'agent-team/model-catalog-refreshed': {
      const data = event.data as {
        readonly requestId: string
        readonly catalog: SessionTeamModelCatalogView
      }
      return {
        ...state,
        catalog: data.catalog,
        lastMutation: { requestId: data.requestId, kind: 'catalog-refreshed' },
      }
    }
    case 'agent-team/config-rejected': {
      const data = event.data as {
        readonly requestId: string
        readonly message: string
      }
      return {
        ...state,
        lastMutation: { requestId: data.requestId, kind: 'rejected', message: data.message },
      }
    }
    default:
      return state
  }
}

export function foldSessionTeamConfigEvents(events: readonly SessionEvent[]): SessionTeamConfigState {
  return events.reduce(applySessionTeamConfigEvent, initSessionTeamConfigProjection())
}

export function viewSessionTeamConfig(state: SessionTeamConfigState): SessionTeamConfigView {
  return state
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeamConfig: SessionTeamConfigState
  }
}

export const sessionTeamConfigProjectionDefinition = {
  key: 'agentTeamConfig',
  stateSchema,
  init: initSessionTeamConfigProjection,
  apply: applySessionTeamConfigEvent,
  wire: {
    viewSchema: sessionTeamConfigViewSchema,
    view: viewSessionTeamConfig,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentTeamConfig', SessionTeamConfigState>
