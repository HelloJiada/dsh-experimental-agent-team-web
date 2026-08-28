/**
 * 调度器按角色能力建议任务分配(改进方向 3 —— 队长负载缓解)。
 *
 * 队长建任务/看状态时,由纯函数根据任务标题与描述推断合适角色
 * (调研类→researcher、实现类→engineer、验收类→qa、视觉类→designer、
 * 数据类→data),输出「任务→建议角色/成员」映射,供队长参考确认。
 *
 * 设计约束:
 * - 只建议、不派单:本模块不写状态、不触发认领;队长确认后仍走现有
 *   assignee 流程(保持队长决策权)。
 * - 纯函数、只读、无 I/O、确定性:同一输入永远同一输出,可单测。
 * - 关键词命中计数决定角色与置信度:命中 0 条 → 不推荐(null);
 *   命中 1/2/≥3 条 → low/medium/high。平票时按固定角色顺序取先者。
 *
 * @module dsh-agent-team-web/suggest
 */

/** 预设可建议的 6 个执行角色(与预设行为角色一一对应)。 */
export type SuggestedRole = 'researcher' | 'engineer' | 'qa' | 'designer' | 'data' | 'docs'

/** 建议置信度:命中关键词条数 1/2/≥3 → low/medium/high。 */
export type SuggestionConfidence = 'low' | 'medium' | 'high'

/** 固定角色顺序:平票时先者胜(engineer 优先于 qa,researcher 优先于 data)。 */
export const SUGGESTED_ROLES: readonly SuggestedRole[] = [
  'researcher',
  'engineer',
  'qa',
  'designer',
  'data',
  'docs',
]

/** 角色 key → 中文军职标题(展示用,与 client/roles 的军职表一致)。 */
export const ROLE_TITLES: Readonly<Record<SuggestedRole, string>> = {
  researcher: '侦察参谋',
  engineer: '技术员',
  qa: '质检员',
  designer: '文宣干事',
  data: '情报分析员',
  docs: '文书',
}

/** 单角色命中结果。 */
export interface RoleSuggestion {
  readonly role: SuggestedRole
  /** 中文军职标题,如「技术员」。 */
  readonly roleTitle: string
  readonly confidence: SuggestionConfidence
  /** 命中的关键词原文(解释/调试用)。 */
  readonly matchedKeywords: readonly string[]
  /** 命中关键词条数(置信度依据)。 */
  readonly matchCount: number
}

/** 成员的结构化最小视图(与 TeamMember/快照成员形状兼容,保持模块解耦)。 */
export interface SuggestableMember {
  readonly name: string
  readonly role?: string
  readonly status?: string
}

/** 任务的结构化最小视图(与 TeamTask/快照任务形状兼容)。 */
export interface SuggestableTask {
  readonly id: string
  readonly subject: string
  readonly description?: string
  readonly status?: string
  readonly assignee?: string
}

/** 「任务→建议角色/成员」映射项。 */
export interface TaskAssigneeSuggestion {
  readonly taskId: string
  readonly subject: string
  /** null = 关键词未命中任何角色,不推荐。 */
  readonly suggestedRole: SuggestedRole | null
  /** 建议角色的中文标题;无建议时为 null。 */
  readonly roleTitle: string | null
  /** 该角色在场的成员名(按负载最少挑选);该角色无成员时为 null。 */
  readonly suggestedMember: string | null
  readonly confidence: SuggestionConfidence | null
  readonly matchedKeywords: readonly string[]
  /** 是否真有该角色成员可派(区分「角色没匹配」与「角色匹配但无人可派」)。 */
  readonly roleHasMember: boolean
}

/**
 * 角色 → 关键词表。中英文混合,匹配时统一转小写子串命中。
 * 关键词尽量互斥;含歧义词(如「分析」)时靠命中计数决胜:
 * 「数据分析」→ data(数据+数据分析) 压过 researcher(分析)。
 */
const ROLE_KEYWORDS: Readonly<Record<SuggestedRole, readonly string[]>> = {
  researcher: [
    '调研', '研究', '调查', '拆解', '拆文', '扫榜', '检索', '搜索', '查一下',
    '竞品', '文献', '资料', '想清楚', '根因', '分析', '方案调研',
    'research', 'investigat', 'survey', 'study', 'analy', 'analysis', 'root cause',
  ],
  engineer: [
    '实现', '开发', '编码', '写代码', '编程', '修改', '修复', '重构',
    '改造', '接入', '集成', '部署', '构建', '编译', '调试', '接口', '模块',
    '代码', '功能', '写一个', '后端', '前端',
    'implement', 'build', 'code', 'fix', 'refactor', 'develop', 'dev', 'patch',
  ],
  qa: [
    '验收', '测试', '验证', '质检', '检查', '回归', '冒烟', '走查', '核对',
    '用例', '通过标准', '回归测试',
    'test', 'verify', 'validat', 'qa', 'checklist',
  ],
  designer: [
    '视觉', '设计', '封面', '海报', '图标', '图片', '插画', '排版', '美化',
    '样式', '皮肤', '配色', '字体', '美工',
    'draw', 'design', 'ui', 'ux', 'artwork',
  ],
  data: [
    '数据', '统计', '指标', '报表', '榜单', '排行', '量化', '爬取', '采集',
    '数据集', '度量', '数据分析',
    'metrics', 'data', 'stats', 'scrape', 'crawl',
  ],
  docs: [
    '文档', '编写', '撰写', '说明书', '手册', '指南', '发布说明', '更新日志',
    'changelog', '笔记', '记录', 'readme', 'API 文档', '注释',
    'document', 'write', 'manual', 'readme', 'guide',
  ],
}

