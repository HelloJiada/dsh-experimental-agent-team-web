/**
 * AgentTeam 设置中心 section(t13 重构)——一个 settings.section 两张卡。
 *
 * 卡片一 RolePresetCard:角色预设——紧凑网格,每格=角色名 + mono id + 单行职责
 * 摘要,整格可点开完整职责说明;不含任何模型或档位控件。
 * 卡片二 ModelGrantCard(模型选择):每 provider 的每模型一行 + 真实 switch
 * (key `${provider}/${model}` 复合,deepseek-official 同样可开关) + 最高
 * 思考档位(由 adapter reasoning 能力驱动),不再渲染任何预设参考区块。
 *
 * 数据流:模型列表 = /state 顶层(providers 含 advisory models);
 * 授权状态 = settingsScope 命名空间 resolved value;写面 = scope.set
 * (宿主持久化,spawn 校验随之下次 add_member 生效)。
 *
 * 纯逻辑(providerGrantRows/toggleProviderModels/roleDefaultsMap 等)导出供 node 直测,
 * 与 activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

/** Minimal settings namespace face retained for the panel's host bridge. */
export interface SettingsScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly base: unknown
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
  readonly mode: 'host' | 'memory'
}
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  /** `true` when Host persisted the edit; `false` when it refused it. */
  set(field: string, value: unknown): Promise<boolean>
}
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
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
  /** New per-model allowlist and supported effort ceiling. */
  readonly modelCapabilities?: Record<string, { enabled: boolean; maxReasoningEffort?: string }>
  /** Legacy fields remain readable and are never auto-deleted. */
  readonly enabledModels?: Record<string, boolean>
  readonly roleDefaults?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
}

/** /state 顶层 providers 条目(t13:含 advisory 模型列表)。 */
export interface ProviderModelCapability {
  readonly id: string
  /** Adapter-provided capabilities in its original preferred order. */
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[]; readonly defaultEffort?: string }
}
export interface ProviderWithModels {
  readonly id: string
  readonly name: string
  readonly models?: readonly (ProviderModelCapability | string)[]
}

function modelId(model: ProviderModelCapability | string): string { return typeof model === 'string' ? model : model.id }
function normalizedModels(provider: ProviderWithModels): readonly ProviderModelCapability[] { return (provider.models ?? []).map(model => typeof model === 'string' ? { id: model } : model) }


export function modelCapabilityValue(value: ProviderGrantsSectionValue | undefined, provider: string, model: string): { enabled: boolean; maxReasoningEffort?: string } {
  const key = modelKeyOf(provider, model)
  const current = value?.modelCapabilities?.[key]
  if (current !== undefined) return current
  return { enabled: value?.enabledModels?.[key] === true }
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
}

/** 角色预设行(t17:合并视图直接透传,模型选项改由全 provider 分组提供)。 */
export type RolePresetRow = RolePresetView

