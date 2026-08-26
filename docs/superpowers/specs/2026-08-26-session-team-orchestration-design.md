# Session Team Orchestration Design

Date: 2026-08-26

## Status

**Superseded on 2026-08-26. Do not implement this design.**

The approved replacement is `2026-08-26-project-command-board-design.md`. The replacement moves authority from per-session Team configuration to a Workspace-scoped project board with a fixed project commander, an independent commissar, and task-pulled execution sessions.

## Objective

Extend the existing read-only Agent Team monitor with an opt-in, per-session Team configuration and orchestration system.

The user is the superior commander. The current conversation's main Agent becomes the Team captain when Team work begins. The system creates one political commissar and only the workers needed by the task. Every conversation remains isolated, new conversations default to Team disabled, and all additional Agents must use models and reasoning efforts allowed by that conversation's configuration.

## Product Correction

This design replaces the rejected Profile-level Team template manager concept. There is no reusable Team-template library or independent Team-management page.

The configuration target is the current conversation. The Team entry sits between the existing Settings and Restart controls:

```text
Settings | Team | Restart
```

Clicking Team opens a side panel for that conversation only.

## Scope and Delivery Phases

The design spans three independently planned and accepted phases.

### Phase 1: Session Configuration Foundation

Deliver:

- Team entry between Settings and Restart;
- per-session enabled flag, default false;
- configured DSH model catalogue;
- per-model minimum and maximum reasoning effort;
- worker hard limit, editable from 1 through 8, default 4;
- durable committed session configuration;
- forked-session configuration copy with Team reset to disabled;
- strict Host capability validation for child-Agent effort installation.

Phase 1 does not create Agents.

### Phase 2: Command and Automatic Team Formation

Deliver:

- current main Agent acting as captain;
- first-use creation of one commissar and required workers;
- automatic model and effort selection within session policy;
- one active work item per worker;
- Team mailbox and direct worker collaboration visible to captain and commissar;
- persistent member reuse for later work in the same conversation;
- transactional formation and rollback.

### Phase 3: Assistance, Supervision, and Lifecycle

Deliver:

- available and assisting member states;
- automatic read-only assistance;
- captain approval for assistance with writes or ownership changes;
- commissar risk suspension and completion objection;
- disagreement escalation to the user;
- graceful draining, immediate interruption, and shutdown;
- member replacement and instance history.

Each phase requires its own implementation plan and acceptance run. Later-phase UI controls must not pretend to function before their Host capabilities exist.

## Authority Model

### User: Superior Commander

The user:

- gives objectives and constraints;
- enables or disables Team for the conversation;
- holds final authority over major direction conflicts;
- can pause, adjust, or terminate Team work;
- resolves disagreements that captain and commissar cannot settle.

The user is not a Team worker and is not the captain.

### Main Conversation Agent: Captain

The current conversation's main Agent automatically becomes captain when first Team formation occurs. No separate captain child Agent is created.

The captain:

- understands and decomposes the task;
- creates, assigns, reassigns, and cancels work items;
- controls normal execution priority;
- approves write-capable assistance and ownership transfer;
- creates or replaces members within session policy;
- coordinates dependencies and progress;
- integrates results and reports to the user.

The captain continues using the conversation's current primary model. It is not constrained by the Team model pool, which governs only the commissar and workers.

### Commissar

Exactly one commissar is created during the first Team formation and remains with that Team instance until Team shutdown or conversation termination.

The commissar owns target, discipline, risk, and quality supervision. It:

- checks whether decomposition remains aligned with the user's goal;
- reviews permissions, scope, safety, deletion, publication, and other risks;
- independently reviews member outputs;
- detects omissions, unsupported claims, unverified completion, and duplicated work;
- can require additional verification;
- can temporarily suspend work presenting major risk;
- reports material risk to both captain and user.

The commissar does not perform normal dispatch, permanently cancel tasks, modify Team configuration, or establish a competing command chain.

### Workers

Workers execute scoped work assigned by the captain. They may communicate directly, request assistance, provide assistance, and share intermediate results. They cannot silently change another member's assignment, priority, ownership, or write scope.

## Communication and Command Chain

Workers A/B/C/D may communicate directly. Every Team message enters the durable Team mailbox and is visible to captain and commissar.

Communication does not grant dispatch authority:

