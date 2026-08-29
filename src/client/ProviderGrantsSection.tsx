/**
 * Provider 授权设置页卡片(t8)——补 settings.section slot。
 *
 * 后端 settings 命名空间(agent-team-web-providers)已注册,但 DSH 设置页
 * shell 依赖 client 侧 `settings.section` slot 渲染功能卡片——本组件即该
 * 卡片:列出 DSH 已注册 provider(ctx.llm 经快照 /state 透出)+ enabledProviders
 * 开关;deepseek-official 恒授权锁定显示「默认」;开关切换经 client
 * settingsScope.set('enabledProviders', nextMap) 写命名空间(宿主持久化,
 * spawn 校验随之下一次 add_member 生效)。
 *
 * 纯逻辑(providerGrantRows/toggleEnabledMap)导出供 node 环境直测,与
 * activity-panel-helpers.test 同构。
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

/** 命名空间 resolved value 形状(与 host ProviderGrantsSchema 对齐)。 */
export interface ProviderGrantsSectionValue {
  readonly enabledProviders?: Record<string, boolean>
}

/**
 * Provider 授权命名空间(client 侧本地常量,与 host provider-grants.ts 的
 * agent-team-web-providers 保持一致;不导入 host 模块以保 client bundle
 * 纯净——provider-grants.ts 顶层执行 schemastery schema,会拖入 host 依赖)。
 */
export const PROVIDER_GRANTS_NAMESPACE = 'agent-team-web-providers'

/** 一个 provider 行:列表 + 授权状态 + 锁定(deepseek-official 恒授权)。 */
export interface ProviderGrantRow {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly locked: boolean
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

/** 纯函数:provider 列表 + 授权 map → 行(deepseek-official 恒锁定且恒 enabled)。 */
export function providerGrantRows(
  providers: readonly { id: string; name: string }[],
  enabled: Readonly<Record<string, boolean>> | undefined,
): readonly ProviderGrantRow[] {
  return providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    enabled: provider.id === 'deepseek-official' || enabled?.[provider.id] === true,
    locked: provider.id === 'deepseek-official',
  }))
}

/** 纯函数:toggle 后的 enabledProviders map(保留其他项)。 */
export function toggleEnabledMap(
  current: Readonly<Record<string, boolean>> | undefined,
  provider: string,
  nextEnabled: boolean,
): Record<string, boolean> {
  return { ...(current ?? {}), [provider]: nextEnabled }
}

/** 从快照 /state 提取 DSH 已注册 provider 列表(经授权 token)。 */
/** 纯函数:从 /state 响应体取顶层 providers(t10:provider 全局事实,不再依赖 teams[0])。 */
export function providersFromStateBody(body: unknown): readonly { id: string; name: string }[] {
  const providers = (body as { providers?: readonly { id: string; name: string }[] } | undefined)?.providers
  return Array.isArray(providers) ? providers : []
}

/** 从快照 /state 提取 DSH 已注册 provider 列表(经授权 token,顶层 providers)。 */
export async function fetchRegisteredProviders(): Promise<readonly { id: string; name: string }[]> {
  const token = agentTeamsWebToken()
  const response = await fetch('/plugins/agent-team-web/state', {
    headers: token === undefined ? {} : { [TOKEN_HEADER]: token },
  })
  if (!response.ok) return []
  return providersFromStateBody(await response.json())
}

/**
 * Provider 授权设置页卡片:provider 列表 + 授权开关。
 * 数据流:provider 列表 = /state 顶层 providers(注册表实时,全局事实);
 * 授权状态 = settingsScope 命名空间 resolved value(推送失效自动刷新)。
 * 开关写面 = scope.set('enabledProviders', nextMap)(宿主持久化)。
 * t10:恒渲染卡片(标题+空态占位),不再因空列表隐藏整卡。
 */
export function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null {
  const { scope, t = (key: string) => key } = props
  const [providers, setProviders] = useState<readonly { id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    void fetchRegisteredProviders()
      .then((list) => { if (alive) { setProviders(list); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  const snapshot = useSyncExternalStore(
    (callback) => scope?.subscribe(callback) ?? (() => undefined),
    () => scope?.getSnapshot() ?? EMPTY_SNAPSHOT,
  )
  const rows = providerGrantRows(providers, snapshot.value?.enabledProviders)
  const toggle = async (row: ProviderGrantRow): Promise<void> => {
    if (scope === undefined || row.locked) return
    await scope.set('enabledProviders', toggleEnabledMap(snapshot.value?.enabledProviders, row.id, !row.enabled))
  }
  return (
    <section className={styles.section} aria-label={t('settings.providers.title')} data-provider-grants data-loading={loading}>
      <header className={styles.head}>
        <span className={styles.title}>{t('settings.providers.title')}</span>
      </header>
      {rows.length === 0
        ? (
          <p className={styles.empty}>
            {t(loading ? 'settings.providers.loading' : 'settings.providers.empty')}
          </p>
        )
        : (
          <ul className={styles.list}>
            {rows.map(row => (
              <li key={row.id} className={styles.row} data-enabled={row.enabled}>
                <span className={styles.name} title={row.id}>{row.name}</span>
                <span className={styles.id}>{row.id}</span>
                {row.locked
                  ? <span className={styles.locked}>{t('settings.providers.locked')}</span>
                  : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={`${row.name} ${t('settings.providers.toggleAria')}`}
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
        )}
      <p className={styles.hint}>{t('settings.providers.hint')}</p>
    </section>
  )
}
