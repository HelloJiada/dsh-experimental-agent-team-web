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
export const TEAM_TOOL_NAMES = [
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_create_task',
  'agent_teams_triage_finding',
  'agent_teams_reassign_task',
  'agent_teams_claim_task',
  'agent_teams_update_task',
  'agent_teams_review_task',
  'agent_teams_send_message',
  'agent_teams_status',
  'agent_teams_retro_review',
  'agent_teams_best_practices',
  'agent_teams_set_mode',
  'agent_teams_delete',
] as const

/**
 * Captain-only tools: creating/removing members, creating or reassigning work,
 * gated review ownership, retrospective calibration and the shared practice
 * library. A member never gets these — they are neither installed into a
 * member's scope nor, on a harness with global registration, left visible
 * (see `members.ts` `memberDeniedTools`).
 */
export const CAPTAIN_ONLY_TOOL_NAMES = [
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_reassign_task',
  'agent_teams_create_task',
  'agent_teams_triage_finding',
  // R-29/F-11:retro_review(队长校准)与 best_practices(经验库/校准统计)同为
  // 队长专属——运行期 requireCaptainTeam 守卫本就拒绝成员,但在成员工具列表
  // 里出现两个"永远报错"的工具浪费 token 且误导,与 create/add_member 等
  // 保持同一套"队长专属"口径。
  'agent_teams_retro_review',
  'agent_teams_best_practices',
  'agent_teams_delete',
] as const

/** The member-visible subset: claim/update/review work, message, read status, set mode. */
export const MEMBER_TOOL_NAMES = TEAM_TOOL_NAMES.filter(
  name => !(CAPTAIN_ONLY_TOOL_NAMES as readonly string[]).includes(name),
)
