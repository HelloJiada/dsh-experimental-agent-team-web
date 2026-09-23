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
/** Per-role default LLM selection for members (auto-assign model + effort). */
export interface MemberLlmDefaults {
    /** Provider route; requires an explicit model. Omit to inherit the captain's. */
    provider?: string;
    /** Model id (e.g. `deepseek-v4-pro`). */
    model?: string;
    /** Reasoning effort (`off`/`low`/`high`/`max`) or `default` for the model default. */
    reasoningEffort?: string;
}
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
     * auto-created and uniqueness-gated). `maxExecPerRoleByRole` overrides this
     * per canonical role key (e.g. `{ engineer: 2 }` allows two engineers). */
    maxExecPerRole?: number;
    /** Per-role overrides for the executing-role cap, keyed by canonical role
     * (e.g. `{ engineer: 2 }`). A role not listed falls back to `maxExecPerRole`
     * (default 1). Values must be ≥ 1. */
    maxExecPerRoleByRole?: Record<string, number>;
    /** Per-role default LLM selection for members (auto-assign model + effort).
     * Keyed by canonical role key (e.g. `{ security: { model: 'deepseek-v4-pro',
     * reasoningEffort: 'max' } }`). A role with no entry falls back to the
     * built-in role table, then to inheriting the captain's route. An explicit
     * provider/model on add_member always wins. */
    roleLlmDefaults?: Record<string, MemberLlmDefaults>;
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
    /**
     * How the 14 `agent_teams_*` tools reach the model.
     *
     * `lazy` (default): only a hint section plus `agent_teams_activate` are
     * always on, and the real surface is installed into the activating session's
     * own scope. Cheapest for sessions that never use AgentTeams, but it
     * requires the harness to let a subagent child inherit its parent AGENT
     * scope's registrations. DSH `0.1.5-rc.2` does not: a child joins its
     * parent's PRESET (`@deepseek-ai/dsh-subagent`,
     * `applyChildComposition` → `agentPresets.composeFrom(childCtx, parent.ctx)`),
     * so members see none of the team tools and the member deny-filter cannot
     * even name them — `tools.restrict()` accepts only global or ancestor-scope
     * names, and it throws `unknown global tool "agent_teams_create"…` before
     * the first member exists.
     *
     * `eager`: register the whole surface in the global layer at mount — the
     * v0.1.14 shape. Every session pays the full ~4.9k tokens/request, and
     * members get the tools by global inheritance while the captain-only ones
     * are denied per child scope. Required on harnesses where child scopes join
     * the parent preset instead of inheriting the parent agent scope.
     */
    registration?: 'lazy' | 'eager';
    /** 模型调度授权(key `${provider}/${model}` → true 授权)。设置页写面字段,
     * 必须 volatile;缺省 = 空 map(仅 deepseek-official 恒授权)。 */
    enabledModels?: Record<string, boolean>;
    /** 角色档位覆盖(roleKey → 档位)。设置页写面字段,必须 volatile;缺省回落到
     * profile.roleLlmDefaults → 内置 DEFAULT_ROLE_LLM。 */
    roleDefaults?: Record<string, MemberLlmDefaults>;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map