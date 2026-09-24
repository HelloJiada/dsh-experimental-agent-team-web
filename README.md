# @deepseek-ai/dsh-experimental-agent-team-web

[中文](README.zh-CN.md) | English

## Status

**Experimental.** This package is intended for experimental and internal use. It follows DSH interfaces that may evolve.

## DSH compatibility

Version 0.1.30 uses the package's self-contained AgentTeams kernel and is tested
against the public DSH `0.1.7-rc.1` package line. It does **not** require the
unpublished official experimental Agent Teams package or a local DSH checkout.

On `0.1.5-rc.2` set `registration: eager` (see `docs/compatibility.md`): that
harness joins a subagent child to its parent **preset** instead of inheriting
the parent **agent scope**, so on-demand activation cannot deliver the team
tools to members. `eager` installs the whole surface in the global layer (the
v0.1.14 shape) and costs the full ~4.9k tokens/request in every session.

Team state remains workspace-local under `.agent-team-web/<teamId>/`, while the
plugin provides the compatibility tools, activity panel, settings/presets,
commissar gate, retrospectives, and archive view.

## Overview

An external DeepSeek Harness (DSH) bundle that turns the current session into the captain of a multi-agent team: create continuable member agents, break goals into dependency-wired tasks, and coordinate them through direct mailbox messages — with a live activity panel and an in-conversation team card.

It provides:

- **loaded on demand**: by default it registers only one `agent_teams_activate` tool plus a two-line hint; the 14 team tools and the captain protocol are installed into the **activating session's own scope** only when activation happens (measured: an inactive session pays ~270 tokens/request instead of ~4,900). Registration stays on that scope, while tool bodies take DSH services from the plugin root context — a session scope does not resolve the plugin's injected `subagents`/`agents` (see `docs/compatibility.md`). Three equivalent, idempotent activation entries: natural language ("use AgentTeams to do X" → the model calls `agent_teams_activate`), the `/agent-teams <goal>` slash command, and its pre-step gesture boundary for surfaces without command adjudication (headless). A harness whose subagent children join the parent **preset** instead of inheriting the parent **agent scope** (DSH `0.1.5-rc.2`) cannot deliver members this way — there, set `registration: eager` to register the whole surface globally (the v0.1.14 shape: ~4,900 tokens/request in every session); see `docs/compatibility.md`;
- the full `agent_teams_*` tool suite (create/add-member/create-task/claim/update/reassign/remove/send-message/status/set-mode/delete, plus `agent_teams_retro_review` and `agent_teams_best_practices`), visible after activation to the captain **and its members** (member child scopes inherit the captain's registrations; under `registration: eager` they inherit them from the global layer);
- a disk-backed team kernel — `.agent-team-web/<teamId>/team.json` + mailbox inboxes are the single source of truth, with atomic writes and per-team locking;
- an event-driven shared-task scheduler that auto-assigns ready work to idle members and reacts to `agent/status`;
- informational `agent-team-web/*` session events appended to the captain's session;
- a server snapshot route (`GET /plugins/agent-team-web/state`, `?archived=1`) that the web client polls once per second;
- a floating **activity panel** in the shell overlay (health/progress, captain node, delegation tree, task-dependency DAG) with drag / resize / dock / collapse interactions and persisted layout;
- an in-conversation **team card** that folds the `agent_teams_create` tool call into a chat node and re-opens the floater via a window event;
- whale artwork for members, captain, and action states (`assets/agent-team-web/`).

## Settings center

DSH Settings hosts an **AgentTeam** section (`settings.section` slot, with a dedicated nav board glyph) of two cards managing model grants and role presets:

- **Model access grants**: per-provider toggles over model authorization (`enabledModels`, composite key `${provider}/${model}`); `deepseek-official` is always granted with a locked "Default" pill. Grants link with role presets — models of unauthorized providers do not appear in the role-preset dropdown.
- **Role presets**: one row per role (display name + mono id), model dropdown grouped by provider (`optgroup`), reasoning-effort dropdown editable; top-right "Reset to defaults" clears all overrides. A row-level **view button** (eye glyph, matching the DSH Agent-preset interaction) opens a role-duty dialog — slogan + working order + deliverable + key rules (full Chinese copy, source `client/roles.ts` ROLE_DUTY).
- **Three-source chain**: a role's preset = settings override → profile `roleLlmDefaults` → built-in `DEFAULT_ROLE_LLM`, falling back down the chain when unset; "Reset to defaults" clears overrides to the chain tail.
- **Grant-linked auto-assignment**: on grant changes (or page init) roles are re-assigned model + effort per `ROLE_AUTO_ASSIGN_TABLE`; manual overrides (distinguished by the `auto` flag) are preserved, unauthorized targets fall back to deepseek, and results carry `auto:true` so they can be recomputed later.
- **Generic capability adaptation**: `NO_REASONING_EFFORT_PROVIDERS` table + `supportsReasoningEffort()` lookup — models that do not support reasoning effort (e.g. cc-switch GPT-5.6) get no effort written and a disabled effort dropdown; adding a new unsupported model is one provider-id entry.

## Self-growing framework

The panel is not just a live monitor — it also gives the captain time/workload
visibility and lets the framework learn from every task:

- **Timing**: each task records `claimedAt` / `startedAt` / `completedAt`; the panel
  shows a member's current-task elapsed time and the task's total duration.
- **Estimate levels**: `agent_teams_create_task` accepts an optional `estimate_level`
  (`S` / `M` / `L`, with reference ranges `S≤15m` / `M≤45m` / `L>45m`, centrally
  adjustable). After completion the panel shows estimate-vs-actual with overrun
  badges (>1× warn, >1.5× over).
- **Output signals**: tasks also track status-change count, message count, and
  output length, so wall-clock time is never mistaken for actual throughput.
- **Retrospective on every completion**: each terminal task automatically distills a
  retro (actual vs estimate, cause classification, best-practice hint); members may
  append a `retro_note`, and the captain can calibrate verdicts via
  `agent_teams_retro_review`.
- **Global best-practices library**: distilled experiences land in
  `.agent-team-web/best-practices.json` (cross-team, traceable to source team/task),
  deduplicated and queryable via `agent_teams_best_practices`; per-role×level
  calibration hints back the captain's future estimates (cold-start guarded until
  enough samples exist).

