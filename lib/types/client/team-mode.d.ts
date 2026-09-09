/** Collaboration-mode display helpers (light / standard / governed). */
import type { AgentTeamsLocaleKey } from './locales.ts';
/** Collaboration policy of a team; legacy records without a mode are standard. */
export type TeamMode = 'light' | 'standard' | 'governed';
/** Normalize a possibly-absent stored mode; anything unknown falls back to standard. */
export declare function effectiveTeamMode(mode: string | undefined): TeamMode;
/** Localized short label key for one mode. */
export declare function teamModeLabelKey(mode: TeamMode): AgentTeamsLocaleKey;
/** Localized explanatory hint key for one mode. */
export declare function teamModeHintKey(mode: TeamMode): AgentTeamsLocaleKey;
//# sourceMappingURL=team-mode.d.ts.map