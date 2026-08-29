/**
 * AgentTeam 设置中心 section(t13 重构)——一个 settings.section 两张卡。
 *
 * 卡片一 ModelGrantCard:模型调度授权——每 provider 的每模型一行 + switch
 * (key `${provider}/${model}` 复合);deepseek-official 名下模型恒授权锁定。
 * 卡片二 RolePresetCard:角色预设——每角色一行 + 预设模型/思考深度选择 +
 * 「默认」(删 settings 覆盖,回落到 profile.roleLlmDefaults → DEFAULT_ROLE_LLM)。
 *
 * 数据流:模型/角色列表 = /state 顶层(providers 含 advisory models,
 * roleDefaults 三源链合并视图含 overridden 标记);授权/覆盖状态 =
 * settingsScope 命名空间 resolved value;写面 = scope.set(宿主持久化,
 * spawn 校验随之下次 add_member 生效)。
 *
 * 纯逻辑(modelGrantRows/toggleModelMap/roleDefaultsMap 等)导出供 node 直测,
 * 与 activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { agentTeamsWebToken } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { TOKEN_HEADER } from '../web-auth-constants.ts'
import styles from './ProviderGrantsSection.module.css'

/**
 * AgentTeam 设置中心命名空间(client 侧本地常量,与 host provider-grants.ts
 * 的 agent-team-web 保持一致;不导入 host 模块以保 client bundle 纯净)。
 */
export const PROVIDER_GRANTS_NAMESPACE = 'agent-team-web'

/** 命名空间 resolved value 形状(与 host AgentTeamSettingsSchema 对齐)。 */
export interface ProviderGrantsSectionValue {
  readonly enabledModels?: Record<string, boolean>
  readonly roleDefaults?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
}

/** /state 顶层 providers 条目(t13:含 advisory 模型列表)。 */
export interface ProviderWithModels {
  readonly id: string
  readonly name: string
  readonly models?: readonly string[]
}

/** /state 顶层角色档位合并视图(三源链 + overridden 标记)。 */
export interface RolePresetView {
  readonly role: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly overridden: boolean
}

/** 模型授权行。 */
export interface ModelGrantRow {
  readonly provider: string
  readonly model: string
  readonly enabled: boolean
  readonly locked: boolean
}

/** 角色预设行。 */
export interface RolePresetRow extends RolePresetView {
  /** 该角色可选的模型(按选中 provider 过滤)。 */
  readonly modelOptions: readonly string[]
}

/** 注入面:scope(读写命名空间) + t(文案)。 */
export interface ProviderGrantsSectionInjected {
  scope: SettingsScope<ProviderGrantsSectionValue>
  t: AgentTeamsTranslate
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type ProviderGrantsSectionProps = Partial<InjectFace<ProviderGrantsSectionInjected>>

/** 快照缺省(scope 未就绪时的稳定引用)。 */
const EMPTY_SNAPSHOT: SettingsScopeSnapshot<ProviderGrantsSectionValue> = {
  status: 'loading',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
}

/** 思考深度选项(与角色档位 effort 值域对齐)。 */
export const EFFORT_OPTIONS = ['high', 'max', 'low', 'off'] as const

/** 纯函数:复合 key(`${provider}/${model}`)。 */
export function modelKeyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** 纯函数:provider×模型 → 模型授权行(deepseek-official 恒锁定恒启用)。 */
export function modelGrantRows(
  providers: readonly ProviderWithModels[],
  enabledModels: Readonly<Record<string, boolean>> | undefined,
): readonly ModelGrantRow[] {
  const rows: ModelGrantRow[] = []
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      rows.push({
        provider: provider.id,
        model,
        enabled: provider.id === 'deepseek-official' || enabledModels?.[modelKeyOf(provider.id, model)] === true,
        locked: provider.id === 'deepseek-official',
      })
    }
  }
  return rows
}

