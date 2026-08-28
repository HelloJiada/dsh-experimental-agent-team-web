# @deepseek-ai/dsh-experimental-agent-team-web

[中文](README.zh-CN.md) | English

## Status

**Experimental.** This package is intended for experimental and internal use. It follows DSH interfaces that may evolve.

## Overview

An external DeepSeek Harness (DSH) bundle that turns the current session into the captain of a multi-agent team: create continuable member agents, break goals into dependency-wired tasks, and coordinate them through direct mailbox messages — with a live activity panel and an in-conversation team card.

It provides:

- the `/agent-teams` slash command (plus a pre-step gesture boundary) that activates the captain protocol;
- the full `agent_teams_*` tool suite (create/add-member/create-task/claim/update/reassign/remove/send-message/status/delete, plus `agent_teams_retro_review` and `agent_teams_best_practices`);
- a disk-backed team kernel — `.agent-team-web/<teamId>/team.json` + mailbox inboxes are the single source of truth, with atomic writes and per-team locking;
- an event-driven shared-task scheduler that auto-assigns ready work to idle members and reacts to `agent/status`;
- informational `agent-team-web/*` session events appended to the captain's session;
- a server snapshot route (`GET /plugins/agent-team-web/state`, `?archived=1`) that the web client polls once per second;
- a floating **activity panel** in the shell overlay (health/progress, captain node, delegation tree, task-dependency DAG) with drag / resize / dock / collapse interactions and persisted layout;
- an in-conversation **team card** that folds the `agent_teams_create` tool call into a chat node and re-opens the floater via a window event;
- whale artwork for members, captain, and action states (`assets/agent-team-web/`).

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

- **Host bundle** (`src/index.ts`): registers tools, the system-prompt protocol section, the `/agent-teams` command + gesture boundary, the snapshot and artwork HTTP routes, and wires the scheduler.
- **Browser bundle** (`src/client/index.tsx`): registers the activity panel in the `shell.overlay` slot, the team card in `conversation.chat.node`, and the hidden command view; the panel polls the snapshot route (no long-lived connection).

The kernel keeps the team state on disk; session events are informational only, and teams are archived (not deleted) so the panel can restore history.

## Installation

### 1. Install the bundle

In your DSH Web profile directory, add the released tarball (no build, no monorepo fetch).
The `releases/latest` URL always points at the newest release:

```bash
cd ~/.dsh/profiles/web
pnpm add https://github.com/HelloJiada/dsh-experimental-agent-team-web/releases/latest/download/deepseek-ai-dsh-experimental-agent-team-web-0.1.2.tgz
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

Restart the DSH web process (the GUI), then activate the captain protocol:

```
/agent-teams <goal>
```

Example: `/agent-teams review the last 20 commits from performance, security, and product perspectives`

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

Release tarball: `deepseek-ai-dsh-experimental-agent-team-web-0.1.2.tgz`
