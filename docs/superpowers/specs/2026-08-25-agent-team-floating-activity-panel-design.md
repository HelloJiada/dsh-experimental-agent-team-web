# Agent Team Floating Activity Panel Design

**Date:** 2026-08-25  
**Status:** Approved design; implementation pending

## Goal

Replace the embedded, full-page Agent Team `conversation.view` dashboard with a reference-aligned, non-modal activity panel mounted in the DSH shell overlay. The new panel must make current-session team activity available without replacing or scrolling with the conversation.

## Compatibility basis

The supported DSH client dependency `@deepseek-ai/dsh-client-ui-layout@0.1.1-rc.2` declares `shell.overlay` as a root-scoped additive list slot above every column and outside all scroll containers. It is the appropriate mount point for a plugin-owned floating surface. The plugin must explicitly declare and inject this client module rather than relying on its transitive presence through `@deepseek-ai/dsh-client-ui-conversation`.

`conversation.view` is a session-scoped tab ring rendered one active entry at a time in the conversation body. It must not host the complete activity panel.

## User experience

### Visibility and launcher

- The panel follows the current conversation session.
- A collapsed right-corner activity badge appears only when the current session has at least one active or blocked team.
- The badge displays a concise team count and activity or attention state.
- Clicking the badge expands the panel.
- When qualifying team activity first appears in a session, the panel may auto-expand once. A manual collapse prevents repeated auto-expansion for that activity lifetime.
- Sessions without active or blocked teams render neither the badge nor the panel.
- The conversation transcript contains only a lightweight Team summary and an action that opens the activity panel; it does not contain the full dashboard.

### Panel modes

- **Docked mode:** Default on wide screens. The panel is positioned at the upper-right of the shell and remains outside conversation scrolling. The preferred width is 388px, constrained to a practical 320–640px range.
- **Floating mode:** The user can switch from docked to floating from the panel header. The header drags the panel; the left edge resizes width; floating mode also supports bottom-edge and corner resizing.
- **Compact mode:** At or below a 960px shell width, the panel becomes a safe-margin overlay. It disables dragging and resizing and keeps overflow inside the panel.
- **Collapse:** The header collapse control hides the panel and returns to the activity badge.
- **Non-modal behavior:** The panel never installs a blocking page mask or globally locks the underlying conversation.

### Geometry persistence

Persist versioned layout state in browser `localStorage` under a plugin-specific key. The state contains:

```ts
type PanelLayout = {
  readonly mode: 'docked' | 'floating'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly heightMode: 'auto' | 'manual'
}
```

Invalid, partial, stale, or malformed stored values fall back to the default docked layout. Geometry is clamped to the shell bounds whenever it is restored, moved, resized, or the shell changes size. Docked and compact panels use content-fit height subject to a safe viewport maximum; manual height applies only in floating mode after a user vertical resize.

## Compact monitoring content

The panel is a monitoring and intervention surface, not a copy of the current full dashboard. It reuses the existing `agentTeam` projection and derived values without changing the host-side projection model.

The visible hierarchy is:

1. **Header** — title, live/attention indicator, dock/float toggle on non-compact screens, and collapse control.
2. **Team overview** — team name, member count, completed/in-progress/blocked task counts, and overall health.
3. **Action priorities** — at most the top three derived alerts or blocking chains, ordered by existing priority. Each item identifies the task, reason, impact, and current suggested action. A healthy team has a concise healthy summary instead of empty alert chrome.
4. **Member activity** — name, role, current activity, workload or unread indication; activating a member uses the existing subagent-session navigation behavior.
5. **Task progress** — compact progress segments plus a short list of active or blocked tasks. The default panel does not render full history, full search/filter controls, the entire dependency DAG, or command-bridge exploration.

## Architecture

### Client integration

`src/client/index.ts` must:

- import the `@deepseek-ai/dsh-client-ui-layout/client` contract for slot typing;
- inject the layout client module through package metadata;
- register one unique root-scope `shell.overlay` entry for the activity panel;
- remove the complete dashboard registration from `conversation.view`;
- register or retain only a lightweight conversation-level Team entry that can request panel expansion.

The panel remains an ordinary host-rendered slot component. It must not create its own React root. A lightweight browser event or narrowly scoped module store may connect the conversation entry to the root-scoped overlay; the mechanism must support opening the panel after the conversation entry has unmounted.

### Panel boundaries

- `src/client/AgentTeamActivityPanel.tsx` owns current-session projection selection, qualifying-team detection, collapsed/expanded state, interaction orchestration, local-storage persistence, and rendering composition.
- `src/client/panel-geometry.ts` contains pure geometry and persistence helpers: parsing, compact-mode detection, bounds resolution, mode transitions, movement, and resize calculations.
- `src/client/AgentTeamActivityPanel.module.css` scopes all shell-overlay panel styles to the plugin surface, uses DSH design tokens, and contains the responsive/interaction visual rules.
- A small conversation entry component renders only the durable transcript summary and an “open team activity” action. It does not duplicate the monitor content.

The existing `AgentTeamWorkspace` must be split or retired rather than extended as another full-screen UI. Existing host-side contract and projection logic remain the data source.

## Error handling and accessibility

- Storage access and JSON parsing must be protected; storage failures render the default layout without throwing.
- Missing or empty projection data renders no launcher/panel rather than a generic empty Team destination.
- Member navigation failures preserve the panel state and use the existing error-reporting pattern.
- Panel controls are native buttons with accessible labels and visible focus styles.
- Drag/resize pointer handlers ignore non-primary buttons and interactive header descendants.
- `prefers-reduced-motion` disables panel and activity-indicator animation.

## Verification

### Unit tests

`panel-geometry` tests cover:

- malformed/partial layout persistence falling back to defaults;
- docked and floating geometry clamping within bounds;
- movement and every resize edge obeying min/max dimensions;
- dock/float transitions preserving a visible rectangle;
- compact bounds forcing safe-margin overlay geometry;
- automatic versus manual height behavior.

### Component tests

- No active or blocked current-session team renders neither badge nor panel.
- A qualifying team with collapsed state renders the badge.
- Badge activation expands the compact monitor; collapse returns to the badge.
- Qualifying content is scoped to the current session.
- Alert/action-priority output is ordered and capped at three entries.
- Activating a member delegates to the existing navigation action.
- Compact mode does not expose drag or resize controls.
- The complete panel is not registered in `conversation.view`.

### Packaging and integration tests

- Client metadata declares `@deepseek-ai/dsh-client-ui-layout` as a compatible peer/dev dependency and DSH client injection requirement.
- The shell-overlay registration is present in the client entry and the old complete `conversation.view` registration is absent.
- The existing classic-script client loader protocol continues to build and pass its bundle check.
- `pnpm run build`, `pnpm run typecheck`, and `pnpm test` pass.

## Non-goals

- Do not redesign the host projection, event adaptation, command bridge, or team data contract.
- Do not create a modal dialog, a full-page Team tab, or a global blocking mask.
- Do not modify DSH host source or depend on private CSS selectors.
- Do not make the full timeline, search/filter dashboard, or dependency DAG the default floating panel content.
- Do not modify unrelated preserved working-tree changes as part of this redesign.
