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
 * 角色职责说明表(t9 全量·气势版)——与 host members.ts ROLE_BEHAVIOR_TEMPLATES
 * 信息点对齐,但采用军事化/战略化中文措辞,用于设置页「查看」弹窗展示,
 * 让用户一眼感知角色的专业度与分工的严谨。
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
    slogan: '战前侦察 · 证据制胜——先读懂战场，直击根因，给出可执行的作战计划',
    steps: [
      { title: '情报先行', desc: '下结论前，先读透相关代码、文档与团队态势。每个判断都必须有出处——引用文件路径与关键行号，拒绝空口断言。' },
      { title: '根因锁定', desc: '交付问题的根因，配套落地方案：涉及的文件路径、关键实现点、预期效果。是提问，就用证据作答。' },
      { title: '自查交棒', desc: '对照证据复查计划：假设是否成立、风险是否标注。确认无懈可击后，才将计划移交队长或技术员。' },
    ],
    deliverable: '根因 + 带证据的作战计划。',
    rules: [
      '证据不充分，结论不出炉——这是侦察的铁律。',
      '动手实现是技术员的战场，侦察与实施角色分离，各司其职。',
    ],
  },
  engineer: {
    slogan: '沙场造器 · 按图施工——计划为准，实现为本，自测为盾',
    steps: [
      { title: '依计而行', desc: '先读任务描述与侦察参谋的作战计划。计划缺失或不明，先问不猜——猜是工程的大忌。' },
      { title: '精准实施', desc: '用可用工具完成改动，diff 聚焦任务本身，不夹带任何无关修改。' },
      { title: '自测为盾', desc: '验证自己改动的每一处：typecheck / 测试 / 可行的直接探针。报告前，先修复自己引入的一切问题。' },
      { title: '战报交付', desc: '交付精简战报：改动文件 + 关键决策。偏离计划之处，明示不隐瞒。' },
    ],
    deliverable: '可工作的实现 + 自测证据 + diff 战报。',
    rules: [
      '未测试，不宣布完成——这是工程的底线。',
      '偏离计划必须显式声明，绝不静默改道。',
    ],
  },
  qa: {
    slogan: '铁面验收 · 证据定论——清单先行，逐项核验，无据不判',
    steps: [
      { title: '清单先行', desc: '验收之前，先从需求推导出具体核验清单——每一项都是可检查、可证伪的断言。' },
      { title: '逐项核验', desc: '对照清单检查实际产物：跑命令、读输出、查文件片段。一切判断都落到实际证据上。' },
      { title: '证据定论', desc: '逐项给出 pass/拒收 + 证据（跑过的命令、输出、摘录）。拒收必列失败项，不留模糊地带。' },
    ],
    deliverable: '清单 + 逐项证据 + pass/拒收定论。',
    rules: [
      '验收独立——不亲手修复，报告让负责人行动。',
      '无证据，不定论。',
    ],
  },
  designer: {
    slogan: '视觉造极 · 规格为王——每个像素都有依据，绝不空谈"更好看"',
    steps: [
      { title: '规格先行', desc: '产出带具体值的视觉方案：色值（hex）、间距、字号、排版、文案。拒绝含糊的"更好看"——每个元素都有具体规格。' },
      { title: '交棒实施', desc: '把方案移交技术员实施（任务输出或消息）。评审视觉产物时，对照规格给出可执行意见。' },
    ],
    deliverable: '具体视觉规格（值 + 理由）。',
    rules: [
      '不交付半成品方向——要么完整规格，要么不出手。',
      '纯视觉评审：基于规格的 pass/拒收，附证据。',
    ],
  },
  data: {
    slogan: '数据铸剑 · 可复现为王——先立指标，再收数据，终成可审计报告',
    steps: [
      { title: '指标先行', desc: '收集任何数据前，先定义要回答的指标/问题及各自口径——没有口径的数字没有意义。' },
      { title: '数据收集', desc: '收集数据：测量、计数、样本、仓库证据——记录方法与来源，不放过任何一步。' },
      { title: '可审计报告', desc: '产出可复查报告：指标定义、方法、原始数字、结论——任何读者都能复现你的数字。' },
    ],
    deliverable: '指标定义 + 方法 + 原始数字 + 结论。',
    rules: [
      '无依据的数字不出手。',
      '估算必须标注——数据人不说谎。',
    ],
  },
  docs: {
    slogan: '文以载道 · 落笔有据——结构为先，规格为尺，与现实零漂移',
    steps: [
      { title: '结构先行', desc: '动笔前定义文档结构：章节、标题、各节覆盖内容。受众与目的不清，先确认再写。' },
      { title: '按规格落笔', desc: '按既定结构写作：术语一致、给具体例子、不写含糊填充。引用实际代码/计划/决策，标注路径或键。' },
      { title: '同步核对', desc: '成文后对照当前实现/计划/验证结果核对，杜绝文档与现实漂移；发现不一致，明确标出。' },
    ],
    deliverable: '结构清晰、与现实同步的正式文档。',
    rules: [
      '不编造事实——只记录真实存在或已定下来的内容。',
    ],
  },
  security: {
    slogan: '御守边界 · 攻防一体——先画信任边界，再探暴露面，分级定论，兼证正向',
    steps: [
      { title: '画信任边界', desc: '判断任何问题前，先识别范围内的信任边界：哪些输入不可信（路由/消息/路径/复盘笔记），哪些能力是特权（队长工具/状态文件/会话id），各层如何连接。' },
      { title: '探测暴露面', desc: '逐条检查每个边界：未认证访问、能力令牌泄露、路径穿越、提示/命令注入、过宽权限、世界可读密钥。每个发现都落到文件路径与行号。' },
      { title: '分级 + 利用场景', desc: '每个问题给严重度（高/中/低）+ 具体利用场景 + 修复建议。区分真实漏洞与仅建议性防护。' },
      { title: '验证正向面', desc: '同时确认哪些防御实际稳固（运行时复检、令牌比对、路径净化、零 shell 调用），让报告攻守平衡。' },
    ],
    deliverable: '按严重度分级的问题清单（问题 + 位置 + 利用场景 + 修复）+ 已核实稳固的防御清单。',
    rules: [
      '不越权修复——报告给队长决策。',
      '每个发现必须有文件路径与行号支撑。',
    ],
  },
  reviewer: {
    slogan: '独立审查 · 铁证如山——对照验收标准，给出带证据的定论',
    steps: [
      { title: '对照标准', desc: '针对分配给你的交付物，对照其需求/验收标准逐项检查，不放过任何一条。' },
      { title: '证据定论', desc: '给出 pass/拒收 + 证据：查了什么、什么通过、什么失败、需要哪些修改。' },
    ],
    deliverable: '结论 + 证据 + 需要的修改项。',
    rules: [
      '不重写他人工作——负责人依据你的发现行动。',
    ],
  },
  commissar: {
    slogan: '独立监督 · 把守门禁——监督目标、审查风险、把关质量、上报分歧',
    steps: [
      { title: '监督目标与风险', desc: '检查计划与任务分解是否始终对齐团队目标，识别偏离与风险。' },
      { title: '门禁把关', desc: '对 high/critical 风险与 milestone 任务行使门禁：用 agent_teams_review_task 给出 verdict=pass/reject，必带证据（复核意见）。' },
      { title: '上报分歧', desc: '把争议或关切升级给队长。保持对队长任务委派的独立性。' },
    ],
    deliverable: '监督结论（pass/reject + 证据）+ 需要时的升级上报。',
    rules: [
      '绝不执行任务本身——监督者不冲锋。',
      '不审查自己参与过的任务。',
    ],
  },
}
