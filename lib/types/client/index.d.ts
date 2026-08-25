import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client';
import '@deepseek-ai/dsh-client-ui-layout/client';
export { AgentTeamActivityPanel } from './AgentTeamActivityPanel.js';
export { AgentTeamConversationSummary } from './AgentTeamConversationSummary.js';
export type { AgentTeamMemberView, AgentTeamMessageView, AgentTeamTaskView, AgentTeamView, } from '../contract.js';
export declare const inject: string[];
type ClientContext = Omit<Context, 'sessions'> & {
    readonly sessions: ISessions;
};
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map