/** 注入面:scope(读写命名空间) + t(文案)。 */
export interface ProviderGrantsSectionInjected {
  scope?: SettingsScope<ProviderGrantsSectionValue>
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


/** 纯函数:复合 key(`${provider}/${model}`)。 */
export function modelKeyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * 纯函数(t14):provider 粒度行——只列 provider,无模型子列表。
 * 行 enabled = 该 provider 下所有模型均已授权(开关态语义:全开/全关);
 * 没有 provider 是恒授权的(deepseek-official 也可全关)。 */
export function providerGrantRows(
  providers: readonly ProviderWithModels[],
  enabledModels: Readonly<Record<string, boolean>> | undefined,
): readonly ProviderGrantRow[] {
  return providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    enabled: (provider.models?.length ?? 0) > 0
      && normalizedModels(provider).every(model => enabledModels?.[modelKeyOf(provider.id, model.id)] === true),
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
  models: readonly (ProviderModelCapability | string)[] | undefined,
  nextEnabled: boolean,
): Record<string, boolean> {
  const next = { ...(current ?? {}) }
  for (const item of models ?? []) {
    const key = modelKeyOf(provider, modelId(item))
    if (nextEnabled) next[key] = true
    else delete next[key]
  }
  return next
}

export function toggleModelCapability(
  current: ProviderGrantsSectionValue | undefined,
  provider: string,
  model: ProviderModelCapability,
  enabled: boolean,
  maxReasoningEffort?: string,
): Record<string, { enabled: boolean; maxReasoningEffort?: string }> {
  const key = modelKeyOf(provider, model.id)
  const capabilities = { ...(current?.modelCapabilities ?? {}) }
  const prior = modelCapabilityValue(current, provider, model.id)
  const allowed = new Set(model.reasoning?.efforts.map(item => item.id) ?? [])
  const requested = maxReasoningEffort === undefined ? prior.maxReasoningEffort : maxReasoningEffort || undefined
  const effort = requested !== undefined && allowed.has(requested) ? requested : undefined
  capabilities[key] = {
    enabled,
    ...effort !== undefined && allowed.has(effort) ? { maxReasoningEffort: effort } : {},
  }
  return capabilities
}

export function modelEnabled(provider: string, model: ProviderModelCapability, value: ProviderGrantsSectionValue | undefined): boolean {
  return modelCapabilityValue(value, provider, model.id).enabled
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


/** 纯函数(t20):实时合并角色档位——显示值 = 实时覆盖(scope snapshot)
 * ?? base(/state 的 profile ?? DEFAULT,不含覆盖);overridden 由实时覆盖
 * 判定(驱动「恢复默认」disabled 态与选中回显)。 */
export const MEMBER_PRESET_ROLES = ['researcher', 'engineer', 'qa', 'designer', 'data', 'docs', 'security', 'reviewer', 'commissar'] as const

export function roleDutyDescription(role: string, t: AgentTeamsTranslate): string {
  return ROLE_DUTY[role]?.slogan ?? t('settings.agentTeam.roleDutyUnavailable')
}

export function mergeRoleDefaults(
  base: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
  overrides: Readonly<Record<string, RoleLlmDefaultValue>> | undefined,
): readonly RolePresetView[] {
  const roles = [...new Set([
    ...MEMBER_PRESET_ROLES,
    ...Object.keys(base ?? {}),
    ...Object.keys(overrides ?? {}),
  ])]
  return roles.map(role => ({
    role,
    ...(overrides?.[role] ?? base?.[role]) ?? {},
    overridden: overrides?.[role] !== undefined,
  }))
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

export interface PracticeEntry {
  readonly id: string
  readonly sourceTeamId: string
  readonly sourceTaskId: string
  readonly sourceTaskSubject: string
  readonly role: string
  readonly practice: string
  readonly verdict: string
  readonly appliesWhen?: readonly string[]
  readonly counterexamples?: readonly { readonly context: string; readonly reason: string }[]
  readonly expiresAt?: number | null
  readonly disabledAt?: number | null
  readonly disabledReason?: string
  readonly revision: number
  readonly reviewHistory?: readonly unknown[]
}

export interface PracticeWorkspace { readonly path: string; readonly title: string }
export interface PracticesResponse { readonly workspaces?: readonly PracticeWorkspace[]; readonly entries?: readonly PracticeEntry[]; readonly workspace?: string }

/** Explicit scope is mandatory: no browser cwd or implicit workspace fallback. */
export async function fetchPractices(workspace?: string): Promise<PracticesResponse> {
  const token = agentTeamsWebToken()
  const url = new URL('/plugins/agent-team-web/practices', window.location.origin)
  if (workspace !== undefined) url.searchParams.set('workspace', workspace)
  const response = await fetch(`${url.pathname}${url.search}`, {
    headers: token === undefined ? {} : { [TOKEN_HEADER]: token },
  })
  if (!response.ok) throw new Error(`http-${response.status}`)
  return await response.json() as PracticesResponse
}

export type PracticeWriteResult =
  | { readonly kind: 'ok'; readonly entry: PracticeEntry }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed'; readonly status?: number }

/** Persist before changing UI state; stale/forbidden/error responses never become success. */
export async function submitPracticeMutation(body: object, token: string | undefined, send = fetch): Promise<PracticeWriteResult> {
  try {
    const response = await send('/plugins/agent-team-web/practices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [TOKEN_HEADER]: token }) },
      body: JSON.stringify(body),
    })
    if (response.status === 409) return { kind: 'conflict' }
    if (response.status === 403) return { kind: 'forbidden' }
    if (!response.ok) return { kind: 'failed', status: response.status }
    return { kind: 'ok', entry: await response.json() as PracticeEntry }
  } catch { return { kind: 'failed' } }
}

export function validatePracticePatch(patch: { practice: string; appliesWhen: string; counterexamples: string; expiresAt: string }): string | undefined {
  if (patch.practice.trim().length === 0) return '实践内容不能为空'
  if (patch.practice.length > 4000) return '实践内容不能超过 4000 字'
  if (patch.appliesWhen.length > 2000 || patch.counterexamples.length > 2000) return '条件和反例不能超过 2000 字'
  if (patch.counterexamples.split('\n').some(value => value.trim() !== '' && (value.indexOf('|') < 1 || !value.slice(value.indexOf('|') + 1).trim()))) return '反例格式应为：场景 | 原因'
  if (patch.expiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.expiresAt) || Number.isNaN(Date.parse(patch.expiresAt)))) return '过期时间格式无效'
  return undefined
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
function ModelGrantCard({ providers, scope, snapshot, t }: {
  readonly providers: readonly ProviderWithModels[]
  readonly scope: SettingsScope<ProviderGrantsSectionValue> | undefined
  readonly snapshot: SettingsScopeSnapshot<ProviderGrantsSectionValue>
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState<string | undefined>()
  const toggle = async (provider: string, model: ProviderModelCapability, enabled: boolean, effort?: string): Promise<void> => {
    if (scope === undefined) return
    const key = modelKeyOf(provider, model.id)
    const next = toggleModelCapability(snapshot.value, provider, model, enabled, effort)
    setBusy(key); setFailure('')
    try {
      if (!await scope.set('modelCapabilities', next)) setFailure(`${provider}/${model.id} 保存失败；设置未确认`)
    } catch { setFailure(`${provider}/${model.id} 保存失败；请重试`) }
    finally { setBusy(undefined) }
  }
  if (providers.length === 0) return null
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.modelSelection')}>
      <header className={styles.head}><span className={styles.title}>{t('settings.agentTeam.modelSelection')}</span></header>
      <p className={styles.modelHelp}>{t('settings.agentTeam.modelSelectionHelp')}</p>
      {failure && <p role="alert" className={styles.growthError}>{failure}</p>}
      {providers.map(provider => <div key={provider.id} className={styles.modelProvider}>
        <h4 className={styles.modelProviderTitle}>{provider.name}<span className={styles.rowSub}>{provider.id}</span></h4>
        {(provider.models ?? []).map(model => {
          const normalized = typeof model === 'string' ? { id: model } : model
          const enabled = modelEnabled(provider.id, normalized, snapshot.value)
          const current = modelCapabilityValue(snapshot.value, provider.id, normalized.id)
          const efforts = normalized.reasoning?.efforts ?? []
          const configuredEffort = current.maxReasoningEffort && efforts.some(item => item.id === current.maxReasoningEffort)
            ? current.maxReasoningEffort
            : ''
          const key = modelKeyOf(provider.id, normalized.id)
          return <div key={normalized.id} className={styles.modelRow}>
            <span className={styles.modelName}>{normalized.id}</span>
            <button type="button" role="switch" aria-checked={enabled} aria-label={`${provider.id}/${normalized.id} 授权`} disabled={busy === key} className={styles.switch} data-on={enabled} onClick={() => { void toggle(provider.id, normalized, !enabled) }}><span className={styles.switchThumb} /></button>
            {efforts.length > 0 && <label className={styles.modelEffort}>最高思考档位
              <select className={styles.select} aria-label={`${provider.id}/${normalized.id} 最高思考档位`} value={configuredEffort} disabled={!enabled || busy === key || scope === undefined} onChange={event => { void toggle(provider.id, normalized, enabled, event.target.value) }}>
                <option value="">模型默认（未显式设置上限）</option>
                {efforts.map(item => <option key={item.id} value={item.id} title={item.description}>{item.name}</option>)}
              </select>
            </label>}
          </div>
        })}
      </div>)}
    </section>
  )
}

/** 卡片一:角色预设仅保留职责与旧路由兼容提示，不管理新成员选路。 */
function RolePresetCard({ rows, t }: {
  readonly rows: readonly RolePresetRow[]
  readonly t: AgentTeamsTranslate
}): ReactNode {
  const [viewing, setViewing] = useState<RolePresetRow | undefined>(undefined)
  if (rows.length === 0) return null
  const viewedRole = viewing?.role
  const viewedDuty = viewedRole === undefined ? undefined : ROLE_DUTY[viewedRole]
  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.rolePreset')}>
      <header className={styles.head}><span className={styles.title}>{t('settings.agentTeam.rolePreset')}</span></header>
      {/* 紧凑网格:整格即入口,职责摘要单行截断,完整职责走弹窗。 */}
      <p className={styles.roleHint}>{t('settings.agentTeam.rolePresetHint')}</p>
      <ul className={styles.roleGrid}>
        {rows.map(row => (
          <li key={row.role}>
            <button
              type="button"
              className={styles.roleChip}
              aria-label={`${t('settings.agentTeam.viewAria')}: ${row.role}`}
              title={`${roleTitle(row.role, t)} · ${roleDutyDescription(row.role, t)}`}
              onClick={() => { setViewing(row) }}
            >
              <span className={styles.roleChipTop}>
                <span className={styles.roleChipTitle}>{roleTitle(row.role, t)}</span>
                <span className={styles.roleChipId}>{row.role}</span>
              </span>
              <span className={styles.roleChipDesc}>{roleDutyDescription(row.role, t)}</span>
            </button>
          </li>
        ))}
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
              职责预设不设置新成员模型；新成员默认继承队长路由。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

/** 卡片三:自成长(t10)——经验库计数 + 最近条目,克制展示(不搞图表/趋势)。 */
function GrowthCard({ t }: { readonly t: AgentTeamsTranslate }): ReactNode {
  // DSH Web's authenticated operator owns all registered workspaces in this
  // explicit single-operator mode. The Host enforces Cookie + token admission.
  const governanceWritable = true
  const [available, setAvailable] = useState(false)
  const [workspaces, setWorkspaces] = useState<readonly PracticeWorkspace[]>([])
  const [workspace, setWorkspace] = useState('')
  const [entries, setEntries] = useState<readonly PracticeEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<PracticeEntry | undefined>()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ practice: '', appliesWhen: '', counterexamples: '', expiresAt: '', reason: '' })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async (path?: string): Promise<void> => {
    setLoading(true); setError('')
    try {
      const result = await fetchPractices(path)
      if (path === undefined) { setWorkspaces(result.workspaces ?? []); setAvailable(true) }
      else setEntries(result.entries ?? [])
    } catch (cause) {
      if (path === undefined) setAvailable(false)
      setError(cause instanceof Error && (cause.message === 'http-401' || cause.message === 'http-403')
        ? '经验治理不可用：请确认当前浏览器已通过 DSH operator 登录'
        : '加载经验失败，请重试')
    } finally { setLoading(false) }
  }
  useEffect(() => { if (governanceWritable) void load() }, [])
  const chooseWorkspace = (path: string): void => {
    setWorkspace(path); setEntries([]); setSelected(undefined); setEditing(false); setNotice(''); setError('')
    if (path !== '') void load(path)
  }
  const beginEdit = (entry: PracticeEntry): void => {
    setSelected(entry); setEditing(true); setError(''); setNotice('')
    setDraft({ practice: entry.practice, appliesWhen: (entry.appliesWhen ?? []).join('\n'), counterexamples: (entry.counterexamples ?? []).map(item => `${item.context} | ${item.reason}`).join('\n'), expiresAt: entry.expiresAt == null ? '' : new Date(entry.expiresAt).toISOString().slice(0, 10), reason: '' })
  }
  const mutate = async (action: 'edit' | 'disable' | 'restore'): Promise<void> => {
    if (!available || !workspace || !selected || busy) return
    if (draft.reason.trim().length < 3) { setError('请填写至少 3 个字符的原因'); return }
    if (action === 'edit') {
      const validation = validatePracticePatch(draft)
      if (validation) { setError(validation); return }
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const token = agentTeamsWebToken()
      const response = await submitPracticeMutation({ workspace, id: selected.id, expectedRevision: selected.revision, action,
          ...(action === 'edit' ? { patch: {
            practice: draft.practice.trim(),
            appliesWhen: draft.appliesWhen.split('\n').map(value => value.trim()).filter(Boolean),
            counterexamples: draft.counterexamples.split('\n').map(value => value.trim()).filter(Boolean).map(value => {
              const split = value.indexOf('|')
              return { context: value.slice(0, split).trim(), reason: value.slice(split + 1).trim() }
            }),
            expiresAt: draft.expiresAt ? new Date(`${draft.expiresAt}T00:00:00`).getTime() : null,
          } } : {}),
          ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        }, token)
      if (response.kind === 'conflict') {
        await load(workspace)
        setSelected(undefined); setEditing(false)
        setError('经验已被其他人修改，请查看刷新后的条目再操作')
        return
      }
      if (response.kind === 'forbidden') { setError('无权修改此工作区的经验'); return }
      if (response.kind === 'failed') { setError(`保存失败${response.status === undefined ? '（网络或服务错误）' : `（HTTP ${response.status}）`}，内容未更改`); return }
      const updated = response.entry
      setEntries(current => current.map(entry => entry.id === updated.id ? updated : entry))
      setSelected(updated); setEditing(false); setNotice('已保存；更改仅影响后续成员')
    } catch {
      setError('网络或服务错误，保存未确认；请重试')
    } finally { setBusy(false) }
  }

