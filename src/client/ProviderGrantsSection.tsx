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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { agentTeamsWebToken } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { roleTitle, ROLE_DUTY } from './roles.ts'
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

/**
 * 已知**不支持** reasoning effort 的 provider 列表(t8 通用适配)。
 * 这些 provider 的模型没有可选的思考深度——自动重分配/模型切换/effort
 * 下拉统一查表,不硬编码单一 provider。后续新增不支持 effort 的模型,
 * 只需在此追加 provider id(或更细粒度时扩展为 Record)。
 * deepseek-official / kimi-coding / xiaomi 等未列出 = 默认支持(未知按支持处理)。
 */
export const NO_REASONING_EFFORT_PROVIDERS: readonly string[] = ['cc-switch']

/**
 * 纯函数(t8):该 provider 是否支持 reasoning effort(未知 provider 默认支持)。
 * 替代 t26 的硬编码 `=== 'cc-switch'` 判断,支持未来任意新模型。
 */
export function supportsReasoningEffort(provider: string | undefined): boolean {
  return provider !== undefined && !NO_REASONING_EFFORT_PROVIDERS.includes(provider)
}

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

/** 角色档位值(client 本地形状,与 host AgentTeamSettingsSchema 对齐;
 * 不导入 host provider-grants.ts 以保 client bundle 纯净)。
 * auto 标记(t23):系统自动分配标识,使下次授权变化可重算(区别于手动覆盖)。 */
export interface RoleLlmDefaultValue {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly auto?: boolean
}

/** 自动重分配档位表(t23,用户确认 v2;t26 修正:cc-switch GPT-5.6 不支持
 * reasoning effort,cc-switch 目标不配 effort——仅模型,effort 由模型默认;
 * deepseek 回退档位保留 effort(deepseek 支持)。sol=最强推理(pro 级 5 角色),
 * terra=稳健执行(技术/质检),luna=轻量省成本(文书/文宣,支持视觉)。 */
export interface RoleAutoAssignEntry {
  readonly provider: string
  readonly model: string
  /** 目标模型的 effort;cc-switch(GPT-5.6)不支持 reasoning → undefined 不写。 */
  readonly reasoningEffort?: string
  readonly fallback: { readonly provider: string; readonly model: string; readonly reasoningEffort: string }
}

export const ROLE_AUTO_ASSIGN_TABLE: Readonly<Record<string, RoleAutoAssignEntry>> = {
  researcher: {
    provider: 'cc-switch', model: 'gpt-5.6-sol[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  data: {
    provider: 'cc-switch', model: 'gpt-5.6-sol[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  reviewer: {
    provider: 'cc-switch', model: 'gpt-5.6-sol[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  commissar: {
    provider: 'cc-switch', model: 'gpt-5.6-sol[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  security: {
    provider: 'cc-switch', model: 'gpt-5.6-sol[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
  },
  engineer: {
    provider: 'cc-switch', model: 'gpt-5.6-terra[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  },
  qa: {
    provider: 'cc-switch', model: 'gpt-5.6-terra[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  },
  docs: {
    provider: 'cc-switch', model: 'gpt-5.6-luna[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
  },
  designer: {
    provider: 'cc-switch', model: 'gpt-5.6-luna[1M]',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
  },
}

/**
 * 纯函数(t23;t26 修正):授权变化后自动重分配角色档位(写 settings 覆盖层,
 * 不动默认/内置表)。逐角色(table 的 key):
 * a. 手动覆盖(roleDefaults[role] 存在且无 auto 标记)→ 保留不动(尊重显式选择);
 * b. 否则(继承态或带 auto 标记的自动分配结果)→ 目标模型已授权 → 写
 *    {provider:'cc-switch', model:目标, auto:true}(cc-switch GPT-5.6 不支持
 *    reasoning effort,不落 effort 字段;deepseek 回退条目保留 effort);
 *    目标未授权 → 写 deepseek 原档位回退(deepseek-official 恒授权),同样 auto:true。
 * 返回新 map 仅含变更(无关角色/已有覆盖原样保留)。
 */
export function autoAssignRoleDefaults(
  current: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
  enabledModels: Readonly<Record<string, boolean>> | undefined,
  table: Readonly<Record<string, RoleAutoAssignEntry>> = ROLE_AUTO_ASSIGN_TABLE,
): Record<string, RoleLlmDefaultValue> {
  const next = { ...(current ?? {}) }
  for (const [role, entry] of Object.entries(table)) {
    const existing = next[role]
    if (existing !== undefined && existing.auto !== true) continue // 手动覆盖保留
    const targetAuthorized = enabledModels?.[modelKeyOf(entry.provider, entry.model)] === true
    if (targetAuthorized) {
      // t8:写面统一查 supportsReasoningEffort(不依赖档位表条目)——provider
      // 不支持 effort(GPT-5.6 等)时即使条目意图有 effort 也不落盘。
      next[role] = {
        provider: entry.provider,
        model: entry.model,
        ...entry.reasoningEffort !== undefined && supportsReasoningEffort(entry.provider)
          ? { reasoningEffort: entry.reasoningEffort }
          : {},
        auto: true,
      }
    } else {
      next[role] = { ...entry.fallback, auto: true }
    }
  }
  return next
}

/** 纯函数(t20):实时合并角色档位——显示值 = 实时覆盖(scope snapshot)
 * ?? base(/state 的 profile ?? DEFAULT,不含覆盖);overridden 由实时覆盖
 * 判定(驱动「恢复默认」disabled 态与选中回显)。 */
export function mergeRoleDefaults(
  base: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
  overrides: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
): readonly RolePresetView[] {
  const roles = [...new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(overrides ?? {}),
  ])]
  return roles.map(role => ({
    role,
    ...(overrides?.[role] ?? base?.[role]) ?? {},
    overridden: overrides?.[role] !== undefined,
  }))
}

