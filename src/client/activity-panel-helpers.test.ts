/**
 * R-15 ActivityPanel 纯函数层补测(面板此前 0% 覆盖)。
 *
 * 从 ActivityPanel.tsx 导出 9 个纯函数(taskTone/timingData/taskStatusLabel/
 * formatTaskIds/compactTaskLabel/taskSummary/healthLevel/healthRiskCount/
 * loadBarFor),覆盖徽标/健康/负载/摘要计算层;
 * 中间态徽标条件(taskBlockedByReview/taskAwaitingInput/taskPendingCalibration)
 * 已在 task-intermediate.test.ts / task-timing.test.ts 覆盖,本文件锁定
 * 面板对这些条件的消费映射(data-state/data-timing/摘要文本)。
 * @module dsh-agent-team-web/client/activity-panel-helpers
 */

import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { AgentTeamsTranslate } from './locales.ts'

// ActivityPanel 引入的 dsh-client-ui-primitives 带 .module.css(node 环境无法
// 解析外部化包的 CSS);icon 仅作展示,桩为最小 stub 组件。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconBranchOutline16: () => null,
  IconChevronDownOutline14: () => null,
  IconCloseOutline16: () => null,
  IconPanelLeftOutline16: () => null,
}))

import {
  compactTaskLabel,
  dismissalTransition,
  formatTaskIds,
  healthLevel,
  healthRiskCount,
  loadBarFor,
  memberModelLabel,
  taskStatusLabel,
  taskSummary,
  taskTone,
  timingData,
} from './ActivityPanel.tsx'
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { TeamIntelligence } from '../intelligence.ts'

const t: AgentTeamsTranslate = (key, params = {}) => {
  const templates: Record<string, string> = {
    'task.status.pending': '待领取',
    'task.status.claimed': '已认领',
    'task.status.inProgress': '进行中',
    'task.status.completed': '已完成',
    'task.status.failed': '失败',
    'task.status.cancelled': '已取消',
    'format.listSeparator': '、',
    'task.summary.waitingBreakdown': '等待拆解任务',
    'task.summary.allDelivered': '全部交付({count})',
    'task.summary.blockedAndRunning': '阻塞 {tasks} 同时进行中{more}',
    'task.summary.more': '等 {count} 个',
    'task.summary.running': '进行中:{tasks}',
    'task.summary.ready': '待领取:{tasks}',
    'task.summary.blocked': '阻塞:{tasks}',
    'task.summary.waitingSchedule': '等待排期',
  }
  const template = templates[key]
  if (template === undefined) return key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
}

function task(id: string, overrides: Partial<ActivityTask> = {}): ActivityTask {
  return {
    id,
    subject: `任务${id}`,
    status: 'in_progress',
    state: 'running',
    assignee: '技术员',
    dependencies: [],
    depth: 0,
    ...overrides,
  }
}

function team(overrides: Partial<ActivityTeam> = {}): ActivityTeam {
  return {
    workspace: 'ws',
    teamId: 'team-a',
    name: '测试团队',
    captainSessionId: 'cap',
    members: [],
    tasks: [],
    messageCount: 0,
    captainInbox: [],
    ...overrides,
  }
}

describe('taskTone — 徽标着色(状态宽化)', () => {
  it('failed/cancelled 覆盖视觉状态,其余透传 state', () => {
    expect(taskTone('running', 'in_progress')).toBe('running')
    expect(taskTone('open', 'pending')).toBe('open')
    expect(taskTone('running', 'failed')).toBe('failed')
    expect(taskTone('open', 'cancelled')).toBe('cancelled')
    expect(taskTone('completed', 'completed')).toBe('completed')
  })
})

describe('timingData — 超时档位(面板 data-timing 消费)', () => {
  it('无预估恒为 ok;超预算为 warn;超 1.5 倍为 over', () => {
    expect(timingData(task('t1'))).toBe('ok')
    // S 预算 15m:已用 ~20m > 15m 且 <= 22.5m → warn(宽边界,Date.now 竞态可忽略)。
    expect(timingData(task('t2', { estimateLevel: 'S', claimedAt: Date.now() - 20 * 60_000 }))).toBe('warn')
    // 已用 ~30m > 22.5m → over。
    expect(timingData(task('t3', { estimateLevel: 'S', claimedAt: Date.now() - 30 * 60_000 }))).toBe('over')
    expect(timingData(task('t4', { estimateLevel: 'S', claimedAt: 0 }))).toBe('over')
  })
})

