# Session Team Phase 1 Configuration Foundation Implementation Plan

> **STOP — SUPERSEDED 2026-08-26. DO NOT EXECUTE OR RESUME THIS PLAN.**
>
> The approved replacement direction is `docs/superpowers/specs/2026-08-26-project-command-board-design.md`. Tasks 1–3 produced unpushed local commits for the rejected per-session configuration model; Tasks 4–7 must remain unstarted. Preserve those commits only as a safety/reference line until Jade explicitly approves the Git recovery operation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a distributable DSH plugin release that lets each conversation persist, validate, and edit an isolated Team model/effort policy from a header action while creating no Team child Agents yet.

**Architecture:** Add whole-snapshot session events and an independent `agentTeamConfig` projection as the single configuration read authority. Client mutations travel through DSH's supported session-command bridge; Host handlers validate exact `ctx.llm` model capabilities, append authoritative events, and expose sanitized model-catalog observations through the projection. The Client registers a session-header action and a shell-overlay side panel, while fork initialization copies policy but appends a disabled snapshot.

**Tech Stack:** TypeScript 5.9, React 18, Zod 4, Vitest 4, Cordis 4.0.1, DSH packages pinned to `0.1.1-rc.2`, tsdown 0.22.2, pnpm 11.7.0.

## Global Constraints

- Implement only Phase 1 from `docs/superpowers/specs/2026-08-26-session-team-orchestration-design.md`.
- Do not create a captain, commissar, worker, Team instance, task, mailbox message, assistance flow, suspension flow, or shutdown state machine.
- Every new conversation defaults to Team disabled.
- Configuration authority is committed current-session events; browser state is only an unsaved form draft.
- Configuration applies to one session only. Fork copies model policy and worker limit, resets `enabled` to false, and copies no runtime Team state.
- `maxWorkers` is an integer from 1 through 8 and defaults to 4.
- The selectable model catalogue contains only currently registered DSH provider/model routes; provider credentials and secrets never enter events, projection DTOs, command input, logs, or Client code.
- Reasoning effort ids are adapter-owned opaque strings in adapter-preferred order. Do not alphabetically sort, alias, clamp, or replace them with a plugin enum.
- A model is selectable for Team children only when exact model metadata exposes at least one reasoning effort.
- Team cannot be enabled with an empty model pool, a stale route, an invalid min/max range, or an unsupported child-effort installation capability.
- The current conversation's captain model is outside the Phase 1 model pool and is not modified.
- Use only DSH `0.1.1-rc.2` public extension surfaces: session events/projections, `conversation.session.header.actions`, `shell.overlay`, session commands, `ctx.commands`, `ctx.llm`, `ctx.sessions`, and `session/created`.
- Do not add a custom Host RPC namespace or modify DSH packages, DSH source, or `node_modules`.
- Use numeric `order` on the official header-actions slot. Verify the desired relative position in the supported clean Profile, but do not claim absolute ordering under arbitrary third-party plugin combinations.
- Client command calls must resolve the `SessionFace` through injected `ctx.sessions.binding(sessionId)?.session`; the header `useSession` prop is a snapshot selector and must not be treated as an imperative session object.
- Host capability detection may verify the supported create-time `installModelSelection` export. It must not claim that an already-running child can be hot-switched.
- Runtime registration shims remain explicitly locked to DSH `0.1.1-rc.2` and fail with actionable compatibility errors.
- Package Phase 1 as version `0.2.0`; never overwrite or reuse the old `0.1.0` release artifact.
- Primary distribution is a prebuilt GitHub Release tarball with SHA-256, clean-Profile installation evidence, upgrade evidence, and uninstall evidence.
- Use TDD for every behavior change: record a failing focused test before production implementation.
- Run commands from `/Users/jade/Desktop/dsh-experimental-agent-team-web`.
- Work in the main workspace only; do not create a worktree unless Jade explicitly requests one in the implementation conversation.

## Event Vocabulary and Wire Contract

Use exactly these new domain events:

```ts
'agent-team/configured'
'agent-team/model-catalog-refreshed'
'agent-team/config-rejected'
```

Use whole-value snapshots:

```ts
interface SessionTeamConfigSnapshot {
  readonly version: 1
  readonly enabled: boolean
  readonly maxWorkers: number
  readonly modelPool: readonly SessionTeamModelPolicy[]
}

interface SessionTeamModelPolicy {
  readonly provider: string
  readonly model: string
  readonly minReasoningEffort: string
  readonly maxReasoningEffort: string
}
```

The configured-event sequence number is the optimistic concurrency revision exposed to the Client. No separate mutable revision counter is stored in the event payload.

A sanitized catalogue snapshot contains provider id/name, model id/name/description, adapter-ordered efforts, default effort, route failures, and Host child-effort capability. It contains no endpoint, credential, token, secret, raw provider settings, or adapter-private metadata.

Use two Host commands:

```text
/agent-team-models <request-json>
/agent-team-config <request-json>
```

Both definitions set `recordInput: false`. The authoritative domain events own request/result payloads; `command/run` must not duplicate model policy into command args.

Client requests contain a unique `requestId`. Successful refresh/save and rejected save events carry that id so the panel can correlate projection updates with the active request. Command admission only returns `{ matched }`; the panel does not pretend that admission means persistence succeeded.

## File Structure