/** 命中条数 → 置信度:1/2/≥3 → low/medium/high。 */
function confidenceOf(matchCount: number): SuggestionConfidence {
  if (matchCount >= 3) return 'high'
  if (matchCount === 2) return 'medium'
  return 'low'
}

/**
 * 根据任务标题与描述推断合适角色。纯函数。
 * 命中 0 条关键词 → null(不推荐,避免瞎猜)。
 * 平票时按 SUGGESTED_ROLES 固定顺序取先者(确定性)。
 */
export function suggestRole(subject: string, description?: string): RoleSuggestion | null {
  const text = `${subject} ${description ?? ''}`.toLowerCase()
  let best: RoleSuggestion | null = null
  for (const role of SUGGESTED_ROLES) {
    const matched = ROLE_KEYWORDS[role].filter(keyword => text.includes(keyword))
    if (matched.length === 0) continue
    if (best === null || matched.length > best.matchCount) {
      best = {
        role,
        roleTitle: ROLE_TITLES[role],
        confidence: confidenceOf(matched.length),
        matchedKeywords: matched,
        matchCount: matched.length,
      }
    }
  }
  return best
}

/** 终结态任务不参与建议。 */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/** 角色 key 归一化:小写、去空白、去版本后缀(engineer-v2 → engineer)。 */
function canonicalRoleKey(role: string): string {
  return role.trim().toLowerCase().replace(/[-_]\s*v\d+$/, '').trim()
}

/**
 * 对一组任务批量输出「任务→建议角色/成员」映射。纯函数。
 *
 * 成员挑选:建议角色在场的活跃成员(status ≠ 'removed')中,取未终结任务
 * 持有数最少者(负载均衡);平手按名字字典序(确定性)。
 * 只做建议:返回的 suggestedMember 不会被写入任何状态。
 */
export function suggestAssignments(
  tasks: readonly SuggestableTask[],
  members: readonly SuggestableMember[],
): TaskAssigneeSuggestion[] {
  const roleMembers = new Map<string, readonly SuggestableMember[]>()
  for (const member of members) {
    if (member.status === 'removed' || member.role === undefined || member.role.trim() === '') continue
    const key = canonicalRoleKey(member.role)
    const list = roleMembers.get(key) ?? []
    roleMembers.set(key, [...list, member])
  }

  // 每位成员的未终结任务持有数(负载线索,与任务快照一致的口径)。
  const openCount = new Map<string, number>()
  for (const task of tasks) {
    if (task.status !== undefined && TERMINAL_TASK_STATUSES.has(task.status)) continue
    if (task.assignee === undefined || task.assignee === '') continue
    openCount.set(task.assignee, (openCount.get(task.assignee) ?? 0) + 1)
  }

  const pickMember = (role: SuggestedRole): string | null => {
    const candidates = roleMembers.get(role) ?? []
    if (candidates.length === 0) return null
    // 负载最少者优先;平手按名字码点序(确定性,不依赖 ICU 拼音排序)。
    const leastLoaded = [...candidates].sort((left, right) =>
      (openCount.get(left.name) ?? 0) - (openCount.get(right.name) ?? 0)
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))[0]
    return leastLoaded?.name ?? null
  }

  return tasks.map((task) => {
    if (task.status !== undefined && TERMINAL_TASK_STATUSES.has(task.status)) {
      return {
        taskId: task.id,
        subject: task.subject,
        suggestedRole: null,
        roleTitle: null,
        suggestedMember: null,
        confidence: null,
        matchedKeywords: [],
        roleHasMember: false,
      }
    }
    const suggestion = suggestRole(task.subject, task.description)
    if (suggestion === null) {
      return {
        taskId: task.id,
        subject: task.subject,
        suggestedRole: null,
        roleTitle: null,
        suggestedMember: null,
        confidence: null,
        matchedKeywords: [],
        roleHasMember: false,
      }
    }
    const member = pickMember(suggestion.role)
    return {
      taskId: task.id,
      subject: task.subject,
      suggestedRole: suggestion.role,
      roleTitle: suggestion.roleTitle,
      suggestedMember: member,
      confidence: suggestion.confidence,
      matchedKeywords: suggestion.matchedKeywords,
      roleHasMember: member !== null,
    }
  })
}

/** 单任务快捷建议(create_task 未指定 assignee 时使用)。 */
export function suggestAssigneeForTask(
  task: SuggestableTask,
  members: readonly SuggestableMember[],
): TaskAssigneeSuggestion {
  return suggestAssignments([task], members)[0] ?? {
    taskId: task.id,
    subject: task.subject,
    suggestedRole: null,
    roleTitle: null,
    suggestedMember: null,
    confidence: null,
    matchedKeywords: [],
    roleHasMember: false,
  }
}