/** 纯函数(t25):是否存在任一档位表目标模型已授权(初始化分配的前提——
 * 有目标可分配才写,避免无谓覆盖/写入)。 */
export function autoAssignHasTarget(
  enabledModels: Readonly<Record<string, boolean>> | undefined,
  table: Readonly<Record<string, RoleAutoAssignEntry>> = ROLE_AUTO_ASSIGN_TABLE,
): boolean {
  if (enabledModels === undefined) return false
  return Object.values(table).some(entry => enabledModels[modelKeyOf(entry.provider, entry.model)] === true)
}

/** 纯函数(t25):初始化重分配幂等判定——按表重算结果与当前覆盖是否不同
 * (无变更则不写 scope,避免无谓写入/触发 uSES 重渲染循环)。 */
export function autoAssignDiffers(
  current: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
  enabledModels: Readonly<Record<string, boolean>> | undefined,
  table: Readonly<Record<string, RoleAutoAssignEntry>> = ROLE_AUTO_ASSIGN_TABLE,
): boolean {
  const next = autoAssignRoleDefaults(current, enabledModels, table)
  const cur = current ?? {}
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)])
  for (const key of keys) {
    const a = cur[key]
    const b = next[key]
    if ((a === undefined) !== (b === undefined)) return true
    if (a === undefined || b === undefined) continue
    if (a.provider !== b.provider || a.model !== b.model
      || a.reasoningEffort !== b.reasoningEffort
      || (a.auto ?? false) !== (b.auto ?? false)) return true
  }
  return false
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

/** 纯函数(t17/t22):模型下拉按 provider 分组——可调度判定与第一张卡
 * providerGrantRows.enabled 语义一致:deepseek-official 恒可调度(全量模型);
 * 其他 provider = models 非空 && 全部模型已授权(enabledModels 每个
 * `${provider}/${model}` key 均为 true)。enabledModels 缺省(undefined)时
 * 不过滤(兼容旧行为/快照缺省);过滤后空组剔除。 */
export function rolePresetModelGroups(
  providers: readonly ProviderWithModels[],
  enabledModels?: Readonly<Record<string, boolean>>,
): readonly { providerId: string; models: readonly string[] }[] {
  const groups: { providerId: string; models: readonly string[] }[] = []
  for (const provider of providers) {
    const models = provider.models ?? []
    if (models.length === 0) continue
    const allGranted = enabledModels === undefined
      || (provider.id === 'deepseek-official')
      || models.every(model => enabledModels[modelKeyOf(provider.id, model)] === true)
    if (!allGranted) continue
    groups.push({ providerId: provider.id, models })
  }
  return groups
}

/** /state 顶层自成长数据(t10:设置页第三张卡数据源)。 */
export interface SelfGrowthView {
  readonly total: number
  readonly calibrated: number
  readonly recent: readonly {
    readonly id: string
    readonly sourceTeamId: string
    readonly sourceTaskSubject: string
    readonly role: string
    readonly practice: string
    readonly verdict: string
  }[]
}

