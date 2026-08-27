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
/** 1 → 一 … 9 → 九, 10 → 十; any other value falls back to the raw number. */
export declare function zhNumber(value: number): string;
/**
 * The display title of a role: the localized military title when the role
 * canonicalizes to a known key (engineer → 技术员, researcher → 侦察参谋,
 * reviewer → 审查员, commissar → 政委), otherwise the raw role text.
 */
export declare function roleDisplayTitle(role: string | undefined): string;
/**
 * Whether a provided name is "just the role" — empty, the raw role text, or
 * the role's display title — in which case auto-numbering applies.
 */
export declare function isRoleOnlyName(name: string, role: string | undefined): boolean;
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
export declare function resolveMemberName(providedName: string | undefined, role: string | undefined, sameRoleActiveCount: number): string;
//# sourceMappingURL=member-naming.d.ts.map