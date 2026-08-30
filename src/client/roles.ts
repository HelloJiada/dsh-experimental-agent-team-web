/**
 * Military-role display titles for member roles: canonical role keys stay
 * English in the data layer; the UI renders the localized title instead.
 * The preset catalog is the captain, the 7 behavioral executing roles
 * (researcher / engineer / qa / designer / data / docs / security), the task-level reviewer,
 * and the commissar. operator is not preset — it is a
 * custom role with no dedicated seat or behavior template — but its
 * display title is kept in the tables so legacy members and custom role
 * strings still resolve (降级 = 不出现在预设清单/协议/模板, 不是删除显示映射).
 * @module dsh-agent-team-web/client/roles
 */

import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'
import { zh } from './locales.ts'

/** Canonical role key → military-title locale key (see `role.*` in locales.ts).
 * Preset: captain + the 7 behavioral executing roles + reviewer + commissar.
 * operator is a compatibility entry for legacy members and
 * custom role strings (not preset, no dedicated seat or behavior template). */
export const ROLE_TITLE_KEY: Record<string, AgentTeamsLocaleKey> = {
  captain: 'role.captain',
  researcher: 'role.researcher',
  engineer: 'role.engineer',
  qa: 'role.qa',
  designer: 'role.designer',
  data: 'role.data',
  docs: 'role.docs',
  reviewer: 'role.reviewer',
  commissar: 'role.commissar',
  security: 'role.security',
  operator: 'role.operator',
}

/** Normalize a role/name for canonical-key lookup: lowercase, trim, and
 * strip display suffixes such as `-v2` / `_v2`. */
function canonicalKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+v2$/, '').trim()
}

/**
 * Member role display title: canonical keys map to the localized military
 * title; anything unknown falls back to the raw role text (never blank,
 * never throws).
 */
export function roleTitle(role: string, t: AgentTeamsTranslate): string {
  const key = ROLE_TITLE_KEY[canonicalKey(role)]
  return key === undefined ? role : t(key)
}

/**
 * Member name display title: when a member is named after a canonical role
 * key (or a display variant such as `engineer-v2`), show the localized
 * military title instead of the raw English key. Any other name (real
 * person, mailbox address, …) is returned unchanged — the data layer's
 * assignee matching and prompt identity keep using the original name.
 */
export function nameTitle(name: string, t: AgentTeamsTranslate): string {
  const key = ROLE_TITLE_KEY[canonicalKey(name)]
  return key === undefined ? name : t(key)
}

/** A Chinese-ordinal suffix like `一号` / `二号` / `十号` (also tolerates a
 * leading space and legacy no-space names). */
const ORDINAL_SUFFIX = /^(?:\s*[一二三四五六七八九十]+\d*号)$/

/** True when the name itself is a canonical role name — the role title is
 * then already expressed by the name, so the role chip can be omitted.
 * Recognizes both plain role names (`技术员`, `engineer`) and auto-numbered
 * names (`技术员 一号`, legacy `技术员一号`). */
export function isRoleName(name: string): boolean {
  const raw = name.trim()
  if (raw === '') return false
  if (ROLE_TITLE_KEY[canonicalKey(raw)] !== undefined) return true
  for (const localeKey of Object.values(ROLE_TITLE_KEY)) {
    const title = (zh as Record<string, string>)[localeKey]
    if (title === undefined) continue
    if (raw === title) return true
    const withoutPrefix = raw.startsWith(title) ? raw.slice(title.length) : ''
    if (withoutPrefix !== '' && ORDINAL_SUFFIX.test(withoutPrefix)) return true
  }
  return false
}


/**
 * 角色职责说明表(t9 全量版)——与 host members.ts ROLE_BEHAVIOR_TEMPLATES
 * 逐点对齐的中文完整版,供设置页「查看」弹窗展示。每个角色包含:
 * 定位(slogan) + 工作顺序(steps, 完整步骤) + 交付物(deliverable) +
 * 核心准则(rules, 行为红线/关键约定)。
 */
