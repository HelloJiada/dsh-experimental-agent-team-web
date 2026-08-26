# Agent Team P0 Host Correctness Design

Date: 2026-08-25

## Status

Approved for implementation planning.

## Objective

Close the five P0 Host-side correctness gaps found by the feature-completeness audit without expanding the Client UI or taking on P1/P2 work:

1. make all seven upstream `agent-teams/*` event types acceptable to the locked DSH runtime and persistence reader;
2. make projection state containing `failed` or `cancelled` tasks valid under the registered state schema;
3. preserve `teamId` and `captainSessionId` as distinct identities;
4. allow legacy state without `history` or `captainSessionId` to continue folding safely; and
5. add schema, restore, identity, registration, and state-version regression tests.

## Non-goals

This change will not modify:

- effective dependency blockers;
- failed/cancelled task health summaries;
- Command Bridge target or command-id semantics;
- quiet-message summary noise;
- member-load calculations;
- Client slots, activity panel, Workspace, DAG UI, or accessibility;
- release tarballs, packlists, or publication documentation.

Those remain P1, P2, or UI follow-up work.

## Current Constraints

The package is locked to `@deepseek-ai/dsh-session@0.1.1-rc.2`. That version:

- publicly exports `KNOWN_SESSION_EVENT_TYPES` from the package root;
- declares it as `ReadonlySet<string>`;
- implements it as a shared mutable `Set`;
- uses that same exported object in session persistence recovery;
- contains no supported third-party event-registration API; and
- explicitly defers a formal external registration surface.

TypeScript declaration merging of `SessionEventMap` makes third-party event names type-safe but does not update the runtime catalogue.

The projection framework uses `stateVersion` for cache invalidation. A version mismatch discards the old row and refolds from the durable session log; it does not migrate the cached state in place.

## Architecture

### Upstream event registration compatibility module

Add one small Host-only module, tentatively `src/upstream-event-registration.ts`, that owns the runtime compatibility shim.

It will:

- import `KNOWN_SESSION_EVENT_TYPES` from the `@deepseek-ai/dsh-session` package root;
- use the existing seven-event upstream vocabulary as the single source of truth;
- verify at runtime that the catalogue exposes callable `add` and `has` methods;
- add every required `agent-teams/*` event type idempotently;
- verify every event is visible after registration; and
- throw a clear compatibility error if registration cannot be completed.

It will not expose or run an unregister operation. Event vocabulary is process-wide persistence compatibility state: unloading one plugin must not make already-persisted logs unreadable or break another registrant using the same namespace.

`src/index.ts` will call this compatibility function before registering the `agentTeam` projection. The plugin must not enter a half-working state where projection registration succeeds but durable upstream events cannot be recovered.

The shim is explicitly version-locked compatibility code, not a claim that mutating the exported Set is a stable DSH public API. A future formal registry should replace this module as one unit.

### Projection state version 2

The projection state will represent two separate identities:

```ts
teamId: TeamId | null
captainSessionId: SessionId | null
```

Their responsibilities are distinct:

- `teamId` identifies the upstream Team entity, scopes events, and remains the provenance value for `commandPlan.generatedFromTeamId`;
- `captainSessionId` identifies the Lead/Captain session and is used for Lead member identity, Lead navigation, Captain name resolution, and Captain message addressing.

`initAgentTeamProjection()` will initialize both fields explicitly and will continue to initialize `history` to an empty array.

The registered projection `stateVersion` will increase from 1 to 2. This invalidates existing projection cache rows and lets the Host refold from the complete durable event log under the corrected state shape and fold semantics. No custom v1-to-v2 cache migration will be added.

## Legacy State Normalization

Pure fold/view functions and regression fixtures must still tolerate legacy state objects that omit fields introduced after state version 1.

A single normalization boundary will provide:

```text
history = state.history ?? []
effectiveCaptainSessionId = state.captainSessionId ?? state.teamId
```

This implements the approved conservative fallback:

- a legacy checkpoint with no `captainSessionId` remains readable and temporarily treats `teamId` as the Captain session;
- a later real `agent-teams/team-created` event replaces that fallback with the emitted `captainSessionId`;
- new initialized state and new version-2 checkpoints always contain `captainSessionId` and `history` explicitly.

Normalization must happen before any Team event appends history, so legacy state cannot reach `[...state.history]` with an undefined value.

The state schema will keep `history` and `captainSessionId` compatible with legacy input while the initializer and fold output enforce the complete version-2 shape.

## Event Data Flow

### Team creation

For `agent-teams/team-created`:

