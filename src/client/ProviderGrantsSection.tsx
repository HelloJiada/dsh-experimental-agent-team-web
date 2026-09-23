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
import { IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

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
export type PresetGroupId = 'ds' | 'gpt' | 'mixed'

export interface RolePresetTemplateEntry {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

export interface RolePresetTemplate {
  readonly id: string
  readonly group: PresetGroupId
  readonly label: string
  readonly description: string
  readonly cost: string
  readonly speed: string
  readonly quality: string
  readonly roleDefaults: Readonly<Record<string, RolePresetTemplateEntry>>
}

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

/** 思考深度选项(与角色档位 effort 值域对齐)。 */
export const EFFORT_OPTIONS = ['high', 'max', 'low', 'off'] as const

export const ROLE_PRESET_TEMPLATES: readonly RolePresetTemplate[] = [
  {
    id: 'ds-current-default',
    group: 'ds',
    label: '当前默认',
    description: '恢复到当前 Web profile 内置的 AgentTeam 默认配置。',
    cost: '低到中',
    speed: '高',
    quality: '中高',
    roleDefaults: {
      researcher: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      reviewer: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      commissar: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    },
  },
  {
    id: 'ds-all-flash',
    group: 'ds',
    label: '全 DS 低成本铺量型',
    description: '所有常规执行位尽量用 DS，适合预算优先与批量轻任务。',
    cost: '很低',
    speed: '很高',
    quality: '中',
    roleDefaults: {
      researcher: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      reviewer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      commissar: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    },
  },
  {
    id: 'ds-pro-balanced',
    group: 'ds',
    label: 'Pro 队长的全 DS 均衡协作型',
    description: '用 Pro 扛研究、数据、审查，用 Flash 负责实现、QA 与文书。',
    cost: '低到中',
    speed: '高',
    quality: '中高',
    roleDefaults: {
      researcher: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      reviewer: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      commissar: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    },
  },
  {
    id: 'ds-pro-risk',
    group: 'ds',
    label: 'Pro 队长的全 DS 中高风险任务型',
    description: '关键判断位全部升到 Pro，只在文书和视觉位保留更省的 Flash。',
    cost: '中到高',
    speed: '中',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      reviewer: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      commissar: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    },
  },
  {
    id: 'gpt-current-default',
    group: 'gpt',
    label: '当前默认',
    description: 'GPT 默认模板：Astra 用于政委与安全；不改变队长模型。',
    cost: '待评估',
    speed: '待实测',
    quality: '待实测',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      qa: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      designer: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      data: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      docs: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-6-astra', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-6-astra', reasoningEffort: 'high' },
    },
  },
  {
    id: 'gpt-all-balanced',
    group: 'gpt',
    label: '全 GPT 通用性价比型',
    description: 'Sol 负责统筹，Luna 负责主要执行与表达。',
    cost: '高',
    speed: '中',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      qa: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      designer: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      data: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      docs: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  },
  {
    id: 'gpt-all-terra',
    group: 'gpt',
    label: '全 GPT 长上下文工程型',
    description: 'Terra 负责研究与实现；三款 GPT-5.6 均配置 1M 上下文。',
    cost: '高',
    speed: '中',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      qa: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      designer: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      data: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      docs: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  },
  {
    id: 'mixed-current-default',
    group: 'mixed',
    label: '当前默认',
    description: '推荐的混编默认配置：GPT 负责关键统筹与理解，DS 负责低价执行与输出。',
    cost: '中',
    speed: '中高',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  },
  {
    id: 'mixed-sol-luna-ds',
    group: 'mixed',
    label: 'Sol + Luna + DS 通用性价比型',
    description: '关键执行位用 Luna，收尾与输出位用 DS。',
    cost: '中',
    speed: '中高',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  },
  {
    id: 'mixed-sol-terra-ds',
    group: 'mixed',
    label: 'Sol + Terra + DS 长上下文执行型',
    description: 'Terra 负责吃大上下文，DS 负责低价输出。',
    cost: '中到高',
    speed: '中',
    quality: '高',
    roleDefaults: {
      researcher: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      qa: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
      data: { provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      docs: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      security: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      reviewer: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      commissar: { provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  },
]

/**
 * 已知**不支持** reasoning effort 的 provider 列表(t8 通用适配)。
 * 这些 provider 的模型没有可选的思考深度——自动重分配/模型切换/effort
 * 下拉统一查表,不硬编码单一 provider。后续新增不支持 effort 的模型,
 * 只需在此追加 provider id(或更细粒度时扩展为 Record)。
 * 当前为空:cc-switch(GPT-5.6)经 anthropic-messages 适配器支持 adaptive
 * thinking 思考深度(low/medium/high/max)——t13 纠正 t26/t8 的误判(当时因
 * settings.yaml 缺 reasoningEfforts 映射导致适配器误报不支持)。未列出的
 * provider 默认支持(未知按支持处理)。
 */
export const NO_REASONING_EFFORT_PROVIDERS: readonly string[] = []

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
    provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  data: {
    provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  reviewer: {
    provider: 'cc-switch', model: 'gpt-5.6-sol', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  commissar: {
    provider: 'cc-switch', model: 'gpt-6-astra', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  },
  security: {
    provider: 'cc-switch', model: 'gpt-6-astra', reasoningEffort: 'max',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
  },
  engineer: {
    provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  },
  qa: {
    provider: 'cc-switch', model: 'gpt-5.6-terra', reasoningEffort: 'high',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  },
  docs: {
    provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low',
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
  },
  designer: {
    provider: 'cc-switch', model: 'gpt-5.6-luna', reasoningEffort: 'low',
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

export function rolePresetTemplatesByGroup(group: PresetGroupId): readonly RolePresetTemplate[] {
  return ROLE_PRESET_TEMPLATES.filter(template => template.group === group)
}

export function applyRolePresetTemplate(
  template: RolePresetTemplate,
): Record<string, { provider?: string; model?: string; reasoningEffort?: string }> {
  return Object.fromEntries(Object.entries(template.roleDefaults).map(([role, value]) => [role, { ...value }]))
}

export function presetDiffCount(
  rows: readonly RolePresetRow[],
  template: RolePresetTemplate,
): number {
  let changed = 0
  for (const row of rows) {
    const next = template.roleDefaults[row.role]
    if (next === undefined) continue
    if (row.provider !== next.provider || row.model !== next.model || row.reasoningEffort !== next.reasoningEffort) changed += 1
  }
  return changed
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
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetGroup, setPresetGroup] = useState<PresetGroupId>('ds')
  const [selectedPresetId, setSelectedPresetId] = useState<string>(rolePresetTemplatesByGroup('ds')[0]?.id ?? '')
  const write = async (role: string, value: { provider?: string; model?: string; reasoningEffort?: string } | undefined): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', roleDefaultsMap(snapshot.value?.roleDefaults, role, value))
  }
  const resetAll = async (): Promise<void> => {
    if (scope === undefined) return
    await scope.set('roleDefaults', resetRoleDefaults())
  }
  const applyPreset = async (): Promise<void> => {
    if (scope === undefined) return
    const template = rolePresetTemplatesByGroup(presetGroup).find(entry => entry.id === selectedPresetId)
    if (template === undefined) return
    await scope.set('roleDefaults', applyRolePresetTemplate(template))
    setPresetOpen(false)
  }
  if (rows.length === 0) return null
  const viewedRole = viewing?.role
  const viewedDuty = viewedRole === undefined ? undefined : ROLE_DUTY[viewedRole]
  const presetTemplates = rolePresetTemplatesByGroup(presetGroup)
  const selectedPreset = presetTemplates.find(entry => entry.id === selectedPresetId) ?? presetTemplates[0]
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
        <button
          type="button"
          className={styles.resetBtn}
          onClick={() => {
            const nextOpen = !presetOpen
            setPresetOpen(nextOpen)
            if (nextOpen) {
              const first = rolePresetTemplatesByGroup(presetGroup)[0]
              if (first !== undefined) setSelectedPresetId(first.id)
            }
          }}
        >
          {t('settings.agentTeam.applyPreset')}
        </button>
      </header>
      {presetOpen && (
        <div className={styles.presetPopover}>
          <div className={styles.presetTitle}>{t('settings.agentTeam.presetTitle')}</div>
          <p className={styles.presetHelp}>{t('settings.agentTeam.presetHelp')}</p>
          <p className={styles.presetHelp}>成本、速度、质量为未实测参考分级；Astra 待评估。套用预设不改变队长模型。</p>
          <div className={styles.presetTabs}>
            {(['ds', 'gpt', 'mixed'] as const).map(group => (
              <button
                key={group}
                type="button"
                className={styles.presetTab}
                data-active={presetGroup === group}
                onClick={() => {
                  setPresetGroup(group)
                  const first = rolePresetTemplatesByGroup(group)[0]
                  if (first !== undefined) setSelectedPresetId(first.id)
                }}
              >
                {group === 'ds'
                  ? t('settings.agentTeam.presetGroup.ds')
                  : group === 'gpt'
                    ? t('settings.agentTeam.presetGroup.gpt')
                    : t('settings.agentTeam.presetGroup.mixed')}
              </button>
            ))}
          </div>
          <div className={styles.presetList}>
            {presetTemplates.map(template => (
              <button
                key={template.id}
                type="button"
                className={styles.presetItem}
                data-active={selectedPreset?.id === template.id}
                onClick={() => { setSelectedPresetId(template.id) }}
              >
                <span className={styles.presetItemHead}>
                  <span className={styles.presetItemName}>{template.label}</span>
                  <span className={styles.presetDiffBadge}>{`${t('settings.agentTeam.preset.diff')} ${presetDiffCount(rows, template)}`}</span>
                </span>
                <span className={styles.presetMetaRow}>
                  <span className={styles.presetMetaChip}>{`成本：${template.cost}`}</span>
                  <span className={styles.presetMetaChip}>{`速度：${template.speed}`}</span>
                  <span className={styles.presetMetaChip}>{`质量：${template.quality}`}</span>
                </span>
                <span className={styles.presetItemDesc}>{template.description}</span>
              </button>
            ))}
          </div>
          <div className={styles.presetActions}>
            <button type="button" className={styles.presetActionGhost} onClick={() => { setPresetOpen(false) }}>
              {t('settings.agentTeam.preset.cancel')}
            </button>
            <button type="button" className={styles.presetActionPrimary} onClick={() => { void applyPreset() }}>
              {t('settings.agentTeam.preset.apply')}
            </button>
          </div>
        </div>
      )}
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
                <IconBrowseOutlineRegular />
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
function GrowthCard({ t }: { readonly t: AgentTeamsTranslate }): ReactNode {
  // Host currently exposes no authenticated per-user/workspace principal to
  // this route. Do not offer mutation controls on the strength of a boot token.
  const governanceWritable = false
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
      if (path === undefined) setWorkspaces(result.workspaces ?? [])
      else setEntries(result.entries ?? [])
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'http-403' ? '无权访问此工作区的经验' : '加载经验失败，请重试')
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
    if (!workspace || !selected || busy) return
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
      <p className={styles.growthMeta}>自成长经验治理暂不可用：宿主尚未提供可验证的用户/工作区身份。工作区枚举、经验详情及写入均已关闭。</p>
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
      <GrowthCard t={t} />
    </div>
  )
}