- Create `src/session-team-config.ts`: branded request ids, config/catalog contracts, Zod schemas, pure validation, default state, exact model capability normalization.
- Create `src/session-team-config.test.ts`: contract, serialization, effort-range, redaction, and pure validation tests.
- Create `src/session-team-config-events.ts`: `SessionEventMap` augmentation, event constants, event catalogue registration and compatibility error.
- Create `src/session-team-config-events.test.ts`: runtime registration and failure tests.
- Create `src/session-team-config-projection.ts`: independent projection state/fold/view for config, catalogue, request result, and revision.
- Create `src/session-team-config-projection.test.ts`: fold, isolation, wire-schema, unrelated-event identity, and recovery tests.
- Create `src/session-team-models.ts`: Host model catalogue loader, exact effort preservation, failure isolation, and create-time effort capability probe.
- Create `src/session-team-models.test.ts`: provider/model/capability tests.
- Create `src/session-team-commands.ts`: command parsing, refresh/save validation, optimistic concurrency, committed append, and rejection handling.
- Create `src/session-team-commands.test.ts`: command handler unit/integration tests.
- Create `src/session-team-fork.ts`: fork seed fold and idempotent disabled-snapshot append.
- Create `src/session-team-fork.test.ts`: fork, resume, non-fork, and idempotence tests.
- Modify `src/index.ts` and `src/index.test.ts`: register event compatibility, projection, commands, and fork hook in safe order.
- Modify `src/contract.ts`: merge `agentTeamConfig` into `SessionProjectionMap` and export Client-safe DTO types.
- Create `src/client/session-team-config-events.ts`: open-panel browser event and request-id helper.
- Create `src/client/AgentTeamConfigButton.tsx` and test: session-header action.
- Create `src/client/AgentTeamConfigPanel.tsx`, CSS module, and test: current-session editor.
- Modify `src/client/index.ts`: register header action and shell overlay; inject command bridge from `ctx.sessions.binding(sessionId)?.session.command`.
- Modify `tests/client-bundle.spec.ts`: new exports, externals, and slot registration.
- Modify `package.json`, `pnpm-lock.yaml`, and `cordis.patch.yml`: version, pinned Host peers/dev dependencies, injection contract, release files.
- Modify README/docs/examples only for Phase 1 installation, compatibility, UI, and explicit no-spawn boundary.
- Rebuild `lib/**` after all source tests pass.

---

### Task 1: Session Team Configuration Contract and Runtime Event Vocabulary

**Files:**
- Create: `src/session-team-config.ts`
- Create: `src/session-team-config.test.ts`
- Create: `src/session-team-config-events.ts`
- Create: `src/session-team-config-events.test.ts`
- Modify: `src/contract.ts`

**Interfaces:**
- Produces `SessionTeamConfigSnapshot`, `SessionTeamModelPolicy`, `SessionTeamModelCatalogView`, `SessionTeamConfigView`, `SessionTeamConfigMutationView`, and Zod schemas.
- Produces `DEFAULT_SESSION_TEAM_CONFIG`, `validateSessionTeamConfig(config, catalog): SessionTeamConfigValidation`.
- Produces `SESSION_TEAM_CONFIG_EVENT_TYPES` and `registerSessionTeamConfigEventTypes(catalogue?: unknown): void`.
- Later tasks consume the exact event names and schemas defined here; no later task defines a duplicate contract.

- [ ] **Step 1: Write failing contract tests for defaults and JSON-safe schemas**

Create `src/session-team-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_TEAM_CONFIG,
  sessionTeamConfigSnapshotSchema,
  sessionTeamConfigViewSchema,
} from './session-team-config.js'

describe('session Team configuration contract', () => {
  it('defaults every session to disabled with four workers and no models', () => {
    expect(DEFAULT_SESSION_TEAM_CONFIG).toEqual({
      version: 1,
      enabled: false,
      maxWorkers: 4,
      modelPool: [],
    })
  })

  it('round-trips a JSON-safe complete snapshot', () => {
    const config = {
      version: 1 as const,
      enabled: true,
      maxWorkers: 4,
      modelPool: [{
        provider: 'anthropic',
        model: 'claude-opus-5',
        minReasoningEffort: 'medium',
        maxReasoningEffort: 'max',
      }],
    }
    expect(sessionTeamConfigSnapshotSchema.parse(JSON.parse(JSON.stringify(config))))
      .toEqual(config)
  })

  it.each([0, 9, 1.5])('rejects invalid worker limit %s', (maxWorkers) => {
    expect(sessionTeamConfigSnapshotSchema.safeParse({
      ...DEFAULT_SESSION_TEAM_CONFIG,
      maxWorkers,
    }).success).toBe(false)
  })

  it('does not admit secret-shaped fields into the strict wire schema', () => {
    expect(sessionTeamConfigViewSchema.safeParse({
      revision: 0,
      config: DEFAULT_SESSION_TEAM_CONFIG,
      catalog: null,
      lastMutation: null,
      apiKey: 'secret',
    }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the contract test and verify red**

```bash
pnpm vitest run --configLoader runner src/session-team-config.test.ts
```

Expected: FAIL because `session-team-config.ts` does not exist.

- [ ] **Step 3: Implement strict contracts and schemas**

Create `src/session-team-config.ts`. Use strict Zod objects. Define catalogue DTOs with this exact shape:

```ts
interface SessionTeamReasoningEffortView {
  readonly id: string
  readonly name: string
  readonly description?: string
}

