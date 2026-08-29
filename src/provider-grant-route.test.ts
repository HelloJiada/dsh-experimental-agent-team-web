/**
 * Provider 授权中心 HTTP 路由测试:`POST /plugins/agent-team-web/provider-grant`。
 *
 * 单通道结论（t6 + 队长拍板）后路由不再写 provider-grants.json：经
 * ProviderGrantAccess.setProviderGrant（apply 期捕获 settings scope 的写面
 * 闭包）写 settings 命名空间。覆盖：R-17/H-1 鉴权围栏（无 auth/错 token/
 * 非可信 Host → 403）、有界 JSON body(400)、provider 必填(400)、写面缺席
 * (503)、授权/撤销经写面落 settings(200)、写面抛错(500)、deepseek-official
 * 隐式恒授权不落盘。
 * @module dsh-agent-team-web/provider-grant-route.test
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { handleProviderGrant, PROVIDER_GRANT_BODY_CAP_BYTES } from './provider-grant-route.ts'
import type { ProviderGrantAccess } from './provider-grants.ts'
import { TOKEN_HEADER } from './web-auth-constants.ts'

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

/** 带写面的 access 桩:记录每次 setProviderGrant 调用。 */
function accessWith(writes: Array<{ provider: string; enabled: boolean }>): ProviderGrantAccess {
  return {
    setProviderGrant: async (provider: string, enabled: boolean) => { writes.push({ provider, enabled }) },
  }
}

describe('handleProviderGrant — R-17/H-1 鉴权围栏', () => {
  it('无 auth 束 → 403,不读 body 不写面', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res, state } = response()
    await handleProviderGrant(accessWith(writes), authorizedPost('{"provider":"kimi-coding","enabled":true}'), res)
    expect(state.status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('token 错误 → 403', async () => {
    const { res, state } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      ...LOOPBACK_HOST,
      [TOKEN_HEADER]: 'wrong-token',
    })
    await handleProviderGrant(accessWith([]), req, res, auth)
    expect(state.status).toBe(403)
  })

  it('非可信 Host → 403(即使 token 正确)', async () => {
    const { res, state } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      host: 'evil.example',
      [TOKEN_HEADER]: TOKEN,
    })
    await handleProviderGrant(accessWith([]), req, res, auth)
    expect(state.status).toBe(403)
  })

  it('可信 Host 白名单放行(写面被调用)', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res } = response()
    const req = request('POST', '{"provider":"kimi-coding","enabled":true}', {
      host: 'trusted.example',
      [TOKEN_HEADER]: TOKEN,
    })
    await handleProviderGrant(accessWith(writes), req, res, {
      token: TOKEN,
      trustedHosts: ['trusted.example'],
    })
    expect(writes).toEqual([{ provider: 'kimi-coding', enabled: true }])
  })
})

describe('handleProviderGrant — 请求校验', () => {
  it('非法 JSON body → 400', async () => {
    const { res, state } = response()
    await handleProviderGrant(accessWith([]), authorizedPost('{not json'), res, auth)
    expect(state.status).toBe(400)
  })

  it('超过 body 上限 → 400(有界读取防内存放大)', async () => {
    const oversized = '{"provider":"' + 'x'.repeat(PROVIDER_GRANT_BODY_CAP_BYTES) + '"}'
    const { res, state } = response()
    await handleProviderGrant(accessWith([]), authorizedPost(oversized), res, auth)
    expect(state.status).toBe(400)
  })

  it('provider 缺失/空白 → 400', async () => {
    const { res: res1, state: state1 } = response()
    await handleProviderGrant(accessWith([]), authorizedPost('{}'), res1, auth)
    expect(state1.status).toBe(400)

    const { res: res2, state: state2 } = response()
    await handleProviderGrant(accessWith([]), authorizedPost('{"provider":"   "}'), res2, auth)
    expect(state2.status).toBe(400)
  })

  it('写面缺席(settings 未接线)→ 503', async () => {
    const { res, state } = response()
    await handleProviderGrant({}, authorizedPost('{"provider":"kimi-coding","enabled":true}'), res, auth)
    expect(state.status).toBe(503)
  })
})

describe('handleProviderGrant — 授权/撤销经写面落 settings', () => {
  it('授权 → 200 + 写面收到 enabled=true', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res, state } = response()
    await handleProviderGrant(accessWith(writes), authorizedPost('{"provider":"kimi-coding","enabled":true}'), res, auth)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ provider: 'kimi-coding', enabled: true })
    expect(writes).toEqual([{ provider: 'kimi-coding', enabled: true }])
  })

  it('撤销 → 200 + 写面收到 enabled=false', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res, state } = response()
    await handleProviderGrant(accessWith(writes), authorizedPost('{"provider":"kimi-coding","enabled":false}'), res, auth)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ provider: 'kimi-coding', enabled: false })
    expect(writes).toEqual([{ provider: 'kimi-coding', enabled: false }])
  })

  it('deepseek-official 授权请求 → 200 但不调用写面(隐式恒授权,永不落盘)', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res, state } = response()
    await handleProviderGrant(accessWith(writes), authorizedPost('{"provider":"deepseek-official","enabled":true}'), res, auth)
    expect(state.status).toBe(200)
    expect(writes).toHaveLength(0)
  })

  it('enabled 缺失 → 视为撤销(false)', async () => {
    const writes: Array<{ provider: string; enabled: boolean }> = []
    const { res, state } = response()
    await handleProviderGrant(accessWith(writes), authorizedPost('{"provider":"kimi-coding"}'), res, auth)
    expect(state.status).toBe(200)
    expect(writes).toEqual([{ provider: 'kimi-coding', enabled: false }])
  })

  it('写面抛错 → 500', async () => {
    const { res, state } = response()
    await handleProviderGrant({
      setProviderGrant: async () => { throw new Error('boom') },
    }, authorizedPost('{"provider":"kimi-coding","enabled":true}'), res, auth)
    expect(state.status).toBe(500)
  })
})
