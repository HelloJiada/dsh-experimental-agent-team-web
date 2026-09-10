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