/** 纯函数:toggle 后的 enabledModels map(保留其他项)。 */
export function toggleModelMap(
  current: Readonly<Record<string, boolean>> | undefined,
  key: string,
  nextEnabled: boolean,
): Record<string, boolean> {
  return { ...(current ?? {}), [key]: nextEnabled }
}

/** 纯函数:角色预设行(合并视图 + 按选中 provider 过滤模型选项)。 */
export function rolePresetRows(
  views: readonly RolePresetView[],
  providers: readonly ProviderWithModels[],
): readonly RolePresetRow[] {
  return views.map(view => {
    const providerModels = providers.find(p => p.id === view.provider)?.models ?? []
    return { ...view, modelOptions: providerModels }
  })
}

/** 纯函数:角色档位覆盖写后的 roleDefaults map(value=undefined → 删覆盖)。 */
export function roleDefaultsMap(
  current: Readonly<Record<string, { provider?: string; model?: string; reasoningEffort?: string }>> | undefined,
  roleKey: string,
  value: { provider?: string; model?: string; reasoningEffort?: string } | undefined,
): Record<string, { provider?: string; model?: string; reasoningEffort?: string }> {
  const next = { ...(current ?? {}) }
  if (value === undefined) delete next[roleKey] // 「默认」= 删覆盖
  else next[roleKey] = value
  return next
}

/** 纯函数:从 /state 响应体取顶层 providers(含 models)与 roleDefaults 合并视图。 */
export function settingsCenterFromStateBody(body: unknown): {
  providers: readonly ProviderWithModels[]
  roleDefaults: readonly RolePresetView[]
} {
  const data = body as {
    providers?: readonly ProviderWithModels[]
    roleDefaults?: readonly RolePresetView[]
  } | undefined
  return {
    providers: Array.isArray(data?.providers) ? data.providers : [],
    roleDefaults: Array.isArray(data?.roleDefaults) ? data.roleDefaults : [],
  }
}

/** 从 /state 拉取设置中心数据(经授权 token)。 */
export async function fetchSettingsCenter(): Promise<{
  providers: readonly ProviderWithModels[]
  roleDefaults: readonly RolePresetView[]
}> {
  const token = agentTeamsWebToken()
  const response = await fetch('/plugins/agent-team-web/state', {
    headers: token === undefined ? {} : { [TOKEN_HEADER]: token },
  })
  if (!response.ok) return { providers: [], roleDefaults: [] }
  return settingsCenterFromStateBody(await response.json())
}

