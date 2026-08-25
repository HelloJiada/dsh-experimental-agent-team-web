# Agent Team Panel Release Repairs Design

**Date:** 2026-08-25  
**Status:** Approved design; implementation pending

## Goal

Correct the floating Agent Team activity panel release blockers so an installed classic-script DSH plugin loads its styles, uses supported theme tokens, presents the approved compact monitoring information, and keeps wide-screen automatic layouts content-fit.

## Scope and baseline

This repair applies to the floating panel implementation committed through `70ace12`. Existing user-approved uncommitted projection, dependency-DAG, documentation, replay, and generated-artifact changes remain preserved baseline. The repair must not revert, discard, or assume ownership of unrelated portions of those changes.

## CSS delivery

### Chosen delivery protocol

Replace plain `@tsdown/css` sidecar extraction with the DSH classic-client CSS Module protocol used by the official UI packages and the AgentTeams reference plugin.

A custom tsdown virtual module for `*.module.css` must:

1. compile CSS through Lightning CSS with deterministic CSS Module names using the `[hash]_[local]` pattern;
2. expose the matching default class-name map to TypeScript/React imports;
3. embed the compiled CSS text in the classic `lib/client.js` bundle;
4. install it when the client module factory executes by creating at most one style element identified by:

```html
<style
  data-plugin="@deepseek-ai/dsh-experimental-agent-team-web"
  data-plugin-css="@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamActivityPanel.module.css">
```

5. guard all DOM access so factory execution without `document` does not throw;
6. never emit top-level ESM CSS imports or CSS `require()` calls in `lib/client.js`.

The injector must query the `data-plugin-css` marker before appending, so repeated factory execution does not duplicate CSS. It must set both `dataset.plugin` and `dataset.pluginCss` before appending the style to `document.head`.

### Packaging boundary

`lib/client.js` is the complete runtime artifact for the panel styles. The published panel must not require a sidecar `lib/style.css` request. The build should not emit `lib/style.css`; if a build configuration limitation leaves one behind, no runtime contract or test may depend on it.

## Supported theme tokens

All unsupported `--dsh-*` references must be removed from source and emitted client CSS. The panel’s local aliases are:

```css
.root {
  --agent-team-panel-bg: var(--dsw-alias-bg-layer-2);
  --agent-team-panel-text: var(--dsw-alias-label-primary);
  --agent-team-panel-muted: var(--dsw-alias-label-secondary);
  --agent-team-panel-border: var(--dsw-alias-border-l2);
  --agent-team-panel-accent: var(--dsw-alias-state-business-primary);
  --agent-team-panel-soft: var(--dsw-alias-bg-module-platform);
}
```

Use these state colors where required:

- active/in-progress/focus: `--dsw-alias-state-business-primary`;
- completed: `--dsw-alias-state-success-primary`;
- warning/blocked: `--dsw-alias-state-warn-primary`;
- failed/error: `--dsw-alias-state-error-primary`.

Use `--dsw-shadow-lv3` for the panel and `--dsw-shadow-lv2` for the collapsed badge. The panel must remain CSS-module scoped, avoid host-private selectors, avoid global page padding, and never add a backdrop or global scroll lock.

## Height and geometry behavior

- **Docked and floating-auto modes:** The panel has `height: auto` and a geometry-derived safe `max-height`; its internal content area scrolls only after content exceeds that ceiling.
- **Floating-manual mode:** A user bottom/corner resize creates the only persisted explicit height. It remains clamped by the geometry helper.
- **Compact mode (`shell width <= 960px`):** The panel occupies the complete safe-margin rectangle. It keeps its explicit compact geometry height, disables drag/resize and internal overflow remains contained.
- Geometry helpers continue to own bounds, safe margins, dock/float transitions, move/resize clamping, and persistence parsing. They must not calculate a full-viewport height for docked or floating-auto panel CSS.

## Compact monitor content

The default surface remains compact and contains no full timeline, filters, search, full DAG canvas, or command explorer.

### Overview and progress

Render team identity and these counts from existing projection values:

- member count;
- completed task count;
- active/in-progress task count;
- blocked task count.

Render a compact segmented progress indicator using existing task data and status tones. It represents completed, active, and blocked task state without inventing a new host-side derivation.

### Action priorities

Render at most three intervention rows in the order already supplied by structured `taskInsights`. Do not parse `summary.topInterventions` display text for order.

Each displayed row contains:

- task identifier and subject;
- existing `reasons` text;
- impact from existing dependency/downstream metadata or task insight fields;
- an existing recommended action matched through structured projection data.

`summary.topInterventions` remains a human-readable summary only. A healthy fallback appears only when no actionable structured priority row exists.

### Member activity and tasks

Member rows show existing projection values for name, role, current activity description, workload, and unread state. Member activation still delegates to the existing public session-navigation callback.

Task rows remain limited to active and blocked tasks, with concise state/status labels.

## Quality corrections

- The activity-panel event test asserts its custom event has no `detail` payload.
- Test cleanup removes listeners and DOM state without dispatching production open events.
- The compact resize test enters floating mode before verifying compact mode hides otherwise-visible resize controls.
- Persist layout in one place per change; pointer-driven updates must not duplicate `localStorage.setItem` writes.
- Remove panel state refs that do not contribute behavior.
- Add behavioral tests for both public `ctx.sessions` member-navigation paths:
  - `subagentAddress` result uses `openSubagent` and does not call `open`;
  - no address falls back to `open`.
- README English and Chinese list `@deepseek-ai/dsh-client-ui-layout/client` among actual classic client runtime externals.

## Verification

### Built classic client CSS contract

After a build, tests must prove:

1. `lib/client.js` still parses with `node:vm.Script` and registers exactly one classic module-loader bundle.
2. It contains no top-level CSS import and no CSS `require()` request.
3. Evaluating its factory with a DOM installs exactly one plugin style tag with the required `data-plugin` and `data-plugin-css` values.
4. The injected CSS contains the generated root selector, key layout rules, and responsive/reduced-motion rules.
5. A second factory execution does not create another style tag.
6. Factory execution without `document` does not throw.
7. Generated CSS module class names used by the panel exist in the injected CSS text.

### Source and component coverage

- CSS source and injected output contain no `--dsh-*` references and include supported `--dsw-alias-*` / `--dsw-shadow-*` tokens.
- Component tests use real projection output and verify completed/active/blocked counts, segmented progress, structured top-three priorities with reason/impact/action, member role/activity/load/unread content, and current-session scope.
- Height tests distinguish wide auto (`height: auto` plus `max-height`) from floating-manual fixed height and compact fixed safe geometry.
- Existing geometry, event, navigation, bundle, and summary behavior retain their covered contracts.

### Release verification

Run:

```bash
pnpm run build
pnpm run typecheck
pnpm test
find lib/types -type f \( -name '*.test.d.ts' -o -name '*.test.d.ts.map' \) -print
npm pack --dry-run
```

The declaration scan must be empty. The pack dry-run must contain required runtime JavaScript, production declarations, README files, declared docs, and examples; it must contain no generated test declarations. Runtime style correctness is proven by the inline `lib/client.js` contract, not by a sidecar CSS file.