## Architecture

- **Host bundle** (`src/index.ts`): installs the process-wide runtime once (scheduler, member selection/state guards, retired-member guard) and registers the always-on activation entry (hint section + `agent_teams_activate`); `src/activation.ts` installs the 14 tools and the captain protocol section into the calling agent's `agent.ctx` on activation; the `/agent-teams` command + gesture boundary, the snapshot and artwork HTTP routes register on the root.
- **Browser bundle** (`src/client/index.tsx`): registers the activity panel in the `shell.overlay` slot, the team card in `conversation.chat.node`, and the hidden command view; the panel polls the snapshot route (no long-lived connection).

The kernel keeps the team state on disk; session events are informational only, and teams are archived (not deleted) so the panel can restore history.

## Historical session diagnostics

Member transcripts live in DSH sessions, whose on-disk format can change between
harness versions. When the current reader cannot open an older member session,
the panel does **not** hide the team: it keeps showing the durable team, task and
archive summary from `.agent-team-web/`, and shows a short diagnostic banner with
the reason and a copyable, redacted reference (no file paths, tokens or raw
session contents). Member rows stay clickable so a transient failure can simply
be retried; a successful open clears the banner. The plugin never reads, rewrites
or migrates the original session logs — recovery is left to DSH itself.

## Collaboration modes

`agent_teams_create` accepts an optional `mode`:

- **`light`** — no commissar is created, and gated tasks (`risk=high|critical` or
  `milestone=true`) are refused. Use it for small, low-risk goals where a single
  executor is enough.
- **`standard`** (default, and what existing teams already do) — a commissar is
  created with the team, and gated tasks need its `pass` verdict before they can
  be completed.
- **`governed`** — the same review gate, and the commissar cannot be removed.

Modes only ever tighten: `agent_teams_set_mode` upgrades `light → standard` or
`light → governed` (creating the commissar when it is missing) and refuses every
downgrade. A gated task always requires a living commissar, so no mode can accept
work that could never be reviewed.

## Concurrency model

