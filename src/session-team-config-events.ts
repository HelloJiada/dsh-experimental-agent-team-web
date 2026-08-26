import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionTeamConfigSnapshot, SessionTeamModelCatalogView } from './session-team-config.js'

const pluginName = '@deepseek-ai/dsh-experimental-agent-team-web'
const supportedSessionVersion = 'DSH 0.1.1-rc.2 (@deepseek-ai/dsh-session@0.1.1-rc.2)'

export const SESSION_TEAM_CONFIG_EVENT_TYPES = [
  'agent-team/configured',
  'agent-team/model-catalog-refreshed',
  'agent-team/config-rejected',
] as const

interface MutableEventTypeCatalogue {
  add(type: string): unknown
  has(type: string): boolean
}

class SessionTeamConfigHostCompatibilityError extends Error {
  override readonly name = 'SessionTeamConfigHostCompatibilityError'
}

function compatibilityError(missing: readonly string[]): SessionTeamConfigHostCompatibilityError {
  return new SessionTeamConfigHostCompatibilityError(
    `${pluginName} requires ${supportedSessionVersion} runtime event compatibility. `
    + `Missing event types: ${missing.join(', ')}. Use a supported Host or upgrade this plugin.`,
  )
}

function mutableCatalogueOf(value: unknown): MutableEventTypeCatalogue {
  if (typeof value !== 'object' || value === null) throw compatibilityError(SESSION_TEAM_CONFIG_EVENT_TYPES)
  try {
    if (
      typeof (value as { add?: unknown }).add !== 'function'
      || typeof (value as { has?: unknown }).has !== 'function'
    ) {
      throw compatibilityError(SESSION_TEAM_CONFIG_EVENT_TYPES)
    }
  } catch (error) {
    if (error instanceof SessionTeamConfigHostCompatibilityError) throw error
    throw compatibilityError(SESSION_TEAM_CONFIG_EVENT_TYPES)
  }
  return value as MutableEventTypeCatalogue
}

function missingTypes(catalogue: MutableEventTypeCatalogue): readonly string[] {
  try {
    return SESSION_TEAM_CONFIG_EVENT_TYPES.filter(type => catalogue.has(type) !== true)
  } catch {
    return SESSION_TEAM_CONFIG_EVENT_TYPES
  }
}

export function registerSessionTeamConfigEventTypes(value: unknown = KNOWN_SESSION_EVENT_TYPES): void {
  const catalogue = mutableCatalogueOf(value)
  try {
    for (const type of SESSION_TEAM_CONFIG_EVENT_TYPES) catalogue.add(type)
  } catch {
    throw compatibilityError(missingTypes(catalogue))
  }
  const missing = missingTypes(catalogue)
  if (missing.length > 0) throw compatibilityError(missing)
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent-team/configured': {
      version: 1
      requestId: string
      config: SessionTeamConfigSnapshot
    }
    'agent-team/model-catalog-refreshed': {
      version: 1
      requestId: string
      catalog: SessionTeamModelCatalogView
    }
    'agent-team/config-rejected': {
      version: 1
      requestId: string
      code: string
      message: string
      currentRevision: number
    }
  }
}