- formal dispatch, reprioritization, reassignment, and cancellation remain captain actions;
- cross-task collaboration leaves a committed record;
- the original task owner retains integration responsibility unless captain transfers ownership;
- commissar observes all Team communication but does not intervene in routine discussion unless supervision is needed.

This preserves efficient peer collaboration without creating a hidden second command chain.

## Disagreement Rules

1. **Ordinary disagreement:** commissar raises an objection; captain revises the plan or records a reasoned response.
2. **Quality deficiency:** commissar requires additional verification; affected work cannot be marked complete.
3. **Major risk:** commissar temporarily suspends the affected work and immediately notifies captain and user.
4. **Direction conflict:** the user makes the final decision.
5. **Emergency handling:** captain may act first when delay would be harmful, but must record the reason and accept subsequent review.

A commissar suspension is temporary. Only the user or authorized captain flow can permanently cancel work.

## Session Team Configuration

```ts
interface SessionTeamConfig {
  enabled: boolean
  maxWorkers: number
  modelPool: SessionTeamModelPolicy[]
}

interface SessionTeamModelPolicy {
  provider: string
  model: string
  minReasoningEffort: string
  maxReasoningEffort: string
}
```

`maxWorkers` is an integer from 1 through 8 and defaults to 4.

The Team configuration is a committed fact in the current conversation, not browser-local state and not a Profile-level template. Conceptual event vocabulary includes configuration and enable/disable facts; exact event names are phase-1 implementation-design decisions and must use the supported session event-registration boundary.

Model credentials, provider settings, and secrets remain owned by DSH providers. Session Team configuration stores only provider/model identifiers and legal effort bounds.

## Session Isolation and Forking

Every conversation has an independent Team configuration and Team instance.

A new conversation defaults to:

```text
enabled = false
```

Fork behavior:

- copy the parent conversation's model pool;
- copy every model's minimum and maximum effort;
- copy the worker limit;
- set Team enabled to false;
- do not copy commissar, workers, tasks, messages, or runtime state;
- when the fork first forms a Team, create a new isolated Team instance and new members.

No Agent session is shared between parent and fork Team instances.

## Model Catalogue and Reasoning Policy

The Team panel lists only provider/model routes that the current DSH Host has configured and can call.

For each selected model, the panel reads exact model capability metadata and displays only the reasoning efforts exposed by that model/provider adapter. Effort identifiers are opaque adapter-owned values, not a plugin-defined universal enum.

The user chooses an inclusive minimum and maximum effort for each model. Save validation requires:

- provider still exists;
- exact model resolves successfully;
- both efforts remain supported by that model;
- minimum is not ordered above maximum according to adapter-provided effort order;
- Host can guarantee installation of the selected effort on a child Agent.

Modern Claude models use adaptive thinking with effort, not a fixed thinking-token budget. This design does not add `budget_tokens`, a Team monetary budget, a cumulative token budget, or a fabricated thinking-token ceiling.

### Strict Host Boundary

The currently verified `SubagentStartRequest.agentOptions` supports provider and model but does not by itself prove durable `reasoningEffort` installation. Team enablement must remain unavailable until the target Host exposes and the plugin integrates a supported child-Agent `ModelSelection` path that guarantees the chosen effort is applied.

If the Host cannot guarantee effort application, the UI shows an actionable compatibility error and refuses to enable Team. It must not silently use provider defaults or hide the mismatch.

## Automatic Model and Effort Selection

The configuration defines a permitted model pool and per-model effort range. The system selects actual member routes automatically using:

- member role;
- task complexity;
- task risk;
- required tools and context;
- current model availability;
- model capabilities;
- configured minimum and maximum effort.

Invariant:

```text
selected model belongs to SessionTeamConfig.modelPool
selected effort belongs to that model's inclusive configured range
```

Selection guidance:

- captain retains the main conversation model;
- commissar prefers a model suitable for independent review and an effort toward the upper legal range;
- workers use effort appropriate to assigned complexity: lower for mechanical work and higher for difficult or sensitive work;
- if a selected route becomes unavailable, another legal route in the pool may be selected;
- no fallback may use the captain model, DSH default model, or any model outside the session pool.

An empty model pool cannot enable Team. If all routes fail while Team is active, the system pauses expansion and replacement, keeps existing members running where possible, and informs the user.

