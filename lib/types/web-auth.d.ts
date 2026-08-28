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
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
export { TOKEN_GLOBAL, TOKEN_HEADER } from './web-auth-constants.ts';
/** Generate one fresh per-boot capability token. */
export declare function createWebToken(): string;
/** Constant-time hex token comparison; unequal lengths never match. */
export declare function tokensEqual(provided: string, expected: string): boolean;
/** Whether a normalized URL hostname names the local loopback authority. */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form. Anything parsing would silently rewrite is
 * refused as a typo that must fail the load loudly instead of authorizing its
 * hostname prefix at request time.
 * @param entry - the configured value, verbatim.
 */
export declare function assertTrustedAuthority(entry: string): void;
/**
 * Whether a request Host names a loopback or configured-trusted authority. A
 * request without a Host header is refused: over plain HTTP a browser always
 * sends Host, and it is the one header DNS rebinding cannot forge.
 * @param headers - the request headers.
 * @param trustedHosts - non-loopback authorities the operator configured.
 * @returns true when the request authority is loopback or trusted.
 */
export declare function requestHostTrusted(headers: IncomingHttpHeaders, trustedHosts: readonly string[]): boolean;
/** Whether a request carries the correct boot token in the token header. */
export declare function requestTokenValid(req: IncomingMessage, token: string): boolean;
/**
 * One combined authorization decision for the AgentTeams web routes:
 * the Host fence first (a DNS-rebound or unconfigured LAN caller is refused
 * before any token comparison), then the boot token.
 * @param req - the incoming request.
 * @param token - the per-boot capability token.
 * @param trustedHosts - non-loopback authorities allowed to reach the routes.
 * @returns true when the request may proceed.
 */
export declare function webRequestAuthorized(req: IncomingMessage, token: string, trustedHosts: readonly string[]): boolean;
/** Write a plain 403 JSON body for an unauthorized web request. */
export declare function sendUnauthorized(res: ServerResponse): void;
//# sourceMappingURL=web-auth.d.ts.map