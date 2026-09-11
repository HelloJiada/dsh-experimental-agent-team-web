# Compatibility

## Required host packages

The host DSH Web profile must provide the public DSH `0.1.3-alpha.2` package line:

- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-api-session-controller`
- `@deepseek-ai/dsh-client-store`
- `@deepseek-ai/dsh-client-ui-chat`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-client-ui-layout`
- `@deepseek-ai/dsh-client-ui-renderer`
- `@deepseek-ai/dsh-client-ui-settings`
- `@deepseek-ai/dsh-invariants`

`@deepseek-ai/dsh-experimental-agent-team-web` ships its own self-contained
AgentTeams kernel (roster, durable mailbox, shared task DAG, scheduler,
commissar gate, retrospectives). It does **not** require the unpublished
`@deepseek-ai/dsh-experimental-agent-team` package, and it does not require a
local DeepSeek Harness checkout.

## Supported DSH versions

| Plugin version | DSH version | Notes |
|---|---|---|
| 0.1.16 | 0.1.3-alpha.2 / 0.1.5-rc.2 | Root service context: tool bodies take injected services from the plugin root instead of the session scope. New `registration: 'lazy' | 'eager'` — `eager` installs the whole surface globally for harnesses that join a subagent child to its parent preset instead of inheriting the parent agent scope (required on 0.1.5-rc.2) |
| 0.1.15 | 0.1.3-alpha.2 | On-demand loading: the 14 team tools and the captain protocol are installed into the activating session's own scope instead of every session (measured 4.9k -> 0.27k tokens per request for inactive sessions) |
| 0.1.14 | 0.1.3-alpha.2 | Packaging hotfix: remove a stray self file: dependency that made the published tarball uninstallable |
| 0.1.13 | 0.1.3-alpha.2 | Collaboration modes: light/standard/governed with an upgrade-only mode switch and fail-closed gated tasks |
| 0.1.12 | 0.1.3-alpha.2 | Historical-session diagnostics: visible, redacted degradation without touching session logs |
| 0.1.11 | 0.1.3-alpha.2 | Portable member routes: authorization and adapter validation before spawn, no silent fallback |
| 0.1.10 | 0.1.3-alpha.2 | Self-contained kernel; canonical workspace identity; objective budget facts separate from attribution |
| 0.1.9 | 0.1.3-alpha.2 | Self-contained kernel; public npm dependencies only |
| 0.1.0 – 0.1.5 | 0.1.1-rc.2 | Historical releases |

If DeepSeek Harness changes Team event shapes, session projection contracts, or
web client slot interfaces, this package may require corresponding updates.

## Scoped registration vs injected services

Activation is on demand: the 14 `agent_teams_*` schemas are registered into the
**calling session's own scope** (`agent.ctx`), which is what keeps an inactive
session at ~270 tokens/request. Registration and *service access* are two
different contexts on purpose:

- `agent.ctx` receives only `tools.register` and the scoped protocol section;
- every service read inside a tool body (`subagents`, `agents`, `llm`) goes
  through `AgentTeamsRuntime.serviceCtx` — the **plugin root context**.

Observed on DSH `0.1.5-rc.2`: the plugin mounts, the hint and activation tool
load, and the panel route answers — but a session scope does not resolve this
plugin's injected services, so `agent_teams_create` died on its first member
spawn (the auto-created commissar) with
`cannot get property "subagents" without inject`. The panel staying healthy is
exactly what made this look like a panel problem.

Reading the row's own `inject: [sessionProjections]` as the cause is a dead end:
the loader **merges** an entry's `inject` into the plugin's static `inject`
(`vendor/loader/src/index.ts`, `Inject.resolve(entry.options.inject, fiber.inject)`
→ `vendor/cordis/src/registry.ts`), it never replaces it. Adding services to
that row therefore cannot fix a service-resolution failure; the fix belongs in
which context the bodies read from.

## Two registration modes (`registration`)

On-demand activation also assumes the harness lets a subagent child inherit its
parent **agent scope**. DSH `0.1.5-rc.2` does not: `applyChildComposition` joins
the child to its parent's **preset**
(`agentPresets.composeFrom(childCtx, parent.ctx)`), so an ad-hoc `agent.ctx`
registration is invisible to members. Two consequences, both observed:

- members see **no** `agent_teams_*` tool at all;
- `agent_teams_create` still fails first, at
  `childCtx.tools.restrict({ deny: MEMBER_DENIED_TOOLS })` →
  `tools.restrict() names unknown global tools "agent_teams_create", …`,
  because `restrict()` accepts only **global** or **ancestor-scope** names
  (`packages/core/tools` `view().restrictableNames`).

`registration: 'lazy'` (default) is the on-demand design: cheapest per idle
session, and correct on a harness whose children inherit the parent agent
scope. `registration: 'eager'` installs the full surface in the global layer at
mount (the v0.1.14 shape): every session pays the full cost, members get the
tools by global inheritance, and the per-child deny filter compiles. Use
`eager` on DSH `0.1.5-rc.2` and any harness with the same child-composition
rule.

```yaml
- id: agent-team-web
  inject: [sessionProjections]
  config:
    registration: eager
    # … the rest of your row config
```