AgentTeams assumes that **one harness process** owns a workspace's team-state
directory (`.agent-team-web/`). All mutations of one team are serialized by an
**in-process** per-team promise-chain lock (`withTeamLock` in `src/state.ts`),
so read-modify-write cycles (`team.json`, mailboxes, the best-practices and
retired-members indexes) stay serial within that process.

Two properties follow from this assumption:

- **Atomic rename protects integrity, not lost updates.** `atomicWriteText`
  writes a temp file and renames it into place, so a crash never leaves a
  half-written `team.json`. But if *two* harness processes share the same
  workspace, their in-process locks do not see each other: a later write can
  overwrite an earlier one and the update is silently lost (the file is still
  valid JSON, just missing the other process's change).
- **Multi-process sharing requires your own file lock.** If you must run more
  than one harness process against one workspace, add an OS-level file lock
  (e.g. a `mkdir` sentinel directory with an expiry/retry policy) around all
  AgentTeams activity; the in-process locks alone are not sufficient.

This is a documented assumption, not a defect: single-process operation is the
supported deployment, and the atomic-write layer guarantees you never see
corrupted state even if a process crashes mid-write.

## Workflow guardrails

The captain may set an explicit `goal`, `workflow_mode` (`decision` or
`governance-maintenance`), and a bounded `main_chain_task_budget` when creating
a team. Main-chain tasks consume that lifetime budget; a task exceeding it must
record an explicit decision-impact exception. Maintenance tasks do not consume
that budget and cannot be a direct or transitive dependency of a main-chain
task. The scheduler dispatches ready main-chain work before maintenance work.

Tasks can carry an impact class, exact `deliverable`, acceptance contract, and
structured `checked` / `unchecked` evidence boundary. Exact deliverables use a
**process-local task lock**: two non-terminal tasks in the same plugin process
cannot register the same normalized path (including root files such as
`README.md`). This is neither an OS file lock nor a filesystem watcher; direct
external writers, symlink aliases, and separate harness processes remain outside
this guarantee.

A captain can revise a task's acceptance only through reassignment with a
non-empty reason. The same task id remains durable, while the acceptance and its
revision history are retained. A review pass is bound to the active task attempt
and contract revision; retries, reassignment, and acceptance revision archive
and clear the old review so it cannot authorize later work. Legacy team records
without these additive fields remain readable through documented fallback values.

## Installation

### 1. Install the bundle

In your DSH Web profile directory, add the released tarball (no build, no monorepo fetch).
The `releases/latest` URL always points at the newest release:

```bash
cd ~/.dsh/profiles/web
pnpm add https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases/latest/download/deepseek-ai-dsh-experimental-agent-team-web-0.1.30.tgz
```

For developers / contributors, a direct git or path install also works — the repository
commits `lib/`, so no build step is needed:

```bash
# path install (workspace checkout)
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-experimental-agent-team-web
```

### 2. Enable the bundle in the profile patch

Add this row to your profile patch (e.g. `cordis.patch.yml`; see
`examples/profile-patch.agent-team-web.yml` for the full skeleton):

```yaml
- insert:
    - id: agent-team-web
      name: "@deepseek-ai/dsh-experimental-agent-team-web"
      inject:
        - sessionProjections
```

### 3. Restart DSH

Restart the DSH web process (the GUI), then activate the captain protocol — two equivalent ways:

```
/agent-teams <goal>
```

or just ask in natural language (the model calls `agent_teams_activate` first, which loads the tool surface and the protocol):

```
use AgentTeams to <goal>
```

Example: `/agent-teams review the last 20 commits from performance, security, and product perspectives`

Activation is per session and idempotent: before it, no `agent_teams_*` tool exists; after it, they are visible from the next step (to the captain and to its members). Sessions that never activate pay only the ~270-token hint per request.

A floating **activity panel** appears at the top right: member status, task
progress, **each member's current-task elapsed time**, estimate-vs-actual with
overrun badges, and drill-down task details with retro / best-practice notes.

### Upgrading

When a new release is published, re-run step 1 — the `releases/latest` URL
redirects to the newest tarball automatically, so no URL change is needed.
(If the filename above still carries an older version, check the
[Releases](https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases)
page for the current asset name.)

---

Release tarball: `deepseek-ai-dsh-experimental-agent-team-web-0.1.30.tgz`
