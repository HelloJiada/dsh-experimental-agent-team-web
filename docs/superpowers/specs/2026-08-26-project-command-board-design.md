# Project Command Board Design

Date: 2026-08-26

## Status

Approved for documentation and staged implementation planning.

This document supersedes the product direction in `2026-08-26-session-team-orchestration-design.md`. The prior per-session Team configuration model is not the implementation target.

## Objective

Build a Workspace-scoped project command board where work, rather than a preconfigured Team, is the organizing center.

The user is the superior decision-maker. Each Workspace has one writable authoritative project board, one fixed project commander session, one independent project commissar session, and dynamically created or reused execution sessions pulled by Ready tasks. Ordinary sessions are execution units and cannot independently rewrite the project plan.

## Product Correction

The rejected direction organized the product around:

- a Team switch on every conversation;
- a per-conversation model pool;
- predefining captain, commissar, and worker behavior before work existed.

The corrected direction is task-first:

```text
User sets project objective
  -> commander proposes plan and task graph
  -> commissar reviews plan and risk gates
  -> eligible leaf tasks become Ready
  -> WIP pulls Ready tasks
  -> available execution sessions are reused or created on demand
  -> outputs and evidence return to the board
  -> review and integration gates determine completion
```

Models, effort, sessions, and worktrees are resources selected for board work. They are not the primary product object.

## Scope

The full product is delivered in four independently planned phases.

### Phase 1: Project Board Foundation

- Workspace-to-project identity;
- project record and empty board;
- commander-session event log as board authority;
- complete task-card contract;
- one parent/child level;
- task state machine;
- dependency and Ready derivation;
- revision/CAS writes;
- manual task creation/editing by the user;
- Workspace project-page board UI;
- no Agent creation.

### Phase 2: Project Leadership

- project model pool and effort bounds;
- automatic-execution capability gate;
- fixed project commander session;
- independent project commissar session;
- project objective submission;
- commander plan proposal;
- commissar whole-plan review;
- High/Critical execution gates;
- disagreement escalation to the user.

### Phase 3: Dynamic Execution Scheduling

- project WIP;
- Ready pull scheduling;
- Available execution-session reuse;
- on-demand execution-session creation;
- unique Owner plus assistants;
- structured progress, blocking, output, and evidence;
- assistance work items;
- Blocked-pressure governance.

### Phase 4: Worktree and Integration Closure

- project-level worktree authorization;
- isolated branch/worktree per write task;
- write-scope conflict detection;
- task-branch review;
- commander merge summary;
- user merge approval;
- main-branch verification;
- Completed integration gate;
- safe worktree/branch cleanup;
- project archive and restore.

The first release does not include a cross-project dashboard. A later global surface may read multiple project boards without becoming another write authority.

## Project Identity

A normalized DSH Workspace / working-directory path identifies one project.

```text
normalized Workspace path -> ProjectId
```

All sessions with that Workspace belong to the project for navigation and read-only aggregation. This does not grant ordinary sessions plan-write authority.

Phase 1 must define deterministic path normalization, symlink/case behavior for the supported platform, and a stable ProjectId derivation. A different Workspace path must never share a board accidentally.

## Project Initialization

Opening the Workspace's Task Board for the first time:

1. derives ProjectId;
2. creates a project record;
3. creates an empty project board;
4. creates no Agent session;
5. leaves the board manually editable.

A legal project model policy plus explicit automatic-execution enablement is required before the system creates leadership sessions.

When the policy and Host capabilities are valid, the system creates together:

- one fixed project commander session;
- one independent project commissar session.

There is no temporary fallback to a DSH default model.

## Authority and Persistence

### Single Write Authority

The fixed project commander session's append-only event log is the authoritative project plan and execution log.

The board is a projection of committed events. Browser state is an unsaved draft only. Execution sessions, the commissar, project-list views, and future cross-project summaries cannot maintain competing copies of plan state.

Conceptual event families include:

```text
project/initialized
project/policy-configured
project/automatic-execution-set
project/goal-set
board/plan-proposed
board/plan-reviewed
board/task-created
board/task-updated
board/task-assigned
board/task-progressed
board/task-blocked
board/task-unblocked
board/task-evidence-added
board/task-submitted
board/task-reviewed
board/task-cancelled
board/decision-escalated
board/decision-resolved
board/worktree-created
board/integration-approved
board/integration-verified
board/worktree-cleaned
project/archived
project/restored
```

Exact event names and payload versions are phase-specific implementation-design decisions. Every state event carries the complete post-change value required for deterministic replay, or an explicitly versioned operation whose conflict semantics are proven by tests.

