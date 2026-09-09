/** Collaboration-mode display helpers (light / standard / governed). */

import type { AgentTeamsLocaleKey } from './locales.ts'

/** Collaboration policy of a team; legacy records without a mode are standard. */
export type TeamMode = 'light' | 'standard' | 'governed'

/** Normalize a possibly-absent stored mode; anything unknown falls back to standard. */
export function effectiveTeamMode(mode: string | undefined): TeamMode {
  return mode === 'light' || mode === 'governed' ? mode : 'standard'
}

/** Localized short label key for one mode. */
export function teamModeLabelKey(mode: TeamMode): AgentTeamsLocaleKey {
  if (mode === 'light') return 'team.mode.light'
  return mode === 'governed' ? 'team.mode.governed' : 'team.mode.standard'
}

/** Localized explanatory hint key for one mode. */
export function teamModeHintKey(mode: TeamMode): AgentTeamsLocaleKey {
  if (mode === 'light') return 'team.mode.hint.light'
  return mode === 'governed' ? 'team.mode.hint.governed' : 'team.mode.hint.standard'
}
