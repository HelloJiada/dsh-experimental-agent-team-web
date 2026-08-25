# Declaration Test Exclusion Design

**Date:** 2026-08-25  
**Status:** Approved design; implementation pending

## Goal

Prevent colocated TypeScript test files under `src/` from producing declaration artifacts in `lib/types/`, because the package publishes the entire `lib/` directory.

## Current behavior

`tsconfig.build.json` emits declarations for `src/**/*.ts` and `src/**/*.tsx`. It excludes the root `tests/` directory but not colocated test modules such as `src/filter.test.ts`. As a result, a normal `pnpm run build` creates `lib/types/*.test.d.ts` and corresponding declaration maps. These are not part of the plugin's public API but are included in the published `lib/` directory.

The normal `tsconfig.json` intentionally includes both source and test files so that `pnpm run typecheck` covers the whole codebase.

## Chosen approach

Update only the declaration-build configuration and add a regression test.

### Build configuration

Add these exclusions to `tsconfig.build.json`:

- `src/**/*.test.ts`
- `src/**/*.test.tsx`

Keep the existing declaration output directory (`lib/types`), source root (`src`), production include globs, and root `tests/` exclusion unchanged.

The primary TypeScript configuration remains unchanged, so colocated tests continue to participate in type checking and Vitest continues to discover them.

### Regression protection

Extend `tests/package-layout.spec.ts` with a recursive check of `lib/types/` after a build. The test must fail if it finds either of these artifact classes at any depth:

- `*.test.d.ts`
- `*.test.d.ts.map`

Existing assertions for declared package export files remain intact. This test protects the release artifact boundary rather than testing TypeScript's glob semantics directly.

## Non-goals

- Do not add `.gitignore` rules for generated test declarations.
- Do not delete the currently untracked `lib/types/*test*.d.ts{,.map}` files as part of this change.
- Do not change JavaScript bundling, npm `files`, package exports, public production declarations, or the normal typecheck configuration.
- Do not relocate source tests.

## Acceptance criteria

After implementation and a clean build:

1. `lib/types/` contains no generated `*.test.d.ts` or `*.test.d.ts.map` files.
2. Production declaration entry points declared in `package.json` remain present.
3. `pnpm run typecheck` continues to check colocated test source without error.
4. The test suite passes, including the new package-layout regression assertion.
