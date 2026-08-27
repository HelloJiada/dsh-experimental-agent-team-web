/**
 * Military-role display titles for member roles: canonical role keys stay
 * English in the data layer; the UI renders the localized title instead.
 * @module dsh-agent-team-web/client/roles
 */
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts';
/** Canonical role key → military-title locale key (see `role.*` in locales.ts). */
export declare const ROLE_TITLE_KEY: Record<string, AgentTeamsLocaleKey>;
/**
 * Member role display title: canonical keys map to the localized military
 * title; anything unknown falls back to the raw role text (never blank,
 * never throws).
 */
export declare function roleTitle(role: string, t: AgentTeamsTranslate): string;
/**
 * Member name display title: when a member is named after a canonical role
 * key (or a display variant such as `engineer-v2`), show the localized
 * military title instead of the raw English key. Any other name (real
 * person, mailbox address, …) is returned unchanged — the data layer's
 * assignee matching and prompt identity keep using the original name.
 */
export declare function nameTitle(name: string, t: AgentTeamsTranslate): string;
/** True when the name itself is a canonical role name — the role title is
 * then already expressed by the name, so the role chip can be omitted.
 * Recognizes both plain role names (`技术员`, `engineer`) and auto-numbered
 * names (`技术员 一号`, legacy `技术员一号`). */
export declare function isRoleName(name: string): boolean;
//# sourceMappingURL=roles.d.ts.map