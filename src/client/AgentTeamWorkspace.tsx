import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

function renderInlineContent(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if ('text' in block && typeof block.text === 'string') return block.text
    if (block.type === 'tool-call' && 'name' in block && typeof block.name === 'string') return `[tool:${block.name}]`
    if (block.type === 'tool-result') return '[tool result]'
    if (block.type === 'image') return '[image]'
    return `[${block.type}]`
  }).join(' ')
}

export function AgentTeamWorkspace({ useProjection }: ConvViewProps): JSX.Element {
  const team = useProjection('agentTeam')

  if (team === undefined || team === null) {
    return (
      <section>
        <h2>Agent Team</h2>
        <p>当前会话没有 Team 数据。</p>
      </section>
    )
  }

  return (
    <section>
      <h2>Agent Team</h2>
      <p>Lead Session: {team.teamId}</p>

      <h3>成员</h3>
      {team.members.length === 0 ? <p>暂无成员记录。</p> : (
        <ul>
          {team.members.map(member => (
            <li key={member.id}>
              <strong>{member.name}</strong>（{member.role}，{member.phase}）
            </li>
          ))}
        </ul>
      )}

      <h3>任务</h3>
      {team.tasks.length === 0 ? <p>暂无任务记录。</p> : (
        <ul>
          {team.tasks.map(task => (
            <li key={task.id}>
              <strong>{task.subject}</strong> — {task.status} — rev {task.revision}
              {task.ownerId !== null ? ` — owner ${task.ownerId}` : ''}
            </li>
          ))}
        </ul>
      )}

      <h3>邮箱</h3>
      {team.messages.length === 0 ? <p>暂无消息记录。</p> : (
        <ul>
          {team.messages.map(message => (
            <li key={message.id}>
              {message.senderName} → {message.targetId} [{message.delivery}] {message.delivered ? '已送达' : '待送达'}：
              {renderInlineContent(message.content)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