## Formation Trigger and Team Instance

Turning on Team validates and commits configuration but creates no child Agent. The conversation enters an enabled-idle state.

When the captain encounters work that benefits from decomposition:

1. classify whether Team formation is justified;
2. plan worker count from parallel work, bounded by `maxWorkers`;
3. select commissar model/effort;
4. select worker models/efforts;
5. create one commissar;
6. create the required workers;
7. commit Team instance and member facts;
8. enter active state.

Simple or indivisible work may remain captain-only even while Team is enabled.

## Transactional Formation and Rollback

Initial formation is transactional at the Team-instance level.

Before creation, revalidate every selected model and effort. If any member creation or required event commit fails:

- interrupt members created during the incomplete formation;
- commit a formation-failure record;
- do not expose a half-active Team;
- return the conversation to enabled-idle;
- show the failed role, provider/model, effort, and error;
- allow configuration correction and retry.

Committed event ordering must not claim an active member before creation succeeds.

## Member State Machine

```text
provisioning
  -> available
  -> failed

available
  -> active
  -> assisting
  -> stopping

active
  -> available
  -> blocked
  -> failed
  -> stopping

assisting
  -> available
  -> failed
  -> stopping

blocked
  -> active
  -> available
  -> stopping

stopping
  -> stopped
```

Each worker owns at most one active or assisting work item at a time. Total concurrently executing workers cannot exceed `maxWorkers`. Captain and commissar do not count toward the worker limit.

Members remain available after completing a work item and are reused for later work until Team is closed or the conversation ends.

## Assistance Model

A worker that completes its assignment reports to captain and becomes available rather than exiting.

An available worker may help another worker through a clearly scoped assistance work item:

- the system may automatically assign read-only investigation, reproduction, or cross-check assistance and notify captain;
- writes, code changes, ownership transfer, write-scope expansion, or other state-changing assistance require captain approval;
- assistance consumes the worker's single execution slot;
- the original owner remains responsible for final integration unless captain explicitly transfers ownership;
- commissar checks for duplicated effort, write conflicts, scope violations, and missing verification;
- after assistance completes, the worker becomes available again.

Workers may request help directly through Team mailbox, but requests do not themselves reassign work.

## Team State Machine

```text
disabled
  -> enabled_idle

enabled_idle
  -> forming
  -> disabled

forming
  -> active
  -> enabled_idle   (rollback)

active
  -> enabled_idle   (no current work, members retained)
  -> draining
  -> paused
  -> stopping

draining
  -> stopping
  -> active         (cancel shutdown)

paused
  -> active
  -> stopping

stopping
  -> disabled
```

The display label on the Team entry maps to current state:

- Team · Off
- Team · Ready
- Team · Running
- Team · Paused
- Team · Closing
- Team · Configuration Error

## Shutdown Semantics

When work is active, closing Team presents exactly three choices.

### Wait for Current Work

- enter draining;
- create no new members;
- assign no new work;
- allow current work and reporting to finish;
- captain summarizes results;
- stop commissar and workers;
- enter disabled.

### Interrupt and Close Now

- interrupt commissar and workers;
- mark unfinished work interrupted/cancelled with committed facts;
- captain summarizes completed and incomplete work;
- enter disabled.

### Cancel Closing

- leave Team in its prior state.

Conversation termination stops every Team child session. Re-enabling Team after shutdown creates a new Team instance and never revives stopped members. Prior committed history remains observable.

## Configuration and Runtime Error Handling

### Enable-Time Errors

Refuse enablement when:

- model pool is empty;
- provider/model is unavailable;
- effort range is invalid or stale;
- Host cannot guarantee child effort installation;
- committed configuration cannot be persisted.

### Formation Errors

Rollback incomplete formation and return to enabled-idle. Report exact role, model route, effort, and failure.

### Active Expansion Errors

Pause expansion and replacement. Existing valid members may continue. Never silently select a route outside policy.

### Member Failure

Keep the member failed record. Captain may create a replacement only from the current legal pool and only after fresh validation.

### Configuration Conflict

Because configuration is committed per session, writes use session revision/precondition semantics. A stale panel must reload and present a conflict instead of overwriting a newer change.

## Persistence and Authority

