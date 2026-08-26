import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamCommandPlanSource } from '../src/commands.js'
import type { AgentTeamCommandPlanView, AgentTeamView } from '../src/contract.js'
import type { AgentTeamProjectionState } from '../src/projection.js'
import { TeamId } from '../src/agent-team-types.js'

const teamId = TeamId('team-docs')
const sessionId = brandSessionId('session-lead')

const projectionTeamId: NonNullable<AgentTeamProjectionState['teamId']> = teamId
const viewTeamId: AgentTeamView['teamId'] = teamId
const planSourceTeamId: AgentTeamCommandPlanSource['teamId'] = teamId
const generatedFromTeamId: AgentTeamCommandPlanView['generatedFromTeamId'] = teamId

// @ts-expect-error Team identity must not be assignable to Session identity.
const sessionFromTeam: SessionId = teamId
// @ts-expect-error Session identity must not be assignable to Team identity.
const teamFromSession: typeof teamId = sessionId

void projectionTeamId
void viewTeamId
void planSourceTeamId
void generatedFromTeamId
void sessionFromTeam
void teamFromSession