### Revision and CAS

Every board mutation carries the board or aggregate revision it was based on. A stale write is rejected and the caller must refresh. The system does not use last-write-wins or implicit field-level merge in the first release.

## Roles

### User: Superior Decision-Maker

The user can:

- set and modify project objective and scope;
- directly create/edit tasks;
- change project priority;
- manually reassign Owner after safety checks;
- authorize project-level automatic worktree creation;
- approve integration into the project main branch;
- resolve commander/commissar disagreements;
- confirm project archival and cleanup.

Structural user edits trigger commissar re-review when they change objective, scope, dependencies, acceptance criteria, or risk.

### Project Commander

The project commander is the execution authority and board planner. It:

- turns the project objective into an execution proposal;
- creates and maintains tasks, dependencies, acceptance criteria, priority, and risk;
- proposes replanning when dependencies fail or scope changes;
- selects Ready tasks under WIP;
- reuses or creates execution sessions;
- assigns and reassigns Owner;
- coordinates assistance;
- reviews ordinary task results;
- prepares worktree integration and merge summaries;
- reports project status and completion.

The commander cannot merge to the main branch without user approval.

### Project Commissar

The commissar is an independent session and independent reviewer. It:

- reviews the whole plan before ordinary execution;
- checks alignment with user objective;
- reviews dependency quality and acceptance criteria;
- requires individual pre-execution review for High/Critical risk tasks;
- samples ordinary results;
- must review High/Critical results and final milestones;
- can return work to Changes;
- can temporarily suspend major risk;
- escalates unresolved direction conflict to the user.

The commissar cannot perform routine dispatch, rewrite the plan structure, permanently cancel work, or create a competing command chain.

### Execution Member / Execution Unit

An execution member is represented by a DSH execution session bound to one project.

It can:

- execute one formal work item at a time;
- update its task's progress;
- report blocking reason;
- submit output and evidence;
- request or perform scoped assistance;
- communicate with project participants through committed records.

It cannot modify project objective, task graph, dependencies, project priority, another task's Owner, or global WIP.

## Permission Matrix

| Action | User | Commander | Commissar | Execution member |
|---|---:|---:|---:|---:|
| Modify project objective/scope | Yes | Propose / authorized update | Review | No |
| Create/decompose tasks | Yes | Yes | No | No |
| Modify dependencies/acceptance | Yes | Yes | Review | No |
| Set priority/risk | Yes | Yes | Review risk | No |
| Assign/reassign Owner | Yes | Yes | No | No |
| Update own progress/blocking | N/A | N/A | N/A | Yes |
| Add evidence | Yes | Yes | Yes | Yes |
| Return task to Changes | Yes | Yes | Yes | No |
| Temporarily suspend major risk | Yes | Yes | Yes | No |
| Approve main-branch integration | Yes | No | No | No |
| Archive project | Yes | Prepare | Review readiness | No |

Host commands/services enforce permissions. UI visibility is not authorization.

## Project Objective Flow

The Workspace Task Board has one project-objective input at the top. It is the authoritative user entry for objective changes.

```text
User commits objective
  -> commander wakes and proposes plan
  -> tasks enter Planning
  -> commissar reviews whole plan
     -> approved: eligible ordinary leaf tasks may become Ready
     -> changes requested: commander revises
     -> unresolved major conflict: Awaiting Decision
```

Ordinary plans execute automatically after commissar approval. User approval is required only for major scope, cost/risk, irreversible actions, or unresolved disagreement.

The commander conversation remains inspectable but is not a second objective-authoring authority.

## Task Hierarchy

The first release supports one parent/child level.

- Parent task: milestone or work package.
- Leaf task: executable task.
- Parent tasks have no execution Owner.
- Dependencies connect executable leaf tasks.
- All direct children must complete and pass required review before parent completion.
- Arbitrary recursive nesting is rejected.

## Complete Task Contract

```ts
interface ProjectTask {
  readonly id: TaskId
  readonly parentId: TaskId | null

  readonly title: string
  readonly objective: string
  readonly description: string

  readonly status: TaskStatus
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3'
  readonly risk: 'low' | 'medium' | 'high' | 'critical'

  readonly blockedBy: readonly TaskId[]
  readonly ownerSessionId: SessionId | null
  readonly assistantSessionIds: readonly SessionId[]

  readonly acceptanceCriteria: readonly AcceptanceCriterion[]
  readonly writeScopes: readonly string[]

  readonly progress: readonly TaskProgressEntry[]
  readonly output: TaskOutput | null
  readonly evidence: readonly TaskEvidence[]
  readonly blockingReason: string | null

  readonly revision: number
  readonly history: readonly TaskHistoryEntry[]
}
```

