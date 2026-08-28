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

import { isCommissarRole } from './commissar-gate.ts'
import type { TeamMember } from './types.ts'

/** Default cap of active members per executing role (configurable via `maxExecPerRole`). */
export const DEFAULT_MAX_EXEC_PER_ROLE = 1

/**
 * Chinese military titles → canonical executing-role key (mirrors client
 * roles.ts). The 5 preset behavioral roles plus reviewer are listed first;
 * security / docs / operator are kept so legacy members and custom role
 * strings still canonicalize into the same per-role cap bucket.
 */
const ZH_EXEC_ROLE_KEY: Record<string, string> = {
  技术员: 'engineer',
  侦察参谋: 'researcher',
  情报分析员: 'data',
  质检员: 'qa',
  文宣干事: 'designer',
  警卫员: 'security',
  文书: 'docs',
  后勤保障员: 'operator',
  审查员: 'reviewer',
}

/**
 * Canonical executing-role key: trim/lowercase, strip `-v2` / `_v2` / ` v2`
 * suffixes, map Chinese military titles to their canonical key. Commissar
 * spellings stay as-is (callers route them through `isCommissarRole`); an
 * empty role canonicalizes to `''`.
 */
export function canonicalExecRole(role: string | undefined): string {
  if (role === undefined) return ''
  const normalized = role.trim().toLowerCase().replace(/[-_\s]+v2$/u, '').trim()
  return ZH_EXEC_ROLE_KEY[normalized] ?? normalized
}

/**
 * Count of active (non-removed) non-commissar members whose canonical
 * executing role equals the given role's canonical key. Members without a
 * role canonicalize to `''` and never match an executing role.
 */
export function countActiveExecRoleMembers(
  members: readonly TeamMember[],
  role: string | undefined,
): number {
  const key = canonicalExecRole(role)
  return members.filter((candidate) =>
    candidate.status !== 'removed'
    && !isCommissarRole(candidate.role)
    && canonicalExecRole(candidate.role) === key,
  ).length
}