interface SessionTeamModelView {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly efforts: readonly SessionTeamReasoningEffortView[]
  readonly defaultEffort?: string
  readonly selectable: boolean
  readonly unavailableReason?: string
}

interface SessionTeamProviderView {
  readonly id: string
  readonly name: string
  readonly models: readonly SessionTeamModelView[]
}

interface SessionTeamCatalogFailureView {
  readonly provider: string
  readonly message: string
}

interface SessionTeamChildEffortCapabilityView {
  readonly status: 'supported' | 'unsupported'
  readonly reason?: string
}

interface SessionTeamModelCatalogView {
  readonly providers: readonly SessionTeamProviderView[]
  readonly failures: readonly SessionTeamCatalogFailureView[]
  readonly childEffortCapability: SessionTeamChildEffortCapabilityView
  readonly refreshedAt: number
}

interface SessionTeamConfigMutationView {
  readonly requestId: string
  readonly kind: 'saved' | 'rejected' | 'catalog-refreshed'
  readonly message?: string
}

interface SessionTeamConfigView {
  readonly revision: number
  readonly config: SessionTeamConfigSnapshot
  readonly catalog: SessionTeamModelCatalogView | null
  readonly lastMutation: SessionTeamConfigMutationView | null
}
```

Export every interface needed by Client code, plus schemas typed with `z.ZodType<...>`.

- [ ] **Step 4: Write failing pure validation tests**

Extend `src/session-team-config.test.ts` with a catalogue whose effort order is `low, medium, high, max`. Assert:

```ts
expect(validateSessionTeamConfig(validEnabledConfig, catalog)).toEqual({ ok: true })
expect(validateSessionTeamConfig({ ...validEnabledConfig, modelPool: [] }, catalog))
  .toMatchObject({ ok: false, code: 'empty-model-pool' })
expect(validateSessionTeamConfig(configWithUnknownModel, catalog))
  .toMatchObject({ ok: false, code: 'unknown-model' })
expect(validateSessionTeamConfig(configWithUnsupportedEffort, catalog))
  .toMatchObject({ ok: false, code: 'unsupported-effort' })
expect(validateSessionTeamConfig(configWithMinAfterMax, catalog))
  .toMatchObject({ ok: false, code: 'invalid-effort-range' })
expect(validateSessionTeamConfig(validEnabledConfig, {
  ...catalog,
  childEffortCapability: { status: 'unsupported', reason: 'missing installModelSelection' },
})).toMatchObject({ ok: false, code: 'child-effort-unsupported' })
```

Also assert that a disabled config with an empty pool is valid; users may save a disabled draft before selecting models.

- [ ] **Step 5: Implement pure validation using adapter order**

Implement lookup by exact `(provider, model)` and compare effort positions in the model's existing `efforts` array. Do not sort or infer names. Return a discriminated result:

```ts
type SessionTeamConfigValidation =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code:
        | 'empty-model-pool'
        | 'unknown-model'
        | 'model-not-selectable'
        | 'unsupported-effort'
        | 'invalid-effort-range'
        | 'child-effort-unsupported'
      readonly message: string
    }
```

- [ ] **Step 6: Write failing event-vocabulary registration tests**

Create `src/session-team-config-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SESSION_TEAM_CONFIG_EVENT_TYPES,
  registerSessionTeamConfigEventTypes,
} from './session-team-config-events.js'

it('registers the exact Phase 1 event vocabulary idempotently', () => {
  const catalogue = new Set<string>()
  registerSessionTeamConfigEventTypes(catalogue)
  registerSessionTeamConfigEventTypes(catalogue)
  expect([...catalogue].sort()).toEqual([...SESSION_TEAM_CONFIG_EVENT_TYPES].sort())
})

it('fails loud when the Host catalogue cannot retain a type', () => {
  const catalogue = { add: () => catalogue, has: () => false }
  expect(() => registerSessionTeamConfigEventTypes(catalogue))
    .toThrow(/DSH 0\.1\.1-rc\.2/)
})
```

- [ ] **Step 7: Implement event declarations and version-locked registration**

Create `src/session-team-config-events.ts` with:

```ts
export const SESSION_TEAM_CONFIG_EVENT_TYPES = [
  'agent-team/configured',
  'agent-team/model-catalog-refreshed',
  'agent-team/config-rejected',
] as const
```

Augment `@deepseek-ai/dsh-session/types` with strict payload interfaces. Use the same defensive catalogue shape checks and strict `has(type) === true` semantics as `src/upstream-event-registration.ts`; share a small internal helper only if doing so reduces duplication without changing the existing upstream registration API.

Configured payload:

```ts
{ version: 1; requestId: string; config: SessionTeamConfigSnapshot }
```

Catalog payload:

```ts
{ version: 1; requestId: string; catalog: SessionTeamModelCatalogView }
```

Rejected payload:

```ts
{
  version: 1
  requestId: string
  code: string
  message: string
  currentRevision: number
}
```

- [ ] **Step 8: Merge the projection Client type map**

In `src/contract.ts` extend `SessionProjectionMap`:

```ts
agentTeamConfig: SessionTeamConfigView
```

Import/export the Client-safe config types from `session-team-config.ts` without importing Host-only DSH services.

- [ ] **Step 9: Run Task 1 tests and typecheck**

```bash
pnpm vitest run --configLoader runner \
  src/session-team-config.test.ts \
  src/session-team-config-events.test.ts
