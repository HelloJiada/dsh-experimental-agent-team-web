# @deepseek-ai/dsh-experimental-agent-team-web

[中文](README.zh-CN.md) | English

## Status

**Experimental.** This package is intended for experimental and internal use. It follows DSH interfaces that may evolve.

## Overview

An external DeepSeek Harness (DSH) bundle that turns the current session into the captain of a multi-agent team: create continuable member agents, break goals into dependency-wired tasks, and coordinate them through direct mailbox messages — with a live activity panel and an in-conversation team card.

It provides:

- the `/agent-teams` slash command (plus a pre-step gesture boundary) that activates the captain protocol;
- the full `agent_teams_*` tool suite (create/add-member/create-task/claim/update/reassign/remove/send-message/status/delete);
- a disk-backed team kernel — `.agent-team-web/<teamId>/team.json` + mailbox inboxes are the single source of truth, with atomic writes and per-team locking;
- an event-driven shared-task scheduler that auto-assigns ready work to idle members and reacts to `agent/status`;
- informational `agent-team-web/*` session events appended to the captain's session;
- a server snapshot route (`GET /plugins/agent-team-web/state`, `?archived=1`) that the web client polls once per second;
- a floating **activity panel** in the shell overlay (health/progress, captain node, delegation tree, task-dependency DAG) with drag / resize / dock / collapse interactions and persisted layout;
- an in-conversation **team card** that folds the `agent_teams_create` tool call into a chat node and re-opens the floater via a window event;
- whale artwork for members, captain, and action states (`assets/agent-team-web/`).

## Architecture

- **Host bundle** (`src/index.ts`): registers tools, the system-prompt protocol section, the `/agent-teams` command + gesture boundary, the snapshot and artwork HTTP routes, and wires the scheduler.
- **Browser bundle** (`src/client/index.tsx`): registers the activity panel in the `shell.overlay` slot, the team card in `conversation.chat.node`, and the hidden command view; the panel polls the snapshot route (no long-lived connection).

The kernel keeps the team state on disk; session events are informational only, and teams are archived (not deleted) so the panel can restore history.

## Usage

1. Install the bundle into a web profile (`dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web` or a path build) and restart DSH.
2. Type `/agent-teams <goal>` in the GUI (or ask in natural language) to activate the captain protocol.
3. Create a team, add members, and break the goal into tasks — the activity panel tracks everything live.

---

Release tarball: `deepseek-ai-dsh-experimental-agent-team-web-0.1.0.tgz`