describe('taskStatusLabel / formatTaskIds — 展示文本', () => {
  it('已知状态映射本地化,未知状态原样返回', () => {
    expect(taskStatusLabel('completed', t)).toBe('已完成')
    expect(taskStatusLabel('failed', t)).toBe('失败')
    expect(taskStatusLabel('mystery', t)).toBe('mystery')
  })

  it('任务 id 列表按本地分隔符连接', () => {
    expect(formatTaskIds(['t1', 't2', 't3'], t)).toBe('t1、t2、t3')
  })
})

describe('compactTaskLabel — 紧凑标题', () => {
  it('剥离开发前缀与序号前缀,截断超长', () => {
    expect(compactTaskLabel('开发调度器')).toBe('调度器')
    expect(compactTaskLabel('3. 修复登录')).toBe('修复登录')
    expect(compactTaskLabel('实现异步队列与背压控制并补充集成测试的回归用例')).toBe('实现异步队列与背压控制并补充集成测…')
    expect(compactTaskLabel('普通标题')).toBe('普通标题')
  })
})

describe('taskSummary — 团队摘要(徽标旁的聚合文本)', () => {
  it('空团队/全完成/阻塞+进行中/进行中/待领取/阻塞 六态', () => {
    expect(taskSummary(team(), t)).toBe('等待拆解任务')
    expect(taskSummary(team({ tasks: [task('t1', { status: 'completed', state: 'completed' })] }), t))
      .toBe('全部交付(1)')
    expect(taskSummary(team({
      tasks: [
        task('t1', { state: 'blocked' }),
        task('t2', { state: 'running' }),
      ],
    }), t)).toBe('阻塞 t1 同时进行中')
    expect(taskSummary(team({ tasks: [task('t1', { state: 'running' })] }), t)).toBe('进行中:t1')
    expect(taskSummary(team({ tasks: [task('t1', { status: 'pending', state: 'open' })] }), t)).toBe('待领取:t1')
    expect(taskSummary(team({ tasks: [task('t1', { state: 'blocked' })] }), t)).toBe('阻塞:t1')
    expect(taskSummary(team({ tasks: [task('t1', { status: 'completed', state: 'completed' })] }), t)).toBe('全部交付(1)')
  })
})

describe('healthLevel / healthRiskCount — 健康与风险', () => {
  it('阈值:<50 critical,<80 warn,其余 ok', () => {
    expect(healthLevel(49)).toBe('critical')
    expect(healthLevel(50)).toBe('warn')
    expect(healthLevel(79)).toBe('warn')
    expect(healthLevel(80)).toBe('ok')
    expect(healthLevel(100)).toBe('ok')
  })

  it('仅统计 high 风险消息;无 intelligence 为 0', () => {
    const intelligence = {
      messageRisks: [
        { riskLevel: 'high' }, { riskLevel: 'medium' }, { riskLevel: 'high' },
      ],
    } as unknown as TeamIntelligence
    expect(healthRiskCount(team({ intelligence }))).toBe(2)
    expect(healthRiskCount(team())).toBe(0)
  })
})

