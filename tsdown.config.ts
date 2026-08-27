import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const pluginId = '@deepseek-ai/dsh-experimental-agent-team-web'
const cssModuleSuffix = '.module.css'
const cssVirtualPrefix = '\0agent-team-css:'
const cssVirtualSuffix = '.mjs'
const projectRoot = resolve('.')
const sourceRoot = resolve(projectRoot, 'src')
const typesRoot = resolve(projectRoot, 'lib/types')

function sourceAssetPath(source: string, importer: string): string {
  const imported = resolve(dirname(importer), source)
  if (existsSync(imported)) return imported
  const emittedPath = relative(typesRoot, imported)
  return emittedPath.startsWith('..') || isAbsolute(emittedPath)
    ? imported
    : resolve(sourceRoot, emittedPath)
}

function virtualSourcePath(sourcePath: string): string {
  return relative(projectRoot, sourcePath).split(sep).join('/')
}

function inlineCssModules() {
  return {
    name: `${pluginId}/inline-css-modules`,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(cssModuleSuffix)) return null
      const sourcePath = importer === undefined ? resolve(source) : sourceAssetPath(source, importer)
      return cssVirtualPrefix + virtualSourcePath(sourcePath) + cssVirtualSuffix
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(cssVirtualPrefix)) return null

      const sourcePath = resolve(projectRoot, virtualId.slice(cssVirtualPrefix.length, -cssVirtualSuffix.length))
      this.addWatchFile(sourcePath)
      const result = transform({
        filename: sourcePath,
        code: await readFile(sourcePath),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = Object.fromEntries(
        Object.entries(result.exports ?? {})
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([local, value]) => {
            const dependency = value.composes.find(composed => composed.type === 'dependency')
            if (dependency !== undefined) {
              throw new Error(`CSS Modules composition from ${dependency.specifier} is not supported in ${sourcePath}`)
            }
            const composedNames = value.composes
              .filter(composed => composed.type === 'local')
              .map(composed => composed.name)
            return [local, [value.name, ...composedNames].join(' ')]
          }),
      )
      const cssText = result.code.toString()
      const cssTagId = `${pluginId}/${basename(sourcePath)}`
      const selector = `style[data-plugin-css=${JSON.stringify(cssTagId)}]`

      return {
        moduleType: 'js',
        code: [
          `const cssText = ${JSON.stringify(cssText)};`,
          `const cssTagId = ${JSON.stringify(cssTagId)};`,
          `if (typeof document !== 'undefined' && document.head && document.head.querySelector(${JSON.stringify(selector)}) === null) {`,
          "  const style = document.createElement('style');",
          `  style.dataset.plugin = ${JSON.stringify(pluginId)};`,
          '  style.dataset.pluginCss = cssTagId;',
          '  style.textContent = cssText;',
          '  document.head.appendChild(style);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n'),
      }
    },
  }
}
const defaultClientExternals = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-layout/client',
])

export default defineConfig([
  {
    name: `${pluginId}/host`,
    entry: {
      index: 'src/index.ts',
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
    entry: { client: 'src/client/index.tsx' },
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    outDir: 'lib',
    plugins: [inlineCssModules()],
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
