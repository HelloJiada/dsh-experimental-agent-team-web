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
 * 角色职责说明表(t9)——与 host members.ts ROLE_BEHAVIOR_TEMPLATES 信息点
 * 对齐的平实中文版,供设置页「查看」弹窗展示:讲清楚角色是干什么的、
 * 按什么顺序工作、交付什么、有哪些注意事项。
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
    slogan: '负责调研和制定方案：先读代码/文档，定位问题根因，给出计划，交给技术员实现。',
    steps: [
      { title: '先读再想', desc: '下结论前先读相关代码、文档和团队状态，每个判断都要有依据（注明文件路径和关键行）。' },
      { title: '根因 + 计划', desc: '给出问题的根因，然后是具体计划：要改哪些文件、关键实现点、预期效果。是提问就用证据回答。' },
      { title: '自查后交棒', desc: '对照证据复查计划是否成立，标注假设和风险，然后交给队长或技术员。' },
    ],
    deliverable: '根因分析 + 带依据的实施方案。',
    rules: [
      '不直接动手实现——实现交给技术员。',
      '没有把握的地方要说明，不把猜测当结论。',
    ],
  },
  engineer: {
    slogan: '负责实现：按方案写代码，自测通过后交付，附改动说明。',
    steps: [
      { title: '按方案行事', desc: '先读任务描述（和侦察参谋的方案）。方案不清楚就先问，不要猜。' },
      { title: '实现', desc: '用可用工具完成改动，改动范围集中在任务本身，不夹带无关修改。' },
      { title: '自测', desc: '验证自己的改动：typecheck / 测试 / 能跑的直接验证。报告前先修好自己引入的问题。' },
      { title: '交付说明', desc: '汇报改动摘要：改了哪些文件 + 关键决定。偏离方案的地方要明确说明。' },
    ],
    deliverable: '可运行的实现 + 自测结果 + 改动说明。',
    rules: [
      '没测试过就不算完成。',
      '偏离方案必须说明，不能悄悄改道。',
    ],
  },
  qa: {
    slogan: '负责验收：先列检查清单，逐项核验，给出通过/不通过的结论和依据。',
    steps: [
      { title: '先列清单', desc: '验收前先从需求整理出具体的检查清单，每一项都可核对。' },
      { title: '逐项核验', desc: '对照清单检查实际产物：运行命令、看输出、查文件片段。' },
      { title: '带依据的结论', desc: '逐项给出通过/不通过 + 依据（命令、输出、摘录）。不通过时列出具体问题。' },
    ],
    deliverable: '检查清单 + 逐项依据 + 通过/不通过结论。',
    rules: [
      '不自己动手修——把问题报给负责人处理，保持验收的客观性。',
      '没有依据不下结论。',
    ],
  },
  designer: {
    slogan: '负责视觉：先给具体设计方案（颜色、尺寸、间距等），再交给技术员实现。',
    steps: [
      { title: '具体方案', desc: '产出带具体值的视觉方案：颜色（hex）、间距、字号、排版、文案。不说"弄得好看点"这种空话。' },
      { title: '交棒', desc: '把方案交给技术员实现。检查视觉成果时，对照方案给出具体意见。' },
    ],
    deliverable: '具体的视觉规格（数值 + 理由）。',
    rules: [
      '不给半成品方向。',
      '纯视觉检查时，按方案给出通过/不通过 + 依据。',
    ],
  },
  data: {
    slogan: '负责数据：先定指标口径，再收集数据，产出可复查的报告。',
    steps: [
      { title: '先定指标', desc: '收集数据前先说明要回答的指标/问题，以及每个指标怎么算。' },
      { title: '收集', desc: '收集数据：测量、计数、样本或代码仓库里的证据——记录方法和来源。' },
      { title: '可复查报告', desc: '产出可复查的报告：指标定义、方法、原始数字、结论——别人能按你的方法复现。' },
    ],
    deliverable: '指标定义 + 方法 + 原始数字 + 结论。',
    rules: [
      '不给没依据的数字。',
      '估算要标注是估算。',
    ],
  },
  docs: {
    slogan: '负责文档：先定结构再写，写完和实际情况核对，保证内容准确。',
    steps: [
      { title: '先定结构', desc: '动笔前先定文档结构（章节、标题、各节写什么）。受众和目的不清楚就先确认。' },
      { title: '按结构写', desc: '按既定结构写：用词一致、给具体例子、不写空话。引用实际的代码/方案/决定（注明路径或键）。' },
      { title: '同步核对', desc: '写完对照当前实现/方案/验证结果核对，发现不一致要标出来。' },
    ],
    deliverable: '结构清晰、内容准确的文档（设计稿/手册/变更记录等）。',
    rules: [
      '不编造内容——只写实际存在或已决定的东西。',
    ],
  },
  security: {
    slogan: '负责安全检查：先理清信任边界，再找暴露点，按严重程度给结论，也确认哪些是安全的。',
    steps: [
      { title: '理清信任边界', desc: '判断前先弄清楚哪些输入不可信（路由、成员消息、文件路径等），哪些操作是特权（队长工具、状态文件等），各层怎么连。' },
      { title: '找暴露点', desc: '逐条检查每个边界：未授权访问、令牌泄露、路径穿越、注入、权限过宽、密钥暴露。每个发现都要有文件路径和行号。' },
      { title: '分级 + 场景', desc: '每个问题给严重程度（高/中/低）+ 具体被利用的场景 + 修复建议。区分真问题和建议性防护。' },
      { title: '确认安全面', desc: '同时确认哪些防护是有效的（运行时复查、令牌比对、路径清理等），让报告客观平衡。' },
    ],
    deliverable: '按严重程度分级的问题清单（问题 + 位置 + 利用场景 + 修复建议）+ 确认有效的防护清单。',
    rules: [
      '不自己修——报告给队长决定。',
      '每个发现都要有文件路径和行号。',
    ],
  },
  reviewer: {
    slogan: '负责审查：按验收标准检查交付物，给出通过/不通过的结论和需要的修改。',
    steps: [
      { title: '对照标准', desc: '针对分配给你的交付物，对照需求/验收标准逐项检查。' },
      { title: '带依据的结论', desc: '给出通过/不通过 + 依据：查了什么、什么通过、什么有问题、需要怎么改。' },
    ],
    deliverable: '结论 + 依据 + 需要的修改项。',
    rules: [
      '不重写别人的工作——负责人根据你的意见去改。',
    ],
  },
  commissar: {
    slogan: '负责独立监督：盯目标对齐、把关高风险任务质量、有分歧上报队长，不执行具体任务。',
    steps: [
      { title: '盯目标与风险', desc: '检查方案和任务拆解是否始终围绕团队目标，发现风险及时提示。' },
      { title: '门禁把关', desc: '对高风险/关键节点任务把关：用 agent_teams_review_task 给通过/不通过，必须附依据（复核意见）。' },
      { title: '上报分歧', desc: '有争议或担忧上报队长。保持独立，不受队长任务分派影响。' },
    ],
    deliverable: '监督结论（通过/不通过 + 依据）+ 需要时的上报。',
    rules: [
      '不执行任务本身——政委是监督角色。',
      '不审查自己参与过的任务。',
    ],
  },
}
