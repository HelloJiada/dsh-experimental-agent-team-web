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
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { registerCaptainRoute } from './captain-route.ts'
import { DEFAULT_ROLE_LLM } from './members.ts'
import { installAgentTeamsGestureBoundary, registerAgentTeamsCommand } from './command.ts'
import { handleCloseTeam } from './close-route.ts'
import { handleProviderGrant } from './provider-grant-route.ts'
import { wireAgentTeamSettings, type AgentTeamSettingsAccess } from './provider-grants.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectArchivedTeamsActivity, collectProviders, collectTeamsActivity, redactSnapshotForHttp } from './snapshot.ts'
import { readBestPractices } from './best-practices.ts'
import { TOKEN_GLOBAL } from './web-auth-constants.ts'
import { assertTrustedAuthority, createWebToken, webRequestAuthorized } from './web-auth.ts'

/**
 * Structural slice of the web server service, compatible with both the
 * published `dsh-host-webserver@0.0.1-rc.1` (`ctx.httpServer` /
 * `HttpServerService`) and the renamed `webServer` / `WebServer` in later
 * builds: the beta transition renames the service without changing the route
 * registration shape.
 */
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
})

/** The model-facing usage policy: when and how to drive AgentTeams. */
function usageSectionText(toolNames: string): string {
  return `When the user asks to run something with AgentTeams (e.g. "use AgentTeams to do X"), or an activation message from the /agent-teams slash command arrives, you are the captain of a multi-agent team. Follow this protocol:
1. Call agent_teams_create with a team name and the goal as description. You become the captain and may lead one team at a time.
2. Call agent_teams_add_member for each executing role the goal needs — 7 preset behavioral roles, one member each by default: 侦察参谋 researcher (想清楚: read code/docs first → root cause + plan → self-check → hand off), 技术员 engineer (做出来: implement per plan → self-test → diff summary), 质检员 qa (验明白: checklist first → verify → pass/reject with evidence), 文宣干事 designer (好看: visual plan with concrete values), 情报分析员 data (算清楚: define metrics → collect → reviewable report), 文书 docs (写明白: structure first → write with spec → sync-check against reality), 警卫员 security (护边界: map the trust perimeter → probe exposure → grade with exploit scenarios → verify the positive side); a reviewer (审查员) is a task-level dynamic role — add one when dedicated review is needed. operator 后勤保障员 is not preset — pass it as a custom role string only when the goal really needs it. A commissar (政委) member for independent oversight is auto-created with the team; do not add a second one. The captain is fixed at 1 and the commissar at 1; each executing role may have up to 1 member by default (每角色默认 1 人，上限可配置), and the team total is capped at 18 members (队长 1 + 政委 1 + 执行成员) — exceeding either cap is rejected. The recommended handoff path is researcher → engineer → qa (docs 文书 joins when the deliverable needs formal documentation), but only when each step truly depends on the previous one — there is no forced pipeline: independent work stays parallel, and tasks become sequential only through explicit dependencies. Members are durable subagents: they wait for your messages, then work a full turn. By default a member on your current provider/model snapshots your current reasoning effort; a member routed to a different provider or model automatically uses that target model's default effort. Never ask the user to choose these per member; only pass provider/model when the user explicitly requests a different route for that role, and reasoning_effort only when the user explicitly requests a particular effort ("default" explicitly selects the target model's default).
3. Break the goal into tasks with agent_teams_create_task and wire dependencies. Assign role-specific work when useful; unassigned ready work belongs to the shared pool. agent_teams_create_task and agent_teams_status surface keyword-based role suggestions (调研→researcher、实现→engineer、验收→qa、视觉→designer、数据→data、文档→docs) as advisory hints only — confirm or override them via the existing assignee flow, they never auto-dispatch. The scheduler automatically claims one ready task for each truly idle member and wakes it, including across later rounds. Tasks marked risk=high/critical or milestone=true fall under the commissar gate: they can only be marked completed after the commissar passes them with agent_teams_review_task (verdict=pass); a rejected completion notifies the commissar automatically.
4. Lead by delegation: monitor with agent_teams_status, send guidance with agent_teams_send_message, and let idle teammates execute ready work. Do not duplicate a teammate's work merely because its turn is slow. If the user requires every member to contribute or report, create one task per required contribution (or message each member directly); never wait for an unassigned member to produce work it was never given.
5. If the user explicitly asks to pause a running member, its open attempt remains parked after interruption; after answering the user, send that same member guidance with agent_teams_send_message so it continues the same attempt. Do not interrupt members for an ordinary user question that did not request a pause. If work must change owner, restart from scratch, or be taken over, call agent_teams_reassign_task first. Reassign to another idle member, retry with the same member, or use assignee=captain before doing it yourself. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Check status after progress notifications until every required task is terminal and every member is idle/ready; do not busy-poll or require reports from members with no assigned work.
7. Present the team's results to the user, then agent_teams_delete the team unless the user wants to keep working with it.

Tools: ${toolNames}`
}