- Team configuration authority: committed current-session events.
- Model capability authority: exact `ctx.llm` provider/model metadata.
- Team runtime authority: captain/root session committed lifecycle, task, and mailbox events.
- Runtime member sessions: `ctx.subagents` and supported Agent model-selection APIs.
- Browser: draft form and presentation only.

The existing read-only projection/monitor remains the observation surface. It must not become a second writable authority.

## UI Information Architecture

The Team button is located between Settings and Restart in the conversation header.

The side panel includes:

1. current-conversation scope label;
2. enabled toggle and current Team status;
3. configured model pool;
4. each model's minimum and maximum supported effort controls;
5. worker limit control, 1–8, default 4;
6. concise command-structure explanation;
7. validation and Host compatibility errors;
8. save action using current session revision;
9. later-phase runtime status and shutdown action.

The panel must explicitly state:

- user is superior commander;
- main conversation Agent is captain;
- no separate captain Agent is created;
- first formation creates one commissar and needed workers;
- additional Agents are restricted to configured models/efforts.

## Security and Authorization

- Provider credentials and secrets never enter Team configuration or Client DTOs.
- The Client cannot directly spawn, interrupt, or mutate Agents; it calls authorized Host commands/services.
- Writes and owner changes require captain authorization under the defined assistance rules.
- Destructive, publication, permission, or other major-risk actions are eligible for commissar suspension and user escalation.
- Every configuration, formation, assignment, assistance, suspension, and shutdown transition produces an auditable committed fact.

## Testing Strategy

### Phase 1

Test:

- new conversation defaults disabled;
- two conversations have isolated configuration;
- fork copies policy and worker limit but resets enabled false;
- Team entry is injected between Settings and Restart;
- only configured callable models are shown;
- effort selectors contain only exact-model efforts;
- minimum above maximum cannot save;
- empty pool cannot enable;
- inability to install child effort cannot enable;
- stale provider/model/effort is rejected;
- refresh and Host restart recover committed configuration;
- stale revision cannot overwrite newer configuration;
- secrets never appear in DTO or events.

### Phase 2

Test:

- enabling creates no member;
- simple work can remain captain-only;
- first decomposable work creates one commissar and bounded workers;
- no separate captain child session exists;
- selected models and efforts satisfy session policy;
- every worker has at most one work item;
- Team messages are visible to captain and commissar;
- direct worker communication does not change ownership;
- partial formation rolls back all provisional members;
- subsequent work reuses available members.

### Phase 3

Test:

- completed worker becomes available;
- automatic read-only assistance is committed and visible;
- write assistance cannot start without captain approval;
- original owner retains integration responsibility;
- commissar can require verification and block completion;
- major risk can be temporarily suspended and escalated;
- user resolves captain/commissar direction conflict;
- draining assigns no new work and closes after completion;
- immediate shutdown interrupts and records unfinished work;
- Team re-enable creates a new instance;
- conversation termination stops all Team children.

## Acceptance Criteria

The overall design is complete only when all three phases independently satisfy their tests and real DSH Profile verification.

The final user-visible behavior must be:

1. every new conversation starts without Team;
2. Team is configured from an entry between Settings and Restart;
3. configuration applies only to that conversation;
4. fork copies policy but starts Team disabled and shares no members;
5. only configured DSH models and their real effort levels are selectable;
6. selected minimum/maximum effort is enforced for every extra Agent;
7. the main conversation Agent is captain and no captain child Agent is created;
8. first justified formation creates one commissar and needed workers within the hard limit;
9. workers communicate directly under captain-visible mailbox and single-command-chain rules;
10. completed workers remain available and can assist others under read/write authorization rules;
11. commissar supervises target, discipline, risk, and quality, with major disagreement escalated to the user;
12. Team shutdown provides wait, immediate interrupt, and cancel choices;
13. no UI claim is shown unless the Host can enforce the corresponding model, effort, lifecycle, and authorization behavior.

## Explicit Non-Goals

The first release does not include:

- Profile-level Team templates;
- reusable Team-template library;
- shared Team instances across conversations;
- fixed thinking-token budgets;
- Team monetary budgets;
- cumulative token hard caps;
- unrestricted worker self-dispatch;
- a second captain Agent;
- hidden fallback to captain or DSH default model;
- hot migration of members across forked conversations.
