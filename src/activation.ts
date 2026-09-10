/**
 * On-demand activation of the AgentTeams surface.
 *
 * WHY THIS EXISTS: registering the 14 `agent_teams_*` tools plus the captain
 * protocol globally charges EVERY request of EVERY session in the profile —
 * measured on a live profile at ~12.4k characters of tool schemas (~3.1k
 * tokens) plus a 5.5k-character prompt section (~1.4k tokens), i.e. ~4.5k
 * tokens per request even in sessions that never use AgentTeams.
 *
 * So the plugin ships two tiny always-on pieces instead — a hint section
 * (~130 tokens) and one activation tool (~85 tokens) — and installs the real
 * surface into the CALLING AGENT'S OWN scope at activation
 * ({@link activateAgentTeams}):
 *
 * - a scoped section named `agent-teams:usage` SHADOWS the global hint for
 *   that agent alone (`packages/core/system-prompt/src/index.ts` "Scoped
 *   sections shadow globals", and the shadowed provider is not even
 *   evaluated);
 * - scoped tool registrations unwind when the agent is disposed, so nothing
 *   leaks into later sessions on the same server;
 * - child scopes inherit an ancestor's contributions, so the team members
 *   spawned by the captain keep their team tools
 *   (`packages/core/tools/tests/scoped.spec.ts`).
 *
 * Activation is reachable three ways, all landing on the same idempotent
 * function: this module's `agent_teams_activate` tool (natural language),
 * the `/agent-teams <goal>` host command, and the plain-text gesture
 * boundary in `command.ts` (headless surfaces).
 *
 * @module dsh-agent-team-web/activation
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerAgentTeamsTools, type AgentTeamsRuntime, type ToolsConfig } from './tools.ts'

/**
 * The 14 collaboration tools activated together, in protocol order.
 *
 * MUST stay identical to what {@link registerAgentTeamsTools} registers: this
 * list is the `Tools:` line the captain protocol ends with, so a name that is
 * registered but unlisted (or listed but absent) quietly misleads the model —
 * `agent_teams_set_mode` was missing here until this list was pinned by
 * `activation.test.ts`.
 */
