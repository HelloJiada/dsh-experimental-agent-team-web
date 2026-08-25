# @deepseek-ai/dsh-experimental-agent-team-web

[中文](README.zh-CN.md) | English

## Status

**Experimental.** This package is intended for experimental and internal use. It follows DSH interfaces that may evolve, and supports only the compatibility line documented below.

## Overview

This external, opt-in DeepSeek Harness (DSH) bundle adds a read-only Agent Team intelligence workspace to a compatible web profile instead of placing Team UI in the default `dsh web` profile.

It provides:

- a host session projection of committed Agent Team records;
- a current-session activity badge and a lightweight transcript summary entry;
- a non-modal Team activity monitor in the shell overlay;
- read-only member, task, and Team mailbox state;
- derived Team health, alerts, recommended actions, and ranked intervention priorities;
- dependency-chain risk propagation and member load analysis;
- message delivery risk classification;
- quick-filter counts and a derived Team timeline;
- a compact monitor summary of current activity, blocked work, priorities, and member status;
- a task-dependency DAG projection/detail capability (pure-SVG layered graph, status-toned nodes, owner labels, click-to-highlight dependencies/dependents for host experiences that opt into it);
- a bounded event-history timeline (entity-coalesced, capped) with timeline summary analytics, rolling milestone windows (count- or time-based), and a command-bridge suggestion layer;
- a host-consumable Command Bridge plan envelope (`commandPlan` DTO: version, priority counts, and a command list with concrete targets, read-only and JSON-serializable);
- an adapter for the upstream `dsh-agent-teams` runtime's `agent-teams/*` session events (with `failed`/`cancelled` task states);
- a real-profile verification checklist and a deterministic end-to-end replay test (see [docs/verification-checklist.md](docs/verification-checklist.md)); and
- an empty state when the current session has no committed Team records.

It does not provide UI mutations, live runtime-only agent status, a standalone Team dashboard route, default inclusion in `dsh web`, or compatibility with arbitrary DSH versions.

## Architecture

The host bundle registers the `agentTeam` session projection. The browser bundle registers a current-session activity badge and a lightweight transcript summary entry. Either opens a non-modal Team activity monitor through the DSH shell-overlay slot. The monitor consumes the projection DTO and focuses on active or blocked work, priorities, and members; it does not embed the former full dashboard.

The projection consumes both the vendored `team/*` event vocabulary and the upstream `dsh-agent-teams` `agent-teams/*` session events through the adapter in `src/upstream.ts`; see [docs/contract-alignment.md](docs/contract-alignment.md) for the field-by-field comparison.

The bundle is opt-in: the included `cordis.patch.yml` inserts it with `sessionProjections` injection. A normal profile without this bundle has no Team UI from this package.

## Source of truth

The Lead/root session's committed Agent Team event log is the sole Team data authority. The projection exposes only committed facts required by the UI and derives explainable insights from them:

- `null` if the current session has no committed Team records;
- a Team view object when committed Team records exist.

The browser does not maintain a second authority store, use demo or mock data as a runtime fallback, or invent facts missing from committed records. The UI is read-only; it does not establish that committed Team records with data have been validated against a real sample.

## Why this direction

Instead of competing only on execution orchestration, this package aims to surpass baseline Agent Team panels through stronger Captain visibility:

- clearer Team health and risk scoring;
- actionable summaries derived from committed Team facts;
- grouped views for blocked, stalled, orphaned, ready, active, pending, and completed work;
- explicit mailbox-delivery risk surfacing;
- dependency-chain fan-out analysis and intervention priority ranking;
- quick-filter counts and a derived Team timeline for faster scanning;
- a current-session activity monitor that keeps the conversation visible while surfacing active or blocked work;
- a bounded event-history timeline (entity-coalesced, capped at 100 distinct entities) with summary analytics; and
- a command-bridge layer that derives executable command suggestions with concrete target ids (execution requires a host runtime tool layer; this bundle stays read-only).