Every leaf task has exactly one Owner when active. It may have multiple assistants. Owner retains integration and review-response responsibility unless commander performs an explicit handoff.

Tasks are never permanently deleted. Mistakes are Cancelled and may be hidden from default views while audit history remains.

## Task State Machine

```text
Backlog
  -> Planning

Planning
  -> Ready
  -> Cancelled

Ready
  -> In Progress
  -> Cancelled

In Progress
  -> Review
  -> Blocked
  -> Failed
  -> Cancelled

Blocked
  -> Ready
  -> Planning
  -> Failed
  -> Cancelled

Review
  -> Completed
  -> Changes
  -> Blocked

Changes
  -> In Progress
  -> Planning
  -> Cancelled

Failed
  -> Planning   (new attempt/replan)
  -> Cancelled
```

A task enters Ready only when:

- it is a leaf task;
- the whole plan passed commissar review;
- all dependencies are Completed;
- acceptance criteria are complete;
- High/Critical pre-execution review passed;
- no structural user edit is waiting for re-review;
- the project is not archived, paused, blocked-pressure suspended, or Awaiting Decision.

Dependency readiness is derived from current dependency state. A task does not remain blocked merely because it once had dependencies. Failed/Cancelled dependencies force commander replanning rather than automatic Ready.

## Priority and Risk

Priority is independent from risk.

### Priority

- P0: project blocker / immediate;
- P1: high priority;
- P2: normal;
- P3: low.

Within one priority, scheduling considers readiness, dependency effects, risk, capability match, context reuse, write-scope conflict, load, and creation order.

### Risk

- Low;
- Medium;
- High;
- Critical.

High/Critical require commissar pre-execution review and result review. Critical risk or unresolved direction conflict escalates to the user.

## Review and Completion

### Ordinary Non-Code Tasks

Execution member submits output and evidence. Commander validates acceptance criteria. Commissar may sample. Completion requires all mandatory evidence.

### High/Critical and Milestones

Commander reviews first; commissar review is mandatory before completion.

### Code-Writing Tasks

A task-branch review is not completion.

```text
execution branch review passes
  -> Review / Awaiting Integration
  -> commander prepares integration summary
  -> user approves merge
  -> merge into main branch
  -> verify on merged main
     -> pass: Completed and cleanup eligible
     -> fail: Changes or Blocked; preserve worktree and branch
```

No execution member may declare a code task Completed before merged-main verification.

## Ready Pull Scheduling and WIP

Project configuration defines maximum `In Progress` leaf-task count, default 4.

When WIP has capacity:

1. rank eligible Ready tasks;
2. find an Available execution session with matching capability/context;
3. reuse it when safe;
4. otherwise create a new execution session under project model policy;
5. commit assignment and unique Owner;
6. transition task to In Progress.

Execution sessions are not created for tasks that are not Ready.

One execution session owns at most one formal Working or Assisting item at a time.

## Blocked Pressure

Blocked tasks do not occupy In Progress WIP. Their Owner may become Available and work elsewhere. Unblocked tasks re-enter Ready and compete for WIP.

Governance thresholds:

- Blocked count >= 3, or Blocked > 30% of unfinished tasks: warning;
- Blocked >= 50% of unfinished tasks: stop pulling new Ready work;
- commander prioritizes unblocking and replanning;
- scheduling resumes after pressure falls below suspension threshold.

The implementation must define denominator behavior for zero/very-small unfinished sets and cover boundary percentages with tests.

## Execution Session Lifecycle

```text
Creating
  -> Available
  -> Failed

Available
  -> Working
  -> Assisting
  -> Archived

Working
  -> Available
  -> Blocked
  -> Failed
  -> Interrupted

Assisting
  -> Available
  -> Failed
  -> Interrupted

Blocked
  -> Working
  -> Available
  -> Interrupted
```

Execution sessions remain in the project after task completion and are preferred for later matching work. They retain project context. Project archive stops or archives them.

## Assistance

Assistance is a committed board work item.

### May Be Automatically Assigned by Commander

- read-only research;
- reproduction;
- log inspection;
- static/read-only analysis;
- cross-checking;
- independent review;
- test-design assistance.

### Requires Commander Authorization

- file/code writes;
- write-scope expansion;
- external-service mutation;
- Owner transfer;
- merge, publication, or deletion;
- project-plan changes;
- irreversible mutation.

Assistance occupies the assistant's single work slot. Original Owner remains responsible for integration unless an explicit handoff changes Owner.

## Manual Reassignment

