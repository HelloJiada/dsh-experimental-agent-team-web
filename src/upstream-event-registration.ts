import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { UPSTREAM_TEAM_EVENT_TYPES } from './upstream.js'

const pluginName = '@deepseek-ai/dsh-experimental-agent-team-web'
const supportedSessionVersion = '@deepseek-ai/dsh-session@0.1.1-rc.2'

interface MutableEventTypeCatalogue {
  add(type: string): unknown
  has(type: string): boolean
}

export class AgentTeamHostCompatibilityError extends Error {
  override readonly name = 'AgentTeamHostCompatibilityError'
}

function compatibilityError(missing: readonly string[]): AgentTeamHostCompatibilityError {
  return new AgentTeamHostCompatibilityError(
    `${pluginName} requires ${supportedSessionVersion} runtime event compatibility. `
    + `Missing event types: ${missing.join(', ')}. Use a supported Host or upgrade this plugin.`,
  )
}

function mutableCatalogueOf(value: unknown): MutableEventTypeCatalogue {
  if (typeof value !== 'object' || value === null) {
    throw compatibilityError(UPSTREAM_TEAM_EVENT_TYPES)
  }
  try {
    if (
      typeof (value as { add?: unknown }).add !== 'function'
      || typeof (value as { has?: unknown }).has !== 'function'
    ) {
      throw compatibilityError(UPSTREAM_TEAM_EVENT_TYPES)
    }
  } catch (error) {
    if (error instanceof AgentTeamHostCompatibilityError) throw error
    throw compatibilityError(UPSTREAM_TEAM_EVENT_TYPES)
  }
  return value as MutableEventTypeCatalogue
}

function missingTypes(catalogue: MutableEventTypeCatalogue): readonly string[] {
  try {
    return UPSTREAM_TEAM_EVENT_TYPES.filter(type => !catalogue.has(type))
  } catch {
    return UPSTREAM_TEAM_EVENT_TYPES
  }
}

export function registerUpstreamAgentTeamEventTypes(
  value: unknown = KNOWN_SESSION_EVENT_TYPES,
): void {
  const catalogue = mutableCatalogueOf(value)
  try {
    for (const type of UPSTREAM_TEAM_EVENT_TYPES) catalogue.add(type)
  } catch {
    throw compatibilityError(missingTypes(catalogue))
  }
  const missing = missingTypes(catalogue)
  if (missing.length > 0) throw compatibilityError(missing)
}