pnpm run typecheck
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/session-team-config.ts src/session-team-config.test.ts \
  src/session-team-config-events.ts src/session-team-config-events.test.ts src/contract.ts
git commit -m "feat: define per-session Team configuration contract"
```

---

### Task 2: Independent Configuration Projection

**Files:**
- Create: `src/session-team-config-projection.ts`
- Create: `src/session-team-config-projection.test.ts`
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`

**Interfaces:**
- Consumes Task 1 schemas and event payloads.
- Produces `sessionTeamConfigProjectionDefinition` with key `agentTeamConfig`, `stateVersion: 1`, strict state schema, and whole-value wire view.
- Produces `foldSessionTeamConfigEvents(events): SessionTeamConfigState` for fork and command concurrency code.

- [ ] **Step 1: Write failing projection default/isolation tests**

Create `src/session-team-config-projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applySessionTeamConfigEvent,
  initSessionTeamConfigProjection,
  viewSessionTeamConfig,
} from './session-team-config-projection.js'

it('starts disabled with revision zero and no catalogue', () => {
  expect(viewSessionTeamConfig(initSessionTeamConfigProjection())).toEqual({
    revision: 0,
    config: { version: 1, enabled: false, maxWorkers: 4, modelPool: [] },
    catalog: null,
    lastMutation: null,
  })
})

it('returns the same state reference for unrelated events', () => {
  const state = initSessionTeamConfigProjection()
  expect(applySessionTeamConfigEvent(state, {
    type: 'user/message', seq: 1, time: 1, data: {},
  } as SessionEvent)).toBe(state)
})
```

- [ ] **Step 2: Run projection tests and verify red**

```bash
pnpm vitest run --configLoader runner src/session-team-config-projection.test.ts
```

Expected: FAIL because projection module does not exist.

- [ ] **Step 3: Implement state, init, fold, and wire view**

State shape:

```ts
interface SessionTeamConfigState {
  readonly revision: number
  readonly config: SessionTeamConfigSnapshot
  readonly catalog: SessionTeamModelCatalogView | null
  readonly lastMutation: SessionTeamConfigMutationView | null
}
```

Fold rules:

- `configured`: replace complete config, set `revision = event.seq`, set mutation `saved`.
- `model-catalog-refreshed`: replace complete catalog, keep config/revision, set mutation `catalog-refreshed`.
- `config-rejected`: keep config/catalog/revision, set mutation `rejected` with message.
- unrelated event: return the same reference.

Export `foldSessionTeamConfigEvents(events)` as a reduce over init/apply. Register `SessionProjectionStateMap.agentTeamConfig`.

- [ ] **Step 4: Add failing overwrite/rejection/schema tests**

Use real-shaped events to assert:

- second configured event fully replaces first model pool;
- catalogue refresh preserves adapter effort order;
- rejected event does not change config or revision;
- `stateSchema.safeParse(folded).success === true`;
- `wire.viewSchema.safeParse(view).success === true`;
- JSON round-trip preserves the view.

- [ ] **Step 5: Implement strict schemas and projection definition**

Use schemas from Task 1; do not create permissive duplicates. Set exact definition:

```ts
{
  key: 'agentTeamConfig',
  stateSchema,
  init,
  apply,
  wire: { viewSchema: sessionTeamConfigViewSchema, view },
  stateVersion: 1,
}
```

- [ ] **Step 6: Write failing Host registration-order test**

Update `src/index.test.ts` mocks and expected calls to require:

```text
upstream events
config events
agentTeam projection
agentTeamConfig projection
```

Both event catalogues must register before either projection.

- [ ] **Step 7: Register config events and projection in Host apply**

Modify `src/index.ts` to call both compatibility registrars before `ctx.inject`. Register both projection definitions inside the injected callback. Preserve the existing `agentTeam` key and behavior.

- [ ] **Step 8: Run Task 2 tests and existing projection regressions**

```bash
pnpm vitest run --configLoader runner \
  src/session-team-config-projection.test.ts \
  src/index.test.ts \
  tests/projection.spec.ts \
  tests/e2e-replay.spec.ts
pnpm run typecheck
```

- [ ] **Step 9: Commit Task 2**

```bash
git add src/session-team-config-projection.ts \
  src/session-team-config-projection.test.ts src/index.ts src/index.test.ts
git commit -m "feat: project per-session Team configuration"
```

---

### Task 3: Sanitized Model Catalogue and Child-Effort Capability Gate

