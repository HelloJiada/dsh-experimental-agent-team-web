# @deepseek-ai/dsh-experimental-agent-team-web

External Agent Teams web bundle for DeepSeek Harness.

This package adds a read-only Agent Teams web surface as an external installable DSH bundle, rather than shipping Team UI inside the default `dsh web` profile.

## Status

**Experimental**

This package is intended for experimental and internal use first.
It depends on DeepSeek Harness package interfaces that may still evolve.

## What this package does

This bundle provides two halves:

- a host-side session projection for committed Agent Teams records;
- a client-side web view for displaying Team data in the conversation UI.

When installed into a compatible DSH profile, it adds:

- an `agentTeam` session projection;
- a Team conversation view tab;
- a read-only Team UI showing roster, task board, and Team mailbox state.

## What this package does not do

This package does not currently provide:

- Team mutations from the web UI;
- live runtime-only agent status transport;
- a standalone Team dashboard route;
- default inclusion in `dsh web`;
- compatibility with arbitrary DSH versions.

## Source of truth

The only authority is the Lead/root session committed Agent Teams event log.

This package does not maintain a second Team authority store in the browser, does not use demo or mock Team data as runtime fallback, and does not fabricate Team facts that are not present in committed Team records.

## Installation

Install the package into an environment that already includes compatible DeepSeek Harness packages.

Then add the bundle to your DSH profile, for example:

```yaml
plugins:
  - "@deepseek-ai/dsh-experimental-agent-team-web"
```

Or include its bundle patch directly.

## Requirements

This package expects a compatible DSH environment with at least:

- `@deepseek-ai/dsh-experimental-agent-team`
- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `react`

It is not intended to run as a standalone app.

## Compatibility

See `docs/compatibility.md` for supported DeepSeek Harness version ranges.

## Bundle behavior

### Without this bundle

A normal `dsh web` profile should start without any Team UI from this package.

### With this bundle installed

A compatible profile gains Team projection registration on the host and Team UI registration on the client.

### After uninstall

Removing the bundle should remove the Team projection, the Team conversation view entry, and the Team UI surface.

## Browser contract

The bundle exposes a browser-safe Team DTO through the `agentTeam` session projection.

The projection value is:

- `null` when the current session has no committed Team records;
- a Team view object when Team records exist.

The view contains only committed Team facts needed by the UI.

## Development

Typical local workflow:

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

## Known limitations

- Read-only Team UI only.
- No live runtime status channel.
- Depends on compatible DSH internal package contracts.
- Experimental Agent Teams runtime remains a required host-side dependency.

## License

MIT