export const TEAM_TOOL_NAMES = [
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_create_task',
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
 * Prompt-section name shared by the always-on hint and the activated
 * protocol. The agent-scoped protocol registers under this same name so it
 * SHADOWS the hint rather than joining it.
 */
export const AGENT_TEAMS_USAGE_SECTION = 'agent-teams:usage'

/** Name of the always-on activation tool. */
export const AGENT_TEAMS_ACTIVATION_TOOL = 'agent_teams_activate'

/** The model-facing usage policy: when and how to drive AgentTeams. */
export function usageSectionText(toolNames: string): string {
  return `When the user asks to run something with AgentTeams (e.g. "use AgentTeams to do X"), or an activation message from the /agent-teams slash command arrives, you are the captain of a multi-agent team. Follow this protocol:
1. Reuse the current active team by default for follow-up work in the same session. If you already lead an active team, keep using it and create new tasks inside it; call agent_teams_create only when no active team exists yet, the current team is clearly unsuitable for the new goal, or the user explicitly asks for a new team. When you do create one, you become the captain and may lead one team at a time. Choose the collaboration mode deliberately: "light" for a small, low-risk goal where one executor suffices (no commissar is created and gated tasks are refused), "standard" (default) for normal work, or "governed" when independent oversight must be guaranteed (the commissar cannot be removed). A light team can be upgraded later with agent_teams_set_mode; downgrading to light is refused.
2. Call agent_teams_add_member for each executing role the goal needs — 7 preset behavioral roles, one member each by default: 侦察参谋 researcher (想清楚: read code/docs first → root cause + plan → self-check → hand off), 技术员 engineer (做出来: implement per plan → self-test → diff summary), 质检员 qa (验明白: checklist first → verify → pass/reject with evidence), 文宣干事 designer (好看: visual plan with concrete values), 情报分析员 data (算清楚: define metrics → collect → reviewable report), 文书 docs (写明白: structure first → write with spec → sync-check against reality), 警卫员 security (护边界: map the trust perimeter → probe exposure → grade with exploit scenarios → verify the positive side); a reviewer (审查员) is a task-level dynamic role — add one when dedicated review is needed. operator 后勤保障员 is not preset — pass it as a custom role string only when the goal really needs it. A commissar (政委) member for independent oversight is auto-created with the team; do not add a second one. The captain is fixed at 1 and the commissar at 1; each executing role may have up to 1 member by default (每角色默认 1 人，上限可配置), and the team total is capped at 18 members (队长 1 + 政委 1 + 执行成员) — exceeding either cap is rejected. The recommended handoff path is researcher → engineer → qa (docs 文书 joins when the deliverable needs formal documentation), but only when each step truly depends on the previous one — there is no forced pipeline: independent work stays parallel, and tasks become sequential only through explicit dependencies. Members are durable subagents: they wait for your messages, then work a full turn. By default a member on your current provider/model snapshots your current reasoning effort; a member routed to a different provider or model automatically uses that target model's default effort. Never ask the user to choose these per member; only pass provider/model when the user explicitly requests a different route for that role, and reasoning_effort only when the user explicitly requests a particular effort ("default" explicitly selects the target model's default).
3. Break the goal into tasks with agent_teams_create_task and wire dependencies. Assign role-specific work when useful; unassigned ready work belongs to the shared pool. agent_teams_create_task and agent_teams_status surface keyword-based role suggestions (调研→researcher、实现→engineer、验收→qa、视觉→designer、数据→data、文档→docs) as advisory hints only — confirm or override them via the existing assignee flow, they never auto-dispatch. The scheduler automatically claims one ready task for each truly idle member and wakes it, including across later rounds. Tasks marked risk=high/critical or milestone=true fall under the commissar gate: they can only be marked completed after the commissar passes them with agent_teams_review_task (verdict=pass); a rejected completion notifies the commissar automatically. In light mode such tasks are refused at creation instead, so raise the mode first (agent_teams_set_mode) rather than weakening the risk level to make the task fit.
4. Lead by delegation: monitor with agent_teams_status, send guidance with agent_teams_send_message, and let idle teammates execute ready work. Do not duplicate a teammate's work merely because its turn is slow. If the user requires every member to contribute or report, create one task per required contribution (or message each member directly); never wait for an unassigned member to produce work it was never given.
5. If the user explicitly asks to pause a running member, its open attempt remains parked after interruption; after answering the user, send that same member guidance with agent_teams_send_message so it continues the same attempt. Do not interrupt members for an ordinary user question that did not request a pause. If work must change owner, restart from scratch, or be taken over, call agent_teams_reassign_task first. Reassign to another idle member, retry with the same member, or use assignee=captain before doing it yourself. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Check status after progress notifications until every required task is terminal and every member is idle/ready; do not busy-poll or require reports from members with no assigned work.
7. Present the team's results to the user and keep the team alive by default for follow-up work in the same session. Do not call agent_teams_delete just because the current tasks finished. Only close/archive the team when the user explicitly asks to close it, archive it, end it, or clearly abandons that team.

Tools: ${toolNames}`
}

/**
 * The always-on hint: the only AgentTeams text an ordinary session pays for
 * (~130 tokens). It must say three things — the feature exists, how to load
 * it, and that the team tools do not exist yet.
 */
export function activationHintText(): string {
  return [
    'AgentTeams (multi-agent teamwork: you become the captain of a team of durable members sharing a task board) is installed but NOT loaded — its tool set and the full captain protocol load on demand, so ordinary sessions do not pay for them.',
    'When the user asks for AgentTeams (e.g. "use AgentTeams to do X") or wants multi-agent / orchestrated work, call agent_teams_activate first; a `/agent-teams <goal>` message activates the same surface. Activation is per session and idempotent, and the agent_teams_* tools plus the full protocol appear from your next step — never call agent_teams_* before activating.',
  ].join('\n')
}

/**
 * Agents whose own scope already carries the activated surface.
 *
 * Keyed on the live Agent object, which is exactly the lifetime of the scope
 * the registration rides: a resumed session gets a fresh Agent (and a fresh,
 * empty scope), so it re-activates instead of silently seeing a stale bit.
 * WeakSet, so nothing accumulates across sessions.
 */
const activatedAgents = new WeakSet<Agent>()

/** Whether this live agent already has the AgentTeams surface installed. */
export function isAgentTeamsActivated(agent: Agent): boolean {
  return activatedAgents.has(agent)
}

/**
 * Install the AgentTeams surface into one agent's own scope: the 14 team
 * tools plus the full captain protocol, shadowing the always-on hint. The
 * caller's scope is what makes this cheap — every other session in the
 * profile keeps paying only the hint.
 *
 * Idempotent per live agent: a repeat call is a no-op returning `false`
 * (re-registering a name in the same layer throws, and the hint must not
 * flip back).
 *
 * @param agent - the captain agent activating; its `ctx` receives the surface.
 * @param config - resolved tool config (shared with the plugin root).
 * @param sectionOrder - prompt-section order for the protocol (default `117`).
 * @param runtime - process-wide runtime installed once at plugin mount.
 * @returns `true` when this call installed the surface, `false` when it was already there.
 */
export function activateAgentTeams(
  agent: Agent,
  config: ToolsConfig,
  sectionOrder: number,
  runtime?: AgentTeamsRuntime,
): boolean {
  if (activatedAgents.has(agent)) return false
  registerAgentTeamsTools(agent.ctx, config, runtime)
  agent.ctx.systemPrompt.section({
    name: AGENT_TEAMS_USAGE_SECTION,
    order: sectionOrder,
    text: usageSectionText(TEAM_TOOL_NAMES.join(', ')),
  })
  activatedAgents.add(agent)
  return true
}

/**
 * Register the two always-on pieces on the plugin root: the hint section and
 * the activation tool. Everything else in this plugin stays unloaded until
 * an agent activates.
 *
 * @param ctx - the plugin root context (injects `tools` + `systemPrompt`).
 * @param config - resolved tool config handed to each activation.
 * @param sectionOrder - prompt-section order (default `117`).
 * @param runtime - process-wide runtime installed once at plugin mount.
 */
export function registerAgentTeamsActivation(
  ctx: Context,
  config: ToolsConfig,
  sectionOrder: number,
  runtime?: AgentTeamsRuntime,
): void {
  ctx.systemPrompt.section({
    name: AGENT_TEAMS_USAGE_SECTION,
    order: sectionOrder,
    text: activationHintText(),
  })

  ctx.tools.register(defineTool({
    name: AGENT_TEAMS_ACTIVATION_TOOL,
    description: 'Load the AgentTeams surface for this session: installs the agent_teams_* collaboration tools and the full captain protocol, which are otherwise not loaded so that ordinary sessions stay cheap. Call this when the user asks to use AgentTeams or for multi-agent / orchestrated work, then follow the protocol. Idempotent; the tools and protocol appear on your next step.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activated: { type: 'boolean', required: true },
          tool_count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.activated
          ? `AgentTeams activated: the ${value.tool_count} agent_teams_* tools and the full captain protocol are now installed for this session and appear from your next step. Re-read the AgentTeams section of your instructions, then lead: create the team with agent_teams_create, add the members the goal needs, break the goal into tasks with dependencies, and drive it by delegation.`
          : `AgentTeams was already active in this session (${value.tool_count} tools installed). Continue as captain; do not create a second team for the same goal.`,
      }],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error(`${AGENT_TEAMS_ACTIVATION_TOOL} requires a calling agent (exec.agent was undefined)`)
      }
      const activated = activateAgentTeams(agent, config, sectionOrder, runtime)
      return { activated, tool_count: TEAM_TOOL_NAMES.length }
    },
  }))
}
