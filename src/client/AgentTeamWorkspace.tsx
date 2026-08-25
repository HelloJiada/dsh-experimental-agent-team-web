import { useMemo, useState } from 'react'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AgentTeamDagNodeView,
  AgentTeamMemberLoadView,
  AgentTeamMessageRiskView,
  AgentTeamTaskInsightView,
  AgentTeamView,
} from '../contract.js'
import {
  defaultAgentTeamFilterState,
  filterAgentTeam,
  type AgentTeamFilterState,
} from '../filter.js'
import { type AgentTeamCommandSuggestion } from '../commands.js'
import { timelineMilestonesView } from '../timeline-milestones.js'

type WorkspaceTab = 'overview' | 'tasks' | 'dag' | 'members' | 'messages' | 'timeline'

const TABS: readonly { key: WorkspaceTab, label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'tasks', label: '任务' },
  { key: 'dag', label: '依赖图' },
  { key: 'members', label: '成员' },
  { key: 'messages', label: '消息' },
  { key: 'timeline', label: '时间线' },
]

function renderInlineContent(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if ('text' in block && typeof block.text === 'string') return block.text
    if (block.type === 'tool-call' && 'name' in block && typeof block.name === 'string') return `[tool:${block.name}]`
    if (block.type === 'tool-result') return '[tool result]'
    if (block.type === 'image') return '[image]'
    return `[${block.type}]`
  }).join(' ')
}

function statCard(label: string, value: string | number, tone: 'neutral' | 'good' | 'warn' | 'danger' = 'neutral'): JSX.Element {
  const colors: Record<typeof tone, string> = {
    neutral: '#334155',
    good: '#166534',
    warn: '#92400e',
    danger: '#991b1b',
  }
  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: 12,
      minWidth: 120,
      background: '#fff',
    }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors[tone] }}>{value}</div>
    </div>
  )
}

function pill(text: string, tone: 'neutral' | 'good' | 'warn' | 'danger'): JSX.Element {
  const styles: Record<typeof tone, { bg: string, fg: string }> = {
    neutral: { bg: '#e2e8f0', fg: '#334155' },
    good: { bg: '#dcfce7', fg: '#166534' },
    warn: { bg: '#fef3c7', fg: '#92400e' },
    danger: { bg: '#fee2e2', fg: '#991b1b' },
  }
  const style = styles[tone]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: style.bg,
      color: style.fg,
    }}>
      {text}
    </span>
  )
}

function toneOfHealth(score: number): 'good' | 'warn' | 'danger' {
  if (score >= 80) return 'good'
  if (score >= 50) return 'warn'
  return 'danger'
}

function insightTone(severity: AgentTeamTaskInsightView['severity']): 'good' | 'warn' | 'danger' {
  switch (severity) {
    case 'low':
      return 'good'
    case 'medium':
      return 'warn'
    case 'high':
      return 'danger'
  }
}

function readinessTone(readiness: AgentTeamTaskInsightView['readiness'], severity: AgentTeamTaskInsightView['severity']): 'good' | 'warn' | 'danger' {
  if (readiness === 'failed') return 'danger'
  if (readiness === 'cancelled') return 'warn'
  return insightTone(severity)
}

function statusTone(status: AgentTeamTaskInsightView['status']): 'good' | 'warn' | 'danger' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'good'
    case 'in_progress':
      return 'warn'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'neutral'
    case 'pending':
      return 'neutral'
  }
}

function loadTone(level: AgentTeamMemberLoadView['level']): 'neutral' | 'good' | 'warn' | 'danger' {
  switch (level) {
    case 'idle':
      return 'neutral'
    case 'focused':
      return 'good'
    case 'stretched':
      return 'warn'
    case 'overloaded':
      return 'danger'
  }
}

function riskTone(riskLevel: AgentTeamMessageRiskView['riskLevel']): 'good' | 'warn' | 'danger' {
  switch (riskLevel) {
    case 'low':
      return 'good'
    case 'medium':
      return 'warn'
    case 'high':
      return 'danger'
  }
}