The user or commander may reassign Owner only through a safe handoff:

1. pause or reach a safe task boundary;
2. inspect current worktree, running operations, and uncommitted changes;
3. record reassignment reason;
4. obtain outgoing Owner handoff summary;
5. validate incoming Owner capability and availability;
6. transfer task/worktree control;
7. resume only after incoming Owner accepts.

The system never creates a second co-Owner as a shortcut.

## Project Model Policy

The project defines a pool of exact DSH routes and adapter-owned effort bounds:

```ts
interface ProjectModelPolicy {
  readonly provider: string
  readonly model: string
  readonly minReasoningEffort: string
  readonly maxReasoningEffort: string
}
```

The policy constrains commander, commissar, and newly created execution members. The system chooses route/effort by role, complexity, risk, context, and tools. Actual effort must remain inside the selected exact model's adapter-ordered range.

No plugin-defined universal effort enum, fixed thinking-token budget, hidden DSH-default fallback, monetary Team budget, or cumulative token hard cap is introduced.

### Manual-Only Mode

When the model pool is empty, stale, or the Host cannot guarantee child effort installation:

- board initialization and manual editing remain available;
- no commander session is created;
- no commissar session is created;
- no automatic plan, review, scheduling, or execution occurs;
- UI explains the precise compatibility/configuration problem.

When a valid policy is saved and automatic execution is explicitly enabled, create commander and commissar together transactionally.

## Leadership Session Lifecycle

Commander and commissar sessions are fixed for the life of the project.

- They are created together after a valid model policy enables automation.
- They sleep without making model calls when no work exists.
- Project archive stops or suspends them.
- Project restore prefers restoring the original sessions and board context.
- Partial leadership creation is rolled back and automation remains disabled.

## Worktree Isolation

Every code-writing leaf task uses its own branch and worktree. Read-only tasks do not create a worktree.

Automatic worktree creation requires explicit project-level authorization from the user during project initialization/settings. Without authorization:

- read-only tasks may execute automatically;
- write tasks remain Ready / Awaiting Worktree Authorization;
- no execution member writes the main workspace.

Worktree creation validates:

- project repository/workspace;
- branch uniqueness;
- path/lock state;
- write-scope conflict;
- WIP capacity;
- task readiness.

## Integration Authority

Commander prepares integration but cannot merge.

The user must approve the merge. After approval:

1. merge task branch into project main branch;
2. run merged-main verification;
3. record results;
4. only then mark Completed;
5. inspect worktree path, locks, uncommitted changes, branch reachability, and task evidence;
6. clean worktree/branch only with the user's cleanup authorization.

Failure preserves the worktree and branch and moves task to Changes or Blocked.

## Project UI

The DSH Workspace project page has a fixed Task Board entry. Ordinary session headers are not the project-management entry.

### Board Header

- project name / Workspace;
- health and automation status;
- authoritative project objective input;
- model policy;
- project settings;
- WIP;
- worktree authorization;
- commander/commissar status.

### Operational Summary

- P0/P1 alerts;
- Blocked count/ratio;
- WIP usage;
- Awaiting Decision count;
- milestones;
- recent reviews and execution events.

### Columns

- Backlog;
- Planning;
- Ready;
- In Progress;
- Blocked;
- Review;
- Changes;
- Completed;
- Failed;
- Cancelled / Archived filter.

### Task Card Summary

- priority and risk;
- title;
- Owner and assistants;
- dependency readiness;
- acceptance progress;
- write scope;
- recent structured progress;
- blocking reason;
- review/integration status;
- worktree/branch;
- output/evidence counts.

Task detail shows the complete contract and history. The board does not embed full live Agent logs. Clicking a participant opens the corresponding DSH session.

## Project States

```text
manual_only
configuring
initializing_leadership
ready
executing
blocked_pressure
awaiting_decision
paused
archiving
archived
configuration_error
```

Important semantics:

- `manual_only`: board writable by user; no Agents or automation.
- `initializing_leadership`: transactional commander/commissar creation.
- `ready`: leadership exists and automation is idle.
- `executing`: one or more tasks active.
- `blocked_pressure`: Ready pulls suspended by Blocked ratio.
- `awaiting_decision`: user decision required.
- `configuration_error`: board remains readable/editable; automation unavailable.

## Project Archive and Restore

Archive is allowed only when no Planning, Ready, In Progress, Review, or Changes tasks exist. Blocked and other unfinished tasks must be completed, replanned, or Cancelled. Worktrees and pending decisions must be resolved.

The user confirms archive.

Archive:

