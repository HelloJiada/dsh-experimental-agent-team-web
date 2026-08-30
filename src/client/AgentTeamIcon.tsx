/**
 * AgentTeam 设置中心卡片标题 Icon(t9,用户选定方案 2「指挥棋盘」)。
 *
 * 16×16 描边式网格图标——网格=任务棋盘,高亮格=当前调度点,表达
 * 「多角色排兵布阵/调度」语义。stroke=currentColor,随主题自动适配;
 * 纯图标组件,不含底色(用户要求只需 Icon)。
 * @module dsh-agent-team-web/client/agent-team-icon
 */

/** 方案 2 指挥棋盘图标:网格 + 高亮格。 */
export function AgentTeamIcon(): React.ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M2.5 6h11M2.5 10h11M6 2.5v11M10 2.5v11" strokeWidth="0.8" opacity="0.55" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