function tabBar(active: WorkspaceTab, onSelect: (tab: WorkspaceTab) => void): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
      {TABS.map(tab => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: active === tab.key ? '1px solid #2563eb' : '1px solid #e2e8f0',
            background: active === tab.key ? '#eff6ff' : '#fff',
            color: active === tab.key ? '#1d4ed8' : '#334155',
            fontWeight: active === tab.key ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

interface FilterChipProps {
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}

function filterChip({ label, count, active, onClick }: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 12,
        background: active ? '#2563eb' : '#f1f5f9',
        color: active ? '#fff' : '#334155',
        border: active ? '1px solid #2563eb' : '1px solid #e2e8f0',
        cursor: 'pointer',
      }}
    >
      {label} <strong>{count}</strong>
    </button>
  )
}

function filterGroup(
  title: string,
  options: readonly { key: string, label: string, count: number }[],
  activeKey: string,
  onSelect: (key: string) => void,
): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(option => filterChip({
          label: option.label,
          count: option.count,
          active: option.key === activeKey,
          onClick: () => onSelect(option.key),
        }))}
      </div>
    </div>
  )
}

function searchInput(value: string, placeholder: string, onChange: (value: string) => void): JSX.Element {
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        fontSize: 13,
        minWidth: 220,
      }}
    />
  )
}

function commandTone(kind: AgentTeamCommandSuggestion['kind']): 'neutral' | 'good' | 'warn' | 'danger' {
  switch (kind) {
    case 'task:reassign':
    case 'member:restart':
      return 'danger'
    case 'task:unblock':
    case 'message:redeliver':
      return 'warn'
    default:
      return 'neutral'
  }
}

