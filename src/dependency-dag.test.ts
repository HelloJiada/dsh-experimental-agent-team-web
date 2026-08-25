import { describe, expect, it } from 'vitest'
import type { AgentTeamTaskView } from './contract.js'
import { dependencyDagView } from './dependency-dag.js'

function task(id: string, blockedBy: string[] = [], status: AgentTeamTaskView['status'] = 'pending', ownerId?: string): AgentTeamTaskView {
  return {
    id: id as never,
    subject: `Task ${id}`,
    description: '',
    status,
    ownerId: (ownerId ?? null) as never,
    blockedBy: blockedBy.map(dep => dep as never),
    writeScopes: [],
    revision: 1,
  }
}

describe('agentTeam dependency DAG', () => {
  it('lays out a chain into topological levels with fan-out depth', () => {
    const dag = dependencyDagView(
      [
        task('task-a'),
        task('task-b', ['task-a']),
        task('task-c', ['task-b']),
      ],
      new Map(),
    )
    expect(dag.levels).toBe(3)
    expect(dag.nodes.find(node => node.id === 'task-a')?.level).toBe(0)
    expect(dag.nodes.find(node => node.id === 'task-b')?.level).toBe(1)
    expect(dag.nodes.find(node => node.id === 'task-c')?.level).toBe(2)
    expect(dag.nodes.find(node => node.id === 'task-a')?.dependencyDepth).toBe(2)
    expect(dag.nodes.find(node => node.id === 'task-b')?.dependencyDepth).toBe(1)
    expect(dag.nodes.find(node => node.id === 'task-c')?.dependencyDepth).toBe(0)
    expect(dag.edges).toEqual([
      { from: 'task-a', to: 'task-b' },
      { from: 'task-b', to: 'task-c' },
    ])
  })

  it('handles fan-in and fan-out deterministically', () => {
    const dag = dependencyDagView(
      [
        task('task-a'),
        task('task-b'),
        task('task-c', ['task-a', 'task-b']),
      ],
      new Map(),
    )
    expect(dag.levels).toBe(2)
    const level0 = dag.nodes.filter(node => node.level === 0).map(node => node.id).sort()
    expect(level0).toEqual(['task-a', 'task-b'])
    expect(dag.nodes.find(node => node.id === 'task-c')?.level).toBe(1)
    expect(dag.edges).toHaveLength(2)
    expect(dag.nodes.find(node => node.id === 'task-a')?.dependencyDepth).toBe(1)
  })

  it('ignores unresolved dependencies and never renders edges for them', () => {
    const dag = dependencyDagView([task('task-a', ['ghost'])], new Map())
    expect(dag.nodes.find(node => node.id === 'task-a')?.level).toBe(0)
    expect(dag.edges).toEqual([])
  })

  it('pushes cycles into a trailing column without hanging', () => {
    const dag = dependencyDagView(
      [
        task('task-a', ['task-b']),
        task('task-b', ['task-a']),
      ],
      new Map(),
    )
    const levels = dag.nodes.map(node => node.level)
    expect(levels.every(level => level === dag.levels - 1)).toBe(true)
    expect(dag.levels).toBe(2)
    expect(dag.edges).toHaveLength(2)
  })

  it('resolves owner display names and derives node tones from status', () => {
    const names = new Map([['worker-1', 'Alice']])
    const dag = dependencyDagView(
      [
        task('task-done', [], 'completed', 'worker-1'),
        task('task-fail', [], 'failed'),
        task('task-wip', [], 'in_progress', 'worker-1'),
        task('task-blocked', ['task-done']),
      ],
      names,
    )
    expect(dag.nodes.find(node => node.id === 'task-done')?.ownerName).toBe('Alice')
    expect(dag.nodes.find(node => node.id === 'task-done')?.tone).toBe('good')
    expect(dag.nodes.find(node => node.id === 'task-fail')?.tone).toBe('danger')
    expect(dag.nodes.find(node => node.id === 'task-wip')?.tone).toBe('warn')
    expect(dag.nodes.find(node => node.id === 'task-blocked')?.tone).toBe('danger')
  })

  it('returns an empty DAG for no tasks', () => {
    const dag = dependencyDagView([], new Map())
    expect(dag.nodes).toEqual([])
    expect(dag.edges).toEqual([])
    expect(dag.levels).toBe(0)
  })
})
