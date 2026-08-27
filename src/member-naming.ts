/**
 * Auto-numbered member naming for `agent_teams_add_member`.
 *
 * When the captain omits a name (or passes only the role), the member is named
 * `<role title> <Chinese ordinal>号` — 技术员 一号, 侦察参谋 一号, 技术员 二号, …
 * (a space separates the title from the ordinal, so the UI never reads as a
 * duplicated role chip). The ordinal derives from the active member count of
 * the same canonical role (via `role-limits.ts`, so numbering and the per-role
 * cap agree), and the Chinese title comes from the client role/locale tables.
 * The commissar is unique and keeps the plain 政委 title (no number); an
 * explicit custom name is always respected as-is.
 * @module dsh-agent-team-web/member-naming
 */

import { isCommissarRole } from './commissar-gate.ts'
import { zh } from './client/locales.ts'
import { ROLE_TITLE_KEY } from './client/roles.ts'
import { canonicalExecRole } from './role-limits.ts'

/** 1 → 一 … 9 → 九, 10 → 十; any other value falls back to the raw number. */
export function zhNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (Number.isInteger(value) && value >= 1 && value <= 9) return digits[value]!
  if (value === 10) return '十'
  return String(value)
}

/**
 * The display title of a role: the localized military title when the role
 * canonicalizes to a known key (engineer → 技术员, researcher → 侦察参谋,
 * reviewer → 审查员, commissar → 政委), otherwise the raw role text.
 */
export function roleDisplayTitle(role: string | undefined): string {
  if (role === undefined || role.trim() === '') return ''
  const key = ROLE_TITLE_KEY[canonicalExecRole(role)]
  const localized = key === undefined ? undefined : zh[key]
  return localized ?? role.trim()
}

/**
 * Whether a provided name is "just the role" — empty, the raw role text, or
 * the role's display title — in which case auto-numbering applies.
 */
export function isRoleOnlyName(name: string, role: string | undefined): boolean {
  const raw = name.trim()
  if (raw === '') return true
  if (role === undefined) return false
  if (raw.toLowerCase() === role.trim().toLowerCase()) return true
  const title = roleDisplayTitle(role)
  return title !== '' && raw === title
}

/**
 * Resolve the final member name. An explicit name that is not just the role is
 * respected unchanged (including already-numbered names like 技术员 二号). A
 * missing or role-only name is auto-numbered from the role title plus the
 * next Chinese ordinal for that role (`<title> <ordinal>号`, e.g. 技术员 一号).
 * The commissar keeps the unique 政委 title without a number. Roles without a
 * known title and without an explicit name cannot be named.
 * @param providedName - the caller-supplied name (may be empty/undefined).
 * @param role - the member's role text.
 * @param sameRoleActiveCount - active members of the same canonical role.
 * @returns the resolved member name.
 */
export function resolveMemberName(
  providedName: string | undefined,
  role: string | undefined,
  sameRoleActiveCount: number,
): string {
  const raw = providedName?.trim() ?? ''
  if (raw !== '' && !isRoleOnlyName(raw, role)) return raw
  const title = roleDisplayTitle(role)
  if (isCommissarRole(role) && title !== '') return title
  if (title === '') {
    if (raw !== '') return raw
    throw new Error('member name must not be empty (no role to derive a numbered name from)')
  }
  return `${title} ${zhNumber(sameRoleActiveCount + 1)}号`
}
