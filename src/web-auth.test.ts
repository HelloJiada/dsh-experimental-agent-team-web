/**
 * R-17/H-1: web-route auth unit tests — token compare, Host fence, combined
 * authorization, and the redacted /state projection.
 * @module dsh-agent-team-web/web-auth.test
 */

import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { TOKEN_HEADER } from './web-auth-constants.ts'
import {
  assertTrustedAuthority,
  createWebToken,
  isLoopbackHostname,
  requestHostTrusted,
  requestTokenValid,
  tokensEqual,
  webRequestAuthorized,
} from './web-auth.ts'

function request(headers: Record<string, string> = {}): IncomingMessage {
  const req = new PassThrough() as unknown as IncomingMessage
  req.headers = headers
  return req
}

const TOKEN = 'boot-token-0123456789abcdef'
const LOOPBACK = { host: '127.0.0.1:3080' }

describe('tokensEqual — constant-time hex compare', () => {
  it('matches equal tokens', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true)
  })

  it('rejects unequal-length tokens (never reaches timingSafeEqual)', () => {
    expect(tokensEqual(TOKEN, 'short')).toBe(false)
    expect(tokensEqual('short', TOKEN)).toBe(false)
  })

  it('rejects same-length different tokens', () => {
    expect(tokensEqual(TOKEN, 'boot-token-0123456789abcdee')).toBe(false)
  })
})

describe('createWebToken — 每次生成独立随机令牌(QA P2 轻量断言)', () => {
  it('两次调用产生不同令牌,且为 48 位十六进制', () => {
    const first = createWebToken()
    const second = createWebToken()
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f]{48}$/)
    expect(second).toMatch(/^[0-9a-f]{48}$/)
  })
})

describe('isLoopbackHostname', () => {
  it('accepts localhost and IPv6 loopback', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
  })

  it('accepts any 127.x.x.x quad', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.255.255.254')).toBe(true)
  })

  it('rejects non-loopback hostnames', () => {
    expect(isLoopbackHostname('192.168.1.1')).toBe(false)
    expect(isLoopbackHostname('harness.local')).toBe(false)
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
  })
})

describe('requestHostTrusted — loopback / trustedHosts fence', () => {
  it('accepts loopback authorities without trustedHosts', () => {
    expect(requestHostTrusted(LOOPBACK, [])).toBe(true)
    expect(requestHostTrusted({ host: 'localhost:3080' }, [])).toBe(true)
    expect(requestHostTrusted({ host: '[::1]:3080' }, [])).toBe(true)
  })

  it('rejects a missing Host header', () => {
    expect(requestHostTrusted({}, [])).toBe(false)
  })

  it('rejects a non-loopback host unless trustedHosts names it', () => {
    expect(requestHostTrusted({ host: 'evil.example:3080' }, [])).toBe(false)
    expect(requestHostTrusted({ host: 'harness.local:3080' }, ['harness.local'])).toBe(true)
    expect(requestHostTrusted({ host: 'harness.local:3080' }, ['harness.local:3080'])).toBe(true)
    expect(requestHostTrusted({ host: 'harness.local:3080' }, ['harness.local:9090'])).toBe(false)
  })

  it('rejects an unparsable Host', () => {
    expect(requestHostTrusted({ host: ':::' }, [])).toBe(false)
  })
})

describe('assertTrustedAuthority — config boundary', () => {
  it('accepts bare host and host:port entries', () => {
    expect(() => assertTrustedAuthority('harness.local')).not.toThrow()
    expect(() => assertTrustedAuthority('harness.local:3080')).not.toThrow()
    expect(() => assertTrustedAuthority('192.168.1.10:8080')).not.toThrow()
  })

  it('rejects malformed entries loudly', () => {
    expect(() => assertTrustedAuthority('http://harness.local')).toThrow()
    expect(() => assertTrustedAuthority('harness.local/path')).toThrow()
    expect(() => assertTrustedAuthority('')).toThrow()
  })
})

describe('requestTokenValid / webRequestAuthorized — combined gate', () => {
  it('accepts loopback + correct token', () => {
    const req = request({ ...LOOPBACK, [TOKEN_HEADER]: TOKEN })
    expect(requestTokenValid(req, TOKEN)).toBe(true)
    expect(webRequestAuthorized(req, TOKEN, [])).toBe(true)
  })

  it('rejects loopback + wrong/missing token', () => {
    expect(webRequestAuthorized(request({ ...LOOPBACK, [TOKEN_HEADER]: 'nope' }), TOKEN, [])).toBe(false)
    expect(webRequestAuthorized(request(LOOPBACK), TOKEN, [])).toBe(false)
  })

  it('rejects non-loopback host even with the correct token', () => {
    const req = request({ host: 'evil.example:3080', [TOKEN_HEADER]: TOKEN })
    expect(webRequestAuthorized(req, TOKEN, [])).toBe(false)
    expect(webRequestAuthorized(req, TOKEN, ['evil.example'])).toBe(true)
  })
})