**Files:**
- Create: `src/session-team-models.ts`
- Create: `src/session-team-models.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes `ctx.llm.listProviders()`, `listModels(provider)`, `resolveModelInfo(provider, model)`, and the runtime `installModelSelection` export.
- Produces `loadSessionTeamModelCatalog(llm, options): Promise<SessionTeamModelCatalogView>`.
- Produces `detectChildEffortCapability(candidate?: unknown): SessionTeamChildEffortCapabilityView`.
- Does not create or mutate any Agent.

- [ ] **Step 1: Add pinned Host peer/dev dependencies**

Add exact `0.1.1-rc.2` peer and dev dependencies for:

```text
@deepseek-ai/dsh-agent
@deepseek-ai/dsh-commands
```

Do not add `@nanmicoder/dsh-agent-teams`; Phase 1 owns no external runtime dependency and creates no Team.

Run:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

Expected: lockfile and node_modules resolve the exact pinned versions.

- [ ] **Step 2: Write failing capability-gate tests**

Create `src/session-team-models.test.ts`:

```ts
expect(detectChildEffortCapability(() => undefined)).toEqual({ status: 'supported' })
expect(detectChildEffortCapability(undefined)).toEqual({
  status: 'unsupported',
  reason: expect.stringContaining('installModelSelection'),
})
```

The real default call must use the namespace import's `installModelSelection` value and return supported on the locked Host.

- [ ] **Step 3: Implement the pure capability probe**

Use:

```ts
import * as dshAgent from '@deepseek-ai/dsh-agent'
```

Default candidate is `dshAgent.installModelSelection`. Check only that the supported create-time installer is callable. Document that Phase 1 does not prove or promise hot mutation of existing children.

- [ ] **Step 4: Write failing catalogue tests with provider-local failure isolation**

Fake the LLM surface:

```ts
listProviders(): [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'broken', name: 'Broken' },
]
listModels('anthropic'): [
  { id: 'opus', name: 'Opus' },
  { id: 'plain', name: 'Plain' },
]
resolveModelInfo('anthropic', 'opus'): {
  id: 'opus', name: 'Opus',
  reasoning: {
    efforts: [
      { id: 'medium', name: 'Medium' },
      { id: 'max', name: 'Maximum' },
    ],
    defaultEffort: 'medium',
  },
}
resolveModelInfo('anthropic', 'plain'): { id: 'plain', name: 'Plain' }
listModels('broken'): throws Error('offline')
```

Assert:

- provider order remains registration order;
- model order remains adapter order;
- effort order remains `medium, max`;
- `opus.selectable === true`;
- `plain.selectable === false` with a reasoning-capability message;
- broken provider becomes one sanitized failure while Anthropic remains usable;
- no arbitrary object property such as `apiKey`, `endpoint`, or `settings` survives in the DTO.

- [ ] **Step 5: Implement detached sanitized catalogue loading**

Define a narrow structural `SessionTeamLlmDirectory` interface in this module instead of accepting the full Cordis context. For every provider:

1. call `listModels`;
2. resolve each exact model;
3. detach only approved fields;
4. preserve order;
5. isolate provider/model failure into sanitized messages;
6. compute `selectable` from non-empty reasoning efforts and supported child-effort capability.

Take `refreshedAt` through an injected `now: () => number` option for deterministic tests.

- [ ] **Step 6: Test the real locked Host export without creating an Agent**

Add:

```ts
it('detects create-time effort installation on DSH 0.1.1-rc.2', () => {
  expect(detectChildEffortCapability()).toEqual({ status: 'supported' })
})
```

This is a compatibility probe, not a child runtime integration test.

- [ ] **Step 7: Run Task 3 tests and typecheck**

```bash
pnpm vitest run --configLoader runner src/session-team-models.test.ts
pnpm run typecheck
```

- [ ] **Step 8: Commit Task 3**

```bash
git add src/session-team-models.ts src/session-team-models.test.ts package.json pnpm-lock.yaml
git commit -m "feat: expose sanitized Team model capabilities"
```

---

### Task 4: Host Refresh/Save Commands and Optimistic Concurrency

**Files:**
- Create: `src/session-team-commands.ts`
- Create: `src/session-team-commands.test.ts`
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`

**Interfaces:**
- Consumes Task 1 contract validation, Task 2 folding, and Task 3 model loader.
- Produces `registerSessionTeamCommands(ctx): () => void`.
- Registers exact commands `agent-team-models` and `agent-team-config` with `recordInput: false`.
- Appends exactly one authoritative success or rejection event per admitted well-formed panel request.

- [ ] **Step 1: Write failing request parsing tests**

In `src/session-team-commands.test.ts`, specify exact request shapes:

```ts
interface RefreshModelsRequest {
  readonly version: 1
  readonly requestId: string
}

interface SaveConfigRequest {
  readonly version: 1
  readonly requestId: string
  readonly expectedRevision: number
  readonly config: SessionTeamConfigSnapshot
}
```

Assert strict JSON parsing rejects unknown properties, blank request id, negative revision, malformed JSON, and images. `input.images` remains absent/false.

- [ ] **Step 2: Implement strict parsers and error result helper**

Command-result text is concise and contains no full config or secret-bearing input. Set `recordInput: false` on both definitions.

- [ ] **Step 3: Write failing refresh command tests**

Using a fake `Agent` with a fake `session.append`, assert:

- valid refresh calls the model loader once;
- appends `agent-team/model-catalog-refreshed` with request id and sanitized catalogue;
- returns `{ kind: 'success', sourceEventSeq }`;
- model-loader failure appends `agent-team/config-rejected` with current revision and returns error;
- no config event is appended.

- [ ] **Step 4: Implement model refresh handler**

Use the invocation's exact `agent.session`, not `ctx.sessions.current`. Compute current revision by folding the session's events. The loader receives `ctx.llm` and real time only at this Host boundary.

- [ ] **Step 5: Write failing save command tests**

Cover:

1. expected revision 0 with no existing config;
2. accepted disabled empty-pool config;
3. accepted enabled valid config after a catalogue refresh;
4. stale expected revision rejects and appends no configured event;
5. enabled empty pool rejects;
6. stale/unknown model rejects after fresh Host revalidation;
7. min above max rejects;
8. unsupported child effort rejects;
9. success appends exactly one full `agent-team/configured` snapshot;
10. configured payload contains no credential fields;
11. input is absent from `command/run` because `recordInput:false`.