```text
teamId <- data.teamId
captainSessionId <- data.captainSessionId
```

The two values must never be cast into one another merely because both are strings at runtime.

### Other upstream events

Member, task, message, and deletion events may fill a missing `teamId` from their payload, preserving existing tolerant ordering behavior. They do not invent a new Captain identity when the payload does not provide one.

### Name resolution

`memberIdForName(state, "captain")` will resolve in this order:

1. `state.captainSessionId`;
2. legacy fallback `state.teamId`;
3. `null` when neither exists.

Normal teammate names continue to resolve against committed member snapshots.

For unknown names, existing tolerant addressing may remain, but the fallback target must use the effective Captain session before considering Team identity. This prevents Team ids from being emitted as session navigation or mailbox targets in corrected version-2 state.

### Projection view

The Lead member's:

- `id`;
- `sessionId`; and
- `leadMemberId`

will use the effective Captain session id.

Team provenance, including `commandPlan.generatedFromTeamId`, will continue to use `teamId`.

## State Schema

`taskStateSchema.status` will accept the complete durable task vocabulary:

```text
pending
in_progress
completed
failed
cancelled
deleted
```

The state schema will add a legacy-compatible `captainSessionId` field and retain legacy-compatible `history` parsing. Both fields are explicit in fresh state and all new fold output.

The formal schema must accept a complete upstream lifecycle after folding, including failed and cancelled tasks. This is required for checkpoint serialization, recovery, cold reads, and any Host validation of projection state.

## Error Handling

The event-registration compatibility module will fail startup when any of these conditions holds:

- the exported catalogue is absent or has an incompatible shape;
- `add` or `has` is not callable;
- the catalogue is frozen, returns a detached copy, or otherwise refuses an addition; or
- any required event is still absent after the registration attempt.

The error must include:

- this plugin's package name;
- the supported `dsh-session` compatibility line;
- the missing event names; and
- guidance to use a supported Host or upgrade this plugin when the Host registration contract changes.

The error must not be caught and converted into best-effort operation. Silent degradation would recreate the original failure mode: successful startup with no durable Team data.

## Testing Strategy

Implementation will follow test-driven development. Regression coverage will include the following.

### Runtime event catalogue

- all seven upstream event types are added;
- repeated registration is idempotent;
- an incompatible or immutable test catalogue throws the compatibility error;
- Host `apply()` completes event registration before projection registration; and
- no unregister behavior removes process-wide event compatibility.

The compatibility function should accept a catalogue parameter internally or expose a narrowly testable helper so failure cases do not mutate the real process-wide catalogue during tests.

### Terminal task state schema

- a folded failed task state passes the formal registered state schema;
- a folded cancelled task state passes the formal registered state schema; and
- the full upstream lifecycle fixture produces a state accepted by the formal schema before the view is derived.

### Captain identity preservation

Using the existing fixture where `teamId = "team-docs"` and `captainSessionId = "session-lead"`:

- both identities are preserved separately in projection state;
- Lead `id` and `sessionId` use `session-lead`;
- `leadMemberId` uses `session-lead`;
- Captain-addressed messages use `session-lead`; and
- command-plan provenance remains `team-docs`.

### Legacy compatibility

- state without `history` can consume another Team event without throwing;
- state without `captainSessionId` uses the approved `teamId` fallback;
- a subsequent `team-created` event replaces the fallback with the real Captain session; and
- view derivation remains valid for legacy-compatible state.

### Cache invalidation contract

- `agentTeamProjectionDefinition.stateVersion` equals 2;
- no custom cached-state migration is introduced; and
- tests document that Host version mismatch triggers full-log refolding under the projection framework contract.

## Acceptance Criteria

The P0 repair is complete only when:

1. plugin startup either registers all seven required upstream event types in the locked Host catalogue or fails with an actionable compatibility error;
2. a full upstream lifecycle containing failed and cancelled tasks produces state accepted by the registered state schema;
3. `teamId` and `captainSessionId` remain distinct through state, view, message targeting, and command provenance;
4. legacy state without `history` or `captainSessionId` continues folding without a runtime exception and uses the approved fallback;
5. projection state version is 2 so stale cache rows refold from durable events;
6. targeted regression tests and the full existing test suite pass; and
7. no Client UI, P1, or P2 behavior is changed.

## Future Replacement Point

When DSH exposes a supported third-party session event registry, replace the compatibility module with that API and keep the rest of the design unchanged. The test contract should remain: all required event types must be registered before projection use, and startup must fail clearly when durable recovery compatibility cannot be guaranteed.
