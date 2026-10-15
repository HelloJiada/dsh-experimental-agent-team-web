# Compatibility

## Required host packages

The plugin peers accept the public DSH `0.2.0-rc.2` and `0.2.1-alpha.x` package lines
(`>=0.2.0-rc.2 <0.3.0-0`), and the development dependencies are pinned to
`0.2.0-rc.2` for typecheck and tests. `0.2.1-alpha.1` replaced the continuable
child-start call `subagents.startContinuable()` with `subagents.startActivation()`;
this plugin detects which one the running DSH exposes and uses it, and it declares
the `dsh-client-ui-slots` peer both lines ship. Typecheck, unit tests, build, and
packed-artifact checks pass against `0.2.0-rc.2`, and the same source is verified
against `0.2.1-alpha.2`. The plugin layer loads in the desktop profile with no
compatibility issue for this package; six unrelated optional profile bundles are
skipped because they are not resolvable from that profile/install. Live
Web/member-spawn smoke remains unverified until a DSH runtime has loaded this build.

`@deepseek-ai/dsh-experimental-agent-team-web` ships its own self-contained
AgentTeams kernel (roster, durable mailbox, shared task DAG, scheduler,
commissar gate, retrospectives). It does **not** require the unpublished
`@deepseek-ai/dsh-experimental-agent-team` package, and it does not require a
local DeepSeek Harness checkout.

## Supported DSH versions

| Plugin version | DSH version | Notes |
|---|---|---|
| 0.1.33 | 0.2.0-rc.2 – 0.2.1-alpha.x | Current target package line. Subagent child-start is detected at runtime (`startActivation` on `0.2.1-alpha.x`, `startContinuable` on `0.2.0-rc.x`); DSH peers accept `>=0.2.0-rc.2 <0.3.0-0`. Typecheck/tests/build/artifact pass against `0.2.0-rc.2`, and the same source typechecks and passes tests against `0.2.1-alpha.2`. Live Web/member-spawn smoke remains unverified. |
| 0.1.32 | 0.2.1-alpha.2 | Superseded: peers pinned exactly to `0.2.1-alpha.2`, and it called `startActivation` unconditionally, so DSH `0.2.0-rc.2` (and earlier lines) rejected it at the compatibility gate. |
| 0.1.16 | 0.1.3-alpha.2 / 0.1.5-rc.2 | Root service context: tool bodies take injected services from the plugin root instead of the session scope. Added `registration: 'lazy' | 'eager'` — `eager` installs the whole surface globally for harnesses that join a subagent child to its parent preset instead of inheriting the parent agent scope. |
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

On-demand activation assumes the harness lets a subagent child inherit its
parent **agent scope**. DSH `0.2.0-rc.2` / `0.2.1-alpha.x` do not: in
`packages/subagent/subagent/src/child-agent.ts`,
`applyChildComposition(childCtx, parent, composition)` first calls
`agentPresets.composeFrom(childCtx, parent.ctx)` — joining the child to the
parent's **preset generation** — and only afterwards applies
`childCtx.tools.restrict(composition.toolFilter)`. An ad-hoc `agent.ctx`
registration (the captain's `lazy` path) is therefore invisible to members.
The plugin handles this without eager/global registration: its `agent/pre-step`
hook resolves active member identity and installs the member-visible subset in
the member's own scope before request assembly. This lazy member-scope design
was observed end-to-end on DSH `0.1.7-rc.2`; runtime behavior on the
`0.2.0-rc.2` / `0.2.1-alpha.x` lines is not yet verified.

`registration: 'lazy'` (**default**) keeps idle sessions at the hint-only cost.
The captain receives the full surface on activation; an active member receives
only `MEMBER_TOOL_NAMES` at its first pre-step. Captain-only tools are absent
from the member scope rather than denied by name, so the child preset's
`tools.restrict()` need not resolve those names. `registration: 'eager'` remains
a fallback for a harness where even a member's own scope cannot receive
registrations: it installs the full surface in the global layer at mount, and
the per-child deny filter compiles, at ~4.9k tokens/request in every session.

```yaml
- id: agent-team-web
  inject: [sessionProjections]
  config:
    registration: eager
    # … the rest of your row config
```
