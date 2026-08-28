/**
 * Web-route authentication for the AgentTeams HTTP surface.
 *
 * Two defense layers, mirroring the harness's `/api` browser-trust fence and
 * the app-restart boot-token pattern:
 *
 * 1. **Host fence** (`requestHostTrusted`): the request Host must name a
 *    loopback authority (or a configured `trustedHosts` entry). This is the
 *    DNS-rebinding defense — over plain HTTP a browser always sends Host, and
 *    it is the one header a rebinding attack cannot forge.
 * 2. **Boot token** (`webRequestAuthorized`): a per-boot random token is
 *    injected into the served HTML as a `globalThis` row (index-inject) and
 *    the browser panel echoes it in `x-dsh-agent-teams-token`. Token compare
 *    is constant-time (`timingSafeEqual`), so response timing cannot leak the
 *    value. A caller that never read the served HTML cannot derive the token
 *    from the leaked `/state` response — closing the H-1 "captainSessionId is
 *    the /close credential" chain.
 *
 * The `/state` route additionally serves a **redacted** snapshot to
 * unauthenticated callers (see `redactSnapshotForHttp` in snapshot.ts), so
 * even the anonymous tier never exposes session ids or inbox text.
 * @module dsh-agent-team-web/web-auth
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { TOKEN_GLOBAL, TOKEN_HEADER } from './web-auth-constants.ts'

export { TOKEN_GLOBAL, TOKEN_HEADER } from './web-auth-constants.ts'

/** Generate one fresh per-boot capability token. */
export function createWebToken(): string {
  return randomBytes(24).toString('hex')
}

/** Constant-time hex token comparison; unequal lengths never match. */
export function tokensEqual(provided: string, expected: string): boolean {
  const actual = Buffer.from(provided)
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length) return false
  return timingSafeEqual(actual, wanted)
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form. Anything parsing would silently rewrite is
 * refused as a typo that must fail the load loudly instead of authorizing its
 * hostname prefix at request time.
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`agent-team-web: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Whether a request Host names a loopback or configured-trusted authority. A
 * request without a Host header is refused: over plain HTTP a browser always
 * sends Host, and it is the one header DNS rebinding cannot forge.
 * @param headers - the request headers.
 * @param trustedHosts - non-loopback authorities the operator configured.
 * @returns true when the request authority is loopback or trusted.
 */
export function requestHostTrusted(
  headers: IncomingHttpHeaders,
  trustedHosts: readonly string[],
): boolean {
  const host = headers.host
  if (typeof host !== 'string') return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (isLoopbackHostname(hostUrl.hostname)) return true
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Whether a request carries the correct boot token in the token header. */
export function requestTokenValid(req: IncomingMessage, token: string): boolean {
  const provided = req.headers[TOKEN_HEADER]
  return typeof provided === 'string' && tokensEqual(provided, token)
}

/**
 * One combined authorization decision for the AgentTeams web routes:
 * the Host fence first (a DNS-rebound or unconfigured LAN caller is refused
 * before any token comparison), then the boot token.
 * @param req - the incoming request.
 * @param token - the per-boot capability token.
 * @param trustedHosts - non-loopback authorities allowed to reach the routes.
 * @returns true when the request may proceed.
 */
export function webRequestAuthorized(
  req: IncomingMessage,
  token: string,
  trustedHosts: readonly string[],
): boolean {
  if (!requestHostTrusted(req.headers, trustedHosts)) return false
  return requestTokenValid(req, token)
}

/** Write a plain 403 JSON body for an unauthorized web request. */
export function sendUnauthorized(res: ServerResponse): void {
  res.writeHead(403, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ ok: false, reason: 'unauthorized' }))
}
