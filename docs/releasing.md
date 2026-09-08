# Build and Release Strategy

## Goal

Consumers install a prebuilt bundle. They must never need to build from source or fetch the DeepSeek Harness monorepo during installation.

## Why

The bundle never imports the DeepSeek Harness monorepo at runtime. All host
interfaces come from npm-published `@deepseek-ai/dsh-*@0.1.3-alpha.2` packages,
and the AgentTeams kernel (roster, mailbox, task DAG, scheduler) is implemented
inside this repository. Consumers therefore never trigger a large monorepo git
fetch during install, and no unpublished package is required.

## Roles

### Maintainer (this repository)

Builds and publishes the prebuilt artifacts.

```bash
set -euo pipefail
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test
pnpm pack

rm -rf .tmp-pack-check
mkdir -p .tmp-pack-check
tar -xf deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz -C .tmp-pack-check
cmp lib/client.js .tmp-pack-check/package/lib/client.js
rg -q '__ModuleLoader__\.load' .tmp-pack-check/package/lib/client.js
rg -q '@deepseek-ai/dsh-experimental-agent-team-web' .tmp-pack-check/package/lib/client.js
rm -rf .tmp-pack-check
```

`cmp` proves the tarball's Client bundle is byte-for-byte identical to the VM-tested workspace artifact. The two independent `rg -q` checks separately check that the loader call string and exact package ID string exist; under the strict shell, any nonzero result blocks release. `pnpm pack` also runs the `prepack` script (`build && test`) automatically.

### Consumer (a DSH profile)

Installs the tarball and enables the bundle row. No build, no monorepo fetch.

## Distribution

1. Create a GitHub Release tagged `v<version>`.
2. Attach the `pnpm pack` output: `deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz`.
3. Consumers install the tarball URL:

   ```bash
   cd ~/.dsh/profiles/web
   pnpm add ./deepseek-ai-dsh-experimental-agent-team-web-<version>.tgz
   ```

## Repository layout

The repository commits `lib/` so a direct git install also works without a build step. `.gitignore` excludes only transient outputs (`dist/`, `coverage/`, `*.tsbuildinfo`), not `lib/`.

## Dependency placement

- `dependencies`: runtime-only packages (`zod`).
- `peerDependencies`: host-provided Cordis, DSH client/session interfaces, and `react`.
- `devDependencies`: mirrors the host interfaces for build and test, plus build/test types and tools including `@types/node`, `tsdown`, TypeScript, and Vitest.

## Versioning

Until promotion to a stable package, keep the `experimental` name and a matching version line with the DeepSeek Harness release it was built against.
