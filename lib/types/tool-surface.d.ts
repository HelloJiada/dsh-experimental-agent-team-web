/**
 * The AgentTeams tool surface split by who may see it.
 *
 * Three consumers must agree on exactly these names, so they live in one leaf
 * module (no imports, therefore no cycle): `activation.ts` registers the
 * captain surface into the activating session's scope, `tools.ts` filters the
 * same registrations down to the member subset for a member's own scope, and
 * `members.ts` derives its per-child deny list from the captain-only list.
 *
 * `TEAM_TOOL_NAMES` MUST stay identical to what `registerAgentTeamsTools`
 * registers — it is also the `Tools:` line the captain protocol ends with, so a
 * name that is registered but unlisted (or listed but absent) quietly misleads
 * the model; `activation.test.ts` pins the correspondence.
 *
 * @module dsh-agent-team-web/tool-surface
 */
/** Every collaboration tool this plugin exposes, in protocol order. */
export declare const TEAM_TOOL_NAMES: readonly ["agent_teams_create", "agent_teams_add_member", "agent_teams_remove_member", "agent_teams_create_task", "agent_teams_triage_finding", "agent_teams_reassign_task", "agent_teams_claim_task", "agent_teams_update_task", "agent_teams_review_task", "agent_teams_send_message", "agent_teams_status", "agent_teams_retro_review", "agent_teams_best_practices", "agent_teams_set_mode", "agent_teams_delete"];
/**
 * Captain-only tools: creating/removing members, creating or reassigning work,
 * gated review ownership, retrospective calibration and the shared practice
 * library. A member never gets these — they are neither installed into a
 * member's scope nor, on a harness with global registration, left visible
 * (see `members.ts` `memberDeniedTools`).
 */
export declare const CAPTAIN_ONLY_TOOL_NAMES: readonly ["agent_teams_create", "agent_teams_add_member", "agent_teams_remove_member", "agent_teams_reassign_task", "agent_teams_create_task", "agent_teams_triage_finding", "agent_teams_retro_review", "agent_teams_best_practices", "agent_teams_delete"];
/** The member-visible subset: claim/update/review work, message, read status, set mode. */
export declare const MEMBER_TOOL_NAMES: ("agent_teams_create" | "agent_teams_add_member" | "agent_teams_remove_member" | "agent_teams_create_task" | "agent_teams_triage_finding" | "agent_teams_reassign_task" | "agent_teams_claim_task" | "agent_teams_update_task" | "agent_teams_review_task" | "agent_teams_send_message" | "agent_teams_status" | "agent_teams_retro_review" | "agent_teams_best_practices" | "agent_teams_set_mode" | "agent_teams_delete")[];
//# sourceMappingURL=tool-surface.d.ts.map