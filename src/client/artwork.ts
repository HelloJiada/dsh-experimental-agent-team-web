/**
 * Shared whale artwork lookup for the activity panel and the conversation
 * card: role keywords map to the packaged role images; the captain always
 * uses the lead whale.
 * @module dsh-agent-team-web/client/artwork
 */

/** Artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/agent-team-web/assets/'

/** V2 whale role artwork per role keyword. */
const ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  // Commissar first: highest priority so 政委 / political-oversight roles
  // never fall into another bucket. `审查` intentionally stays with security.
  [/commissar|political|政委|政治委员|监督/, 'member-commissar-v2.png'],
  [/data|analys|metric|performance|数据|分析|指标|性能|情报/, 'member-data-v2.png'],
  [/resear|investig|explor|study|研究|调查|探索|调研|侦察|参谋/, 'member-researcher-v2.png'],
  // Match compound QA titles (for example "QA Engineer") before the broad
  // engineer bucket, otherwise an eight-role roster repeats the engineer art.
  [/\bqa\b|test|verif|quality|测试|质量|验证|质检/, 'member-qa-v2.png'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程|技术/, 'member-engineer-v2.png'],
  [/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍|文宣|宣传|干事/, 'member-designer-v2.png'],
  // Reviewer before security: an explicit reviewer role, or 审查员/核验 titles,
  // takes the reviewer bucket first. It reuses the security whale image, so
  // compound titles that also contain 审查/安全 (e.g. 安全审查员) keep the exact
  // same artwork while an English `reviewer` role no longer rides the broad
  // `review` keyword into security.
  [/\breviewer\b|审查员|核验/, 'member-security-v2.png'],
  [/secur|audit|risk|threat|review|安全|审计|审查|风险|警卫/, 'member-security-v2.png'],
  [/docs|writer|product|spec|撰写|文案|写作|文档|规范|文书/, 'member-docs-v2.png'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调|后勤|保障/, 'member-operator-v2.png'],
]

/** Captain artwork (always the lead whale). */
export const LEAD_ART = `${ART_BASE}team-lead-v2.png`

/** Status action artwork per member activity. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working-v2.png`,
  idle: `${ART_BASE}action-sleeping-v2.png`,
  unknown: `${ART_BASE}action-thinking-v2.png`,
}

/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtUrl(name: string, role: string): string | null {
  const identity = `${name} ${role}`.toLowerCase()
  for (const [pattern, art] of ROLE_ART) {
    if (pattern.test(identity)) return `${ART_BASE}${art}`
  }
  return null
}
