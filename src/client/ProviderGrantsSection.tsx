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
 * 纯逻辑(providerGrantRows/toggleProviderModels/roleDefaultsMap 等)导出供 node 直测,
 * 与 activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { agentTeamsWebToken } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { roleTitle } from './roles.ts'
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

/** Provider 粒度行(t14:第一张卡片,无模型子列表)。 */
export interface ProviderGrantRow {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly locked: boolean
}

/** 角色预设行(t17:合并视图直接透传,模型选项改由全 provider 分组提供)。 */
export type RolePresetRow = RolePresetView

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

/**
 * 纯函数(t14):provider 粒度行——只列 provider,无模型子列表。
 * 行 enabled = 该 provider 下所有模型均已授权(开关态语义:全开/全关);
 * deepseek-official 恒锁定恒启用(「默认」徽,无 switch)。 */
export function providerGrantRows(
  providers: readonly ProviderWithModels[],
  enabledModels: Readonly<Record<string, boolean>> | undefined,
): readonly ProviderGrantRow[] {
  return providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    enabled: provider.id === 'deepseek-official'
      || ((provider.models?.length ?? 0) > 0
        && (provider.models ?? []).every(model => enabledModels?.[modelKeyOf(provider.id, model)] === true)),
    locked: provider.id === 'deepseek-official',
  }))
}

/**
 * 纯函数(t14):provider 行 switch 联动该 provider 全部模型——
 * 开启 = 全部模型授权(写各自 `${provider}/${model}` key);关闭 = 全部撤销
 * (删除该 provider 全部模型 key)。设计决策:provider 粒度展示,授权数据仍
 * 模型粒度(enabledModels 复合 key)不变。 */
export function toggleProviderModels(
  current: Readonly<Record<string, boolean>> | undefined,
  provider: string,
  models: readonly string[] | undefined,
  nextEnabled: boolean,
): Record<string, boolean> {
  const next = { ...(current ?? {}) }
  for (const model of models ?? []) {
    const key = modelKeyOf(provider, model)
    if (nextEnabled) next[key] = true
    else delete next[key]
  }
  return next
}

/** 纯函数:角色预设行(t17 合并视图透传;模型选项改由 rolePresetModelGroups
 * 全 provider 分组提供)。 */