function CommandBridgeSection({ team }: { readonly team: AgentTeamView }): JSX.Element {
  const plan = team.commandPlan
  const commands = plan.commands
  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>Command Bridge（建议命令）</h3>
      <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: 12 }}>
        计划 v{plan.version} · 共 {plan.total} 条
        {plan.highPriorityCount > 0 ? ` · 高优先级 ${plan.highPriorityCount}` : ''}
        {plan.mediumPriorityCount > 0 ? ` · 中优先级 ${plan.mediumPriorityCount}` : ''}
        {plan.lowPriorityCount > 0 ? ` · 低优先级 ${plan.lowPriorityCount}` : ''}
      </p>
      {commands.length === 0 ? (
        <p>当前没有需要执行层的命令建议。</p>
      ) : (
        <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
          {commands.map(command => (
            <li key={command.id} style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '8px 10px',
              background: '#fff',
            }}>
              <strong>{command.label}</strong>
              {' '}
              {pill(command.kind, commandTone(command.kind))}
              {' '}
              {pill(command.priority, command.priority === 'high' ? 'danger' : command.priority === 'medium' ? 'warn' : 'neutral')}
              <div style={{ color: '#475569', marginTop: 4, fontSize: 13 }}>
                {command.rationale}
                <span style={{ color: '#64748b' }}> · target {command.targetId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>宿主可消费的命令计划（只读 envelope）</summary>
        <pre style={{
          margin: '8px 0 0',
          padding: 10,
          borderRadius: 8,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          fontSize: 11,
          lineHeight: 1.5,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
          {JSON.stringify(plan, null, 2)}
        </pre>
      </details>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
        命令建议由 committed Team facts 推导，执行需要宿主 runtime 工具层支持；本工作台保持只读。
      </p>
    </div>
  )
}

function OverviewTab({ team }: { readonly team: AgentTeamView }): JSX.Element {
  const healthTone = toneOfHealth(team.summary.healthScore)
  return (
    <section style={{ display: 'grid', gap: 20 }}>
      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {statCard('健康度', team.summary.healthScore, healthTone)}
        {statCard('成员数', team.summary.memberCount)}
        {statCard('Ready 任务', team.summary.readyTaskCount, team.summary.readyTaskCount > 0 ? 'warn' : 'good')}
        {statCard('阻塞任务', team.summary.blockedTaskCount, team.summary.blockedTaskCount > 0 ? 'danger' : 'good')}
        {statCard('Stalled 任务', team.summary.stalledTaskCount, team.summary.stalledTaskCount > 0 ? 'danger' : 'good')}
        {statCard('Orphaned 任务', team.summary.orphanedTaskCount, team.summary.orphanedTaskCount > 0 ? 'danger' : 'good')}
        {statCard('过载成员', team.summary.overloadedMemberCount, team.summary.overloadedMemberCount > 0 ? 'danger' : 'good')}
        {statCard('高风险消息', team.summary.highRiskMessageCount, team.summary.highRiskMessageCount > 0 ? 'danger' : 'good')}
        {statCard('待投递消息', team.summary.undeliveredMessageCount, team.summary.undeliveredMessageCount > 0 ? 'danger' : 'good')}
        {statCard('失败成员', team.summary.failedMemberCount, team.summary.failedMemberCount > 0 ? 'danger' : 'good')}
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Captain 摘要</h3>
          <p style={{ margin: 0, color: '#334155' }}>{team.summary.overview}</p>
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Captain Briefing</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {team.summary.captainBriefing.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Top Interventions</h3>
          {team.summary.topInterventions.length === 0 ? <p>暂无需要优先干预的任务。</p> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {team.summary.topInterventions.map(action => <li key={action}>{action}</li>)}
            </ol>
          )}
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>优先建议</h3>
          {team.summary.recommendedActions.length === 0 ? <p>暂无建议。</p> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {team.summary.recommendedActions.map(action => <li key={action}>{action}</li>)}
            </ol>
          )}
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>风险与提醒</h3>
          {team.summary.alerts.length === 0 ? (
            <p style={{ margin: 0 }}>{pill('无明显风险', 'good')}</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {team.summary.alerts.map(alert => (
                <li key={alert} style={{ marginBottom: 4 }}>{alert}</li>
              ))}
            </ul>
          )}
        </div>
        <CommandBridgeSection team={team} />
      </section>
    </section>
  )
}

function TasksTab({
  team,
  filter,
  onFilterChange,
}: {
  readonly team: AgentTeamView
  readonly filter: AgentTeamFilterState
  readonly onFilterChange: (next: AgentTeamFilterState) => void
}): JSX.Element {
  const filtered = useMemo(() => filterAgentTeam(team, filter), [team, filter])
  const setTaskFilter = (taskFilter: AgentTeamFilterState['taskFilter']) => onFilterChange({ ...filter, taskFilter })
  const setTaskQuery = (taskQuery: string) => onFilterChange({ ...filter, taskQuery })

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ marginBottom: 8 }}>{searchInput(filter.taskQuery, '搜索任务…', setTaskQuery)}</div>
        {filterGroup('任务筛选', team.quickFilters.taskFilters, filter.taskFilter, key => setTaskFilter(key as AgentTeamFilterState['taskFilter']))}
        <p style={{ fontSize: 12, color: '#64748b' }}>当前显示 {filtered.tasks.length} / {team.tasks.length} 个任务</p>
      </div>

      <section>
        <h3>任务洞察</h3>
        {filtered.taskInsights.length === 0 ? <p>当前筛选下没有任务洞察。</p> : (
          <ul style={{ display: 'grid', gap: 10, paddingLeft: 20 }}>
            {filtered.taskInsights.map(insight => (
              <li key={insight.taskId}>
                <strong>{insight.subject}</strong>
                {' '}
                {pill(insight.readiness, readinessTone(insight.readiness, insight.severity))}
                {' '}
                {pill(insight.severity, insightTone(insight.severity))}
                {' '}
                {insight.interventionPriority > 0 ? pill(`P${insight.interventionPriority}`, 'warn') : null}
                {' '}
                <span style={{ color: '#64748b' }}>下游依赖 {insight.dependencyDepth}</span>
                <div style={{ color: '#475569', marginTop: 4 }}>
                  {insight.reasons.join(' ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>全部任务（已筛选）</h3>
        {filtered.tasks.length === 0 ? <p>当前筛选下没有任务。</p> : (
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {filtered.tasks.map(task => (
              <li key={task.id}>
                <strong>{task.subject}</strong>
                {' '}
                {pill(task.status, statusTone(task.status))}
                {task.ownerId !== null ? ` · owner ${task.ownerId}` : ''}
                {task.blockedBy.length > 0 ? ` · blocked by ${task.blockedBy.join(', ')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

function MembersTab({
  team,
  filter,
  onFilterChange,
}: {
  readonly team: AgentTeamView
  readonly filter: AgentTeamFilterState
  readonly onFilterChange: (next: AgentTeamFilterState) => void
}): JSX.Element {
  const filtered = useMemo(() => filterAgentTeam(team, filter), [team, filter])
  const setMemberFilter = (memberFilter: AgentTeamFilterState['memberFilter']) => onFilterChange({ ...filter, memberFilter })
  const setMemberQuery = (memberQuery: string) => onFilterChange({ ...filter, memberQuery })

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ marginBottom: 8 }}>{searchInput(filter.memberQuery, '搜索成员…', setMemberQuery)}</div>
        {filterGroup('成员筛选', team.quickFilters.memberFilters, filter.memberFilter, key => setMemberFilter(key as AgentTeamFilterState['memberFilter']))}
        <p style={{ fontSize: 12, color: '#64748b' }}>当前显示 {filtered.members.length} / {team.members.length} 个成员</p>
      </div>

      <section>
        <h3>成员</h3>
        {filtered.members.length === 0 ? <p>当前筛选下没有成员。</p> : (
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {filtered.members.map(member => (
              <li key={member.id}>
                <strong>{member.name}</strong>
                {' '}
                {member.role === 'lead' ? pill('Lead', 'neutral') : pill('Teammate', member.phase === 'failed' ? 'danger' : 'good')}
                {' '}
                <span style={{ color: '#475569' }}>session {member.sessionId}</span>
                {' '}
                <span>phase: {member.phase}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>成员负载</h3>
        {filtered.memberLoads.length === 0 ? <p>当前筛选下没有负载数据。</p> : (
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {filtered.memberLoads.map(load => (
              <li key={load.memberId}>
                <strong>{load.memberName}</strong>
                {' '}
                {pill(load.level, loadTone(load.level))}
                {' '}
                <span>active {load.activeTaskCount} / pending-owned {load.pendingOwnedTaskCount}</span>
                {load.stalledTaskCount > 0 ? ` · stalled ${load.stalledTaskCount}` : ''}
                {load.orphanedTaskCount > 0 ? ` · orphaned ${load.orphanedTaskCount}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

function MessagesTab({
  team,
  filter,
  onFilterChange,
}: {
  readonly team: AgentTeamView
  readonly filter: AgentTeamFilterState
  readonly onFilterChange: (next: AgentTeamFilterState) => void
}): JSX.Element {
  const filtered = useMemo(() => filterAgentTeam(team, filter), [team, filter])
  const setMessageFilter = (messageFilter: AgentTeamFilterState['messageFilter']) => onFilterChange({ ...filter, messageFilter })

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div>
        {filterGroup('消息筛选', team.quickFilters.messageFilters, filter.messageFilter, key => setMessageFilter(key as AgentTeamFilterState['messageFilter']))}
        <p style={{ fontSize: 12, color: '#64748b' }}>当前显示 {filtered.messages.length} / {team.messages.length} 条消息</p>
      </div>

      <section>
        <h3>邮箱</h3>
        {filtered.messages.length === 0 ? <p>当前筛选下没有消息。</p> : (
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {filtered.messages.map(message => (
              <li key={message.id}>
                {message.senderName} → {message.targetId}
                {' '}
                {pill(message.delivery === 'wakeup' ? 'Wakeup' : 'Quiet', message.delivery === 'wakeup' ? 'warn' : 'neutral')}
                {' '}
                {message.delivered ? pill('已送达', 'good') : pill('待送达', 'danger')}
                ：{renderInlineContent(message.content)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>消息风险</h3>
        {filtered.messageRisks.length === 0 ? <p>当前筛选下没有消息风险数据。</p> : (
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {filtered.messageRisks.map(risk => (
              <li key={risk.messageId}>
                <strong>{risk.senderName} → {risk.targetId}</strong>
                {' '}
                {pill(risk.riskLevel, riskTone(risk.riskLevel))}
                <div style={{ color: '#475569', marginTop: 4 }}>
                  {risk.reasons.join(' ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

const DAG_COL_WIDTH = 232
const DAG_ROW_HEIGHT = 84
const DAG_NODE_WIDTH = 200
const DAG_NODE_HEIGHT = 56
const DAG_PAD = 24

const dagTonePalette: Record<AgentTeamDagNodeView['tone'], { fill: string, stroke: string, text: string }> = {
  neutral: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#334155' },
  good: { fill: '#f0fdf4', stroke: '#86efac', text: '#166534' },
  warn: { fill: '#fffbeb', stroke: '#fde68a', text: '#92400e' },
  danger: { fill: '#fef2f2', stroke: '#fca5a5', text: '#991b1b' },
}

function DependencyDagTab({ team }: { readonly team: AgentTeamView }): JSX.Element {
  const dag = team.dependencyDag
  const [selected, setSelected] = useState<string | null>(null)

  const positions = useMemo(() => {
    const map = new Map<string, { x: number, y: number }>()
    for (const node of dag.nodes) {
      map.set(node.id, {
        x: DAG_PAD + node.level * DAG_COL_WIDTH,
        y: DAG_PAD + node.position * DAG_ROW_HEIGHT,
      })
    }
    return map
  }, [dag])

  const adjacent = useMemo(() => {
    const set = new Set<string>()
    if (selected !== null) {
      for (const edge of dag.edges) {
        if (edge.from === selected || edge.to === selected) {
          set.add(edge.from)
          set.add(edge.to)
        }
      }
    }
    return set
  }, [dag.edges, selected])

  const maxPerLevel = useMemo(() => {
    let max = 0
    const counts = new Map<number, number>()
    for (const node of dag.nodes) {
      const count = (counts.get(node.level) ?? 0) + 1
      counts.set(node.level, count)
      if (count > max) max = count
    }
    return max
  }, [dag.nodes])

  if (dag.nodes.length === 0) {
    return (
      <section>
        <h3>任务依赖图</h3>
        <p>当前没有任务，暂无可视化依赖关系。</p>
      </section>
    )
  }

  const width = DAG_PAD * 2 + (dag.levels - 1) * DAG_COL_WIDTH + DAG_NODE_WIDTH
  const height = DAG_PAD * 2 + maxPerLevel * DAG_ROW_HEIGHT

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div>
        <h3 style={{ marginBottom: 8 }}>任务依赖图（DAG）</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>
          {dag.nodes.length} 个任务 · {dag.levels} 层 · {dag.edges.length} 条依赖
          {selected !== null ? ' · 点击已选节点可取消高亮' : ' · 点击节点高亮其依赖/下游'}
        </p>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="任务依赖图">
          <defs>
            <marker id="dagArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          {dag.edges.map(edge => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (from === undefined || to === undefined) return null
            const highlighted = selected !== null && (edge.from === selected || edge.to === selected)
            const path = [
              `M ${from.x + DAG_NODE_WIDTH} ${from.y + DAG_NODE_HEIGHT / 2}`,
              `C ${from.x + DAG_NODE_WIDTH + 60} ${from.y + DAG_NODE_HEIGHT / 2},`,
              `${to.x - 60} ${to.y + DAG_NODE_HEIGHT / 2},`,
              `${to.x} ${to.y + DAG_NODE_HEIGHT / 2}`,
            ].join(' ')
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={path}
                fill="none"
                stroke={highlighted ? '#2563eb' : '#94a3b8'}
                strokeWidth={highlighted ? 2.5 : 1.2}
                markerEnd="url(#dagArrow)"
              />
            )
          })}
          {dag.nodes.map(node => {
            const position = positions.get(node.id)
            if (position === undefined) return null
            const palette = dagTonePalette[node.tone]
            const dimmed = selected !== null && !adjacent.has(node.id)
            const isSelected = selected === node.id
            return (
              <g
                key={node.id}
                onClick={() => setSelected(prev => (prev === node.id ? null : node.id))}
                style={{ cursor: 'pointer', opacity: dimmed ? 0.3 : 1 }}
              >
                <title>{`${node.subject}\nstatus: ${node.status}\nowner: ${node.ownerName ?? '未指派'}\n下游依赖: ${node.dependencyDepth}`}</title>
                <rect
                  x={position.x}
                  y={position.y}
                  width={DAG_NODE_WIDTH}
                  height={DAG_NODE_HEIGHT}
                  rx={8}
                  fill={palette.fill}
                  stroke={isSelected ? '#2563eb' : palette.stroke}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text x={position.x + 10} y={position.y + 22} fontSize={13} fontWeight={600} fill={palette.text}>
                  {node.subject.length > 20 ? `${node.subject.slice(0, 20)}…` : node.subject}
                </text>
                <text x={position.x + 10} y={position.y + 42} fontSize={11} fill="#64748b">
                  {node.status}{node.ownerName !== null ? ` · ${node.ownerName}` : ' · 未指派'}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
        节点按依赖层从左到右排列（第 0 层为无依赖任务）；颜色反映任务状态；数字角标语义见任务洞察。
      </p>
    </section>
  )
}

function TimelineTab({ team }: { readonly team: AgentTeamView }): JSX.Element {
  const summary = team.timelineSummary
  const [windowMode, setWindowMode] = useState<'count' | 'time'>('count')
  const milestones = useMemo(
    () => timelineMilestonesView(team.timeline, { mode: windowMode }),
    [team.timeline, windowMode],
  )
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div>
        <h3 style={{ marginBottom: 8 }}>Timeline</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {statCard('事件总数', summary.totalEvents)}
          {statCard('任务事件', summary.taskEvents)}
          {statCard('成员事件', summary.memberEvents)}
          {statCard('消息事件', summary.messageEvents)}
          {statCard('合并条目', summary.coalescedEntries, summary.coalescedEntries > 0 ? 'warn' : 'neutral')}
        </div>
        <p style={{ marginTop: 10, color: '#475569' }}>
          {summary.firstSeq !== null && summary.lastSeq !== null ? `事件序号范围 #${summary.firstSeq} → #${summary.lastSeq}` : '当前时间线缺少事件序号。'}
          {summary.latestTitle !== null ? ` · 最新里程碑：${summary.latestTitle}` : ''}
        </p>
      </div>
      {milestones.length > 0 ? (
        <div>
          <h3 style={{ marginBottom: 8 }}>里程碑窗口（滚动摘要）</h3>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['count', 'time'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setWindowMode(mode)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  background: windowMode === mode ? '#2563eb' : '#f1f5f9',
                  color: windowMode === mode ? '#fff' : '#334155',
                  border: windowMode === mode ? '1px solid #2563eb' : '1px solid #e2e8f0',
                  cursor: 'pointer',
                }}
              >
                {mode === 'count' ? '按行数（8/窗）' : '按时间（1h/窗）'}
              </button>
            ))}
          </div>
          <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
            {milestones.map(window => (
              <li key={window.windowId} style={{
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '8px 10px',
                background: '#fff',
              }}>
                <strong>{window.headline}</strong>
                {' '}
                {pill(window.headlineTone, window.headlineTone)}
                {' '}
                <span style={{ color: '#64748b' }}>
                  {window.startSeq !== null && window.endSeq !== null ? `#${window.startSeq}→#${window.endSeq}` : ''}
                  {' '}
                  {window.entryCount} 行 / {window.eventCount} 事件
                  {' '}
                  · 成员 {window.memberEvents} / 任务 {window.taskEvents} / 消息 {window.messageEvents}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {team.timeline.length === 0 ? <p>暂无时间线数据。</p> : (
        <ul style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
          {team.timeline.map(entry => (
            <li key={entry.id}>
              {entry.seq !== undefined ? pill(`#${entry.seq}`, 'neutral') : null}
              {entry.count !== undefined && entry.count > 1 ? pill(`×${entry.count}`, 'neutral') : null}
              {' '}
              {pill(entry.kind, entry.tone)}
              {' '}
              <strong>{entry.title}</strong>
              {' '}
              <span style={{ color: '#475569' }}>{entry.detail}</span>
              {entry.time !== undefined ? <span style={{ color: '#94a3b8' }}> · t={entry.time}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AgentTeamWorkspace({ useProjection }: ConvViewProps): JSX.Element {
  const team = useProjection('agentTeam')
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [filter, setFilter] = useState<AgentTeamFilterState>(defaultAgentTeamFilterState)

  if (team === undefined || team === null) {
    return (
      <section>
        <h2>Agent Team</h2>
        <p>当前会话没有 Team 数据。</p>
      </section>
    )
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <header>
        <h2 style={{ marginBottom: 8 }}>Agent Team Dashboard</h2>
        <p style={{ margin: 0, color: '#475569' }}>
          Team {team.teamId} · 健康度 {team.summary.healthScore}/100 · {team.summary.statusLabel}
        </p>
      </header>

      {tabBar(tab, setTab)}

      {tab === 'overview' && <OverviewTab team={team} />}
      {tab === 'tasks' && <TasksTab team={team} filter={filter} onFilterChange={setFilter} />}
      {tab === 'dag' && <DependencyDagTab team={team} />}
      {tab === 'members' && <MembersTab team={team} filter={filter} onFilterChange={setFilter} />}
      {tab === 'messages' && <MessagesTab team={team} filter={filter} onFilterChange={setFilter} />}
      {tab === 'timeline' && <TimelineTab team={team} />}
    </section>
  )
}