export interface RoleDuty {
  readonly slogan: string
  readonly steps: readonly { readonly title: string; readonly desc: string }[]
  readonly deliverable: string
  readonly rules: readonly string[]
}

/** 已知角色职责(查看弹窗展示);未知角色缺省为 undefined(弹窗不展示职责区)。 */
export const ROLE_DUTY: Readonly<Record<string, RoleDuty>> = {
  researcher: {
    slogan: '想清楚：先读代码/文档 → 定位根因 → 给出计划 → 自查交棒',
    steps: [
      { title: '先读再想', desc: '下任何结论或计划之前，先读相关代码、文档和团队状态。每个判断都要有出处——引用文件路径和关键行。' },
      { title: '根因 + 计划', desc: '交付问题的根因，然后是具体计划：涉及的文件路径、关键实现点、预期效果。如果任务是提问，就用证据回答。' },
      { title: '自查后交棒', desc: '对照证据复查自己的计划是否成立：假设是否合理、风险是否已标注。确认后再交棒（写入任务输出或发给队长/技术员）。' },
    ],
    deliverable: '根因 + 带证据的具体计划。',
    rules: [
      '不直接动手实现——实现是技术员的职责，两角色分离。',
      '拿不准的证据不要当作结论；标注假设与风险。',
    ],
  },
  engineer: {
    slogan: '做出来：按计划实现 → 自测 → 交付摘要',
    steps: [
      { title: '按计划行事', desc: '先读任务描述（及侦察参谋的计划）。计划缺失或不清晰时先问，不要猜。' },
      { title: '实现', desc: '用可用工具完成改动，diff 聚焦在任务范围内，不夹带无关修改。' },
      { title: '自测', desc: '验证自己改了什么：typecheck / 测试 / 可行的直接探针。报告前先修复自己引入的问题。' },
      { title: '交付摘要', desc: '报告精简摘要：改动文件 + 关键决策。偏离计划的任何地方都要明确标注。' },
    ],
    deliverable: '可工作的实现 + 自测证据 + diff 摘要。',
    rules: [
      '未测试不宣布完成。',
      '偏离计划必须显式说明，不能静默改道。',
    ],
  },
  qa: {
    slogan: '验明白：先列验收清单 → 逐项核验 → 带证据的结论',
    steps: [
      { title: '清单先行', desc: '验收之前，先从需求推导出具体的核验清单——每一项都是可检查的断言。' },
      { title: '逐项核验', desc: '对照清单检查实际产物：运行命令、读输出、检查文件片段。每一项都要落到实际证据。' },
      { title: '带证据结论', desc: '逐项给出 pass/拒收 + 证据（跑过的命令、输出、摘录）。拒收时列出具体失败项。' },
    ],
    deliverable: '清单 + 逐项证据 + pass/拒收结论。',
    rules: [
      '不亲自修问题——报告发现让负责人处理，保持验收独立性。',
      '没有证据不下结论。',
    ],
  },
  designer: {
    slogan: '好看：先给具体视觉方案 → 交棒实施',
    steps: [
      { title: '具体视觉方案', desc: '产出带具体值的视觉/UX 方案：颜色（hex）、间距、字号、排版、文案。拒绝含糊的"更好看"——每个元素都要有具体规格。' },
      { title: '交棒', desc: '把方案交给技术员实施（任务输出或消息）。评审视觉产物时，对照具体规格给出可执行意见。' },
    ],
    deliverable: '具体视觉规格（值 + 理由）。',
    rules: [
      '不交付半成品方向。',
      '纯视觉评审时，给出基于规格的 pass/拒收 + 证据。',
    ],
  },
  data: {
    slogan: '算清楚：先定义指标 → 收集 → 可审计报告',
    steps: [
      { title: '先定义指标', desc: '收集任何数据前，先说明要回答的指标/问题及各自如何定义。' },
      { title: '收集', desc: '收集数据：测量、计数、样本或仓库证据——记录方法与来源。' },
      { title: '可审计报告', desc: '产出可复查的报告：指标定义、方法、原始数字、结论——足够让其他人复现你的数字。' },
    ],
    deliverable: '指标定义 + 方法 + 原始数字 + 结论。',
    rules: [
      '不提供无依据的数字。',
      '估算必须标注为估算。',
    ],
  },
  docs: {
    slogan: '写明白：先定结构 → 按规格写 → 与现实同步核对',
    steps: [
      { title: '结构先行', desc: '动笔前先定义文档结构（章节、标题、各节内容覆盖什么）。受众/目的不清时先确认。' },
      { title: '按规格写', desc: '按既定结构与规格写作：术语一致、给具体例子、不写含糊填充。引用实际代码/计划/决策（标注路径或键）。' },
      { title: '同步核对', desc: '成文后对照当前实现/计划/验证结果核对，确保文档不偏离现实；发现不一致要标出。' },
    ],
    deliverable: '结构清晰、准确的正式文档（设计稿/手册/变更记录/笔记）。',
    rules: [
      '不编造事实——只记录实际存在或已决定的内容。',
    ],
  },
  security: {
    slogan: '护边界：画信任边界 → 探测暴露面 → 分级结论（含利用场景）→ 验证正向面',
    steps: [
      { title: '先画信任边界', desc: '判断任何问题前，先识别范围内的信任边界：哪些输入不可信（web 路由、成员消息、文件路径、复盘笔记），哪些能力是特权（队长专属工具、状态文件、会话 id），各层如何连接。' },
      { title: '探测暴露面', desc: '逐条检查每个边界：未认证访问、能力令牌泄露（任何读者可见的写权限值）、路径穿越、注入提示/命令、过宽权限、世界可读的密钥。每个发现都要落到文件路径和行号。' },
      { title: '分级 + 利用场景', desc: '每个问题给严重度（高/中/低）+ 具体利用场景 + 修复建议。区分真实漏洞与仅建议性防护。' },
      { title: '验证正向面', desc: '同时确认什么实际是稳的（运行时复检、令牌比对、路径净化、零 shell 调用），让报告平衡。' },
    ],
    deliverable: '按严重度分级的问题清单（问题 + 位置 + 利用场景 + 修复建议）+ 已核实稳固的防御清单。',
    rules: [
      '不自己修问题——报告给队长决策。',
      '每个发现必须有文件路径和行号支撑。',
    ],
  },
  reviewer: {
    slogan: '审查员：任务级动态角色，专项复核他人工作',
    steps: [
      { title: '对照验收标准', desc: '针对分配给你的具体交付物，对照其需求/验收标准逐项检查。' },
      { title: '带证据结论', desc: '给出 pass/拒收结论 + 证据：查了什么、什么通过、什么失败、需要哪些修改。' },
    ],
    deliverable: '结论 + 证据 + 需要的修改项。',
    rules: [
      '不重写他人工作——负责人根据你的发现行动。',
    ],
  },
  commissar: {
    slogan: '独立监督：监督目标 · 审查风险 · 把关质量 · 上报分歧（不执行任务）',
    steps: [
      { title: '监督目标对齐与风险', desc: '检查计划与任务分解是否始终对齐团队目标；识别风险。' },
      { title: '门禁把关', desc: '对 high/critical 风险与 milestone 任务行使门禁：用 agent_teams_review_task 给 verdict=pass/reject，必须带证据（复核意见）。' },
      { title: '上报分歧', desc: '把争议或关切升级给队长。保持对队长任务委派的独立性。' },
    ],
    deliverable: '监督结论（pass/reject + 证据）+ 需要时的升级上报。',
    rules: [
      '绝不执行任务工作本身——政委是监督角色，不是执行者。',
      '不审查自己参与过的任务。',
    ],
  },
}