For validation, reload the current model catalogue from `ctx.llm`; do not trust the prior catalogue event as current capability authority.

- [ ] **Step 6: Implement optimistic save handler**

Algorithm:

```text
parse request
fold current session events
compare expectedRevision to folded revision
load fresh sanitized catalogue
validate complete config against fresh catalogue
append configured on success
append config-rejected on domain rejection with requestId/currentRevision
return CommandResult correlated by sourceEventSeq
```

Malformed manual slash input may return a command error without a domain event because no trustworthy request id exists. Panel-generated requests always carry a valid request id.

- [ ] **Step 7: Write failing Host registration tests**

Update `src/index.test.ts` to require command registration only after event/projection compatibility registration. Mock `ctx.commands.register` and assert exact command names and `recordInput:false`.

- [ ] **Step 8: Wire command registration through explicit Host injection**

Update Host `inject` and `cordis.patch.yml` requirements to include:

```text
sessionProjections
commands
llm
sessions
```

`registerSessionTeamCommands` returns a composite disposer for both command definitions. Use Cordis effect ownership; do not leave duplicate command registrations on reload.

- [ ] **Step 9: Run Task 4 tests and Host regressions**

```bash
pnpm vitest run --configLoader runner \
  src/session-team-commands.test.ts \
  src/session-team-config-projection.test.ts \
  src/index.test.ts \
  tests/e2e-replay.spec.ts
pnpm run typecheck
```

- [ ] **Step 10: Commit Task 4**

```bash
git add src/session-team-commands.ts src/session-team-commands.test.ts \
  src/index.ts src/index.test.ts cordis.patch.yml
git commit -m "feat: persist validated session Team configuration"
```

---

### Task 5: Fork Inheritance with Team Disabled

**Files:**
- Create: `src/session-team-fork.ts`
- Create: `src/session-team-fork.test.ts`
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`

**Interfaces:**
- Consumes `foldSessionTeamConfigEvents` and `agent-team/configured`.
- Produces `initializeForkedSessionTeamConfig(session): void` and `registerSessionTeamForkInheritance(ctx): () => void`.
- Copies only policy and worker limit; appends disabled complete snapshot.

- [ ] **Step 1: Write failing seed-fold tests**

Build fake sessions with `header.parentSession`, `header.seedLength`, and `events`. Assert:

- no parent metadata: no append;
- parent with no inherited config: no append;
- inherited enabled config: append one complete config with identical pool/limit and `enabled:false`;
- inherited disabled config: still append one child-owned disabled snapshot so future child updates have a child revision;
- appended event has a new request id/provenance suitable for audit;
- tasks/messages/member events are ignored.

- [ ] **Step 2: Implement seed-prefix-only inheritance**

Read only:

```ts
session.events.slice(0, session.header.seedLength)
```

Do not fold child events when deriving inherited policy. Generate an internal request id such as `fork:<childSessionId>:<parentSessionId>`; schemas must accept it.

- [ ] **Step 3: Write failing resume/idempotence tests**

Assert no append when:

- the session has `parentSession` but a post-seed `agent-team/configured` event already exists;
- `session/created` is replayed for the same live/resumed child;
- `seedLength` is absent or zero.

This prevents every Host restart from appending another disabled snapshot.

- [ ] **Step 4: Implement post-seed guard**

Inspect events at `index >= seedLength` for any child-owned configured event. If one exists, return without append.

- [ ] **Step 5: Write failing Cordis listener registration test**

Mock `ctx.on('session/created', handler, { global: true })`; assert the exact event name, global option, and disposer ownership. The listener must be synchronous because a thrown initialization error may veto publication on the supported Host.

- [ ] **Step 6: Register fork inheritance after event compatibility**

Wire the listener in Host apply. Event vocabulary registration must happen before any fork initialization can append the custom event.

- [ ] **Step 7: Run Task 5 tests and full projection recovery tests**

```bash
pnpm vitest run --configLoader runner \
  src/session-team-fork.test.ts \
  src/session-team-config-projection.test.ts \
  src/projection-history.test.ts \
  src/index.test.ts
pnpm run typecheck
```

- [ ] **Step 8: Commit Task 5**

```bash
git add src/session-team-fork.ts src/session-team-fork.test.ts src/index.ts src/index.test.ts
git commit -m "feat: inherit disabled Team policy on session fork"
```

---

### Task 6: Session Header Action and Configuration Side Panel

**Files:**
- Create: `src/client/session-team-config-events.ts`
- Create: `src/client/AgentTeamConfigButton.tsx`
- Create: `src/client/AgentTeamConfigButton.test.tsx`
- Create: `src/client/AgentTeamConfigPanel.tsx`
- Create: `src/client/AgentTeamConfigPanel.module.css`
- Create: `src/client/AgentTeamConfigPanel.test.tsx`
- Modify: `src/client/index.ts`
- Modify: `tests/client-bundle.spec.ts`

**Interfaces:**
- Header button consumes standard session props `sessionId`, `useProjection`, and `useSession` snapshot selector.
- Panel consumes current `useSessions`, current config projection, and injected imperative callbacks.
- Client apply resolves commands through `ctx.sessions.binding(sessionId)?.session.command(line)`.
- Neither component stores authoritative config outside projection values.

- [ ] **Step 1: Define the browser open-event contract**

Create `session-team-config-events.ts`:

```ts
export const OPEN_SESSION_TEAM_CONFIG_EVENT =
  '@deepseek-ai/dsh-experimental-agent-team-web/open-session-team-config'

