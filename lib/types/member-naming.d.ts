/**
 * Role-based member naming for `agent_teams_add_member`.
 *
 * When the captain omits a name (or passes only the role), the member is
 * named after the role title itself — 技术员, 侦察参谋, 情报分析员, … — with no
 * ordinal suffix (each role defaults to a single member, so a number adds
 * nothing). Only when a second member of the same role is added (the
 * per-role cap is configurable) does the auto-name fall back to a numbered
 * suffix: `<role title> <Chinese ordinal>号` (技术员 二号). The ordinal derives
 * from the active member count of the same canonical role (via
 * `role-limits.ts`, so numbering and the per-role cap agree), and the Chinese
 * title comes from the client role/locale tables. The commissar is unique and
 * keeps the plain 政委 title (no number); an explicit custom name is always
 * respected as-is — including legacy numbered names like 技术员 一号.
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
 * the role's display title — in which case role-based naming applies.
 */
export declare function isRoleOnlyName(name: string, role: string | undefined): boolean;
/**
 * Resolve the final member name. An explicit name that is not just the role is
 * respected unchanged (including legacy numbered names like 技术员 二号). A
 * missing or role-only name is named after the role title itself (`<title>`,
 * e.g. 技术员) — no ordinal, since each role defaults to a single member. When
 * a second member of the same role is added (per-role cap raised), the name
 * falls back to `<title> <ordinal>号` (e.g. 技术员 二号) to stay unique. The
 * commissar keeps the unique 政委 title without a number. Roles without a
 * known title and without an explicit name cannot be named.
 * @param providedName - the caller-supplied name (may be empty/undefined).
 * @param role - the member's role text.
 * @param sameRoleActiveCount - active members of the same canonical role.
 * @returns the resolved member name.
 */
export declare function resolveMemberName(providedName: string | undefined, role: string | undefined, sameRoleActiveCount: number): string;
//# sourceMappingURL=member-naming.d.ts.map