/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * section into the global system prompt. After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-web`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module agent-team-web
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "agent-team-web";
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /**
     * State directory name under the captain's workspace; team state lives at
     * `<workspace>/<stateDir>/<teamId>/` (default `.agent-team-web`).
     */
    stateDir?: string;
    /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
    memberProvider?: string;
    /** Optional model override applied to every member. */
    memberModel?: string;
    /** Member delegation depth cap (default `1`; `0` forbids delegation entirely). */
    memberMaxDepth?: number;
    /** Team size cap in members, including captain and commissar (default `18`). */
    maxMembers?: number;
    /** Per executing-role member cap (default `1`): each executing role
     * (the 7 preset behavioral roles engineer/researcher/data/qa/designer/docs/security,
     * the task-level reviewer, and any custom role string) may have up to this many
     * members; captain and commissar are exempt (captain fixed at 1, commissar
     * auto-created and uniqueness-gated). */
    maxExecPerRole?: number;
    /** A member-owned claimed/in-progress task is considered stalled (and
     * eligible for a teammate's self-organizing help) after this many
     * milliseconds without an update (default `120_000` = 2 minutes). */
    stallThresholdMs?: number;
    /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
    promptSectionOrder?: number;
    /**
     * Register the deterministic `/agent-teams` activation surfaces (the
     * closed-namespace slash command and the plain-text gesture boundary).
     * Disable to keep the natural-language trigger as the only entry point.
     */
    slashCommand?: boolean;
    /**
     * Non-loopback authorities the AgentTeams web routes accept, mirroring the
     * harness `/api` browser-trust fence contract: bare `host` or `host:port`
     * entries. The default empty list accepts only loopback Hosts, so an
     * all-interfaces bind cannot be read or closed by an unconfigured LAN
     * caller even though the served HTML exposes the boot token.
     */
    trustedHosts?: string[];
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map