export interface OpenSessionTeamConfigDetail {
  readonly sessionId: string
}
```

Provide a typed dispatcher and listener helper. Request ids use `crypto.randomUUID()` when available and a deterministic-safe fallback combining time/counter; tests inject the generator. Request ids contain no user/config data.

- [ ] **Step 2: Write failing header button tests**

Test in JSDOM:

- default projection shows `Team · 关闭`;
- enabled config shows `Team · 待命` in Phase 1;
- rejected last mutation shows `Team · 配置错误`;
- click dispatches open event with the exact session id;
- button exposes accessible name and `aria-expanded` state;
- component never calls a Host command directly.

- [ ] **Step 3: Implement `AgentTeamConfigButton`**

Use `PropsRuntime<'conversation.session.header.actions'>`. `useProjection('agentTeamConfig')` is the only state read. Use exact numeric order `110` in registration; document that clean-Profile acceptance verifies relative placement while arbitrary plugin combinations may interleave numeric orders.

- [ ] **Step 4: Write failing panel rendering/model tests**

Panel tests cover:

- hidden until open event targets current session;
- current-conversation scope text;
- default disabled, maxWorkers 4;
- open triggers `/agent-team-models {json}` through injected command bridge;
- only `selectable:true` models can be added;
- model effort options preserve catalogue order;
- model without reasoning efforts is shown disabled with reason;
- no provider secret-shaped values render;
- cancel discards draft and closes;
- switching sessions closes/rebinds the panel rather than leaking draft.

- [ ] **Step 5: Implement Phase 1 side panel without spawn controls**

The panel includes:

- enable toggle;
- model pool rows with provider/model identity;
- min/max effort selectors;
- worker limit 1–8;
- command-structure explanation;
- compatibility/validation errors;
- Save and Cancel.

It explicitly states that enabling saves policy only and creates no member in Phase 1. Do not render Run, Spawn, Commissar, Worker status, Stop, Assist, or Pause controls.

- [ ] **Step 6: Write failing Client-side prevalidation/save correlation tests**

Assert:

- enabled + empty pool prevents command and shows error;
- min after max prevents command;
- unsupported child effort prevents command;
- valid save sends exact `/agent-team-config <json>` with `expectedRevision` from projection and a request id;
- command admission `matched:false` shows Host-command-unavailable error;
- `matched:true` shows saving state but not success;
- success is shown only when projection `lastMutation.requestId` matches and kind is `saved`;
- rejection is shown only for matching request id;
- a newer unrelated mutation does not satisfy the current save;
- stale-revision rejection reloads draft from projection before retry.

- [ ] **Step 7: Implement imperative command bridge in Client apply**

Extend `ClientContext` with `ISessions`. Inject callbacks into panel registration:

```ts
async function runSessionCommand(sessionId: SessionId, line: string) {
  const face = ctx.sessions.binding(sessionId)?.session
  if (face === undefined) throw new Error('Session command capability unavailable')
  return face.command(line)
}
```

Do not call `useSession().command`; `useSession` is a selector hook.

Register:

```text
conversation.session.header.actions  -> AgentTeamConfigButton
shell.overlay                        -> AgentTeamConfigPanel
```

Preserve existing activity panel and conversation summary registrations.

- [ ] **Step 8: Update classic-bundle protocol tests**

Update bundle export/slot expectations for four registrations. Assert header entry id `agent-team-config`, order `110`, and component identity. Assert all runtime externals are present in manifest injection/module table and CSS remains embedded once.

- [ ] **Step 9: Run Task 6 tests and typecheck**

```bash
pnpm vitest run --configLoader runner \
  src/client/AgentTeamConfigButton.test.tsx \
  src/client/AgentTeamConfigPanel.test.tsx \
  tests/client-bundle.spec.ts
pnpm run typecheck
```

- [ ] **Step 10: Commit Task 6**

```bash
git add src/client/session-team-config-events.ts \
  src/client/AgentTeamConfigButton.tsx src/client/AgentTeamConfigButton.test.tsx \
  src/client/AgentTeamConfigPanel.tsx src/client/AgentTeamConfigPanel.module.css \
  src/client/AgentTeamConfigPanel.test.tsx src/client/index.ts \
  tests/client-bundle.spec.ts
git commit -m "feat: add per-session Team configuration panel"
```

---

### Task 7: Plugin Integration, Versioned Distribution, and Clean-Profile Acceptance

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `cordis.patch.yml`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/compatibility.md`
- Modify: `docs/verification-checklist.md`
- Modify: `docs/real-profile-smoke-check.md`
- Modify: `docs/releasing.md`
- Modify: `examples/profile-patch.agent-team-web.yml`
- Modify: `tests/package-layout.spec.ts`
- Create: `tests/session-team-phase-1.spec.ts`
- Rebuild: `lib/**`

**Interfaces:**
- Consumes all Phase 1 source work.
- Produces plugin version `0.2.0`, self-contained tarball, SHA-256, release instructions, clean-Profile acceptance record, and no Phase 2/3 claim.