/**
 * 自成长数据汇总(t10,设置页第三张卡)——跨 workspace 合并全局经验库:
 * 返回总条数 + 校准计数(useful/revised 视为已校准,pending 待校准)+ 最近
 * 若干条(按 updatedAt 降序,供展示摘要)。任何 workspace 无库/读失败都
 * 静默容错,返回空数据(设置页显示空态而非报错)。
 */
async function collectSelfGrowth(roots: readonly { workspace: string; stateRoot: string }[]): Promise<{
  total: number
  calibrated: number
  recent: readonly {
    id: string
    sourceTeamId: string
    sourceTaskSubject: string
    role: string
    practice: string
    verdict: string
  }[]
}> {
  const entries: Awaited<ReturnType<typeof readBestPractices>> = []
  for (const root of roots) {
    try {
      entries.push(...await readBestPractices(root.stateRoot))
    } catch {
      // 单个 workspace 无经验库/损坏:跳过,不阻断整体。
    }
  }
  const sorted = [...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const calibrated = entries.filter(e => e.verdict === 'useful' || e.verdict === 'revised').length
  return {
    total: entries.length,
    calibrated,
    recent: sorted.slice(0, 5).map(e => ({
      id: e.id,
      sourceTeamId: e.sourceTeamId,
      sourceTaskSubject: e.sourceTaskSubject,
      role: e.role,
      practice: e.practice,
      verdict: e.verdict,
    })),
  }
}

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

  const toolNames = [
    'agent_teams_create',
    'agent_teams_add_member',
    'agent_teams_remove_member',
    'agent_teams_create_task',
    'agent_teams_reassign_task',
    'agent_teams_claim_task',
    'agent_teams_update_task',
    'agent_teams_review_task',
    'agent_teams_send_message',
    'agent_teams_status',
    'agent_teams_retro_review',
    'agent_teams_best_practices',
    'agent_teams_delete',
  ].join(', ')
  ctx.systemPrompt.section({
    name: 'agent-teams:usage',
    order: config.promptSectionOrder ?? 117,
    text: usageSectionText(toolNames),
  })

  // AgentTeam 设置中心（t13:命名空间 agent-team-web,模型粒度授权 + 角色档位
  // 覆盖）。t6 接线延续：在 inject 作用域内捕获 register() 返回的
  // SettingsScope,经闭包写入 settingsAccess(判定/快照/写面);工具 execute
  // 与 HTTP 路由、快照采集经 settingsAccess 读写;settings 作用域释放时
  // 全部清空。headless 无 settings 服务 → 不注册,modelGrantedFor 保持
  // undefined → spawn 校验退化为仅 deepseek-official 名下恒授权(默认语义)。
  const settingsAccess: AgentTeamSettingsAccess = {}
  ctx.inject(['settings'], (settingsCtx) => {
    wireAgentTeamSettings(settingsCtx, settingsAccess)
  })

  registerAgentTeamsTools(ctx, {
    ...resolved,
    // t13 接线:模型授权 + 角色档位覆盖经 settingsAccess(apply 期捕获
    // settings scope 的闭包)延迟读取——注入回调在 apply 之后才执行,
    // 此处只需稳定引用。
    modelGrantedFor: (provider, model) => settingsAccess.modelGrantedFor?.(provider, model)
      ?? (provider === 'deepseek-official'),
    roleDefaultsFor: (roleKey) => settingsAccess.roleDefaultsFor?.(roleKey),
  })

  // t12 扩展:队长路由覆盖——AgentTeam 激活时,队长(指挥者)的 LLM 请求按
  // settings.roleDefaults['captain'] 路由(职责核心用好模型,如 gpt)。仅
  // 队长 agent + 配置存在时生效,其他会话/普通对话不受影响。
  registerCaptainRoute(ctx, () => settingsAccess.roleDefaultsFor?.('captain'))

  // Deterministic activation surfaces: the closed-namespace `/agent-teams`
  // host command (surfaces in the Web GUI slash menu via the Harness
  // ui-commands client) and the plain-text gesture boundary for surfaces
  // without command adjudication (headless CLI). Both default on; a profile
  // can disable them to keep the natural-language trigger exclusive.
  //
  // `commands` is registered lazily (not a required inject): it ships in the
  // base bundle of every standard profile, but a minimal composition that
  // omits the command registry keeps the plugin fully functional — the fiber
  // never pends on it and simply never gains the slash command.
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerAgentTeamsCommand(commandCtx)
    })
    installAgentTeamsGestureBoundary(ctx)
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
        // t10:自成长数据(设置页第三张卡)——全局经验库计数 + 最近条目(含
        // 校准状态)。跨 workspace 合并:每个 workspace 一份 best-practices.json。
        selfGrowth: await collectSelfGrowth(roots),
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
