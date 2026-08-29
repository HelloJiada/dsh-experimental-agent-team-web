/**
 * AgentTeam 设置中心 HTTP 路由(`POST /plugins/agent-team-web/model-grant`)。
 *
 * 设置页通过标准 settings RPC 持久化为主通道；此路由保留为第二写面
 * （决策 2，R-17/H-1 token 围栏已在，双通道无害）。t13 模型粒度：body 为
 * `{ provider, model, enabled }`,经 apply 期捕获的 settings scope 写面
 * （AgentTeamSettingsAccess.setModelGrant,复合 key `${provider}/${model}`）
 * 写入 settings 命名空间 —— settings 是唯一真源,无文件双源漂移。
 *
 * 处理顺序：R-17/H-1 token + Host 围栏最先（未授权一律 403，不读 body）→
 * 有界 JSON body(400) → provider/model 必填(400) → 写面可用性(503,
 * settings 缺席) → setModelGrant(成功 200,失败 500)。deepseek-official
 * 名下模型由写面隐式恒授权,不会落盘。
 * @module dsh-agent-team-web/provider-grant-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody } from './close-route.ts'
import type { AgentTeamSettingsAccess } from './provider-grants.ts'
import { webRequestAuthorized } from './web-auth.ts'

/** Model-grant 请求体上限(与 close 路由同量级,防内存放大)。 */
export const PROVIDER_GRANT_BODY_CAP_BYTES = 16 * 1024

/** The model-grant route auth bundle: boot token + trusted Host fence. */
export interface ProviderGrantRouteAuth {
  readonly token: string
  readonly trustedHosts: readonly string[]
}

/**
 * Handle one model-grant request.
 * @param access - the apply-time-wired settings access（读/写面）；
 *   `setModelGrant` 缺席（settings 服务未接线）时返回 503。
 * @param req - the incoming HTTP request.
 * @param res - the HTTP response.
 * @param auth - the route capability token + trusted hosts; the request must
 *   pass the Host fence and present the boot token before any body is read.
 */
export async function handleProviderGrant(
  access: AgentTeamSettingsAccess,
  req: IncomingMessage,
  res: ServerResponse,
  auth?: ProviderGrantRouteAuth,
): Promise<void> {
  // R-17/H-1: token + Host fence first. When the route passes no auth (tests,
  // legacy callers), the endpoint is refused outright — the write surface must
  // never run unauthenticated.
  if (auth === undefined || !webRequestAuthorized(req, auth.token, auth.trustedHosts)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  let payload: { provider?: string; model?: string; enabled?: boolean }
  try {
    payload = await readJsonBody(req, PROVIDER_GRANT_BODY_CAP_BYTES) as { provider?: string; model?: string; enabled?: boolean }
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  const provider = payload.provider?.trim() ?? ''
  const model = payload.model?.trim() ?? ''
  if (provider === '' || model === '') {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'provider and model are required' }))
    return
  }
  // deepseek-official 名下模型隐式恒授权,永不落盘(路由层契约;写面闭包另有同守卫)。
  if (provider === 'deepseek-official') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ provider, model, enabled: payload.enabled === true }))
    return
  }
  if (access.setModelGrant === undefined) {
    // settings 服务缺席(headless/未接线):写面不可用。
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'settings service is not available for model grants' }))
    return
  }
  const enabled = payload.enabled === true
  try {
    await access.setModelGrant(provider, model, enabled)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ provider, model, enabled }))
  } catch (error: unknown) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: String(error) }))
  }
}