export function rolePresetRows(views: readonly RolePresetView[]): readonly RolePresetRow[] {
  return views
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

/** 纯函数(t17):「恢复默认」= 清空全部 roleDefaults 覆盖,所有角色回落三源链。 */
export function resetRoleDefaults(): Record<string, { provider?: string; model?: string; reasoningEffort?: string }> {
  return {}
}

/** 纯函数(t17):模型下拉按 provider 分组——返回全部含模型的 provider 组
 * (advisory models),供 <optgroup> 渲染;选中任一项即写该组 provider。 */
export function rolePresetModelGroups(
  providers: readonly ProviderWithModels[],
): readonly { providerId: string; models: readonly string[] }[] {
  return providers
    .map(provider => ({ providerId: provider.id, models: provider.models ?? [] }))
    .filter(group => group.models.length > 0)
}

/** 纯函数(t17):模型下拉当前选中值所在组(无覆盖/模型不在任何组 → undefined)。 */
export function rolePresetSelectedGroup(
  groups: readonly { providerId: string; models: readonly string[] }[],
  value: { provider?: string; model?: string } | undefined,
): string | undefined {
  const model = value?.model
  const provider = value?.provider
  if (model === undefined) return undefined
  return groups.find(group => group.providerId === provider && group.models.includes(model))?.providerId
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

/** 卡片一:模型调度授权(t14:provider 粒度行 + switch;deepseek 锁定「默认」)。
 * provider 行 switch = 该 provider 全部模型统一授权(读写 enabledModels
 * 中该 provider 的所有 `${provider}/${model}` key)。 */
function ModelGrantCard({ rows, providers, scope, snapshot, t }: {
  readonly rows: readonly ProviderGrantRow[]
  readonly providers: readonly ProviderWithModels[]
  readonly scope: SettingsScope<ProviderGrantsSectionValue> | undefined
  readonly snapshot: SettingsScopeSnapshot<ProviderGrantsSectionValue>
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const toggle = async (row: ProviderGrantRow): Promise<void> => {
    if (scope === undefined || row.locked) return
    const models = providers.find(p => p.id === row.id)?.models
    await scope.set('enabledModels', toggleProviderModels(snapshot.value?.enabledModels, row.id, models, !row.enabled))
  }
  if (rows.length === 0) return null
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.modelGrant')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.modelGrant')}</span>
      </header>
      <ul className={styles.list}>
        {rows.map(row => (
          <li key={row.id} className={styles.row} data-enabled={row.enabled}>
            <span className={styles.nameWrap}>
              <span className={styles.name} title={row.id}>{row.name}</span>
              <span className={styles.rowSub}>{row.id}</span>
            </span>
            {row.locked
              ? <span className={styles.pill}>{t('settings.agentTeam.locked')}</span>
              : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${row.name} ${t('settings.agentTeam.toggleAria')}`}
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

/** 卡片二:角色预设(t17 方案甲——无表头/无职位列/无默认按钮列;
 * 右上「恢复默认」;模型下拉按 provider 分组)。 */
function RolePresetCard({ rows, groups, scope, snapshot, t }: {
  readonly rows: readonly RolePresetRow[]
  readonly groups: readonly { providerId: string; models: readonly string[] }[]
  readonly scope: SettingsScope<ProviderGrantsSectionValue> | undefined
  readonly snapshot: SettingsScopeSnapshot<ProviderGrantsSectionValue>
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const write = async (role: string, value: { provider?: string; model?: string; reasoningEffort?: string } | undefined): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', roleDefaultsMap(snapshot.value?.roleDefaults, role, value))
  }
  const resetAll = async (): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', resetRoleDefaults())
  }
  if (rows.length === 0) return null
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.rolePreset')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.rolePreset')}</span>
        <button
          type="button"
          className={styles.resetBtn}
          disabled={!rows.some(row => row.overridden)}
          onClick={() => { void resetAll() }}
        >
          {t('settings.agentTeam.reset')}
        </button>
      </header>
      <ul className={styles.list}>
        {rows.map(row => {
          // 当前模型覆盖值所在组(选中项须落在对应 optgroup 内)。
          const selectedGroup = rolePresetSelectedGroup(groups, { provider: row.provider, model: row.model })
          return (
            <li key={row.role} className={styles.row} data-overridden={row.overridden}>
              <span className={styles.nameWrap}>
                <span className={styles.name} title={row.role}>{roleTitle(row.role, t)}</span>
                <span className={styles.rowSub}>{row.role}</span>
              </span>
              <select
                className={styles.select}
                aria-label={`${row.role} ${t('settings.agentTeam.modelAria')}`}
                value={row.model ?? ''}
                onChange={(event) => {
                  const model = event.target.value
                  if (model === '') {
                    // 继承:删覆盖,回落三源链。
                    void write(row.role, undefined)
                    return
                  }
                  // 选中模型所属组 → 直接写 {provider: 组 provider, model}(旧 provider 不保留)。
                  const group = groups.find(g => g.models.includes(model))
                  void write(row.role, { provider: group?.providerId, model })
                }}
              >
                <option value="">{t('settings.agentTeam.inherit')}</option>
                {groups.map(group => (
                  <optgroup key={group.providerId} label={group.providerId}>
                    {group.models.map(model => (
                      <option
                        key={`${group.providerId}/${model}`}
                        value={model}
                        {...(selectedGroup === group.providerId && row.model === model ? { selected: true } : {})}
                      >
                        {model}
                      </option>
                    ))}
                  </optgroup>
                ))}
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
            </li>
          )
        })}
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
  const providerRows = providerGrantRows(center.providers, snapshot.value?.enabledModels)
  const roleRows = rolePresetRows(center.roleDefaults)
  const modelGroups = rolePresetModelGroups(center.providers)
  return (
    <div className={styles.section} data-provider-grants data-loading={loading}>
      {providerRows.length === 0 && roleRows.length === 0
        ? <p className={styles.empty}>{t(loading ? 'settings.agentTeam.loading' : 'settings.agentTeam.empty')}</p>
        : (
          <>
            <ModelGrantCard rows={providerRows} providers={center.providers} scope={scope} snapshot={snapshot} t={t} />
            <RolePresetCard rows={roleRows} groups={modelGroups} scope={scope} snapshot={snapshot} t={t} />
          </>
        )}
    </div>
  )
}