See [docs/product-roadmap.md](docs/product-roadmap.md) for the staged plan.

## Requirements and compatibility

Use this package in a DSH profile that provides the required host packages:

- `@deepseek-ai/dsh-experimental-agent-team`
- `@deepseek-ai/dsh-session-projection`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-invariants`

`react` and the Cordis/DSH client and session interfaces are peer dependencies supplied by the compatible host environment. The supported compatibility line is plugin `0.1.x` with DSH `0.1.x`, for experimental use only. Changes to Team event shapes, session projection contracts, or client slot interfaces can require a corresponding package update. See [docs/compatibility.md](docs/compatibility.md).

## Installation

Consumers install a prebuilt bundle and do not need to build from source or fetch the DeepSeek Harness monorepo during installation.

### Release tarball

Download the tarball attached to the matching GitHub Release, then install it in the DSH profile:

```bash
cd ~/.dsh/profiles/web
pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-0.1.0.tgz
```

The release artifact is named `deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz`.

### Git installation

A direct Git installation also works because this repository commits its built `lib/` artifacts. Install it into an environment that already provides compatible DSH packages:

```bash
cd ~/.dsh/profiles/web
pnpm add git+ssh://git@github.com/HelloJiada/dsh-experimental-agent-team-web.git
```

The Agent Team runtime package must already be available in the profile; this bundle does not install it.

## Enable in a DSH profile

Add the opt-in bundle row to the profile patch. It matches the package's included `cordis.patch.yml`:

```yaml
- insert:
    - id: agent-team-web
      name: "@deepseek-ai/dsh-experimental-agent-team-web"
      inject:
        - sessionProjections
```

`dsh.client.inject` in this package's manifest declares client injection requirements. It is not a declaration of module-table externals.

For the shortest real-profile integration path, see [docs/real-profile-smoke-check.md](docs/real-profile-smoke-check.md); a reusable profile patch skeleton ships in [examples/profile-patch.agent-team-web.yml](examples/profile-patch.agent-team-web.yml), and the full checklist is in [docs/verification-checklist.md](docs/verification-checklist.md). The host-side consumption contract for `commandPlan.commands` is specified in [docs/command-bridge-execution.md](docs/command-bridge-execution.md).

## Usage

In a compatible conversation, a Team activity badge appears only when the current session has active or blocked Team work. Select the badge, or the lightweight Team summary in the transcript, to open the monitor.

On wide screens the monitor is docked by default; it can optionally be switched to a draggable, resizable floating panel. At 960px and below it becomes a compact safe-margin overlay. Panel geometry is stored locally in each browser. The monitor is informational only: members, tasks, and mailbox state cannot be changed from this UI. Selecting a member opens that member’s existing session.

The monitor does not show the full timeline, filters, dependency DAG, or command explorer by default. The dependency DAG remains available in the projection as a detail capability for host experiences that need it.

## Building, testing, and packaging

For maintainers:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test
pnpm pack
```

`pnpm pack` runs `prepack` (`build` and `test`) and produces `deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz`. Attach that prebuilt tarball to a GitHub Release. The release acceptance procedure, including checking the packed Client artifact, is in [docs/releasing.md](docs/releasing.md).

## Client bundle contract

`lib/client.js` is a browser classic-script/CJS factory bundle, not an ESM browser entry. It registers `@deepseek-ai/dsh-experimental-agent-team-web` with:

```js
window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-experimental-agent-team-web", factory: (require) => { /* ... */ } })
```

The DSH module table provides shared host runtime dependencies. In the current built client, the actual runtime externals are `react` and `react/jsx-runtime` (hooks-backed activity monitor); these must not be confused with `dsh.client.inject` metadata.

## Known limitations

- The Team activity monitor is read-only.
- There is no live runtime-status channel.
- The monitor is a shell overlay, not a standalone dashboard URL route.
- Team facts are limited to the Lead/root session's committed event log.
- This experimental package depends on compatible DSH host contracts and does not support arbitrary DSH versions.

## License

MIT
