/**
 * 耗时格式化纯函数(服务端与客户端共用)。
 *
 * 面板展示约定:12m / 1h 05m —— 不足 1 分钟显示 `<1m`,不足 1 小时显示
 * `Nm`,达到 1 小时显示 `Xh YYm`(分钟两位补零)。
 * @module dsh-agent-team-web/duration
 */

/** 格式化毫秒为面板展示用的紧凑耗时文本。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0m'
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 1) return '<1m'
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}
