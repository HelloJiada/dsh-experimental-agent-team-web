import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Script, createContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const defaultModuleTable = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

type ClientFactory = (require: (id: string) => unknown) => Record<string, unknown>
interface Registration {
  readonly id: string
  readonly factory: ClientFactory
}

interface PackageManifest {
  readonly name: string
  readonly dsh?: { readonly client?: { readonly external?: readonly string[] } }
}

describe('client bundle protocol', () => {
  it('registers a classic-script factory whose requests exist in the DSH module table', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as PackageManifest
    const source = await readFile(resolve(root, 'lib/client.js'), 'utf8')
    const registrations: Registration[] = []
    const context = createContext({
      window: {
        __ModuleLoader__: {
          load(registration: Registration): void {
            registrations.push(registration)
          },
        },
      },
    })

    expect(() => new Script(source, { filename: 'lib/client.js' }).runInContext(context)).not.toThrow()
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe(manifest.name)

    const declared = new Set(manifest.dsh?.client?.external ?? [])
    const available = new Set([...defaultModuleTable, ...declared])
    const requested = new Set<string>()
    const exports = registrations[0]!.factory((id) => {
      requested.add(id)
      if (!available.has(id)) throw new Error(`unexpected client external: ${id}`)
      if (id === 'react/jsx-runtime') {
        return { Fragment: Symbol('Fragment'), jsx: vi.fn(), jsxs: vi.fn() }
      }
      if (id === 'react') {
        return { useState: vi.fn(() => [undefined, vi.fn()]), useMemo: vi.fn((fn: () => unknown) => fn()) }
      }
      throw new Error(`missing test stub for declared client external: ${id}`)
    })

    expect(requested).toEqual(new Set(['react', 'react/jsx-runtime']))
    expect([...requested].every(id => available.has(id))).toBe(true)
    expect(exports).toMatchObject({
      inject: ['slots'],
      apply: expect.any(Function),
      AgentTeamWorkspace: expect.any(Function),
    })
  })

  it('parses as a classic script without top-level ESM module syntax', async () => {
    const source = await readFile(resolve(root, 'lib/client.js'), 'utf8')
    expect(() => new Script(source, { filename: 'lib/client.js' })).not.toThrow()
  })
})
