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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type AgentTeamsRuntime, type ToolsConfig } from './tools.ts';
/**
 * The 14 collaboration tools activated together, in protocol order.
 *
 * MUST stay identical to what {@link registerAgentTeamsTools} registers: this
 * list is the `Tools:` line the captain protocol ends with, so a name that is
 * registered but unlisted (or listed but absent) quietly misleads the model —
 * `agent_teams_set_mode` was missing here until this list was pinned by
 * `activation.test.ts`.
 */
export declare const TEAM_TOOL_NAMES: readonly ["agent_teams_create", "agent_teams_add_member", "agent_teams_remove_member", "agent_teams_create_task", "agent_teams_reassign_task", "agent_teams_claim_task", "agent_teams_update_task", "agent_teams_review_task", "agent_teams_send_message", "agent_teams_status", "agent_teams_retro_review", "agent_teams_best_practices", "agent_teams_set_mode", "agent_teams_delete"];
/**
 * Prompt-section name shared by the always-on hint and the activated
 * protocol. The agent-scoped protocol registers under this same name so it
 * SHADOWS the hint rather than joining it.
 */
export declare const AGENT_TEAMS_USAGE_SECTION = "agent-teams:usage";
/** Name of the always-on activation tool. */
export declare const AGENT_TEAMS_ACTIVATION_TOOL = "agent_teams_activate";
/** The model-facing usage policy: when and how to drive AgentTeams. */
export declare function usageSectionText(toolNames: string): string;
/**
 * The always-on hint: the only AgentTeams text an ordinary session pays for
 * (~130 tokens). It must say three things — the feature exists, how to load
 * it, and that the team tools do not exist yet.
 */
export declare function activationHintText(): string;
/** Whether this live agent already has the AgentTeams surface installed. */
export declare function isAgentTeamsActivated(agent: Agent): boolean;
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
export declare function activateAgentTeams(agent: Agent, config: ToolsConfig, sectionOrder: number, runtime?: AgentTeamsRuntime): boolean;
/**
 * Register the always-on pieces for `registration: 'eager'`: the full 14-tool
 * surface plus the captain protocol in the PLUGIN ROOT (the global layer),
 * with no activation step at all.
 *
 * This is the v0.1.14 shape, kept because on-demand activation cannot deliver
 * on every harness: a harness that joins a subagent child to its parent's
 * PRESET instead of inheriting the parent AGENT scope (DSH `0.1.5-rc.2`, see
 * `@deepseek-ai/dsh-subagent` `applyChildComposition`) leaves members with
 * none of the team tools — and the member deny-filter cannot even name them,
 * because `tools.restrict()` accepts only global or ancestor-scope names.
 * Global registration reaches every agent, so members get the tools and the
 * per-child deny filter compiles.
 *
 * @param ctx - the plugin root context.
 * @param config - resolved tool config.
 * @param sectionOrder - prompt-section order for the protocol.
 * @param runtime - process-wide runtime from {@link installAgentTeamsRuntime}.
 */
export declare function registerAgentTeamsSurface(ctx: Context, config: ToolsConfig, sectionOrder: number, runtime?: AgentTeamsRuntime): void;
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
export declare function registerAgentTeamsActivation(ctx: Context, config: ToolsConfig, sectionOrder: number, runtime?: AgentTeamsRuntime): void;
//# sourceMappingURL=activation.d.ts.map