/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official browser locale service into ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Module-loading import: the card registers into the conversation chat-node
// slot, whose keyed renderer map lives in the ui-conversation contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The frame-level overlay is declared by ui-layout. This import is type-only;
// ctx.slots.inject below owns the runtime wait for the declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) and the ctx.settingsScope augmentation (settings-namespace scope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'
import {
  AGENT_TEAMS_LOCALE_NAMESPACE, en, zh, type AgentTeamsLocaleKey,
} from './locales.ts'
import { openAgentTeamMember } from './session-navigation.ts'
import {
  ProviderGrantsSection,
  PROVIDER_GRANTS_NAMESPACE,
  type ProviderGrantsSectionInjected,
  type ProviderGrantsSectionValue,
} from './ProviderGrantsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentTeams conversation card and activity monitor copy. */
    agentTeamWeb: AgentTeamsLocaleKey
  }
}

/** Required services: conversation nodes, slots, sessions navigation, locale,
 * and the settings-namespace scope (Provider 授权设置页卡片读写命名空间)。
 * `settingsScope` 必须显式声明——cordis 服务代理守卫在未 inject 时访问会抛
 * "cannot get property 'settingsScope' without inject",渲染期崩溃被错误边界
 * 吞掉导致 content 区空白(t11 根因)。 */
export const inject = ['conversationEvents', 'slots', 'sessions', 'locale', 'settingsScope']

/** The replayed user message is the canonical transcript entry. */
function HiddenAgentTeamsCommand(): null {
  return null
}

/** rc.2 宿主显式类型面:覆写 cordis Context 的 sessions 为 ISessions。 */
type ClientContext = Omit<Context, 'sessions'> & { readonly sessions: ISessions }

/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, { zh, en }),
    'agent-team-web: dictionaries',
  )
  const openMember = (parentId: SessionId, childId: SessionId): void => {
    void openAgentTeamMember(ctx.sessions, parentId, childId).catch((error: unknown) => {
      console.warn(`agent-team-web: failed to open member transcript ${childId}: ${String(error)}`)
    })
  }
  const Panel = ({ t }: PropsLocale<'agentTeamWeb'>) => (
    <ActivityPanel
      sessionsList={ctx.sessions.list}
      openMember={openMember}
      t={t}
    />
  )
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-teams-activity',
    order: 80,
    label: 'AgentTeams activity',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
  }, Panel))

  // The host command is only the slash-menu/admission surface. Its input is
  // replayed as the visible user message, so the generic result row would be
  // a duplicate placed before that message by command lifecycle ordering.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'agent-teams',
  }, HiddenAgentTeamsCommand))

  ctx.conversationEvents.register(agentTeamsCardDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    inject: (): AgentTeamsCardInjected => ({
      openMember,
    }),
  }, AgentTeamsCard))

  // Provider 授权设置页卡片(t8):后端命名空间已注册,补 client 侧
  // settings.section slot 让设置页 shell 渲染开关卡片。scope 在 apply 期
  // bind 一次(照 ui-settings-models 先例,注入面引用稳定对象;不在注入面
  // 每次调用时 bind,避免渲染期建 controller + 注册 effect)。
  const sectionT = ctx.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE) as (key: AgentTeamsLocaleKey) => string
  const providerGrantsScope = ctx.settingsScope.bind<ProviderGrantsSectionValue>({
    namespace: PROVIDER_GRANTS_NAMESPACE,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-team-web-providers',
    order: 100,
    label: () => sectionT('settings.providers.title'),
    inject: (): ProviderGrantsSectionInjected => ({
      scope: providerGrantsScope,
      t: sectionT,
    }),
  }, ProviderGrantsSection))
}
