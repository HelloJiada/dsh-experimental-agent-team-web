/**
 * Executing-role membership limits for `agent_teams_add_member`.
 *
 * The captain owns exactly one seat (never created via add_member), the
 * commissar is auto-created and uniqueness-gated, and every executing role
 * (the 6 preset behavioral roles engineer / researcher / data / qa / designer / docs,
 * plus the task-level reviewer and any custom role string such as
 * security / operator) may have at most `maxExecPerRole` (default 1)
 * active members. Role strings are matched canonically — trim/lowercase, strip
 * `-v2`/`_v2`/` v2` suffixes and Chinese military titles — in the same style
 * as `isCommissarRole`.
 * @module dsh-agent-team-web/role-limits
 */
import type { TeamMember } from './types.ts';
/** Default cap of active members per executing role (configurable via `maxExecPerRole`). */
export declare const DEFAULT_MAX_EXEC_PER_ROLE = 1;
/**
 * Canonical executing-role key: trim/lowercase, strip `-v2` / `_v2` / ` v2`
 * suffixes, map Chinese military titles to their canonical key. Commissar
 * spellings stay as-is (callers route them through `isCommissarRole`); an
 * empty role canonicalizes to `''`.
 */
export declare function canonicalExecRole(role: string | undefined): string;
/**
 * Count of active (non-removed) non-commissar members whose canonical
 * executing role equals the given role's canonical key. Members without a
 * role canonicalize to `''` and never match an executing role.
 */
export declare function countActiveExecRoleMembers(members: readonly TeamMember[], role: string | undefined): number;
//# sourceMappingURL=role-limits.d.ts.map