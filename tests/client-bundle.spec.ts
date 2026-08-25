import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Script, createContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const clientBundleSource = readFile(resolve(root, 'lib/client.js'), 'utf8')
const defaultModuleTable = new Set([
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

type ClientFactory = (require: (id: string) => unknown) => Record<string, unknown>
interface Registration {
  readonly id: string
  readonly factory: ClientFactory
}

interface SlotRegistration {
  readonly name: string
  readonly id: string
}

interface RegisteredSlot {
  readonly injectedSlotName: string | undefined
  readonly registration: SlotRegistration
  readonly component: unknown
}

interface ClientBundleExports {
  readonly inject: readonly string[]
  readonly apply: (ctx: {
    readonly slots: {
      inject(slotName: string, register: () => unknown): void
      register(registration: SlotRegistration, component: unknown): unknown
    }
    readonly sessions: {
      subagentAddress(sessionId: unknown): undefined
      openSubagent(address: unknown): void
      open(sessionId: unknown): void
    }
  }) => void
  readonly AgentTeamActivityPanel: unknown
  readonly AgentTeamConversationSummary: unknown
}

interface PackageManifest {
  readonly name: string
  readonly dsh?: { readonly client?: { readonly inject?: readonly string[] } }
}

function createClientRequire(options: {
  readonly available?: ReadonlySet<string>
  readonly requested?: Set<string>
} = {}): (id: string) => unknown {
  return (id) => {
    options.requested?.add(id)
    if (options.available !== undefined && !options.available.has(id)) {
      throw new Error(`unexpected client external: ${id}`)
    }
    if (id === 'react/jsx-runtime') {
      return { Fragment: Symbol('Fragment'), jsx: vi.fn(), jsxs: vi.fn() }
    }
    if (id === 'react') {
      return { useState: vi.fn(() => [undefined, vi.fn()]), useMemo: vi.fn((fn: () => unknown) => fn()) }
    }
    if (id === '@deepseek-ai/dsh-client-ui-layout/client') return {}
    throw new Error(`missing test stub for declared client external: ${id}`)
  }
}

describe('client bundle protocol', () => {
  it('registers a classic-script factory whose requests exist in the DSH module table', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as PackageManifest
    const source = await clientBundleSource
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
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-layout')
    const declared = new Set(manifest.dsh?.client?.inject ?? [])
    const available = new Set([...defaultModuleTable, ...declared])
    const requested = new Set<string>()
    const exports = registrations[0]!.factory(createClientRequire({ available, requested }))

    expect(requested).toEqual(new Set([
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-layout/client',
    ]))
    expect([...requested].every(id => available.has(id))).toBe(true)
    expect(exports).toMatchObject({
      inject: ['slots'],
      apply: expect.any(Function),
      AgentTeamActivityPanel: expect.any(Function),
      AgentTeamConversationSummary: expect.any(Function),
    })

    const bundle = exports as unknown as ClientBundleExports
    const registeredSlots: RegisteredSlot[] = []
    let injectedSlotName: string | undefined
    bundle.apply({
      slots: {
        inject(slotName, register): void {
          injectedSlotName = slotName
          try {
            register()
          } finally {
            injectedSlotName = undefined
          }
        },
        register(registration, component): SlotRegistration {
          registeredSlots.push({ injectedSlotName, registration, component })
          return registration
        },
      },
      sessions: {
        subagentAddress: () => undefined,
        openSubagent: () => undefined,
        open: () => undefined,
      },
    })

    expect(registeredSlots).toEqual([
      expect.objectContaining({
        injectedSlotName: 'shell.overlay',
        registration: expect.objectContaining({ id: 'agent-team-activity' }),
        component: bundle.AgentTeamActivityPanel,
      }),
      expect.objectContaining({
        injectedSlotName: 'conversation.view',
        registration: expect.objectContaining({ id: 'agent-team' }),
        component: bundle.AgentTeamConversationSummary,
      }),
    ])
    expect(registeredSlots.find(slot => slot.injectedSlotName === 'conversation.view')?.component)
      .not.toBe(bundle.AgentTeamActivityPanel)
  })

  it('installs the bundled CSS module once when the factory runs in a DOM', async () => {
    const source = await clientBundleSource
    const registrations: Registration[] = []
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      runScripts: 'outside-only',
    })
    Object.defineProperty(dom.window, '__ModuleLoader__', {
      value: {
        load(registration: Registration): void {
          registrations.push(registration)
        },
      },
    })

    dom.window.eval(source)
    expect(registrations).toHaveLength(1)

    try {
      const require = createClientRequire()
      registrations[0]!.factory(require)
      registrations[0]!.factory(require)

      const tagId = '@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamActivityPanel.module.css'
      const selector = `style[data-plugin-css=${JSON.stringify(tagId)}]`
      expect(dom.window.document.querySelectorAll(selector)).toHaveLength(1)
      const style = dom.window.document.querySelector<HTMLStyleElement>(selector)!
      expect(style.dataset.plugin).toBe('@deepseek-ai/dsh-experimental-agent-team-web')
      expect(style.dataset.pluginCss).toBe(tagId)
      expect(style.textContent).toContain('_root')
      expect(style.textContent).toMatch(/@media \((?:max-width:\s*960px|width\s*<=\s*960px)\)/)
      expect(style.textContent).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/)
    } finally {
      dom.window.close()
    }
  })

  it('runs the client factory without a DOM', async () => {
    const source = await clientBundleSource
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
    new Script(source, { filename: 'lib/client.js' }).runInContext(context)

    expect(() => registrations[0]!.factory(createClientRequire())).not.toThrow()
  })

  it('parses as a self-contained classic script without CSS runtime requests', async () => {
    const source = await clientBundleSource
    expect(() => new Script(source, { filename: 'lib/client.js' })).not.toThrow()
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/require\([^)]*\.css["'][^)]*\)/)
    expect(source).not.toContain(`${root}/`)
  })
})