describe('loadBarFor — 成员负载条', () => {
  const member: ActivityMember = {
    id: 'm1', name: '技术员', role: 'engineer', activity: 'working',
    progress: 0, done: 0, total: 0, currentTask: '', currentTaskElapsedMs: 0,
    currentTaskElapsedApprox: false, unread: 0,
  }

  it('有负载数据时输出四段比例与档位;无数据返回 null', () => {
    const intelligence = {
      memberLoads: [
        {
          memberId: 'm1', memberName: '技术员',
          activeTaskCount: 1, pendingOwnedTaskCount: 1, stalledTaskCount: 1, orphanedTaskCount: 1,
          level: 'overloaded',
        },
      ],
    } as unknown as TeamIntelligence
    const bar = loadBarFor(team({ intelligence }), member)
    expect(isValidElement(bar)).toBe(true)
    const props = (bar as never as { props: Record<string, unknown> }).props
    expect(props['data-level']).toBe('overloaded')
    expect(props['role']).toBe('img')
    expect(String(props['title'])).toContain('技术员')
    // 四段各 25%。
    const segments = props['children'] as Array<{ props: { style: { width: string } } }>
    expect(segments).toHaveLength(4)
    for (const segment of segments) expect(segment.props.style.width).toBe('25%')

    expect(loadBarFor(team(), member)).toBeNull()
  })

  it('负载全零时不渲染(避免除零)', () => {
    const intelligence = {
      memberLoads: [
        {
          memberId: 'm1', memberName: '技术员',
          activeTaskCount: 0, pendingOwnedTaskCount: 0, stalledTaskCount: 0, orphanedTaskCount: 0,
          level: 'idle',
        },
      ],
    } as unknown as TeamIntelligence
    expect(loadBarFor(team({ intelligence }), member)).toBeNull()
  })
})

describe('memberModelLabel — 成员模型小字(t7 最终格式 ds-v4-flash · high)', () => {
  it('deepseek-official:品牌 ds + 模型去 provider 前缀段', () => {
    expect(memberModelLabel('deepseek-official', 'deepseek-v4-flash', 'high')).toBe('ds-v4-flash · high')
    expect(memberModelLabel('deepseek-official', 'deepseek-v4-pro', undefined)).toBe('ds-v4-pro')
    expect(memberModelLabel('deepseek-official', 'deepseek-v4-flash-vision-exp', 'low')).toBe('ds-v4-flash-vision-exp · low')
  })

  it('其他 provider:品牌取 id 首段,模型带该前缀则去前缀,否则保留完整', () => {
    expect(memberModelLabel('kimi-coding', 'kimi-k2.7-code', 'high')).toBe('kimi-k2.7-code · high')
    expect(memberModelLabel('xiaomi', 'custom-model', 'max')).toBe('custom-model · max')
  })

  it('自定义/未知 provider 保留完整模型 id;effort 缺失不加后缀', () => {
    expect(memberModelLabel('my-provider', 'my-model-v1', 'off')).toBe('my-model-v1 · off')
    expect(memberModelLabel(undefined, 'plain-model', 'high')).toBe('plain-model · high')
    expect(memberModelLabel('deepseek-official', 'deepseek-v4-flash', '')).toBe('ds-v4-flash')
  })

  it('model 缺失/空白 → null(旧数据不显示小字)', () => {
    expect(memberModelLabel('deepseek-official', undefined, 'high')).toBeNull()
    expect(memberModelLabel('deepseek-official', '  ', 'high')).toBeNull()
    expect(memberModelLabel(undefined, undefined, undefined)).toBeNull()
  })
})

describe('dismissalTransition — 删除后完全消失状态机(t24)', () => {
  it('从未有过活动团队 + 无团队 → 保持原状(交给 !hasTeams 门控)', () => {
    expect(dismissalTransition({ hadLive: false, dismissed: false }, 0))
      .toEqual({ hadLive: false, dismissed: false })
  })

  it('有活动团队 → hadLive 置位、dismissed 复位(新团队出现面板恢复)', () => {
    expect(dismissalTransition({ hadLive: false, dismissed: false }, 1))
      .toEqual({ hadLive: true, dismissed: false })
    expect(dismissalTransition({ hadLive: true, dismissed: true }, 1))
      .toEqual({ hadLive: true, dismissed: false })
  })

  it('活动团队从有变无(删除)→ dismissed=true 完全消失(即使归档区非空)', () => {
    expect(dismissalTransition({ hadLive: true, dismissed: false }, 0))
      .toEqual({ hadLive: true, dismissed: true })
    // 已 dismissed 后仍无团队 → 保持完全消失。
    expect(dismissalTransition({ hadLive: true, dismissed: true }, 0))
      .toEqual({ hadLive: true, dismissed: true })
  })
})
