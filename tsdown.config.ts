import { defineConfig } from 'tsdown'

const pluginId = '@deepseek-ai/dsh-experimental-agent-team-web'
const defaultClientExternals = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

export default defineConfig([
  {
    name: `${pluginId}/host`,
    entry: {
      index: 'src/index.ts',
      invariant: 'src/invariant.ts',
    },
    format: 'esm',
    platform: 'node',
    dts: false,
    sourcemap: true,
    clean: false,
    outDir: 'lib',
    outExtensions: () => ({ js: '.js' }),
  },
  {
    name: `${pluginId}/client`,
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    outDir: 'lib',
    deps: {
      neverBundle: specifier => defaultClientExternals.has(specifier),
      alwaysBundle: specifier => !defaultClientExternals.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
