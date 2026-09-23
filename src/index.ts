/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * section into the global system prompt. After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-web`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module agent-team-web
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Declaration merge only: makes ctx.llm, ctx.subagents and ctx.systemPrompt visible.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { installAgentTeamsRuntime, type ToolsConfig } from './tools.ts'
import { DEFAULT_ROLE_LLM } from './members.ts'
import {
  activateAgentTeams,
  registerAgentTeamsActivation,
  registerAgentTeamsSurface,
} from './activation.ts'
import type { AgentTeamsActivation } from './command.ts'
import { installAgentTeamsGestureBoundary, registerAgentTeamsCommand } from './command.ts'
import { handleCloseTeam } from './close-route.ts'
import { handleProviderGrant } from './provider-grant-route.ts'
import { handlePractices } from './practices-route.ts'
import {
  AgentTeamSettingsFields,
  settingsAccessFromConfig,
  wireAgentTeamSettings,
  type AgentTeamSettingsAccess,
} from './provider-grants.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectArchivedTeamsActivity, collectProviders, collectTeamsActivity, redactSnapshotForHttp } from './snapshot.ts'
import { TOKEN_GLOBAL } from './web-auth-constants.ts'
import { assertTrustedAuthority, createWebToken, webRequestAuthorized } from './web-auth.ts'

/**
 * Structural slice of the web server service, compatible with both the
 * published `dsh-host-webserver@0.0.1-rc.1` (`ctx.httpServer` /
 * `HttpServerService`) and the renamed `webServer` / `WebServer` in later
 * builds: the beta transition renames the service without changing the route
 * registration shape.
 */
interface OperatorAdmission {
  readonly operator: { readonly id: string }
  admit(request: IncomingMessage): { readonly peer: { readonly id: string } } | { readonly rejection: 401 | 403 }
}

interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const
/** Workspace registry service key candidates, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

export const name = 'agent-team-web'
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']

/** Plugin configuration. */
/** Per-role default LLM selection for members (auto-assign model + effort). */
export interface MemberLlmDefaults {
  /** Provider route; requires an explicit model. Omit to inherit the captain's. */
  provider?: string
  /** Model id (e.g. `deepseek-v4-pro`). */
  model?: string
  /** Reasoning effort (`off`/`low`/`high`/`max`) or `default` for the model default. */
  reasoningEffort?: string
}

export interface Config {
  /**
   * State directory name under the captain's workspace; team state lives at
   * `<workspace>/<stateDir>/<teamId>/` (default `.agent-team-web`).
   */
  stateDir?: string
  /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
  memberProvider?: string
  /** Optional model override applied to every member. */
  memberModel?: string
  /** Member delegation depth cap (default `1`; `0` forbids delegation entirely). */
  memberMaxDepth?: number
  /** Team size cap in members, including captain and commissar (default `18`). */
  maxMembers?: number
  /** Per executing-role member cap (default `1`): each executing role
   * (the 7 preset behavioral roles engineer/researcher/data/qa/designer/docs/security,
   * the task-level reviewer, and any custom role string) may have up to this many
   * members; captain and commissar are exempt (captain fixed at 1, commissar
   * auto-created and uniqueness-gated). `maxExecPerRoleByRole` overrides this
   * per canonical role key (e.g. `{ engineer: 2 }` allows two engineers). */
  maxExecPerRole?: number
  /** Per-role overrides for the executing-role cap, keyed by canonical role
   * (e.g. `{ engineer: 2 }`). A role not listed falls back to `maxExecPerRole`
   * (default 1). Values must be ≥ 1. */
  maxExecPerRoleByRole?: Record<string, number>
  /** Per-role default LLM selection for members (auto-assign model + effort).
   * Keyed by canonical role key (e.g. `{ security: { model: 'deepseek-v4-pro',
   * reasoningEffort: 'max' } }`). A role with no entry falls back to the
   * built-in role table, then to inheriting the captain's route. An explicit
   * provider/model on add_member always wins. */
  roleLlmDefaults?: Record<string, MemberLlmDefaults>
  /** A member-owned claimed/in-progress task is considered stalled (and
   * eligible for a teammate's self-organizing help) after this many
   * milliseconds without an update (default `120_000` = 2 minutes). */
  stallThresholdMs?: number
  /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
  promptSectionOrder?: number
  /**
   * Register the deterministic `/agent-teams` activation surfaces (the
   * closed-namespace slash command and the plain-text gesture boundary).
   * Disable to keep the natural-language trigger as the only entry point.
   */
  slashCommand?: boolean
  /**
   * Non-loopback authorities the AgentTeams web routes accept, mirroring the
   * harness `/api` browser-trust fence contract: bare `host` or `host:port`
   * entries. The default empty list accepts only loopback Hosts, so an
   * all-interfaces bind cannot be read or closed by an unconfigured LAN
   * caller even though the served HTML exposes the boot token.
   */
  trustedHosts?: string[]
  /**
   * How the 14 `agent_teams_*` tools reach the model.
   *
   * `lazy` (default): only a hint section plus `agent_teams_activate` are
   * always on, and the real surface is installed into the activating session's
   * own scope. Cheapest for sessions that never use AgentTeams, but it
   * requires the harness to let a subagent child inherit its parent AGENT
   * scope's registrations. DSH `0.1.5-rc.2` does not: a child joins its
   * parent's PRESET (`@deepseek-ai/dsh-subagent`,
   * `applyChildComposition` → `agentPresets.composeFrom(childCtx, parent.ctx)`),
   * so members see none of the team tools and the member deny-filter cannot
   * even name them — `tools.restrict()` accepts only global or ancestor-scope
   * names, and it throws `unknown global tool "agent_teams_create"…` before
   * the first member exists.
   *
   * `eager`: register the whole surface in the global layer at mount — the
   * v0.1.14 shape. Every session pays the full ~4.9k tokens/request, and
   * members get the tools by global inheritance while the captain-only ones
   * are denied per child scope. Required on harnesses where child scopes join
   * the parent preset instead of inheriting the parent agent scope.
   */
  registration?: 'lazy' | 'eager'
  /** 模型调度授权(key `${provider}/${model}` → true 授权)。设置页写面字段,
   * 必须 volatile;缺省 = 空 map(仅 deepseek-official 恒授权)。 */
  enabledModels?: Record<string, boolean>
  /** 角色档位覆盖(roleKey → 档位)。设置页写面字段,必须 volatile;缺省回落到
   * profile.roleLlmDefaults → 内置 DEFAULT_ROLE_LLM。 */
  roleDefaults?: Record<string, MemberLlmDefaults>
}

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.agent-team-web'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  memberMaxDepth: z.natural().default(1),
  maxMembers: z.natural().min(1).default(18),
  maxExecPerRole: z.natural().min(1).default(1),
  maxExecPerRoleByRole: z.dict(z.natural().min(1)).default({}),
  roleLlmDefaults: z.dict(z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
  })).default({}),
  stallThresholdMs: z.natural().default(120_000),
  promptSectionOrder: z.natural().default(117),
  slashCommand: z.boolean().default(true),
  trustedHosts: z.array(z.string()).default([]),
  registration: z.union(['lazy', 'eager'] as const).default('lazy'),
  // 设置页写面字段。DSH 0.1.7 的设置命名空间就是组合 entry 的 id,其 schema
  // 即本插件 Config;只有标为 volatile 的字段才会出现在设置表单里并接受
  // 即时写入(settings/schema.ts 的 volatileForm / isVolatilePath)。这两个
  // 字段与 AgentTeamSettingsFields 共用同一份 volatile schema。
  enabledModels: AgentTeamSettingsFields.enabledModels,
  roleDefaults: AgentTeamSettingsFields.roleDefaults,
})

export function apply(ctx: Context, config: Config): void {
  const trustedHosts = config.trustedHosts ?? []
  // R-17/H-1: per-boot capability token for the AgentTeams web routes. The
  // token rides into the served HTML (index-inject global row) so the browser
  // panel can echo it; it is the write credential for /close, so a leaked
  // /state response can never derive close authority. Malformed trustedHosts
  // entries fail the load loudly instead of silently authorizing a prefix.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  const webToken = createWebToken()
  const resolved: ToolsConfig = {
    stateDir: config.stateDir ?? '.agent-team-web',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    memberMaxDepth: config.memberMaxDepth ?? 1,
    maxMembers: config.maxMembers ?? 18,
    maxExecPerRole: config.maxExecPerRole ?? 1,
    maxExecPerRoleByRole: config.maxExecPerRoleByRole,
    roleLlmDefaults: config.roleLlmDefaults,
    stallThresholdMs: config.stallThresholdMs ?? 120_000,
  }

  // Provider registration is a sibling plugin's effect (`subagent-spawn` /
  // `subagent-fork` rows), which can land after this mount under the Loader's
  // concurrent activation — so capability validation happens at the first
  // member spawn (`spawnMember`), the earliest point the provider list is
  // settled, rather than here.

  // AgentTeam 设置中心(t13:模型粒度授权 + 角色档位覆盖)。DSH 0.1.7 起设置
  // 命名空间就是组合 entry id(`agent-team-web`),其 schema 即本插件 Config,
  // 故读访问直接取本次 apply 的 config(volatile 写入会重新应用本 entry);
  // 写面仅为 HTTP 第二通道保留,经宿主 settings.update 落盘,settings 服务
  // 缺席(headless)时保持 undefined → 路由 503,读访问不受影响。
  const settingsAccess: AgentTeamSettingsAccess = settingsAccessFromConfig(config)
  ctx.inject(['settings'], (settingsCtx) => {
    wireAgentTeamSettings(settingsCtx, settingsAccess)
  })

  // t13 接线:模型授权 + 角色档位覆盖经 settingsAccess(apply 期捕获
  // settings scope 的闭包)延迟读取——注入回调在 apply 之后才执行,
  // 此处只需稳定引用。这份配置既交给激活期(每次激活装一套工具 schema),
  // 也交给运行时安装,必须是同一份。
  const toolsConfig: ToolsConfig = {
    ...resolved,
    modelGrantedFor: (provider, model) => settingsAccess.modelGrantedFor?.(provider, model)
      ?? (provider === 'deepseek-official'),
    roleDefaultsFor: (roleKey) => settingsAccess.roleDefaultsFor?.(roleKey),
  }

  // 两半分开装——这是本插件 token 成本的关键分界:
  //
  // 1. 运行时(调度器、退休成员守卫、成员档位/状态守卫)是进程级 hook,零
  //    模型可见成本,必须活过单个队长会话,因此在这里装一次。放到激活期会
  //    导致第二次激活重复包装 subagent followup、起第二个调度器,并且在队长
  //    作用域释放时连带拆掉别的会话要用的调度器。
  // 2. 14 个 agent_teams_* 工具的 schema + 队长协议(实测约 4.5k tokens/请求)
  //    按会话装,只在这里留一条提示段 + 一个激活工具(见 activation.ts)。
  //    未使用 AgentTeams 的会话因此只付提示的钱。
  const runtime = installAgentTeamsRuntime(ctx, toolsConfig)
  const sectionOrder = config.promptSectionOrder ?? 117
  // 注册方式见 Config.registration:
  // - lazy(默认):这里只装提示段 + 激活工具,真面在激活时装进调用方 agent 的 scope。
  // - eager:整面装进全局层(v0.1.14 形态)。当 harness 让子 agent 加入「父的
  //   preset」而不是继承「父 agent 的 scope」时(DSH 0.1.5-rc.2 即如此),lazy
  //   的成员既拿不到工具,成员 deny 过滤也无法命名这些工具,只能走 eager。
  const eager = (config.registration ?? 'lazy') === 'eager'
  if (eager) {
    registerAgentTeamsSurface(ctx, toolsConfig, sectionOrder, runtime)
  } else {
    registerAgentTeamsActivation(ctx, toolsConfig, sectionOrder, runtime)
  }
  const activateAgent: AgentTeamsActivation = eager
    // 全局层已经装好整面,激活无事可做(斜杠命令仍照常注入目标文本)。
    ? () => undefined
    : (agent) => {
        activateAgentTeams(agent, toolsConfig, sectionOrder, runtime)
      }

  // Deterministic activation surfaces: the closed-namespace `/agent-teams`
  // host command (surfaces in the Web GUI slash menu via the Harness
  // ui-commands client) and the plain-text gesture boundary for surfaces
  // without command adjudication (headless CLI). Both default on; a profile
  // can disable them to keep the natural-language trigger exclusive. Both
  // also ACTIVATE: the surface must exist before the step that will read it
  // is assembled.
  //
  // `commands` is registered lazily (not a required inject): it ships in the
  // base bundle of every standard profile, but a minimal composition that
  // omits the command registry keeps the plugin fully functional — the fiber
  // never pends on it and simply never gains the slash command.
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerAgentTeamsCommand(commandCtx, activateAgent)
    })
    installAgentTeamsGestureBoundary(ctx, activateAgent)
  }

  // The activity panel data/artwork routes need the Web server and the
  // workspace registry, which headless profiles do not mount; under
  // concurrent activation they may also bind after this plugin. Register the
  // routes lazily: try now, then on each service binding event. In a webless
  // profile the plugin stays tool-only and never blocks boot.
  let webRegistered = false
  const registerWebSurface = (): void => {
    if (webRegistered) return
    const webServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebRouteHost | undefined
    const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as WorkspaceRegistry | undefined
    if (webServer === undefined || workspaceRegistry === undefined) return
    webRegistered = true

    // R-17/H-1: publish the per-boot capability token into the served HTML so
    // the browser panel can echo it in `x-dsh-agent-teams-token`. Only this
    // same-origin consumer receives the full snapshot; anonymous callers get
    // the redacted projection (no session ids, no inbox text).
    const inject = (ctx as unknown as {
      on(name: 'webserver/index-inject', listener: (table: { kind: 'global'; name: string; value: unknown }[]) => void): unknown
    }).on
    inject('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: TOKEN_GLOBAL, value: webToken })
    })

    // Activity panel data route: the browser floater polls this for team
    // snapshots (disk truth + live subagent activity). Mirrors the Claude
    // Code desktop watcher's server-side snapshot pattern.
    ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/agent-team-web/state',
    handler: async (req, res) => {
      // R-17/H-1: host fence + token gate. An authenticated same-origin panel
      // receives the full snapshot; everyone else receives only the redacted
      // display projection (no captainSessionId, member subagent ids, or
      // inbox text), and a non-loopback/trusted Host is refused outright.
      const authorized = webRequestAuthorized(req, webToken, trustedHosts)
      const url = new URL(req.url ?? '/', 'http://x')
      const roots = workspaceRegistry.list().map((workspace) => ({
        workspace: workspace.title,
        stateRoot: join(workspace.path, resolved.stateDir),
      }))
      // ?archived=1 serves teams moved to archive/ (post-delete review).
      // providers 快照透出读 settings 命名空间 resolved value(单通道真源),
      // 经 settingsAccess.enabledModels 闭包(apply 期捕获 scope)。
      const snapshots = url.searchParams.get('archived') === '1'
        ? await collectArchivedTeamsActivity(ctx, roots, settingsAccess.enabledModels)
        : await collectTeamsActivity(ctx, roots, settingsAccess.enabledModels)
      // t10(t9 根因):provider 是全局事实,顶层直接算(不再依赖 teams[0]——
      // 无团队时设置页卡片恒空)。t13:含每 provider 模型列表(advisory)。
      const providers = await collectProviders(ctx, settingsAccess.enabledModels)
      // t13:角色档位三源链(settings 覆盖 → profile.roleLlmDefaults →
      // DEFAULT_ROLE_LLM)。t20:分开透出——合并视图(兼容)+ base(不含覆盖:
      // profile ?? DEFAULT)+ 原始覆盖层(settings.roleDefaults 原文);client
      // 用「实时覆盖(scope snapshot) ?? base」合并出实时显示,删覆盖后 base
      // 立即可见(不再被陈旧合并视图掩盖)。
      const roleOverrides = settingsAccess.roleDefaults?.() ?? {}
      const roleKeys = [...new Set([
        ...Object.keys(DEFAULT_ROLE_LLM),
        ...Object.keys(resolved.roleLlmDefaults ?? {}),
        ...Object.keys(roleOverrides),
      ])]
      const roleDefaultsBase: Record<string, { provider?: string; model?: string; reasoningEffort?: string }> = {}
      for (const roleKey of roleKeys) {
        roleDefaultsBase[roleKey] = resolved.roleLlmDefaults?.[roleKey] ?? DEFAULT_ROLE_LLM[roleKey]
      }
      const roleDefaults = roleKeys.map(roleKey => {
        const merged = roleOverrides[roleKey] ?? roleDefaultsBase[roleKey]
        return {
          role: roleKey,
          ...merged ?? {},
          overridden: roleOverrides[roleKey] !== undefined,
        }
      })
      const body = JSON.stringify({
        teams: snapshots.map(snapshot => redactSnapshotForHttp(snapshot, authorized)),
        providers,
        roleDefaults,
        roleDefaultsBase,
        roleDefaultsOverrides: roleOverrides,
        // 未有可信用户/workspace principal：不从 /state 侧门泄露跨工作区
        // 经验库的计数、来源、标题或正文（即使持有共享 boot token）。
        selfGrowth: { total: 0, calibrated: 0, recent: [] },
      })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  }), 'agent-teams: activity route')

  // Team close route: the panel's "end & archive team" button POSTs here. The
  // handler is the host-side authority — it re-checks ownership and that all
  // tasks are completed before archiving (defense in depth over the client's
  // disabled state). Method-agnostic webServer routing means POST is enforced
  // inside the handler. R-17/H-1: the boot token is now the write credential,
  // so a leaked /state response cannot derive close authority (the route-level
  // check below and the in-handler check are two layers of the same gate).
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/agent-team-web/close',
    handler: (req, res) => handleCloseTeam(ctx, resolved, workspaceRegistry, req, res, {
      token: webToken,
      trustedHosts,
    }),
  }), 'agent-teams: close route')

  // AgentTeam 设置中心第二写面(决策 2 保留):设置页通过 settings RPC 持久化
  // 为主通道;此 HTTP 路由保留为 R-17 token 围栏的第二写面。t13 模型粒度:
  // 经 settingsAccess.setModelGrant 写 settings 命名空间(settings 唯一真源);
  // settings 缺席时路由返回 503。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/agent-team-web/model-grant',
    handler: (req, res) => handleProviderGrant(settingsAccess, req, res, {
      token: webToken,
      trustedHosts,
    }),
  }), 'agent-teams: model-grant route')

  // One Host operator owns all registered workspaces in explicit single-user
  // mode. Resolve Connection at request time (a sibling service can bind later),
  // and fail closed while it is absent; the boot token alone is never identity.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/agent-team-web/practices',
    handler: (req, res) => handlePractices(workspaceRegistry, resolved.stateDir, req, res, {
      token: webToken,
      trustedHosts,
      connection: ctx.get('connection') as OperatorAdmission | undefined,
    }),
  }), 'agent-teams: practices route')

  // Whale mascot artwork: serve the packaged V2 role/action images to the
  // activity panel. An explicit allowlist guards the route (no path
  // traversal); the images ship with the bundle (files: assets/).
  const artDir = fileURLToPath(new URL('../assets/agent-team-web/', import.meta.url))
  const ART_ALLOWLIST = new Set([
    'team-lead-v2.png',
    'member-commissar-v2.png',
    'member-researcher-v2.png', 'member-engineer-v2.png',
    'member-qa-v2.png', 'member-designer-v2.png',
    'member-security-v2.png', 'member-docs-v2.png',
    'member-data-v2.png', 'member-operator-v2.png',
    'action-working-v2.png', 'action-thinking-v2.png',
    'action-reporting-v2.png', 'action-celebrating-v2.png',
    'action-sleeping-v2.png', 'action-sending-v2.png',
  ])
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/agent-team-web/assets',
    handler: async (req, res) => {
      let name: string
      try {
        name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '')
      } catch {
        // Malformed percent-encoding: treat as an unknown asset, not a 400.
        res.writeHead(404)
        res.end()
        return
      }
      if (!ART_ALLOWLIST.has(name)) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const data = await readFile(join(artDir, name))
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
        })
        res.end(data)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: artwork read failed for ${name}: ${String(error)}`)
        res.writeHead(404)
        res.end()
      }
      },
    }), 'agent-teams: artwork route')
  }

  registerWebSurface()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name as (typeof WEB_SERVER_KEYS)[number])
      || WORKSPACE_KEYS.includes(name as (typeof WORKSPACE_KEYS)[number])) {
      registerWebSurface()
    }
  })
}
