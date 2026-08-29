/**
 * Provider 授权中心 HTTP 路由(`POST /plugins/agent-team-web/provider-grant`)。
 *
 * 面板 switch 拨动后 POST 到这里授权/撤销一个 LLM provider 的成员使用权。
 * 与 close-route.ts 同构:路由处理抽成可直测的纯处理器 ——
 * R-17/H-1 token + Host 围栏最先(未授权一律 403,不读 body)→ 有界 JSON
 * body(400)→ provider 必填(400)→ 首个注册工作区落盘 grants(无工作区
 * 409)→ setProviderGrant 原子写(成功 200,失败 500)。deepseek-official
 * 由 setProviderGrant 隐式恒授权,写路由不会持久化它。
 * @module dsh-agent-team-web/provider-grant-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
/** Provider-grant 请求体上限(与 close 路由同量级,防内存放大)。 */
export declare const PROVIDER_GRANT_BODY_CAP_BYTES: number;
/** The provider-grant route auth bundle: boot token + trusted Host fence. */
export interface ProviderGrantRouteAuth {
    readonly token: string;
    readonly trustedHosts: readonly string[];
}
/**
 * Handle one provider-grant request.
 * @param stateDirName - the AgentTeams state directory name (under a workspace).
 * @param workspaceRegistry - registered workspaces; the grant persists under the
 *   first workspace's state root (same convention as the panel snapshot data).
 * @param req - the incoming HTTP request.
 * @param res - the HTTP response.
 * @param auth - the route capability token + trusted hosts; the request must
 *   pass the Host fence and present the boot token before any body is read.
 */
export declare function handleProviderGrant(stateDirName: string, workspaceRegistry: WorkspaceRegistry, req: IncomingMessage, res: ServerResponse, auth?: ProviderGrantRouteAuth): Promise<void>;
//# sourceMappingURL=provider-grant-route.d.ts.map