- stops scheduling;
- stops/suspends leadership and execution sessions;
- preserves board and full event history;
- leaves a read-only project view.

Restore:

- restores the same board;
- prefers original commander/commissar sessions;
- revalidates model policy and Host capability;
- does not blindly resume old In Progress work;
- commander re-evaluates unfinished work into Planning/Ready.

## Error Handling

### Model/Capability Error

Board remains available; automation disabled; no default fallback.

### Leadership Creation Failure

Rollback partial leadership sessions; remain manual-only/configuration-error; report failed role/route/effort.

### Execution Session Creation Failure

Task remains Ready, consumes no WIP, and records scheduling failure.

### Worktree Creation Failure

Write task remains Ready/Awaiting Authorization; no main-workspace write occurs; show path/branch/lock error.

### Execution Failure

Record failed attempt and evidence. Commander may retry, reassign, split, replan, or cancel. Failure history remains.

### Integration/Main Verification Failure

Task is not Completed. Preserve branch/worktree, record conflict/test failure, and move to Changes or Blocked.

### Revision Conflict

Reject stale mutation; refresh projection; do not overwrite or implicitly merge.

## Audit and Security

Commit authoritative events for:

- project initialization;
- model policy and automation changes;
- objective changes;
- proposal/review/revision;
- task creation and structural edits;
- risk changes;
- assignment/reassignment/handoff;
- status and blocking;
- assistance;
- output/evidence;
- review/return;
- commissar suspension;
- user decision;
- worktree create/commit/integration/cleanup;
- archive/restore.

Never store provider secrets, access tokens, hidden chain-of-thought, arbitrary environment dumps, or credentials in board events or Client DTOs.

Client visibility is not authorization. Host mutation commands/services enforce role, project, revision, state-transition, worktree, and risk gates.

## First-Release Delivery Plan

### Stage 1: Project Board Foundation

No Agent creation. Deliver project identity, project/board authority, full task contract, state/dependency/Ready logic, CAS, manual edits, and Workspace board UI.

### Stage 2: Project Leadership

Deliver model policy, automation gate, commander/commissar lifecycle, objective planning, whole-plan review, risk gates, and decision escalation.

### Stage 3: Dynamic Execution

Deliver WIP pull, execution-session reuse/create, Owner/assistants, progress/blocking/output/evidence, assistance, and Blocked-pressure control.

### Stage 4: Worktree Integration

Deliver project authorization, per-write-task isolation, conflict checks, review, user merge approval, merged-main verification, completion gate, cleanup, archive, and restore.

Each stage requires its own implementation plan, review, full verification, and real DSH Profile acceptance. Later-stage controls must not appear functional before their Host capabilities exist.

## Explicit Non-Goals for Stage 1

- per-session Team switch;
- per-session Team model pool;
- captain/commissar creation;
- execution Agent creation;
- WIP automation;
- assistance automation;
- worktree creation;
- merge automation;
- cross-project dashboard;
- real-time Agent logs embedded in cards;
- arbitrary task nesting;
- permanent task deletion.

## Superseded Local Work

The following unpushed commits belong to the superseded per-session Team direction and are not approved as the base of the project-board implementation:

```text
69a1630 docs: design per-session team orchestration
7251778 feat: define per-session Team configuration contract
d8f7b6c feat: project per-session Team configuration
8f8cebf feat: expose sanitized Team model capabilities
```

Reusable implementation ideas may be re-reviewed and selectively reimplemented or cherry-picked only after a project-board stage plan names the exact applicable contract. The `SessionTeamConfig` product model itself is superseded.

Before rewriting local `main`, create a safety branch preserving these commits. Any reset, branch deletion, worktree cleanup, or history rewrite requires explicit user confirmation after this design is reviewed.

## Acceptance Criteria for the Overall Product

1. Each Workspace maps to one project and one writable authoritative board.
2. Empty/manual board works without model policy or Agents.
3. Valid automation creates exactly one fixed commander and one independent commissar.
4. Ordinary sessions cannot rewrite the project plan.
5. Commander proposes plan; commissar reviews; ordinary approved tasks flow automatically.
6. High/Critical tasks and milestones pass mandatory commissar gates.
7. Ready tasks pull work under project WIP; sessions are reused before creation.
8. Blocked tasks release WIP and trigger threshold governance.
9. Each active leaf task has one Owner and optional assistants.
10. Code tasks use authorized isolated worktrees and cannot complete before user-approved merge plus main verification.
11. Every mutation is revision-checked and auditable.
12. Projects archive only after active work, worktrees, and decisions are resolved.
13. No secret, hidden reasoning, or unsupported Host behavior is represented as a board fact.
