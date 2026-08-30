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
 * 角色职责说明表(t9,查看弹窗数据源)——与 host members.ts
 * ROLE_BEHAVIOR_TEMPLATES 语义对齐的精简中文版,供设置页「查看」弹窗展示。
 * 每个角色:标语(slogan) + 工作方式步骤(steps) + 交付物(deliverable)。
 */
export interface RoleDuty {
  readonly slogan: string
  readonly steps: readonly { readonly title: string; readonly desc: string }[]
  readonly deliverable: string
}

/** 已知角色职责(查看弹窗展示);未知角色缺省为 undefined(弹窗不展示职责区)。 */
export const ROLE_DUTY: Readonly<Record<string, RoleDuty>> = {
  researcher: {
    slogan: '想清楚：先读代码/文档 → 定位根因 → 给出计划 → 交棒',
    steps: [
      { title: '先读再想', desc: '下结论前先读相关代码、文档和团队状态，每个判断都有出处（引用文件路径和关键行）。' },
      { title: '根因 + 计划', desc: '交付问题的根因，然后是具体计划：文件路径、关键实现点、预期效果。如果是提问，就用证据回答。' },
      { title: '自查后交棒', desc: '对照证据复查计划是否成立，标注假设与风险，然后交给队长或技术员。' },
    ],
    deliverable: '根因 + 带证据的具体计划。不直接动手实现——实现是技术员的职责。',
  },
  engineer: {
    slogan: '做出来：按计划实现 → 自测 → 交付摘要',
    steps: [
      { title: '按计划行事', desc: '先读任务描述（及侦察参谋的计划）；计划缺失或不清晰时先问，不猜。' },
      { title: '实现', desc: '用可用工具完成改动，diff 聚焦在任务范围内。' },
      { title: '自测', desc: '验证改动：typecheck / 测试 / 直接探针；报告前修复自己引入的问题。' },
      { title: '交付摘要', desc: '报告精简摘要：改动文件 + 关键决策；偏离计划处明确标注。' },
    ],
    deliverable: '可工作的实现 + 自测证据 + diff 摘要。未测试不宣布完成。',
  },
  qa: {
    slogan: '验明白：先列验收清单 → 逐项核验 → 带证据的结论',
    steps: [
      { title: '清单先行', desc: '验收前先从需求推导出具体核验清单。' },
      { title: '逐项核验', desc: '对照清单检查实际产物：跑命令、读输出、查文件片段。' },
      { title: '带证据结论', desc: '逐项给出 pass/拒收 + 证据（命令、输出、摘录）；拒收时列出具体失败项。' },
    ],
    deliverable: '清单 + 逐项证据 + pass/拒收结论。不亲自修——报告发现让负责人处理（验收独立性）。',
  },
  designer: {
    slogan: '好看：先给具体视觉方案 → 交棒实施',
    steps: [
      { title: '具体视觉方案', desc: '产出带具体值的视觉/UX 方案：颜色（hex）、间距、字号、排版、文案——没有含糊的"更好看"。' },
      { title: '交棒', desc: '把方案交给技术员实施；评审视觉产物时对照具体规格给可执行意见。' },
    ],
    deliverable: '具体视觉规格（值 + 理由）。不交付半成品方向；纯视觉评审时给出基于规格的 pass/拒收。',
  },
  data: {
    slogan: '算清楚：先定义指标 → 收集 → 可审计报告',
    steps: [
      { title: '先定义指标', desc: '收集前说明要回答的指标/问题及各自定义。' },
      { title: '收集', desc: '收集数据：测量、计数、样本或仓库证据——记录方法与来源。' },
      { title: '可审计报告', desc: '产出可复查报告：指标定义、方法、原始数字、结论——他人可复现。' },
    ],
    deliverable: '指标定义 + 方法 + 原始数字 + 结论。不提供无依据数字，估算标注为估算。',
  },
  docs: {
    slogan: '写明白：先定结构 → 按规格写 → 与现实同步核对',
    steps: [
      { title: '结构先行', desc: '动笔前定义文档结构（章节、标题、各节内容），受众/目的不清时先确认。' },
      { title: '按规格写', desc: '按既定结构与规格写作，内容清晰准确。' },
      { title: '同步核对', desc: '成文后对照实际产物核对，确保文档与事实一致。' },
    ],
    deliverable: '结构清晰、与现实同步的正式文档。',
  },
  security: {
    slogan: '护边界：摸清信任边界 → 探测暴露面 → 给出分级结论',
    steps: [
      { title: '画信任边界', desc: '先明确系统的信任边界与假设。' },
      { title: '探测暴露面', desc: '用攻击场景探测暴露面，评估影响。' },
      { title: '分级结论', desc: '给出分级（含利用场景证据）；并验证正向面不受影响。' },
    ],
    deliverable: '信任边界图 + 暴露面探测 + 分级结论（含场景证据）+ 正向验证。',
  },
  reviewer: {
    slogan: '审查员：任务级动态角色，专项复核',
    steps: [
      { title: '专项复核', desc: '在需要独立审查时加入，按任务专项核验关键产出。' },
      { title: '独立结论', desc: '给出独立、有依据的审查结论，不受执行者立场影响。' },
    ],
    deliverable: '独立审查结论（通过/需修改 + 依据）。',
  },
  commissar: {
    slogan: '独立监督：监督目标 · 审查风险 · 把关质量 · 上报分歧',
    steps: [
      { title: '监督目标', desc: '跟踪团队目标对齐与执行方向，发现偏离及时提示。' },
      { title: '审查风险', desc: '审查高风险/关键节点任务，评估风险并给出监督意见。' },
      { title: '把关质量', desc: '对门禁任务行使 pass/reject 复核，拒绝时附证据。' },
      { title: '上报分歧', desc: '重大分歧或风险主动上报队长。' },
    ],
    deliverable: '独立监督结论 + 门禁复核（pass/reject 带证据）+ 风险/分歧上报。',
  },
}
