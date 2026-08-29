/**
 * Provider 授权中心 HTTP 路由测试:`POST /plugins/agent-team-web/provider-grant`。
 *
 * 与 close-route.test.ts 同构:直测抽取出的 handleProviderGrant ——
 * R-17/H-1 鉴权围栏(无 auth/错 token/非可信 Host → 403)、有界 JSON body
 * (400)、provider 必填(400)、无工作区落盘(409)、授权/撤销落盘(200 +
 * provider-grants.json 生效)、deepseek-official 恒授权不落盘。
 * @module dsh-agent-team-web/provider-grant-route.test
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleProviderGrant, PROVIDER_GRANT_BODY_CAP_BYTES } from './provider-grant-route.ts'
import { providerGranted } from './state.ts'
import { TOKEN_HEADER } from './web-auth-constants.ts'

const STATE_DIR = '.agent-team-web'
const TOKEN = 'test-boot-token-0123456789abcdef'
const LOOPBACK_HOST = { host: '127.0.0.1:3080' }
const auth = { token: TOKEN, trustedHosts: [] }

/** A minimal IncomingMessage whose body streams the given raw text. */
function request(method: string, rawBody?: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new PassThrough()
  const req = stream as unknown as IncomingMessage
  req.method = method
  req.headers = headers
  stream.end(rawBody ?? '')
  return req
}

/** A POST request carrying the boot token and a loopback Host. */
function authorizedPost(rawBody: string, headers: Record<string, string> = {}): IncomingMessage {
  return request('POST', rawBody, { ...LOOPBACK_HOST, [TOKEN_HEADER]: TOKEN, ...headers })
}

interface ResState {
  status: number
  headers: Record<string, string | number | undefined>
  body: string
}

/** A minimal ServerResponse recording status/headers/body. */
function response(): { res: ServerResponse; state: ResState } {
  const state: ResState = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status: number, headers?: Record<string, string | number>): unknown {
      state.status = status
      if (headers !== undefined) state.headers = headers
      return res
    },
    end(payload?: string): void {
      state.body = payload ?? ''
    },
  } as unknown as ServerResponse
  return { res, state }
}

function registry(workspaces: readonly { path: string; title: string }[]): WorkspaceRegistry {
  return { list: () => workspaces } as unknown as WorkspaceRegistry
}

let workspace: string
let stateRoot: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'agent-team-grant-route-'))
  stateRoot = join(workspace, STATE_DIR)
  await mkdir(stateRoot, { recursive: true })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('handleProviderGrant — R-17/H-1 鉴权围栏', () => {
  it('无 auth 束 → 403,不读 body 不落盘(写面永不裸奔)', async () => {
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"kimi-coding","enabled":true}'), res)
    expect(state.status).toBe(403)
    await expect(readFile(join(stateRoot, 'provider-grants.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('token 错误 → 403', async () => {
    const { res, state } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      ...LOOPBACK_HOST,
      [TOKEN_HEADER]: 'wrong-token',
    })
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), req, res, auth)
    expect(state.status).toBe(403)
  })

  it('非可信 Host → 403(即使 token 正确)', async () => {
    const { res, state } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      host: 'evil.example',
      [TOKEN_HEADER]: TOKEN,
    })
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), req, res, auth)
    expect(state.status).toBe(403)
  })

  it('可信 Host 白名单放行', async () => {
    const { res } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      host: 'trusted.example',
      [TOKEN_HEADER]: TOKEN,
    })
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), req, res, {
      token: TOKEN,
      trustedHosts: ['trusted.example'],
    })
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(true)
  })
})

describe('handleProviderGrant — 请求校验', () => {
  it('非法 JSON body → 400', async () => {
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{not json'), res, auth)
    expect(state.status).toBe(400)
  })

  it('超过 body 上限 → 400(有界读取防内存放大)', async () => {
    const oversized = '{"provider":"' + 'x'.repeat(PROVIDER_GRANT_BODY_CAP_BYTES) + '"}'
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost(oversized), res, auth)
    expect(state.status).toBe(400)
  })

  it('provider 缺失/空白 → 400', async () => {
    const { res: res1, state: state1 } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{}'), res1, auth)
    expect(state1.status).toBe(400)

    const { res: res2, state: state2 } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"   "}'), res2, auth)
    expect(state2.status).toBe(400)
  })

  it('无注册工作区 → 409(无落盘位置)', async () => {
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([]), authorizedPost('{"provider":"kimi-coding","enabled":true}'), res, auth)
    expect(state.status).toBe(409)
  })
})

describe('handleProviderGrant — 授权/撤销落盘', () => {
  it('授权 → 200 + provider-grants.json 生效', async () => {
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"kimi-coding","enabled":true}'), res, auth)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ provider: 'kimi-coding', enabled: true })
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(true)
    expect(await readFile(join(stateRoot, 'provider-grants.json'), 'utf8')).toContain('kimi-coding')
  })

  it('撤销 → 200 + 文件移除该项', async () => {
    await writeFile(join(stateRoot, 'provider-grants.json'), '["kimi-coding"]\n', 'utf8')
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"kimi-coding","enabled":false}'), res, auth)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ provider: 'kimi-coding', enabled: false })
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(false)
  })

  it('deepseek-official 授权请求 → 200 但永不落盘(隐式恒授权)', async () => {
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"deepseek-official","enabled":true}'), res, auth)
    expect(state.status).toBe(200)
    await expect(readFile(join(stateRoot, 'provider-grants.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enabled 缺失 → 视为撤销(false)', async () => {
    await writeFile(join(stateRoot, 'provider-grants.json'), '["kimi-coding"]\n', 'utf8')
    const { res, state } = response()
    await handleProviderGrant(STATE_DIR, registry([{ path: workspace, title: 'ws' }]), authorizedPost('{"provider":"kimi-coding"}'), res, auth)
    expect(state.status).toBe(200)
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(false)
  })
})
