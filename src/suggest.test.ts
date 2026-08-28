import { describe, expect, it } from 'vitest'
import {
  ROLE_TITLES,
  suggestAssigneeForTask,
  suggestAssignments,
  suggestRole,
  type SuggestableMember,
} from '../src/suggest.ts'

const member = (name: string, overrides: Partial<SuggestableMember> = {}): SuggestableMember => ({
  name,
  role: 'engineer',
  ...overrides,
})

describe('suggestRole — 任务类型 → 角色推断(纯函数)', () => {
  it('调研类 → researcher', () => {
    const suggestion = suggestRole('竞品调研与拆解分析', '查一下市场资料并输出研究结论')
    expect(suggestion?.role).toBe('researcher')
    expect(suggestion?.roleTitle).toBe(ROLE_TITLES.researcher)
    expect(suggestion?.matchedKeywords.length).toBeGreaterThanOrEqual(3)
  })

  it('实现类 → engineer', () => {
    expect(suggestRole('实现调度器按角色建议任务分配')?.role).toBe('engineer')
    expect(suggestRole('修复登录接口并重构验证模块')?.role).toBe('engineer')
  })

  it('验收类 → qa', () => {
    expect(suggestRole('改进3/4/5 验收')?.role).toBe('qa')
    expect(suggestRole('回归测试与冒烟走查')?.role).toBe('qa')
  })

  it('视觉类 → designer', () => {
    expect(suggestRole('设计团队面板封面与海报')?.role).toBe('designer')
  })

  it('数据类 → data', () => {
    expect(suggestRole('统计团队耗时数据并输出报表')?.role).toBe('data')
  })

  it('文档类 → docs', () => {
    expect(suggestRole('编写 README 与 API 文档')?.role).toBe('docs')
    expect(suggestRole('写一份发布说明和更新日志')?.role).toBe('docs')
  })

  it('数据分析(歧义词)由命中计数决胜 → data', () => {
    // 「分析」命中 researcher,「数据」+「数据分析」命中 data → data 胜。
    expect(suggestRole('数据分析')?.role).toBe('data')
  })

  it('实现并测试(平票)按固定顺序 → engineer 优先于 qa', () => {
    expect(suggestRole('实现功能并测试')?.role).toBe('engineer')
  })

  it('无关键词 → null(不瞎猜)', () => {
    expect(suggestRole('随便做点事情')).toBeNull()
  })

  it('置信度:1 条 → low / 2 条 → medium / ≥3 条 → high', () => {
    expect(suggestRole('部署上线')?.confidence).toBe('low')
    expect(suggestRole('实现并接入')?.confidence).toBe('medium')
    expect(suggestRole('实现、接入接口并部署构建')?.confidence).toBe('high')
  })

  it('英文关键词大小写不敏感', () => {
    expect(suggestRole('Implement the Scheduler')?.role).toBe('engineer')
    expect(suggestRole('Run acceptance TEST for the panel')?.role).toBe('qa')
  })

  it('description 参与推断(标题空泛时靠描述)', () => {
    const suggestion = suggestRole('做一下', '验收面板布局并检查回归用例')
    expect(suggestion?.role).toBe('qa')
  })

  it('安全类任务建议 security 角色(第 7 预设)', () => {
    expect(suggestRole('安全审查')?.role).toBe('security')
    expect(suggestRole('检查权限边界与注入面')?.role).toBe('security')
    expect(suggestRole('Security hardening of the web routes')?.role).toBe('security')
    expect(suggestRole('普通功能开发')?.role).toBe('engineer')
  })

  it('确定性:同一输入两次结果一致', () => {
    const subject = '实现改进:调度器建议任务分配'
    const first = suggestRole(subject, '接入 create_task 并展示建议')
    const second = suggestRole(subject, '接入 create_task 并展示建议')
    expect(second).toEqual(first)
  })
})

describe('suggestAssignments — 任务→建议角色/成员 映射(纯函数)', () => {
  const members: readonly SuggestableMember[] = [
    member('技术员 一号', { role: 'engineer' }),
    member('技术员 二号', { role: 'engineer' }),
    member('侦察参谋 一号', { role: 'researcher' }),
    member('质检员 一号', { role: 'qa' }),
    member('被移除的工程师', { role: 'engineer', status: 'removed' }),
  ]

  it('实现类任务建议 engineer 成员(负载最少优先)', () => {
    const [suggestion] = suggestAssignments(
      [{ id: 't1', subject: '实现调度器建议', status: 'pending' }],
      members,
    )
    expect(suggestion.suggestedRole).toBe('engineer')
    expect(suggestion.suggestedMember).toBe('技术员 一号')
    expect(suggestion.roleTitle).toBe(ROLE_TITLES.engineer)
    expect(suggestion.roleHasMember).toBe(true)
  })

  it('负载均衡:已持有任务的工程师排在空闲者之后', () => {
    const suggestions = suggestAssignments(
      [
        { id: 't0', subject: '进行中任务', status: 'in_progress', assignee: '技术员 一号' },
        { id: 't1', subject: '实现调度器建议', status: 'pending' },
      ],
      members,
    )
    expect(suggestions[1]?.suggestedMember).toBe('技术员 二号')
  })

  it('移除的成员不参与建议', () => {
    const [suggestion] = suggestAssignments(
      [{ id: 't1', subject: '实现调度器建议', status: 'pending' }],
      [member('被移除的工程师', { role: 'engineer', status: 'removed' })],
    )
    expect(suggestion.suggestedRole).toBe('engineer')
    expect(suggestion.suggestedMember).toBeNull()
    expect(suggestion.roleHasMember).toBe(false)
  })

  it('角色匹配但该角色无成员:仍给角色建议,成员为 null', () => {
    const [suggestion] = suggestAssignments(
      [{ id: 't1', subject: '验收面板布局', status: 'pending' }],
      [member('技术员 一号', { role: 'engineer' })],
    )
    expect(suggestion.suggestedRole).toBe('qa')
    expect(suggestion.suggestedMember).toBeNull()
  })

  it('终结态任务不产生建议', () => {
    const [suggestion] = suggestAssignments(
      [{ id: 't1', subject: '实现调度器建议', status: 'completed' }],
      members,
    )
    expect(suggestion.suggestedRole).toBeNull()
    expect(suggestion.confidence).toBeNull()
  })

  it('角色 key 版本后缀归一化(engineer-v2 也能匹配)', () => {
    const [suggestion] = suggestAssignments(
      [{ id: 't1', subject: '实现调度器建议', status: 'pending' }],
      [member('技术员 一号', { role: 'engineer-v2' })],
    )
    expect(suggestion.suggestedMember).toBe('技术员 一号')
  })

  it('确定性:同一输入两次结果一致', () => {
    const tasks = [{ id: 't1', subject: '实现调度器建议', status: 'pending' }]
    expect(suggestAssignments(tasks, members)).toEqual(suggestAssignments(tasks, members))
  })

  it('suggestAssigneeForTask 单任务快捷入口与批量结果一致', () => {
    const task = { id: 't1', subject: '实现调度器建议', status: 'pending' }
    const single = suggestAssigneeForTask(task, members)
    const batch = suggestAssignments([task], members)[0]
    expect(single).toEqual(batch)
  })
})
