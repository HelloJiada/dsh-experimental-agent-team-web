/**
 * Military-role display titles for member roles: canonical role keys stay
 * English in the data layer; the UI renders the localized title instead.
 * The preset catalog is the captain, the 6 behavioral executing roles
 * (researcher / engineer / qa / designer / data / docs), the task-level reviewer,
 * and the commissar. security / operator are not preset — they are
 * custom roles with no dedicated seat or behavior template — but their
 * display titles are kept in the tables so legacy members and custom role
 * strings still resolve (降级 = 不出现在预设清单/协议/模板, 不是删除显示映射).
 * @module dsh-agent-team-web/client/roles
 */
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts';
/** Canonical role key → military-title locale key (see `role.*` in locales.ts).
 * Preset: captain + the 6 behavioral executing roles + reviewer + commissar.
 * security / operator are compatibility entries for legacy members and
 * custom role strings (not preset, no dedicated seat or behavior template). */
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