/**
 * 队长路由覆盖(t12 扩展):AgentTeam 激活时,队长(指挥者)的 LLM 请求按
 * settings.roleDefaults['captain'] 路由——队长职责核心,用好模型(如 gpt)。
 *
 * 实现:监听 `agent/created`(每个 agent 创建时,scoped 到该 agent),在其
 * scoped context 上注册 `agent/request` waterfall——仅当该 agent 是 AgentTeam
 * 队长(captainAgentIds 集合命中)且 captain 配置存在时,改写 provider/model/
 * effort;其他 agent 与普通会话完全不受影响(原样 next())。
 *
 * 边界:①不改会话日志/header 记录(waterfall 是请求前改写,先例 core/agent
 * model-selection.ts);②「恢复默认」清空 captain 覆盖后,队长回落会话模型;
 * ③「恢复默认」清空 captain 覆盖后,队长回落会话模型。
 * ④captain 选 cc-switch(GPT-5.6)时 effort 照常写入(t13:支持 adaptive thinking)。
 * @module dsh-agent-team-web/captain-route
 */
import type { Context } from '@deepseek-ai/cordis';
/** 标记某 agent 为 AgentTeam 队长(create 工具成功后调用)。 */
export declare function markCaptainAgent(agentId: string): void;
/** 取消队长标记(团队删除/归档时调用,释放内存)。 */
export declare function unmarkCaptainAgent(agentId: string): void;
/** captain 配置读取器(settings scope 闭包,apply 期注入)。 */
type CaptainConfigReader = () => {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
} | undefined;
/**
 * 注册队长路由覆盖:监听 agent/created,对每个 agent 的 scoped context 注册
 * agent/request waterfall——队长且配置存在时改写 provider/model/effort。
 * @param ctx - 插件 context(注入 agents)。
 * @param captainConfig - settings.roleDefaults['captain'] 读取器。
 * @returns 卸载函数。
 */
export declare function registerCaptainRoute(ctx: Context, captainConfig: CaptainConfigReader): () => void;
export {};
//# sourceMappingURL=captain-route.d.ts.map