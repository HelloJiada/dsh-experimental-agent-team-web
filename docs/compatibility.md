# Compatibility

## Required host packages

- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-invariants`

`@deepseek-ai/dsh-experimental-agent-team-web` ships its own private runtime surface; no separate upstream Agent Teams package is required.

## Supported DSH versions

| Plugin version | DSH version | Notes |
|---|---|---|
| 0.1.x | 0.1.x | Experimental compatibility only |

If DeepSeek Harness changes Team event shapes, session projection contracts, or web client slot interfaces, this package may require corresponding updates.
