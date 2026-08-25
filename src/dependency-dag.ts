import type {
  AgentTeamDagEdgeView,
  AgentTeamDagNodeView,
  AgentTeamDagView,
  AgentTeamTaskView,
} from './contract.js'

/**
 * Computes a layered task-dependency DAG from committed task facts.
 *
 * - `level` is the topological column (longest path from dependency sources);
 *   tasks with no resolvable dependencies sit at level 0.
 * - Cycles (an anomaly in practice) are pushed to their own trailing column so
 *   the renderer still gets a deterministic layout.
 * - Node tone is derived from status + dependency state, mirroring the
 *   snapshot-timeline tones; owner display names are resolved from the member
 *   map provided by the projection.
 *
 * This module is deliberately free of runtime dependencies (types only) so
 * both the host projection and the client dashboard can share it without
 * pulling zod or the projection stack into the browser bundle.
 */
export function dependencyDagView(
  tasks: readonly AgentTeamTaskView[],
  memberNames: ReadonlyMap<string, string>,
): AgentTeamDagView {
  const ids = new Set(tasks.map(task => String(task.id)))
  const byId = new Map(tasks.map(task => [String(task.id), task]))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const task of tasks) {
    const id = String(task.id)
    indegree.set(id, task.blockedBy.filter(dep => ids.has(String(dep))).length)
    for (const dep of task.blockedBy) {
      if (!ids.has(String(dep))) continue
      const list = dependents.get(String(dep)) ?? []
      list.push(id)
      dependents.set(String(dep), list)
    }
  }

  // Kahn's algorithm with a deterministically sorted frontier; each node's
  // level is the longest dependency path from the sources.
  const level = new Map<string, number>()
  const queue: string[] = tasks
    .filter(task => (indegree.get(String(task.id)) ?? 0) === 0)
    .map(task => String(task.id))
    .sort()
  while (queue.length > 0) {
    const id = queue.shift()!
    if (!level.has(id)) level.set(id, 0)
    for (const next of dependents.get(id) ?? []) {
      const nextLevel = (level.get(id) ?? 0) + 1
      if (nextLevel > (level.get(next) ?? 0)) level.set(next, nextLevel)
      const remaining = (indegree.get(next) ?? 1) - 1
      indegree.set(next, remaining)
      if (remaining === 0) {
        queue.push(next)
        queue.sort()
      }
    }
  }

  // Residual cycles: place every unprocessed task in one trailing column.
  const maxLevel = tasks.reduce((max, task) => Math.max(max, level.get(String(task.id)) ?? 0), 0)
  for (const task of tasks) {
    const id = String(task.id)
    if (!level.has(id)) level.set(id, maxLevel + 1)
  }

  const nodes: AgentTeamDagNodeView[] = []
  const rowsByLevel = new Map<number, string[]>()
  for (const task of tasks) {
    const id = String(task.id)
    const taskLevel = level.get(id) ?? 0
    const rows = rowsByLevel.get(taskLevel) ?? []
    rows.push(id)
    rowsByLevel.set(taskLevel, rows)
  }
  for (const rows of rowsByLevel.values()) rows.sort()

  for (const task of tasks) {
    const id = String(task.id)
    const taskLevel = level.get(id) ?? 0
    const rows = rowsByLevel.get(taskLevel) ?? []
    const ownerId = task.ownerId !== null ? String(task.ownerId) : null
    nodes.push({
      id,
      subject: task.subject,
      status: task.status,
      tone: nodeToneOf(task),
      ownerName: ownerId !== null ? (memberNames.get(ownerId) ?? ownerId) : null,
      level: taskLevel,
      position: rows.indexOf(id),
      dependencyDepth: downstreamCountOf(id, dependents),
    })
  }
  nodes.sort((left, right) => left.level - right.level || left.position - right.position || left.id.localeCompare(right.id))

  const edges: AgentTeamDagEdgeView[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    for (const dep of task.blockedBy) {
      if (!ids.has(String(dep))) continue
      const from = String(dep)
      const to = String(task.id)
      const key = `${from}\u0000${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to })
    }
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))

  return {
    nodes,
    edges,
    levels: tasks.length === 0 ? 0 : Math.max(...nodes.map(node => node.level)) + 1,
  }
}

function nodeToneOf(task: AgentTeamTaskView): AgentTeamDagNodeView['tone'] {
  switch (task.status) {
    case 'completed':
      return 'good'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'neutral'
    case 'in_progress':
      return 'warn'
    case 'pending':
      return task.blockedBy.length > 0 ? 'danger' : 'neutral'
    default:
      return 'neutral'
  }
}

/** Number of tasks that transitively depend on the given task id. */
function downstreamCountOf(taskId: string, dependents: ReadonlyMap<string, readonly string[]>): number {
  const seen = new Set<string>()
  const stack = [...(dependents.get(taskId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    for (const next of dependents.get(current) ?? []) stack.push(next)
  }
  return seen.size
}