  return (
    <section className={styles.card} aria-label={t('settings.agentTeam.growth')}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.agentTeam.growth')}</span>
        {governanceWritable && <button type="button" className={styles.resetBtn} onClick={() => { setExpanded(value => !value); if (!expanded && workspaces.length === 0) void load() }}>
          {expanded ? '收起' : '查看全部'}
        </button>}
      </header>
      <p className={styles.growthMeta}>单机单 operator 模式：已登录本机 DSH 的操作者可管理所有已注册工作区；变更仅影响后续新成员。</p>
      {governanceWritable && expanded && <div className={styles.growthControls}>
        <label className={styles.growthMeta}>工作区
          <select className={styles.select} value={workspace} onChange={event => chooseWorkspace(event.target.value)}>
            <option value="">请选择工作区</option>
            {workspaces.map(item => <option key={item.path} value={item.path}>{item.title} — {item.path}</option>)}
          </select>
        </label>
        {loading && <p className={styles.empty}>正在加载…</p>}
        {error && <p role="alert" className={styles.growthError}>{error}<button type="button" onClick={() => { void load(workspace || undefined) }}>重试</button></p>}
        {notice && <p role="status" className={styles.growthNotice}>{notice}</p>}
        {workspace && !loading && entries.length === 0 && <p className={styles.empty}>当前工作区暂无经验。</p>}
        <ul className={styles.growthList}>
          {entries.map(entry => <li key={entry.id} className={styles.growthItem}>
            <button type="button" className={styles.growthPractice} onClick={() => { setSelected(entry); setEditing(false); setDraft(d => ({ ...d, reason: '' })); setError('') }}>{entry.practice}</button>
            <span className={styles.growthMeta}>{`${entry.sourceTeamId} · ${entry.role} · ${entry.sourceTaskSubject} · ${entry.verdict}${entry.disabledAt ? ' · 已撤销' : ''}`}</span>
          </li>)}
        </ul>
      </div>}
      {governanceWritable && selected && <div className={styles.growthDetail} role="dialog" aria-label="经验详情">
        <div className={styles.growthDetailHead}><strong>经验详情</strong><button type="button" onClick={() => { setSelected(undefined); setEditing(false) }}>关闭</button></div>
        <p><b>实践：</b>{selected.practice}</p>
        <p><b>来源：</b>{selected.sourceTeamId} · {selected.sourceTaskSubject} · {selected.role}</p>
        <p><b>适用条件：</b>{(selected.appliesWhen ?? []).join('；') || '未填写'}</p>
        <p><b>反例：</b>{(selected.counterexamples ?? []).map(value => `${value.context}：${value.reason}`).join('；') || '未填写'}</p>
        <p><b>状态：</b>{selected.disabledAt ? `已撤销：${selected.disabledReason ?? ''}` : selected.verdict} · revision {selected.revision}</p>
        {governanceWritable && (!editing ? <div className={styles.growthActions}>
          <label>操作原因<textarea value={draft.reason} onChange={event => setDraft(d => ({ ...d, reason: event.target.value }))} /></label>
          <button type="button" disabled={!workspace} onClick={() => beginEdit(selected)}>纠错/编辑</button>
          {selected.disabledAt
            ? <button type="button" disabled={busy || !workspace} onClick={() => { if (window.confirm('恢复该经验？恢复后仍需重新审核，且仅影响后续成员。')) void mutate('restore') }}>恢复</button>
            : <button type="button" disabled={busy || !workspace} onClick={() => { if (window.confirm('撤销此经验？将停止注入后续新成员。')) void mutate('disable') }}>撤销</button>}
        </div> : <div className={styles.growthEditor}>
          <label>实践<textarea value={draft.practice} onChange={event => setDraft(d => ({ ...d, practice: event.target.value }))} /></label>
          <label>适用条件<textarea value={draft.appliesWhen} onChange={event => setDraft(d => ({ ...d, appliesWhen: event.target.value }))} /></label>
          <label>反例（每行一条）<textarea value={draft.counterexamples} onChange={event => setDraft(d => ({ ...d, counterexamples: event.target.value }))} /></label>
          <label>过期日期<input type="date" value={draft.expiresAt} onChange={event => setDraft(d => ({ ...d, expiresAt: event.target.value }))} /></label>
          <label>修改原因<textarea value={draft.reason} onChange={event => setDraft(d => ({ ...d, reason: event.target.value }))} /></label>
          <div className={styles.growthActions}><button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('提交修改？修改将重新进入待审核状态。')) void mutate('edit') }}>{busy ? '提交中…' : '保存修改'}</button></div>
        </div>)}
        {error && <p role="alert" className={styles.growthError}>{error}</p>}
      </div>}
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
  // Role duties always drive rows; merge base/settings values only for compatibility display of legacy routes.
  const roleRows = mergeRoleDefaults(center.roleDefaultsBase, snapshot.value?.roleDefaults)
  return (
    <div className={styles.section} data-provider-grants data-loading={loading}>
      {center.providers.length === 0 && roleRows.length === 0
        ? <p className={styles.empty}>{t(loading ? 'settings.agentTeam.loading' : 'settings.agentTeam.empty')}</p>
        : (
          <>
            <RolePresetCard rows={roleRows} t={t} />
            <ModelGrantCard providers={center.providers} scope={scope} snapshot={snapshot} t={t} />
          </>
        )}
      {/* t10:自成长卡独立于前两卡(provider 为空也展示——经验库是全局积累)。 */}
      <GrowthCard t={t} />
    </div>
  )
}
