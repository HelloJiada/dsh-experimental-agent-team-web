/**
 * 耗时格式化纯函数(服务端与客户端共用)。
 *
 * 面板展示约定:12m / 1h 05m —— 不足 1 分钟显示 `<1m`,不足 1 小时显示
 * `Nm`,达到 1 小时显示 `Xh YYm`(分钟两位补零)。
 * @module dsh-agent-team-web/duration
 */
/** 格式化毫秒为面板展示用的紧凑耗时文本。 */
export declare function formatDuration(ms: number): string;
//# sourceMappingURL=duration.d.ts.map