/** 纯函数(t20):从 /state 响应体取设置中心数据——providers(含 models)+
 * roleDefaultsBase(不含覆盖的 base:profile ?? DEFAULT)+ roleDefaultsOverrides
 * (settings.roleDefaults 原文,初始值;实时覆盖由 scope snapshot 提供)
 * + selfGrowth(自成长数据,t10)。 */
export function settingsCenterFromStateBody(body: unknown): {
  providers: readonly ProviderWithModels[]
  roleDefaultsBase: Record<string, RoleLlmDefaultValue>
  roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>
  selfGrowth: SelfGrowthView
} {
  const data = body as {
    providers?: readonly ProviderWithModels[]
    roleDefaultsBase?: Record<string, RoleLlmDefaultValue>
    roleDefaultsOverrides?: Record<string, RoleLlmDefaultValue>
    selfGrowth?: SelfGrowthView
  } | undefined
  return {
    providers: Array.isArray(data?.providers) ? data.providers : [],
    roleDefaultsBase: data?.roleDefaultsBase ?? {},
    roleDefaultsOverrides: data?.roleDefaultsOverrides ?? {},
    selfGrowth: data?.selfGrowth ?? { total: 0, calibrated: 0, recent: [] },
  }
}

/** 从 /state 拉取设置中心数据(经授权 token)。 */
export async function fetchSettingsCenter(): Promise<{
  providers: readonly ProviderWithModels[]
  roleDefaultsBase: Record<string, RoleLlmDefaultValue>
  roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>
  selfGrowth: SelfGrowthView
}> {
  const token = agentTeamsWebToken()
  const response = await fetch('/plugins/agent-team-web/state', {
    headers: token === undefined ? {} : { [TOKEN_HEADER]: token },
  })
  if (!response.ok) return { providers: [], roleDefaultsBase: {}, roleDefaultsOverrides: {}, selfGrowth: { total: 0, calibrated: 0, recent: [] } }
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
    // t23:授权变化 → 同一次 scope 操作链内自动重分配角色档位(写 settings
    // 覆盖层:新授权模型用起来 / 关授权回退 deepseek;手动覆盖不动)。
    const nextEnabled = toggleProviderModels(snapshot.value?.enabledModels, row.id, models, !row.enabled)
    await scope.set('enabledModels', nextEnabled)
    await scope.set('roleDefaults', autoAssignRoleDefaults(snapshot.value?.roleDefaults, nextEnabled))
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
  // t9:当前查看职责的角色(undefined = 弹窗关闭)。
  const [viewing, setViewing] = useState<RolePresetRow | undefined>(undefined)
  const write = async (role: string, value: { provider?: string; model?: string; reasoningEffort?: string } | undefined): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', roleDefaultsMap(snapshot.value?.roleDefaults, role, value))
  }
  const resetAll = async (): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', resetRoleDefaults())
  }
  if (rows.length === 0) return null
  const viewedRole = viewing?.role
  const viewedDuty = viewedRole === undefined ? undefined : ROLE_DUTY[viewedRole]
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
        {rows.map(row => (
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
                // 选中模型所属组 → 写 {provider: 组 provider, model}(旧 provider
                // 不保留);t8:目标组不支持 reasoning effort(GPT-5.6 等)时
                // **不保留旧 effort**——写 {provider, model} 无 effort 字段;
                // 其他组保留当前 reasoningEffort(切模型不丢思考等级)。
                const group = groups.find(g => g.models.includes(model))
                void write(row.role, {
                  provider: group?.providerId,
                  model,
                  ...group?.providerId !== undefined && supportsReasoningEffort(group.providerId)
                    ? { reasoningEffort: row.reasoningEffort }
                    : {},
                })
              }}
            >
              <option value="">{t('settings.agentTeam.inherit')}</option>
              {groups.map(group => (
                <optgroup key={group.providerId} label={group.providerId}>
                  {group.models.map(model => (
                    <option
                      key={`${group.providerId}/${model}`}
                      value={model}
                    >
                      {model}
                    </option>
                  ))}
                </optgroup>
              ))}
              {/* t22 边界:当前选中模型所在组被授权过滤(先选后关)→ 补占位 option,
                  保证 select 不空白、用户可感知需先授权;onChange 行为不变。 */}
              {row.model !== undefined && row.model !== ''
                && !groups.some(group => group.models.includes(row.model as string)) && (
                  <option value={row.model}>{`${row.model}（${t('settings.agentTeam.unauthorized')}）`}</option>
                )}
            </select>
              <select
                className={styles.select}
                aria-label={`${row.role} ${t('settings.agentTeam.effortAria')}`}
                // t21:删「继承」选项;极端空值(无生效 effort)fallback 到
                // EFFORT_OPTIONS[0],避免 select 无匹配显示空白。
                // t8:当前模型 provider 不支持 reasoning effort(GPT-5.6 等)→
                // 禁用 effort 下拉(选 effort 无意义;覆盖写面也不再落 effort)。
                disabled={!supportsReasoningEffort(row.provider)}
                value={EFFORT_OPTIONS.includes(row.reasoningEffort as (typeof EFFORT_OPTIONS)[number])
                  ? row.reasoningEffort
                  : EFFORT_OPTIONS[0]}
                onChange={(event) => {
                  const effort = event.target.value
                  // 次因①:只写三字段(provider/model/effort),不 spread 整个 row
                  // (避免 role/overridden 落入 settings.roleDefaults)。
                  void write(row.role, {
                    provider: row.provider,
                    model: row.model,
                    reasoningEffort: effort === '' ? undefined : effort,
                  })
                }}
              >
                {EFFORT_OPTIONS.map(effort => <option key={effort} value={effort}>{effort}</option>)}
              </select>
              {/* t9:查看职责按钮——纯眼睛图标,对齐 DSH Agent 预设交互。 */}
              <button
                type="button"
                className={styles.viewBtn}
                aria-label={`${t('settings.agentTeam.viewAria')}: ${row.role}`}
                title={`${t('settings.agentTeam.viewAria')}: ${row.role}`}
                onClick={() => { setViewing(row) }}
              >
                <IconBrowseOutline16 />
              </button>
            </li>
          )
        )}
      </ul>
      {/* t9:职责说明弹窗(对齐 DSH Agent 预设的只读 viewer)。 */}
      {viewing !== undefined && (
        <div className={styles.modalMask} role="presentation" onClick={() => { setViewing(undefined) }}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={`${t('settings.agentTeam.viewAria')}: ${viewedRole}`}
            onClick={(event) => { event.stopPropagation() }}
          >
            <header className={styles.modalHead}>
              <span className={styles.modalTitle}>{roleTitle(viewing.role, t)}</span>
              <span className={styles.rowSub}>{viewing.role}</span>
              <button
                type="button"
                className={styles.modalClose}
                aria-label={t('settings.agentTeam.close')}
                onClick={() => { setViewing(undefined) }}
              >
                ✕
              </button>
            </header>
            {viewedDuty === undefined
              ? <p className={styles.modalEmpty}>{t('settings.agentTeam.viewEmpty')}</p>
              : (
                <div className={styles.modalBody}>
                  <p className={styles.roleSlogan}>{viewedDuty.slogan}</p>
                  <p className={styles.modalSectionTitle}>{t('settings.agentTeam.viewSteps')}</p>
                  {viewedDuty.steps.map((step, index) => (
                    <div key={step.title} className={styles.dutyRow}>
                      <span className={styles.dutyStep}>{`${index + 1}. ${step.title}`}</span>
                      <span className={styles.dutyDesc}>{step.desc}</span>
                    </div>
                  ))}
                  <p className={styles.modalSectionTitle}>{t('settings.agentTeam.viewDeliverable')}</p>
                  <p className={styles.dutyDesc} style={{ padding: '0 10px' }}>{viewedDuty.deliverable}</p>
                  <p className={styles.modalSectionTitle}>{t('settings.agentTeam.viewRules')}</p>
                  {viewedDuty.rules.map(rule => (
                    <div key={rule} className={styles.ruleRow}>
                      <span className={styles.ruleBullet}>•</span>
                      <span className={styles.dutyDesc}>{rule}</span>
                    </div>
                  ))}
                </div>
              )}
            <p className={styles.modalSectionTitle} style={{ marginTop: 14, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 10 }}>
              {t('settings.agentTeam.viewCurrent')}
            </p>
            <div className={styles.modalKv}><span className={styles.modalK}>{t('settings.agentTeam.modelAria')}</span><span className={styles.modalV}>{viewing.provider ?? ''}{viewing.provider !== undefined && viewing.model !== undefined ? ' / ' : ''}{viewing.model ?? ''}</span></div>
            <div className={styles.modalKv}><span className={styles.modalK}>{t('settings.agentTeam.effortAria')}</span><span className={styles.modalV}>{viewing.reasoningEffort ?? t('settings.agentTeam.modelDefault')}</span></div>
          </div>
        </div>
      )}
    </section>
  )
}

