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
| 0.1.8 | 0.1.3-alpha.2 | Self-contained kernel; public npm dependencies only |
| 0.1.0 – 0.1.5 | 0.1.1-rc.2 | Historical releases |

If DeepSeek Harness changes Team event shapes, session projection contracts, or
web client slot interfaces, this package may require corresponding updates.