/** 卡片一:模型调度授权。 */
function ModelGrantCard({ rows, scope, snapshot, t }: {
  readonly rows: readonly ModelGrantRow[]
  readonly scope: SettingsScope<ProviderGrantsSectionValue> | undefined
  readonly snapshot: SettingsScopeSnapshot<ProviderGrantsSectionValue>
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const toggle = async (row: ModelGrantRow): Promise<void> => {
    if (scope === undefined || row.locked) return
    const key = modelKeyOf(row.provider, row.model)
    await scope.set('enabledModels', toggleModelMap(snapshot.value?.enabledModels, key, !row.enabled))
  }
  if (rows.length === 0) return null
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.modelGrant')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.modelGrant')}</span>
      </header>
      <ul className={styles.list}>
        {rows.map(row => (
          <li key={modelKeyOf(row.provider, row.model)} className={styles.row} data-enabled={row.enabled}>
            <span className={styles.name} title={modelKeyOf(row.provider, row.model)}>
              {row.provider}/{row.model}
            </span>
            {row.locked
              ? <span className={styles.locked}>{t('settings.agentTeam.locked')}</span>
              : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${row.provider}/${row.model} ${t('settings.agentTeam.toggleAria')}`}
                  className={styles.switch}
                  data-on={row.enabled}
                  onClick={() => { void toggle(row) }}
                >
                  <span className={styles.switchThumb} />
                </button>
              )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 卡片二:角色预设。 */
function RolePresetCard({ rows, providers, scope, snapshot, t }: {
  readonly rows: readonly RolePresetRow[]
  readonly providers: readonly ProviderWithModels[]
  readonly scope: SettingsScope<ProviderGrantsSectionValue> | undefined
  readonly snapshot: SettingsScopeSnapshot<ProviderGrantsSectionValue>
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const write = async (role: string, value: { provider?: string; model?: string; reasoningEffort?: string } | undefined): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', roleDefaultsMap(snapshot.value?.roleDefaults, role, value))
  }
  if (rows.length === 0) return null
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.rolePreset')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.rolePreset')}</span>
      </header>
      <ul className={styles.list}>
        {rows.map(row => (
          <li key={row.role} className={styles.row} data-overridden={row.overridden}>
            <span className={styles.name}>{row.role}</span>
            <select
              className={styles.select}
              aria-label={`${row.role} ${t('settings.agentTeam.providerAria')}`}
              value={row.provider ?? ''}
              onChange={(event) => {
                const provider = event.target.value
                void write(row.role, provider === ''
                  ? { provider: undefined, model: undefined, reasoningEffort: undefined }
                  : { provider, model: undefined, reasoningEffort: undefined })
              }}
            >
              <option value="">{t('settings.agentTeam.inherit')}</option>
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.id}</option>)}
            </select>
            <select
              className={styles.select}
              aria-label={`${row.role} ${t('settings.agentTeam.modelAria')}`}
              value={row.model ?? ''}
              disabled={(row.provider ?? '') === ''}
              onChange={(event) => {
                const model = event.target.value
                void write(row.role, { ...row, model: model === '' ? undefined : model })
              }}
            >
              <option value="">{t('settings.agentTeam.inherit')}</option>
              {row.modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
            <select
              className={styles.select}
              aria-label={`${row.role} ${t('settings.agentTeam.effortAria')}`}
              value={row.reasoningEffort ?? ''}
              onChange={(event) => {
                const effort = event.target.value
                void write(row.role, { ...row, reasoningEffort: effort === '' ? undefined : effort })
              }}
            >
              <option value="">{t('settings.agentTeam.inherit')}</option>
              {EFFORT_OPTIONS.map(effort => <option key={effort} value={effort}>{effort}</option>)}
            </select>
            <button
              type="button"
              className={styles.defaultBtn}
              disabled={!row.overridden}
              onClick={() => { void write(row.role, undefined) }}
            >
              {t('settings.agentTeam.default')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * AgentTeam 设置中心 section:两张卡(模型调度授权 + 角色预设)。
 * 数据流:模型/角色列表 = /state 顶层;授权/覆盖状态 = settingsScope 命名
 * 空间 resolved value;开关/选择写面 = scope.set(宿主持久化)。
 */
export function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null {
  const { scope, t = (key: string) => key } = props
  const [center, setCenter] = useState<{ providers: readonly ProviderWithModels[]; roleDefaults: readonly RolePresetView[] }>({ providers: [], roleDefaults: [] })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    void fetchSettingsCenter()
      .then((data) => { if (alive) { setCenter(data); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  const snapshot = useSyncExternalStore(
    (callback) => scope?.subscribe(callback) ?? (() => undefined),
    () => scope?.getSnapshot() ?? EMPTY_SNAPSHOT,
  )
  const modelRows = modelGrantRows(center.providers, snapshot.value?.enabledModels)
  const roleRows = rolePresetRows(center.roleDefaults, center.providers)
  return (
    <div className={styles.section} data-provider-grants data-loading={loading}>
      {modelRows.length === 0 && roleRows.length === 0
        ? <p className={styles.empty}>{t(loading ? 'settings.agentTeam.loading' : 'settings.agentTeam.empty')}</p>
        : (
          <>
            <ModelGrantCard rows={modelRows} scope={scope} snapshot={snapshot} t={t} />
            <RolePresetCard rows={roleRows} providers={center.providers} scope={scope} snapshot={snapshot} t={t} />
          </>
        )}
    </div>
  )
}
