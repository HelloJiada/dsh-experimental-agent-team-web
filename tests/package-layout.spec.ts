import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const expected = [
  'lib/index.js',
  'lib/client.js',
  'lib/invariant.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'lib/types/invariant.d.ts',
]

describe('package layout', () => {
  it('publishes every declared JavaScript and declaration export after build', async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string, default: string } | string>
    }
    const declaredExports = Object.values(packageJson.exports)
      .filter((entry): entry is { types: string, default: string } => typeof entry !== 'string')
      .flatMap(entry => [entry.default, entry.types])
      .map(entry => entry.slice(2))

    expect(new Set(declaredExports)).toEqual(new Set(expected))
    await expect(Promise.all(expected.map(path => access(resolve(root, path))))).resolves.toHaveLength(expected.length)
  })
})
