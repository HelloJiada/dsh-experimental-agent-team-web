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

  it('publishes linked English and Chinese README files with the release tarball name', async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      version: string
      files: readonly string[]
    }
    const english = await readFile(resolve(root, 'README.md'), 'utf8')
    const chinesePath = resolve(root, 'README.zh-CN.md')

    await expect(access(chinesePath)).resolves.toBeUndefined()
    const chinese = await readFile(chinesePath, 'utf8')
    const tarball = `deepseek-ai-dsh-experimental-agent-team-web-${packageJson.version}.tgz`

    expect(packageJson.files).toContain('README.md')
    expect(packageJson.files).toContain('README.zh-CN.md')
    expect(english).toContain('[中文](README.zh-CN.md)')
    expect(chinese).toContain('[English](README.md)')
    expect(english).toContain(tarball)
    expect(chinese).toContain(tarball)
  })

  it('ships real-profile integration examples and smoke-check docs with the tarball', async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      files: readonly string[]
    }
    expect(packageJson.files).toContain('examples')
    expect(packageJson.files).toContain('docs/verification-checklist.md')
    expect(packageJson.files).toContain('docs/real-profile-smoke-check.md')
    expect(packageJson.files).toContain('docs/command-bridge-execution.md')
    await expect(access(resolve(root, 'examples/profile-patch.agent-team-web.yml'))).resolves.toBeUndefined()
    await expect(access(resolve(root, 'docs/real-profile-smoke-check.md'))).resolves.toBeUndefined()
    await expect(access(resolve(root, 'docs/command-bridge-execution.md'))).resolves.toBeUndefined()
  })
})
