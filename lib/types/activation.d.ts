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
export { CAPTAIN_ONLY_TOOL_NAMES, MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from './tool-surface.ts';
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
 * Install the member-visible surface into one member's own scope.
 *
 * This is what keeps `registration: 'lazy'` usable on a harness whose subagent
 * children join the parent PRESET instead of inheriting the parent agent scope
 * (verified on DSH `0.1.7-rc.2`): the captain's own scope is unreachable from a
 * member, but the member's scope is ours to fill, and `agent/pre-step` runs
 * before that step's request is assembled. Only {@link MEMBER_TOOL_NAMES} are
 * registered, so the captain-only tools are absent rather than merely denied —
 * which also means no `tools.restrict({ deny })` name has to resolve globally.
 *
 * Idempotent per live agent, sharing {@link activatedAgents} with the captain
 * path: an agent is either a captain or a member in this plugin's model, never
 * both, and either way it must not receive a second layer.
 *
 * @param agent - the member agent whose `ctx` receives the subset.
 * @param config - resolved tool config (shared with the plugin root).
 * @param runtime - process-wide runtime installed once at plugin mount.
 * @returns `true` when this call installed the subset, `false` when it was already there.
 */
export declare function activateMemberAgentTeams(agent: Agent, config: ToolsConfig, runtime?: AgentTeamsRuntime): boolean;
/**
 * Install the member-scope activation used by `registration: 'lazy'`.
 *
 * Runs inside the `agent/pre-step` waterfall, i.e. before the stepping agent's
 * request is assembled, so the tool subset is visible in that same step. Only
 * subagent children are considered (`session.header.origin === 'subagent'`),
 * which keeps the per-step cost of ordinary sessions at one property read; the
 * durable roster lookup happens only for children this process has not already
 * registered as members.
 *
 * @param ctx - host context providing the `agent/pre-step` waterfall.
 * @param config - resolved tool config.
 * @param stateDir - configured team state directory (membership fallback).
 * @param runtime - process-wide runtime installed once at plugin mount.
 * @returns a disposer removing the hook.
 */
export declare function installMemberSurfaceActivation(ctx: Context, config: ToolsConfig, stateDir: string, runtime?: AgentTeamsRuntime): () => void;
/**
 * Register the always-on pieces for `registration: 'eager'`, the fallback for
 * harnesses where even a member's own scope cannot receive registrations.
 *
 * This global-registration mode is the fallback for a harness where even a
 * member's own scope cannot receive registrations; the normal path is `lazy`
 * plus {@link installMemberSurfaceActivation}, which fills each member's scope
 * at its first pre-step. Use this one when that is not enough: it reaches every
 * agent, so the per-child deny filter also compiles — and every session pays
 * the full token cost.
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