- [ ] **Step 1: Add deterministic Phase 1 end-to-end replay test**

Create `tests/session-team-phase-1.spec.ts` covering:

```text
new session default
catalog refresh
valid disabled save
valid enabled save
stale save rejection
Host restart replay
fork seed inheritance with enabled reset false
two sessions maintain isolated policies
no member/task/message/team-created event produced
```

Use real event shapes, projection schemas, command handlers with fake DSH services, and JSON round-trip the final view.

- [ ] **Step 2: Run the E2E test red, then fix only integration gaps**

```bash
pnpm vitest run --configLoader runner tests/session-team-phase-1.spec.ts
```

Expected initial failure identifies missing wiring. Fix only Phase 1 source integration; do not add spawn behavior.

- [ ] **Step 3: Set package version and complete plugin dependency metadata**

Set:

```json
"version": "0.2.0"
```

Ensure exact peer/dev dependencies for every runtime import and exact `dsh.client.inject` entries for every Client external. Ensure `cordis.patch.yml` injects `sessionProjections`, `commands`, `llm`, and `sessions` as required by Host apply.

- [ ] **Step 4: Update package-layout and release tests**

Tests must execute a real `pnpm pack --dry-run` or inspect a freshly generated tarball, not only workspace paths. Assert:

- version is 0.2.0;
- Host/Client files and declarations exist;
- no CSS sidecar is required;
- required docs/examples are included;
- all relative README links included in the package resolve;
- tarball does not contain `.superpowers`, source tests, local config, credentials, or old `.tgz` files;
- packed `lib/client.js` and `lib/index.js` are byte-identical to verified workspace artifacts;
- declaration maps either resolve to published sources or are not published/enabled according to the release decision.

- [ ] **Step 5: Update user documentation without overclaiming**

Document:

- DSH `0.1.1-rc.2` exact compatibility;
- installation from GitHub Release `.tgz`;
- Team button uses official header-actions slot and numeric order;
- clean supported Profile places it in the intended action row, but arbitrary third-party action ordering may interleave;
- Phase 1 saves session policy only and creates no Agent;
- empty model pool and unsupported effort capability block enablement;
- model credentials never enter plugin data;
- fork copy/reset semantics;
- command bridge and committed-event authority;
- upgrade from 0.1.0 to 0.2.0;
- uninstall preserves session logs but removes the UI/projection capability until reinstalled.

Remove contradictory claims that the entire plugin is read-only; distinguish the still-read-only runtime monitor from the writable Phase 1 configuration surface.

- [ ] **Step 6: Run source verification before build**

```bash
pnpm run typecheck
pnpm run test
```

Expected: all tests pass. Record exact counts.

- [ ] **Step 7: Build fresh artifacts and inspect scope**

```bash
pnpm run build
git diff --check
git status --short
git diff --stat
```

Inspect generated Host and Client bundles. Confirm config UI is in Client; command/model/fork logic is Host-only; no unexpected external or sidecar appears.

- [ ] **Step 8: Run fresh-artifact verification and create release tarball**

```bash
pnpm run typecheck
pnpm run test
mkdir -p /tmp/agent-team-web-release
pnpm pack --pack-destination /tmp/agent-team-web-release
shasum -a 256 /tmp/agent-team-web-release/deepseek-ai-dsh-experimental-agent-team-web-0.2.0.tgz
```

Record the SHA-256 in the release acceptance report. Do not commit the tarball to the repository.

- [ ] **Step 9: Clean-Profile real acceptance**

In a disposable DSH Web Profile pinned to `0.1.1-rc.2`:

1. install only required compatible DSH packages and the generated `0.2.0.tgz`;
2. merge the shipped patch;
3. run `dsh --profile <clean-profile> --dump-config`;
4. start Web;
5. verify Team action appears in the supported header action row and, in this clean Profile, between the expected Settings/Restart actions when those actions are present;
6. open two sessions and save different policies;
7. refresh browser and restart Host; verify recovery;
8. fork enabled source; verify copied policy and disabled child;
9. verify model effort order equals adapter metadata;
10. verify invalid/stale policy is rejected;
11. verify enabling creates zero subagents and zero Team runtime events;
12. uninstall plugin; verify Host starts and existing session logs remain intact;
13. reinstall `0.2.0`; verify config projection recovers.

If the local environment lacks the `dsh` executable, mark release as blocked and provide the exact commands for a machine that has the supported Host. Synthetic tests do not replace this gate.

- [ ] **Step 10: Commit source/docs/build artifacts**

Stage reviewed source, tests, docs, manifest, lockfile, patch, and generated `lib/**`. Do not stage `.tgz`, `.superpowers`, clean Profile files, credentials, or logs.

```bash
git add package.json pnpm-lock.yaml cordis.patch.yml README.md README.zh-CN.md \
  docs/compatibility.md docs/verification-checklist.md \
  docs/real-profile-smoke-check.md docs/releasing.md \
  examples/profile-patch.agent-team-web.yml tests lib src
git status --short
git commit -m "feat: ship per-session Team configuration foundation"
```

- [ ] **Step 11: Verify final repository and release evidence**

```bash
git status -sb
git log --oneline -10
```

Expected: worktree clean; Phase 1 commits visible; branch not pushed unless Jade separately requests it. Report exact tests, tarball path, SHA-256, and whether clean-Profile acceptance passed or remains the sole release blocker.
