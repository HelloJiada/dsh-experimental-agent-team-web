import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'shell.overlay': {
            kind: 'list';
            scope: 'root';
        };
    }
}
type AgentTeamActivityPanelProps = PropsRuntime<'shell.overlay'> & {
    readonly openMember: (memberId: string) => void;
};
export declare function AgentTeamActivityPanel({ useSessions, openMember }: AgentTeamActivityPanelProps): JSX.Element | null;
export {};
//# sourceMappingURL=AgentTeamActivityPanel.d.ts.map