/** 卡片三:自成长(t10)——经验库计数 + 最近条目,克制展示(不搞图表/趋势)。 */
function GrowthCard({ growth, t }: {
  readonly growth: SelfGrowthView
  readonly t: AgentTeamsTranslate
}): ReactNode {
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.growth')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.growth')}</span>
      </header>
      {growth.total === 0
        ? <p className={styles.empty}>{t('settings.agentTeam.growthEmpty')}</p>
        : (
          <>
            <p className={styles.growthStat}>
              {t('settings.agentTeam.growthCount', { total: growth.total, calibrated: growth.calibrated })}
            </p>
            <ul className={styles.growthList}>
              {growth.recent.map(entry => (
                <li key={entry.id} className={styles.growthItem}>
                  <span className={styles.growthPractice}>{entry.practice}</span>
                  <span className={styles.growthMeta}>
                    {`${t('settings.agentTeam.growthFrom')} ${entry.sourceTeamId} · ${entry.role}`}
                    {entry.verdict === 'useful' && ` · ${t('settings.agentTeam.growthVerdict.useful')}`}
                    {entry.verdict === 'revised' && ` · ${t('settings.agentTeam.growthVerdict.revised')}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  )
}

/**
 * AgentTeam 设置中心 section:两张卡(模型调度授权 + 角色预设)。
 * t20 数据流:模型/角色 base = /state 顶层(一次性);授权/覆盖实时状态 =
 * settingsScope 命名空间 resolved value(订阅自动刷新);显示值 = 实时覆盖
 * ?? base;开关/选择写面 = scope.set(宿主持久化,写后 snapshot 更新即时回显)。
 */
export function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null {
  const { scope, t = (key: string) => key } = props
  const [center, setCenter] = useState<{
    providers: readonly ProviderWithModels[]
    roleDefaultsBase: Record<string, RoleLlmDefaultValue>
    selfGrowth: SelfGrowthView
  }>({ providers: [], roleDefaultsBase: {}, selfGrowth: { total: 0, calibrated: 0, recent: [] } })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    void fetchSettingsCenter()
      .then((data) => { if (alive) { setCenter({ providers: data.providers, roleDefaultsBase: data.roleDefaultsBase, selfGrowth: data.selfGrowth }); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  const snapshot = useSyncExternalStore(
    (callback) => scope?.subscribe(callback) ?? (() => undefined),
    () => scope?.getSnapshot() ?? EMPTY_SNAPSHOT,
  )
  // t25:页面初始化执行一次自动重分配(预开授权也生效——用户在 settings 文件
  // 预开启 cc-switch 时无 toggle 事件,t23 的触发式重分配不会跑)。条件:
  // center 加载完 + scope snapshot 就绪 + 存在已授权目标模型;幂等(无变更
  // 不写);ref 一次性保险(写 roleDefaults 不改变授权,天然不循环)。
  const initAssignRef = useRef(false)
  useEffect(() => {
    if (initAssignRef.current) return
    if (loading) return
    const value = snapshot.value
    if (value === undefined) return
    initAssignRef.current = true
    if (scope === undefined) return
    if (!autoAssignHasTarget(value.enabledModels)) return // 无目标可分配 → 不写
    if (!autoAssignDiffers(value.roleDefaults, value.enabledModels)) return // 幂等
    void scope.set('roleDefaults', autoAssignRoleDefaults(value.roleDefaults, value.enabledModels))
  }, [loading, snapshot.value, scope])
  const providerRows = providerGrantRows(center.providers, snapshot.value?.enabledModels)
  // t20 主因修复:实时合并——显示值 = 实时覆盖(scope snapshot) ?? base(/state)。
  const roleRows = mergeRoleDefaults(center.roleDefaultsBase, snapshot.value?.roleDefaults)
  // t22:授权联动——groups 传实时授权 snapshot(开关切换后 scope.set →
  // snapshot 更新 → uSES 重渲染 → 角色预设下拉即时增删 provider 组)。
  const modelGroups = rolePresetModelGroups(center.providers, snapshot.value?.enabledModels)
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
      {/* t10:自成长卡独立于前两卡(provider 为空也展示——经验库是全局积累)。 */}
      <GrowthCard growth={center.selfGrowth} t={t} />
    </div>
  )
}
