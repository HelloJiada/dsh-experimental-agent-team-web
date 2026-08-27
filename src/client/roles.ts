/**
 * Military-role display titles for member roles: canonical role keys stay
 * English in the data layer; the UI renders the localized title instead.
 * @module dsh-agent-team-web/client/roles
 */

import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'
import { zh } from './locales.ts'

/** Canonical role key → military-title locale key (see `role.*` in locales.ts). */
export const ROLE_TITLE_KEY: Record<string, AgentTeamsLocaleKey> = {
  captain: 'role.captain',
  researcher: 'role.researcher',
  engineer: 'role.engineer',
  qa: 'role.qa',
  designer: 'role.designer',
  security: 'role.security',
  reviewer: 'role.reviewer',
  docs: 'role.docs',
  data: 'role.data',
  operator: 'role.operator',
  commissar: 'role.commissar',
}

/** Normalize a role/name for canonical-key lookup: lowercase, trim, and
 * strip display suffixes such as `-v2` / `_v2`. */
function canonicalKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+v2$/, '').trim()
}

/**
 * Member role display title: canonical keys map to the localized military
 * title; anything unknown falls back to the raw role text (never blank,
 * never throws).
 */
export function roleTitle(role: string, t: AgentTeamsTranslate): string {
  const key = ROLE_TITLE_KEY[canonicalKey(role)]
  return key === undefined ? role : t(key)
}

/**
 * Member name display title: when a member is named after a canonical role
 * key (or a display variant such as `engineer-v2`), show the localized
 * military title instead of the raw English key. Any other name (real
 * person, mailbox address, …) is returned unchanged — the data layer's
 * assignee matching and prompt identity keep using the original name.
 */
export function nameTitle(name: string, t: AgentTeamsTranslate): string {
  const key = ROLE_TITLE_KEY[canonicalKey(name)]
  return key === undefined ? name : t(key)
}

/** A Chinese-ordinal suffix like `一号` / `二号` / `十号` (also tolerates a
 * leading space and legacy no-space names). */
const ORDINAL_SUFFIX = /^(?:\s*[一二三四五六七八九十]+\d*号)$/

/** True when the name itself is a canonical role name — the role title is
 * then already expressed by the name, so the role chip can be omitted.
 * Recognizes both plain role names (`技术员`, `engineer`) and auto-numbered
 * names (`技术员 一号`, legacy `技术员一号`). */
export function isRoleName(name: string): boolean {
  const raw = name.trim()
  if (raw === '') return false
  if (ROLE_TITLE_KEY[canonicalKey(raw)] !== undefined) return true
  for (const localeKey of Object.values(ROLE_TITLE_KEY)) {
    const title = (zh as Record<string, string>)[localeKey]
    if (title === undefined) continue
    if (raw === title) return true
    const withoutPrefix = raw.startsWith(title) ? raw.slice(title.length) : ''
    if (withoutPrefix !== '' && ORDINAL_SUFFIX.test(withoutPrefix)) return true
  }
  return false
}
