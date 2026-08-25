import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region src/agent-team-types.ts
/**
* Mapping from the upstream `dsh-agent-teams` task status vocabulary to the
* vendored one used by this bundle's projection. `claimed` is represented as
* `pending` with an owner; `failed` / `cancelled` are carried through so the
* dashboard can surface terminal work honestly.
*/
const UPSTREAM_TASK_STATUS = {
	pending: "pending",
	claimed: "pending",
	in_progress: "in_progress",
	completed: "completed",
	failed: "failed",
	cancelled: "cancelled"
};
//#endregion
//#region src/upstream.ts
const UPSTREAM_TEAM_EVENT_TYPES = [
	"agent-teams/team-created",
	"agent-teams/member-added",
	"agent-teams/member-removed",
	"agent-teams/task-created",
	"agent-teams/task-updated",
	"agent-teams/message-sent",
	"agent-teams/team-deleted"
];
function isUpstreamTeamEventType(type) {
	return UPSTREAM_TEAM_EVENT_TYPES.includes(type);
}
function dataOf(event) {
	return event.data;
}
function memberIdForName(state, name) {
	if (name === "captain" && state.teamId !== null) return state.teamId;
	for (const member of Object.values(state.members)) if (member.name === name) return member.id;
	return null;
}
/**
* Applies one upstream `agent-teams/*` event to the projection state.
* Returns `null` for unrecognized event types. History bookkeeping is left to
* the caller (`appendHistory`), matching the vendored-event path.
*/
function applyUpstreamEvent(state, event) {
	switch (event.type) {
		case "agent-teams/team-created": return {
			...state,
			teamId: SessionId(dataOf(event).teamId),
			hasTeamEvents: true
		};
		case "agent-teams/member-added": {
			const data = dataOf(event);
			const member = {
				id: SessionId(data.memberId),
				name: data.name,
				description: data.role ?? "",
				provider: "",
				context: "fresh",
				phase: "active"
			};
			return {
				...state,
				teamId: state.teamId ?? SessionId(data.teamId),
				hasTeamEvents: true,
				members: {
					...state.members,
					[data.memberId]: member
				}
			};
		}
		case "agent-teams/member-removed": {
			const data = dataOf(event);
			const members = { ...state.members };
			delete members[data.memberId];
			return {
				...state,
				teamId: state.teamId ?? SessionId(data.teamId),
				hasTeamEvents: true,
				members
			};
		}
		case "agent-teams/task-created": {
			const data = dataOf(event);
			const task = {
				id: data.taskId,
				revision: 1,
				subject: data.subject,
				description: "",
				status: "pending",
				ownerId: data.assignee !== void 0 ? memberIdForName(state, data.assignee) ?? void 0 : void 0,
				blockedBy: data.dependencies.map((dependency) => dependency),
				writeScopes: []
			};
			return {
				...state,
				teamId: state.teamId ?? SessionId(data.teamId),
				hasTeamEvents: true,
				tasks: {
					...state.tasks,
					[data.taskId]: task
				}
			};
		}
		case "agent-teams/task-updated": {
			const data = dataOf(event);
			const previous = state.tasks[data.taskId];
			const mappedStatus = UPSTREAM_TASK_STATUS[data.status] ?? previous?.status ?? "pending";
			const ownerId = data.assignee !== void 0 ? memberIdForName(state, data.assignee) ?? void 0 : previous?.ownerId;
			const task = {
				id: data.taskId,
				revision: (previous?.revision ?? 0) + 1,
				subject: previous?.subject ?? data.taskId,
				description: previous?.description ?? "",
				status: mappedStatus,
				ownerId,
				blockedBy: previous?.blockedBy ?? [],
				writeScopes: previous?.writeScopes ?? []
			};
			return {
				...state,
				teamId: state.teamId ?? SessionId(data.teamId),
				hasTeamEvents: true,
				tasks: {
					...state.tasks,
					[data.taskId]: task
				}
			};
		}
		case "agent-teams/message-sent": {
			const data = dataOf(event);
			const message = {
				id: data.messageId,
				senderId: memberIdForName(state, data.from) ?? state.teamId ?? SessionId(data.teamId),
				senderName: data.from,
				targetId: memberIdForName(state, data.to) ?? state.teamId ?? SessionId(data.teamId),
				delivery: "quiet",
				content: [{
					type: "text",
					text: data.content
				}]
			};
			return {
				...state,
				teamId: state.teamId ?? SessionId(data.teamId),
				hasTeamEvents: true,
				messages: {
					...state.messages,
					[data.messageId]: message
				}
			};
		}
		case "agent-teams/team-deleted": return {
			...state,
			teamId: state.teamId ?? SessionId(dataOf(event).teamId),
			hasTeamEvents: true
		};
		default: return null;
	}
}
/** Builds a timeline history entry for an upstream event (no state mutation). */
function upstreamHistoryEntryOf(event) {
	const seq = event.seq;
	const time = typeof event.time === "number" ? event.time : 0;
	switch (event.type) {
		case "agent-teams/team-created": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "member",
				type: event.type,
				title: `团队创建 ${data.name}`,
				detail: `captain ${data.captainSessionId}`,
				tone: "good",
				entityKey: `team:${data.teamId}`,
				count: 1
			};
		}
		case "agent-teams/member-added": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "member",
				type: event.type,
				title: `成员加入 ${data.name}`,
				detail: data.role !== void 0 ? `role ${data.role}` : "role -",
				tone: "good",
				entityKey: `member:${data.memberId}`,
				count: 1
			};
		}
		case "agent-teams/member-removed": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "member",
				type: event.type,
				title: `成员移除 ${data.memberId}`,
				detail: "removed",
				tone: "warn",
				entityKey: `member:${data.memberId}`,
				count: 1
			};
		}
		case "agent-teams/task-created": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "task",
				type: event.type,
				title: `任务创建 ${data.subject}`,
				detail: `status pending`,
				tone: "neutral",
				entityKey: `task:${data.taskId}`,
				count: 1
			};
		}
		case "agent-teams/task-updated": {
			const data = dataOf(event);
			const tone = data.status === "completed" ? "good" : data.status === "failed" ? "danger" : data.status === "cancelled" ? "neutral" : data.status === "in_progress" ? "warn" : "neutral";
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "task",
				type: event.type,
				title: `任务更新 ${data.taskId}`,
				detail: `status ${data.status}`,
				tone,
				entityKey: `task:${data.taskId}`,
				count: 1
			};
		}
		case "agent-teams/message-sent": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "message",
				type: event.type,
				title: `消息 ${data.from} → ${data.to}`,
				detail: "已记录到邮箱",
				tone: "neutral",
				entityKey: `message:${data.messageId}`,
				count: 1
			};
		}
		case "agent-teams/team-deleted": {
			const data = dataOf(event);
			return {
				id: `${event.type}:${seq}`,
				seq,
				time,
				kind: "member",
				type: event.type,
				title: "团队已删除",
				detail: `team ${data.teamId}`,
				tone: "danger",
				entityKey: `team:${data.teamId}`,
				count: 1
			};
		}
		default: return null;
	}
}
//#endregion
//#region src/timeline-milestones.ts
const toneRank = {
	danger: 0,
	warn: 1,
	good: 2,
	neutral: 3
};
/**
* Groups the timeline into rolling windows and returns them most-recent-first.
* Each window carries its event distribution (member/task/message), seq range,
* row/event counts, and a headline derived from the most significant entry
* (danger > warn > good > neutral; ties pick the latest). This is the
* roadmap's "rolling-window milestone summary": Captain sees what happened per
* window without reading every row.
*
* This module is deliberately free of runtime dependencies (types only), so
* both the host projection and the client dashboard can share it without
* pulling zod or the projection stack into the browser bundle.
*/
function timelineMilestonesView(timeline, options = {}) {
	if (timeline.length === 0) return [];
	const mode = options.mode ?? "count";
	const windowSize = options.windowSize ?? 8;
	const windowMs = options.windowMs ?? 36e5;
	const sorted = [...timeline].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0) || (left.time ?? 0) - (right.time ?? 0));
	const groups = [];
	if (mode === "time") {
		const byBucket = /* @__PURE__ */ new Map();
		for (const row of sorted) {
			const bucket = row.time !== void 0 ? Math.floor(row.time / windowMs) : Number.NEGATIVE_INFINITY;
			const list = byBucket.get(bucket) ?? [];
			list.push(row);
			byBucket.set(bucket, list);
		}
		const buckets = [...byBucket.keys()].sort((left, right) => left - right);
		for (const [index, bucket] of buckets.entries()) groups.push({
			rows: byBucket.get(bucket) ?? [],
			order: index
		});
	} else for (let start = 0; start < sorted.length; start += windowSize) groups.push({
		rows: sorted.slice(start, start + windowSize),
		order: groups.length
	});
	return groups.map(({ rows }, index) => {
		const memberEvents = rows.filter((row) => row.kind === "member").reduce((sum, row) => sum + (row.count ?? 1), 0);
		const taskEvents = rows.filter((row) => row.kind === "task").reduce((sum, row) => sum + (row.count ?? 1), 0);
		const messageEvents = rows.filter((row) => row.kind === "message").reduce((sum, row) => sum + (row.count ?? 1), 0);
		const seqs = rows.map((row) => row.seq).filter((seq) => seq !== void 0);
		let headline = rows[rows.length - 1] ?? rows[0];
		for (const row of rows) if (toneRank[row.tone] < toneRank[headline.tone]) headline = row;
		return {
			windowId: `w${index}`,
			startSeq: seqs[0] ?? null,
			endSeq: seqs[seqs.length - 1] ?? null,
			entryCount: rows.length,
			eventCount: memberEvents + taskEvents + messageEvents,
			memberEvents,
			taskEvents,
			messageEvents,
			headline: headline.title,
			headlineTone: headline.tone
		};
	}).reverse();
}
//#endregion
//#region src/commands.ts
/**
* Single source of truth for the command vocabulary. The union type
* `AgentTeamCommandKind` lives in `contract.ts`; this runtime list is
* compile-time checked against it, so host consumers (and the zod schema)
* always see the exact same set.
*/
const AGENT_TEAM_COMMAND_KINDS = [
	"task:claim",
	"task:reassign",
	"task:unblock",
	"member:restart",
	"message:redeliver",
	"message:broadcast"
];
const priorityRank = {
	high: 0,
	medium: 1,
	low: 2
};
/**
* Wraps the derived command suggestions into a stable, host-consumable plan
* envelope. The plan is a pure read-only projection of committed Team facts:
* a runtime tool layer may consume `commands` (each with a concrete targetId)
* and execute them; this bundle never executes anything itself.
*/
function commandPlanView(view) {
	const commands = suggestCommands(view);
	const countByPriority = (priority) => commands.filter((command) => command.priority === priority).length;
	return {
		version: 1,
		generatedFromTeamId: view.teamId,
		total: commands.length,
		highPriorityCount: countByPriority("high"),
		mediumPriorityCount: countByPriority("medium"),
		lowPriorityCount: countByPriority("low"),
		commands
	};
}
/**
* Derives actionable command suggestions from committed Team facts. These are
* recommendations for a host runtime tool layer: this bundle does not execute
* them (the Team surface stays read-only), but it exposes the bridge contract
* and the concrete target ids any executor would need.
*/
function suggestCommands(view) {
	const suggestions = [];
	for (const insight of view.taskInsights) {
		if (insight.status === "completed") continue;
		const targetId = String(insight.taskId);
		if (insight.readiness === "orphaned") suggestions.push({
			id: `cmd:reassign:${targetId}`,
			kind: "task:reassign",
			label: `重新分配任务「${insight.subject}」`,
			targetId,
			targetLabel: insight.subject,
			priority: "high",
			rationale: `任务 owner（${String(insight.ownerId ?? "未知")}）在成员快照中不可见，需要重新归属。`
		});
		else if (insight.readiness === "stalled" && insight.ownerId === null) suggestions.push({
			id: `cmd:claim:${targetId}`,
			kind: "task:claim",
			label: `认领任务「${insight.subject}」`,
			targetId,
			targetLabel: insight.subject,
			priority: "medium",
			rationale: "任务已具备执行条件但无 owner，建议 Captain 认领或指派。"
		});
		else if (insight.readiness === "blocked") suggestions.push({
			id: `cmd:unblock:${targetId}`,
			kind: "task:unblock",
			label: `解除任务「${insight.subject}」阻塞`,
			targetId,
			targetLabel: insight.subject,
			priority: "high",
			rationale: `任务被依赖阻塞：${insight.reasons[0] ?? "前置任务未完成"}，需优先推进前置依赖。`
		});
	}
	for (const member of view.members) if (member.role === "teammate" && member.phase === "failed") suggestions.push({
		id: `cmd:restart:${String(member.id)}`,
		kind: "member:restart",
		label: `重启成员「${member.name}」`,
		targetId: String(member.id),
		targetLabel: member.name,
		priority: "high",
		rationale: "成员处于 failed 状态，需要重启、替换或由 Captain 接管其任务。"
	});
	for (const risk of view.messageRisks) {
		if (risk.riskLevel !== "high") continue;
		const targetId = String(risk.targetId);
		if (!risk.delivered) suggestions.push({
			id: `cmd:redeliver:${String(risk.messageId)}`,
			kind: "message:redeliver",
			label: `重发高风险消息 → ${targetId}`,
			targetId,
			targetLabel: String(risk.messageId),
			priority: "high",
			rationale: risk.reasons.join(" ") || "高风险消息尚未送达。"
		});
		else suggestions.push({
			id: `cmd:broadcast:${String(risk.messageId)}`,
			kind: "message:broadcast",
			label: `广播消息（目标 ${targetId} 不可达）`,
			targetId,
			targetLabel: String(risk.messageId),
			priority: "medium",
			rationale: risk.reasons.join(" ") || "目标成员状态异常，建议改为广播。"
		});
	}
	for (const load of view.memberLoads) {
		if (load.level !== "overloaded") continue;
		suggestions.push({
			id: `cmd:rebalance:${String(load.memberId)}`,
			kind: "task:reassign",
			label: `为成员「${load.memberName}」转移负载`,
			targetId: String(load.memberId),
			targetLabel: load.memberName,
			priority: "medium",
			rationale: "成员负载过高，建议把部分 ready work 转移给空闲或负载更低的成员。"
		});
	}
	return suggestions.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.id.localeCompare(right.id));
}
//#endregion
//#region src/dependency-dag.ts
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
function dependencyDagView(tasks, memberNames) {
	const ids = new Set(tasks.map((task) => String(task.id)));
	new Map(tasks.map((task) => [String(task.id), task]));
	const indegree = /* @__PURE__ */ new Map();
	const dependents = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		const id = String(task.id);
		indegree.set(id, task.blockedBy.filter((dep) => ids.has(String(dep))).length);
		for (const dep of task.blockedBy) {
			if (!ids.has(String(dep))) continue;
			const list = dependents.get(String(dep)) ?? [];
			list.push(id);
			dependents.set(String(dep), list);
		}
	}
	const level = /* @__PURE__ */ new Map();
	const queue = tasks.filter((task) => (indegree.get(String(task.id)) ?? 0) === 0).map((task) => String(task.id)).sort();
	while (queue.length > 0) {
		const id = queue.shift();
		if (!level.has(id)) level.set(id, 0);
		for (const next of dependents.get(id) ?? []) {
			const nextLevel = (level.get(id) ?? 0) + 1;
			if (nextLevel > (level.get(next) ?? 0)) level.set(next, nextLevel);
			const remaining = (indegree.get(next) ?? 1) - 1;
			indegree.set(next, remaining);
			if (remaining === 0) {
				queue.push(next);
				queue.sort();
			}
		}
	}
	const maxLevel = tasks.reduce((max, task) => Math.max(max, level.get(String(task.id)) ?? 0), 0);
	for (const task of tasks) {
		const id = String(task.id);
		if (!level.has(id)) level.set(id, maxLevel + 1);
	}
	const nodes = [];
	const rowsByLevel = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		const id = String(task.id);
		const taskLevel = level.get(id) ?? 0;
		const rows = rowsByLevel.get(taskLevel) ?? [];
		rows.push(id);
		rowsByLevel.set(taskLevel, rows);
	}
	for (const rows of rowsByLevel.values()) rows.sort();
	for (const task of tasks) {
		const id = String(task.id);
		const taskLevel = level.get(id) ?? 0;
		const rows = rowsByLevel.get(taskLevel) ?? [];
		const ownerId = task.ownerId !== null ? String(task.ownerId) : null;
		nodes.push({
			id,
			subject: task.subject,
			status: task.status,
			tone: nodeToneOf(task),
			ownerName: ownerId !== null ? memberNames.get(ownerId) ?? ownerId : null,
			level: taskLevel,
			position: rows.indexOf(id),
			dependencyDepth: downstreamCountOf(id, dependents)
		});
	}
	nodes.sort((left, right) => left.level - right.level || left.position - right.position || left.id.localeCompare(right.id));
	const edges = [];
	const seen = /* @__PURE__ */ new Set();
	for (const task of tasks) for (const dep of task.blockedBy) {
		if (!ids.has(String(dep))) continue;
		const from = String(dep);
		const to = String(task.id);
		const key = `${from}\u0000${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push({
			from,
			to
		});
	}
	edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
	return {
		nodes,
		edges,
		levels: tasks.length === 0 ? 0 : Math.max(...nodes.map((node) => node.level)) + 1
	};
}
function nodeToneOf(task) {
	switch (task.status) {
		case "completed": return "good";
		case "failed": return "danger";
		case "cancelled": return "neutral";
		case "in_progress": return "warn";
		case "pending": return task.blockedBy.length > 0 ? "danger" : "neutral";
		default: return "neutral";
	}
}
/** Number of tasks that transitively depend on the given task id. */
function downstreamCountOf(taskId, dependents) {
	const seen = /* @__PURE__ */ new Set();
	const stack = [...dependents.get(taskId) ?? []];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === void 0 || seen.has(current)) continue;
		seen.add(current);
		for (const next of dependents.get(current) ?? []) stack.push(next);
	}
	return seen.size;
}
//#endregion
//#region src/projection.ts
const memberStateSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	description: z.string(),
	provider: z.string(),
	context: z.enum(["fresh", "fork"]),
	phase: z.enum([
		"provisioning",
		"active",
		"failed"
	]),
	error: z.string().optional()
}).strict();
const taskStateSchema = z.object({
	id: z.string().min(1),
	revision: z.number().int().positive(),
	subject: z.string(),
	description: z.string(),
	status: z.enum([
		"pending",
		"in_progress",
		"completed",
		"deleted"
	]),
	ownerId: z.string().min(1).optional(),
	blockedBy: z.array(z.string().min(1)),
	writeScopes: z.array(z.string())
}).strict();
const contentBlockSchema = z.object({ type: z.string().min(1) }).passthrough();
const historyEntrySchema = z.object({
	id: z.string().min(1),
	seq: z.number().int().nonnegative(),
	time: z.number().int().nonnegative(),
	kind: z.enum([
		"member",
		"task",
		"message"
	]),
	type: z.string().min(1),
	title: z.string(),
	detail: z.string(),
	tone: z.enum([
		"neutral",
		"good",
		"warn",
		"danger"
	]),
	entityKey: z.string().optional(),
	count: z.number().int().positive().optional()
}).strict();
const messageStateSchema = z.object({
	id: z.string().min(1),
	senderId: z.string().min(1),
	senderName: z.string(),
	targetId: z.string().min(1),
	delivery: z.enum(["quiet", "wakeup"]),
	content: z.array(contentBlockSchema)
}).strict();
const stateSchema = z.object({
	teamId: z.string().min(1).nullable(),
	hasTeamEvents: z.boolean(),
	members: z.record(z.string(), memberStateSchema),
	tasks: z.record(z.string(), taskStateSchema),
	messages: z.record(z.string(), messageStateSchema),
	delivered: z.record(z.string(), z.literal(true)),
	history: z.array(historyEntrySchema).optional()
}).strict();
function initAgentTeamProjection() {
	return {
		teamId: null,
		hasTeamEvents: false,
		members: {},
		tasks: {},
		messages: {},
		delivered: {},
		history: []
	};
}
function isTeamEventType(type) {
	return isUpstreamTeamEventType(type) || type === "team/member" || type === "team/task" || type === "team/message/queued" || type === "team/message/delivered";
}
function teamIdOf(state, event) {
	const data = event.data;
	if (data.teamId !== void 0) return SessionId(data.teamId);
	return state.teamId;
}
function sameTeamOrUnset(state, teamId) {
	return state.teamId === null || state.teamId === teamId;
}
function historyEntryOf(event) {
	if (isUpstreamTeamEventType(event.type)) return upstreamHistoryEntryOf(event);
	const seq = event.seq;
	const time = typeof event.time === "number" ? event.time : 0;
	switch (event.type) {
		case "team/member": {
			const member = event.data.member;
			const tone = member.phase === "failed" ? "danger" : member.phase === "provisioning" ? "warn" : "good";
			return {
				id: `team/member:${seq}`,
				seq,
				time,
				kind: "member",
				type: event.type,
				title: `成员 ${member.name}`,
				detail: `phase ${member.phase}`,
				tone,
				entityKey: `member:${String(member.id)}`,
				count: 1
			};
		}
		case "team/task": {
			const task = event.data.task;
			const tone = task.status === "completed" ? "good" : task.status === "in_progress" ? "warn" : task.blockedBy.length > 0 ? "danger" : "neutral";
			return {
				id: `team/task:${seq}`,
				seq,
				time,
				kind: "task",
				type: event.type,
				title: `任务 ${task.subject}`,
				detail: `status ${task.status} · rev ${task.revision}`,
				tone,
				entityKey: `task:${String(task.id)}`,
				count: 1
			};
		}
		case "team/message/queued": {
			const message = event.data.message;
			return {
				id: `team/message/queued:${seq}`,
				seq,
				time,
				kind: "message",
				type: event.type,
				title: `消息 ${message.senderName} → ${message.targetId}`,
				detail: `已入队（${message.delivery}）`,
				tone: message.delivery === "wakeup" ? "warn" : "neutral",
				entityKey: `message:${String(message.id)}`,
				count: 1
			};
		}
		case "team/message/delivered": {
			const data = event.data;
			return {
				id: `team/message/delivered:${seq}`,
				seq,
				time,
				kind: "message",
				type: event.type,
				title: `消息 ${data.messageId}`,
				detail: `已送达（target ${data.targetId}）`,
				tone: "good",
				entityKey: `message:${String(data.messageId)}`,
				count: 1
			};
		}
		default: return null;
	}
}
/**
* Appends a history entry, coalescing with the most recent entry for the same
* entity (member/task/message id) so repeated events for one entity collapse
* into a single timeline row carrying a running count. The retained window is
* bounded by HISTORY_LIMIT (oldest distinct entities are dropped first).
*/
function appendHistory(state, event) {
	const entry = historyEntryOf(event);
	if (entry === null) return state;
	const history = [...state.history];
	const entityKey = entry.entityKey ?? entry.id;
	let mergeIndex = -1;
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const existing = history[index];
		if ((existing.entityKey ?? existing.id) === entityKey) {
			mergeIndex = index;
			break;
		}
	}
	if (mergeIndex >= 0) {
		const previous = history[mergeIndex];
		history[mergeIndex] = {
			...entry,
			count: (previous.count ?? 1) + 1
		};
	} else history.push(entry);
	return {
		...state,
		history: history.slice(-100)
	};
}
function applyAgentTeamEvent(state, event) {
	if (!isTeamEventType(event.type)) return state;
	const teamId = teamIdOf(state, event);
	if (teamId === null || !sameTeamOrUnset(state, teamId)) return state;
	if (isUpstreamTeamEventType(event.type)) {
		const next = applyUpstreamEvent(state, event);
		return next === null ? state : appendHistory(next, event);
	}
	switch (event.type) {
		case "team/member": {
			const member = event.data.member;
			return appendHistory({
				...state,
				teamId,
				hasTeamEvents: true,
				members: {
					...state.members,
					[member.id]: member
				}
			}, event);
		}
		case "team/task": {
			const task = event.data.task;
			return appendHistory({
				...state,
				teamId,
				hasTeamEvents: true,
				tasks: {
					...state.tasks,
					[task.id]: task
				}
			}, event);
		}
		case "team/message/queued": {
			const message = event.data.message;
			return appendHistory({
				...state,
				teamId,
				hasTeamEvents: true,
				messages: {
					...state.messages,
					[message.id]: message
				}
			}, event);
		}
		case "team/message/delivered": {
			const messageId = String(event.data.messageId);
			return appendHistory({
				...state,
				teamId,
				hasTeamEvents: true,
				delivered: {
					...state.delivered,
					[messageId]: true
				}
			}, event);
		}
		default: return state;
	}
}
function memberComparator(left, right) {
	if (left.role !== right.role) return left.role === "lead" ? -1 : 1;
	return left.name.localeCompare(right.name);
}
function taskRank(status) {
	switch (status) {
		case "in_progress": return 0;
		case "pending": return 1;
		case "completed": return 2;
		case "failed": return 3;
		case "cancelled": return 4;
	}
}
function memberView(member) {
	return {
		id: member.id,
		name: member.name,
		role: "teammate",
		phase: member.phase,
		sessionId: member.id
	};
}
function taskView(task) {
	if (task.status === "deleted") throw new Error("deleted tasks must be filtered before view conversion");
	return {
		id: task.id,
		subject: task.subject,
		description: task.description,
		status: task.status,
		ownerId: task.ownerId ?? null,
		blockedBy: [...task.blockedBy],
		writeScopes: [...task.writeScopes],
		revision: task.revision
	};
}
function messageView(message, deliveredIds) {
	return {
		id: message.id,
		senderId: message.senderId,
		senderName: message.senderName,
		targetId: message.targetId,
		delivery: message.delivery,
		content: [...message.content],
		delivered: deliveredIds.has(message.id)
	};
}
/** Count of tasks that transitively depend on the given task (risk propagation fan-out). */
function dependencyDepthOf(taskId, tasks) {
	const dependents = /* @__PURE__ */ new Map();
	for (const task of tasks) for (const dep of task.blockedBy) {
		const list = dependents.get(dep) ?? [];
		list.push(task.id);
		dependents.set(dep, list);
	}
	const seen = /* @__PURE__ */ new Set();
	const stack = [...dependents.get(taskId) ?? []];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === void 0 || seen.has(current)) continue;
		seen.add(current);
		for (const downstream of dependents.get(current) ?? []) stack.push(downstream);
	}
	return seen.size;
}
function taskInsightView(task, memberIds, dependencyDepth) {
	const reasons = [];
	let readiness = "ready";
	let severity = "low";
	if (task.status === "completed") {
		reasons.push("任务已完成。");
		return {
			taskId: task.id,
			subject: task.subject,
			status: task.status,
			readiness,
			reasons,
			severity,
			ownerId: task.ownerId,
			dependencyDepth,
			interventionPriority: 0
		};
	}
	if (task.status === "failed") {
		reasons.push("任务已失败（terminal）。");
		return {
			taskId: task.id,
			subject: task.subject,
			status: task.status,
			readiness: "failed",
			reasons,
			severity: "low",
			ownerId: task.ownerId,
			dependencyDepth,
			interventionPriority: 0
		};
	}
	if (task.status === "cancelled") {
		reasons.push("任务已取消（terminal）。");
		return {
			taskId: task.id,
			subject: task.subject,
			status: task.status,
			readiness: "cancelled",
			reasons,
			severity: "low",
			ownerId: task.ownerId,
			dependencyDepth,
			interventionPriority: 0
		};
	}
	if (task.status === "pending" && task.blockedBy.length > 0) {
		readiness = "blocked";
		severity = "high";
		reasons.push(`依赖未完成：${task.blockedBy.join(", ")}。`);
	}
	if (task.ownerId !== null && !memberIds.has(task.ownerId)) {
		readiness = "orphaned";
		severity = "high";
		reasons.push("任务 owner 在当前成员快照中不存在。");
	}
	if (task.status === "in_progress" && task.ownerId === null) {
		readiness = "stalled";
		severity = "high";
		reasons.push("任务处于进行中，但没有声明 owner。");
	}
	if (task.status === "in_progress" && task.ownerId !== null && memberIds.has(task.ownerId)) {
		readiness = "stalled";
		severity = "medium";
		reasons.push("任务处于进行中，但还没有证据表明它已经完成或解除占用。");
	}
	if (task.status === "pending" && task.blockedBy.length === 0 && task.ownerId === null) {
		readiness = "ready";
		severity = "medium";
		reasons.push("任务已 ready，但尚未声明 owner。");
	}
	if (task.status === "pending" && task.blockedBy.length === 0 && task.ownerId !== null && memberIds.has(task.ownerId)) {
		readiness = "stalled";
		severity = "medium";
		reasons.push("任务已具备执行条件，但仍停留在 pending。");
	}
	if (dependencyDepth > 0) reasons.push(`当前有 ${dependencyDepth} 个下游任务依赖它，解除它可释放整条链路。`);
	if (reasons.length === 0) reasons.push("当前没有明显异常。");
	return {
		taskId: task.id,
		subject: task.subject,
		status: task.status,
		readiness,
		reasons,
		severity,
		ownerId: task.ownerId,
		dependencyDepth,
		interventionPriority: 0
	};
}
function severityRank(severity) {
	switch (severity) {
		case "high": return 0;
		case "medium": return 1;
		case "low": return 2;
	}
}
function interventionScore(insight) {
	return Math.min(insight.dependencyDepth * 100, 500) + {
		high: 100,
		medium: 40,
		low: 0
	}[insight.severity] + {
		blocked: 30,
		orphaned: 30,
		stalled: 25,
		ready: 10,
		failed: 0,
		cancelled: 0
	}[insight.readiness];
}
function memberLoadViews(members, tasks, insights) {
	return members.filter((member) => member.role === "teammate").map((member) => {
		const ownedTasks = tasks.filter((task) => task.ownerId === member.id);
		const activeTaskCount = ownedTasks.filter((task) => task.status === "in_progress").length;
		const pendingOwnedTaskCount = ownedTasks.filter((task) => task.status === "pending").length;
		const stalledTaskCount = insights.filter((insight) => insight.ownerId === member.id && insight.readiness === "stalled").length;
		const orphanedTaskCount = insights.filter((insight) => insight.ownerId === member.id && insight.readiness === "orphaned").length;
		let level = "idle";
		if (activeTaskCount >= 3 || ownedTasks.length >= 4) level = "overloaded";
		else if (activeTaskCount >= 2 || ownedTasks.length >= 3 || stalledTaskCount > 0) level = "stretched";
		else if (ownedTasks.length > 0) level = "focused";
		return {
			memberId: member.id,
			memberName: member.name,
			level,
			activeTaskCount,
			pendingOwnedTaskCount,
			stalledTaskCount,
			orphanedTaskCount
		};
	}).sort((left, right) => {
		const rank = {
			overloaded: 0,
			stretched: 1,
			focused: 2,
			idle: 3
		};
		return rank[left.level] - rank[right.level] || left.memberName.localeCompare(right.memberName);
	});
}
function messageRiskView(message, failedTargets) {
	const reasons = [];
	let riskLevel = "low";
	if (!message.delivered) if (message.delivery === "wakeup") {
		riskLevel = "high";
		reasons.push("wakeup 消息尚未送达，目标可能无法被及时唤醒。");
	} else reasons.push("quiet 消息已记录到邮箱，等待目标读取。");
	if (failedTargets.has(String(message.targetId))) {
		riskLevel = "high";
		reasons.push("目标成员处于 failed 状态，消息可能无法被处理。");
	}
	if (reasons.length === 0) reasons.push("消息已送达，风险较低。");
	return {
		messageId: message.id,
		senderName: message.senderName,
		targetId: message.targetId,
		delivery: message.delivery,
		delivered: message.delivered,
		riskLevel,
		reasons
	};
}
function riskRank(riskLevel) {
	switch (riskLevel) {
		case "high": return 0;
		case "medium": return 1;
		case "low": return 2;
	}
}
function quickFiltersView(tasks, insights, memberLoads, messages, messageRisks) {
	const blockedCount = insights.filter((insight) => insight.readiness === "blocked").length;
	const stalledCount = insights.filter((insight) => insight.readiness === "stalled").length;
	const orphanedCount = insights.filter((insight) => insight.readiness === "orphaned").length;
	const readyCount = insights.filter((insight) => insight.readiness === "ready" && insight.status === "pending").length;
	const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
	const completedCount = tasks.filter((task) => task.status === "completed").length;
	const levelCounts = {
		idle: 0,
		focused: 0,
		stretched: 0,
		overloaded: 0
	};
	for (const load of memberLoads) levelCounts[load.level] += 1;
	const highRiskMessageCount = messageRisks.filter((risk) => risk.riskLevel === "high").length;
	const undeliveredCount = messages.filter((message) => !message.delivered).length;
	const wakeupCount = messages.filter((message) => message.delivery === "wakeup").length;
	const quietCount = messages.filter((message) => message.delivery === "quiet").length;
	const deliveredCount = messages.filter((message) => message.delivered).length;
	const failedTaskCount = insights.filter((insight) => insight.readiness === "failed").length;
	const cancelledTaskCount = insights.filter((insight) => insight.readiness === "cancelled").length;
	return {
		taskFilters: [
			{
				key: "all",
				label: "全部任务",
				count: tasks.length
			},
			{
				key: "in_progress",
				label: "进行中",
				count: inProgressCount
			},
			{
				key: "ready",
				label: "Ready",
				count: readyCount
			},
			{
				key: "blocked",
				label: "Blocked",
				count: blockedCount
			},
			{
				key: "stalled",
				label: "Stalled",
				count: stalledCount
			},
			{
				key: "orphaned",
				label: "Orphaned",
				count: orphanedCount
			},
			{
				key: "failed",
				label: "Failed",
				count: failedTaskCount
			},
			{
				key: "cancelled",
				label: "Cancelled",
				count: cancelledTaskCount
			},
			{
				key: "completed",
				label: "已完成",
				count: completedCount
			}
		],
		memberFilters: [
			{
				key: "all",
				label: "全部成员",
				count: memberLoads.length
			},
			{
				key: "overloaded",
				label: "Overloaded",
				count: levelCounts.overloaded
			},
			{
				key: "stretched",
				label: "Stretched",
				count: levelCounts.stretched
			},
			{
				key: "focused",
				label: "Focused",
				count: levelCounts.focused
			},
			{
				key: "idle",
				label: "Idle",
				count: levelCounts.idle
			}
		],
		messageFilters: [
			{
				key: "all",
				label: "全部消息",
				count: messages.length
			},
			{
				key: "undelivered",
				label: "待送达",
				count: undeliveredCount
			},
			{
				key: "high_risk",
				label: "高风险",
				count: highRiskMessageCount
			},
			{
				key: "wakeup",
				label: "Wakeup",
				count: wakeupCount
			},
			{
				key: "quiet",
				label: "Quiet",
				count: quietCount
			},
			{
				key: "delivered",
				label: "已送达",
				count: deliveredCount
			}
		]
	};
}
function timelineView(members, tasks, messages, history = []) {
	if (history.length > 0) return [...history].sort((left, right) => left.seq - right.seq).map((entry) => ({
		id: entry.id,
		kind: entry.kind,
		title: entry.title,
		detail: entry.detail,
		tone: entry.tone,
		time: entry.time,
		seq: entry.seq,
		count: entry.count
	}));
	const entries = [];
	for (const member of members) {
		if (member.role === "lead") continue;
		const tone = member.phase === "failed" ? "danger" : member.phase === "provisioning" ? "warn" : "good";
		entries.push({
			id: `member:${member.id}`,
			kind: "member",
			title: `成员 ${member.name}`,
			detail: `phase ${member.phase}`,
			tone
		});
	}
	for (const task of tasks) {
		const tone = task.status === "completed" ? "good" : task.status === "in_progress" ? "warn" : task.blockedBy.length > 0 ? "danger" : "neutral";
		entries.push({
			id: `task:${task.id}`,
			kind: "task",
			title: `任务 ${task.subject}`,
			detail: `status ${task.status}`,
			tone
		});
	}
	for (const message of messages) entries.push({
		id: `message:${message.id}`,
		kind: "message",
		title: `消息 ${message.senderName} → ${message.targetId}`,
		detail: message.delivered ? "已送达" : "待送达",
		tone: message.delivered ? "good" : "danger"
	});
	const kindRank = {
		task: 0,
		member: 1,
		message: 2
	};
	return entries.sort((left, right) => kindRank[left.kind] - kindRank[right.kind] || left.id.localeCompare(right.id));
}
function timelineSummaryView(timeline) {
	if (timeline.length === 0) return {
		totalEvents: 0,
		memberEvents: 0,
		taskEvents: 0,
		messageEvents: 0,
		coalescedEntries: 0,
		firstSeq: null,
		lastSeq: null,
		firstTime: null,
		lastTime: null,
		latestTitle: null
	};
	const memberEvents = timeline.filter((entry) => entry.kind === "member").length;
	const taskEvents = timeline.filter((entry) => entry.kind === "task").length;
	const messageEvents = timeline.filter((entry) => entry.kind === "message").length;
	const totalEvents = timeline.reduce((sum, entry) => sum + (entry.count ?? 1), 0);
	const coalescedEntries = timeline.filter((entry) => (entry.count ?? 1) > 1).length;
	const withSeq = timeline.filter((entry) => entry.seq !== void 0);
	const withTime = timeline.filter((entry) => entry.time !== void 0);
	const latest = timeline[timeline.length - 1] ?? null;
	return {
		totalEvents,
		memberEvents,
		taskEvents,
		messageEvents,
		coalescedEntries,
		firstSeq: withSeq[0]?.seq ?? null,
		lastSeq: withSeq[withSeq.length - 1]?.seq ?? null,
		firstTime: withTime[0]?.time ?? null,
		lastTime: withTime[withTime.length - 1]?.time ?? null,
		latestTitle: latest?.title ?? null
	};
}
function summaryView(members, tasks, messages, insights, memberLoads, messageRisks) {
	const teammateMembers = members.filter((member) => member.role !== "lead");
	const failedMembers = teammateMembers.filter((member) => member.phase === "failed");
	const pendingTasks = tasks.filter((task) => task.status === "pending");
	const inProgressTasks = tasks.filter((task) => task.status === "in_progress");
	const completedTasks = tasks.filter((task) => task.status === "completed");
	const blockedTasks = insights.filter((task) => task.readiness === "blocked");
	const stalledTasks = insights.filter((task) => task.readiness === "stalled");
	const orphanedTasks = insights.filter((task) => task.readiness === "orphaned");
	const readyTasks = insights.filter((task) => task.readiness === "ready" && task.status === "pending");
	const undeliveredMessages = messages.filter((message) => !message.delivered);
	const wakeupMessages = messages.filter((message) => message.delivery === "wakeup");
	const overloadedMembers = memberLoads.filter((load) => load.level === "overloaded");
	const stretchedMembers = memberLoads.filter((load) => load.level === "stretched");
	const highRiskMessages = messageRisks.filter((risk) => risk.riskLevel === "high");
	const topInterventions = insights.filter((insight) => insight.status !== "completed" && insight.status !== "failed" && insight.status !== "cancelled").sort((left, right) => left.interventionPriority - right.interventionPriority).slice(0, 5).map((insight) => {
		return `${insight.interventionPriority > 0 ? `P${insight.interventionPriority}` : "P-"} · ${insight.subject}（${insight.readiness}，依赖 ${insight.dependencyDepth} 下游）`;
	});
	const alerts = [];
	const recommendedActions = [];
	const captainBriefing = [];
	let healthScore = 100;
	if (failedMembers.length > 0) {
		healthScore -= Math.min(45, failedMembers.length * 25);
		alerts.push(`${failedMembers.length} 个成员处于 failed 状态，团队执行面存在明显风险。`);
		recommendedActions.push("优先检查 failed 成员对应的任务归属，并决定重试、替换还是由 Captain 接管。");
		captainBriefing.push(`失败成员 ${failedMembers.map((member) => member.name).join("、")} 需要优先处置。`);
	}
	if (blockedTasks.length > 0) {
		healthScore -= Math.min(20, blockedTasks.length * 8);
		alerts.push(`${blockedTasks.length} 个任务被依赖阻塞，吞吐正在下降。`);
		recommendedActions.push("优先解除阻塞链最前面的依赖任务，避免更多待处理任务继续堆积。");
		captainBriefing.push(`当前有 ${blockedTasks.length} 个阻塞任务，需要检查依赖链。`);
	}
	if (stalledTasks.length > 0) {
		healthScore -= Math.min(20, stalledTasks.length * 8);
		alerts.push(`${stalledTasks.length} 个任务出现 stalled 信号，说明 ready work 未有效推进。`);
		recommendedActions.push("重新确认 stalled 任务的 owner 和状态是否一致，必要时重新派单或催办。");
		captainBriefing.push(`存在 ${stalledTasks.length} 个 stalled 任务，建议立即核查执行责任。`);
	}
	if (orphanedTasks.length > 0) {
		healthScore -= Math.min(25, orphanedTasks.length * 10);
		alerts.push(`${orphanedTasks.length} 个任务处于 orphaned 状态，owner 关联已失效。`);
		recommendedActions.push("尽快为 orphaned 任务重新绑定可见成员，避免任务长时间悬空。");
		captainBriefing.push(`有 ${orphanedTasks.length} 个 orphaned 任务，需尽快重新归属。`);
	}
	if (undeliveredMessages.length > 0) {
		healthScore -= Math.min(15, undeliveredMessages.length * 5);
		alerts.push(`${undeliveredMessages.length} 条消息仍未送达，团队协作上下文可能不一致。`);
		recommendedActions.push("检查未送达消息的目标成员是否仍可用，并评估是否需要重发或改由 Captain 广播。");
	}
	if (highRiskMessages.length > 0) {
		healthScore -= Math.min(10, highRiskMessages.length * 4);
		captainBriefing.push(`有 ${highRiskMessages.length} 条高风险消息需要优先处理。`);
	}
	if (overloadedMembers.length > 0) {
		healthScore -= Math.min(15, overloadedMembers.length * 7);
		alerts.push(`${overloadedMembers.length} 名成员负载过高，团队存在局部过载。`);
		recommendedActions.push("把过载成员的一部分 ready work 转移给空闲或负载更低的成员。");
	}
	if (inProgressTasks.length > 0 && teammateMembers.length === 0) {
		healthScore -= 10;
		alerts.push("存在进行中任务，但没有可见 teammate 成员记录。");
		recommendedActions.push("确认当前 Team 是否只由 Captain 执行，或是否缺失成员生命周期事件。");
	}
	if (pendingTasks.length > 0 && inProgressTasks.length === 0) {
		healthScore -= 8;
		alerts.push("存在待处理任务，但当前没有任何任务处于进行中。");
		recommendedActions.push("为 ready 任务分配 owner，或确认调度器是否没有唤醒可执行成员。");
	}
	if (readyTasks.length > 0) captainBriefing.push(`当前有 ${readyTasks.length} 个 ready 任务可以尽快推进。`);
	if (stretchedMembers.length > 0) captainBriefing.push(`成员 ${stretchedMembers.map((member) => member.memberName).join("、")} 已接近负载上限。`);
	if (topInterventions.length > 0) captainBriefing.push(`建议优先干预：${topInterventions[0] ?? ""}`);
	if (recommendedActions.length === 0) recommendedActions.push("继续保持当前节奏，重点关注新阻塞和新失败事件。");
	if (captainBriefing.length === 0) captainBriefing.push("当前团队没有明显异常，可以继续保持既有节奏。");
	if (healthScore < 0) healthScore = 0;
	let statusLabel = "运行平稳";
	if (healthScore < 50) statusLabel = "需要立即干预";
	else if (healthScore < 80) statusLabel = "存在风险";
	const overviewParts = [
		`共有 ${teammateMembers.length} 名 teammate`,
		`${tasks.length} 个任务（${inProgressTasks.length} 进行中 / ${pendingTasks.length} 待处理 / ${completedTasks.length} 已完成）`,
		`${messages.length} 条团队消息`
	];
	if (failedMembers.length > 0) overviewParts.push(`${failedMembers.length} 名成员失败`);
	if (blockedTasks.length > 0) overviewParts.push(`${blockedTasks.length} 个任务阻塞`);
	if (stalledTasks.length > 0) overviewParts.push(`${stalledTasks.length} 个任务 stalled`);
	if (orphanedTasks.length > 0) overviewParts.push(`${orphanedTasks.length} 个任务 orphaned`);
	if (undeliveredMessages.length > 0) overviewParts.push(`${undeliveredMessages.length} 条消息待送达`);
	return {
		memberCount: teammateMembers.length,
		failedMemberCount: failedMembers.length,
		taskCount: tasks.length,
		pendingTaskCount: pendingTasks.length,
		inProgressTaskCount: inProgressTasks.length,
		completedTaskCount: completedTasks.length,
		blockedTaskCount: blockedTasks.length,
		stalledTaskCount: stalledTasks.length,
		orphanedTaskCount: orphanedTasks.length,
		readyTaskCount: readyTasks.length,
		overloadedMemberCount: overloadedMembers.length,
		messageCount: messages.length,
		undeliveredMessageCount: undeliveredMessages.length,
		wakeupMessageCount: wakeupMessages.length,
		highRiskMessageCount: highRiskMessages.length,
		healthScore,
		statusLabel,
		overview: overviewParts.join("，") + "。",
		alerts,
		recommendedActions,
		captainBriefing,
		topInterventions
	};
}
function viewAgentTeam(state) {
	if (!state.hasTeamEvents || state.teamId === null) return null;
	const deliveredIds = new Set(Object.keys(state.delivered));
	const members = [{
		id: state.teamId,
		name: "lead",
		role: "lead",
		phase: "active",
		sessionId: state.teamId
	}, ...Object.values(state.members).filter((member) => member.id !== state.teamId).map(memberView)].sort(memberComparator);
	const tasks = Object.values(state.tasks).filter((task) => task.status !== "deleted").map(taskView).sort((left, right) => taskRank(left.status) - taskRank(right.status) || left.id.localeCompare(right.id));
	const messages = Object.values(state.messages).map((message) => messageView(message, deliveredIds)).sort((left, right) => left.id.localeCompare(right.id));
	const memberIds = new Set(members.map((member) => String(member.id)));
	const taskInsights = tasks.map((task) => taskInsightView(task, memberIds, dependencyDepthOf(task.id, tasks))).sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.taskId.localeCompare(right.taskId));
	const prioritizedInsights = [...taskInsights].sort((left, right) => interventionScore(right) - interventionScore(left));
	const priorityByTaskId = new Map(prioritizedInsights.map((insight, index) => [insight.taskId, index + 1]));
	const rankedInsights = taskInsights.map((insight) => ({
		...insight,
		interventionPriority: priorityByTaskId.get(insight.taskId) ?? 0
	}));
	const blockedTasks = tasks.filter((task) => rankedInsights.some((insight) => insight.taskId === task.id && insight.readiness === "blocked"));
	const activeTasks = tasks.filter((task) => task.status === "in_progress");
	const pendingTasks = tasks.filter((task) => task.status === "pending");
	const completedTasks = tasks.filter((task) => task.status === "completed");
	const stalledTasks = tasks.filter((task) => rankedInsights.some((insight) => insight.taskId === task.id && insight.readiness === "stalled"));
	const orphanedTasks = tasks.filter((task) => rankedInsights.some((insight) => insight.taskId === task.id && insight.readiness === "orphaned"));
	const readyTasks = tasks.filter((task) => rankedInsights.some((insight) => insight.taskId === task.id && insight.readiness === "ready" && task.status === "pending"));
	const memberLoads = memberLoadViews(members, tasks, rankedInsights);
	const failedTargetIds = new Set(members.filter((member) => member.role === "teammate" && member.phase === "failed").map((member) => String(member.id)));
	const messageRisks = messages.map((message) => messageRiskView(message, failedTargetIds)).sort((left, right) => riskRank(left.riskLevel) - riskRank(right.riskLevel) || left.messageId.localeCompare(right.messageId));
	const quickFilters = quickFiltersView(tasks, rankedInsights, memberLoads, messages, messageRisks);
	const timeline = timelineView(members, tasks, messages, state.history ?? []);
	const timelineSummary = timelineSummaryView(timeline);
	const timelineMilestones = timelineMilestonesView(timeline);
	const dependencyDag = dependencyDagView(tasks, new Map(members.map((member) => [String(member.id), member.name])));
	const summary = summaryView(members, tasks, messages, rankedInsights, memberLoads, messageRisks);
	const commandPlan = commandPlanView({
		teamId: state.teamId,
		members,
		taskInsights: rankedInsights,
		memberLoads,
		messageRisks
	});
	return {
		teamId: state.teamId,
		leadMemberId: state.teamId,
		members,
		tasks,
		messages,
		blockedTasks,
		activeTasks,
		pendingTasks,
		completedTasks,
		stalledTasks,
		orphanedTasks,
		readyTasks,
		taskInsights: rankedInsights,
		memberLoads,
		messageRisks,
		quickFilters,
		timeline,
		timelineSummary,
		timelineMilestones,
		dependencyDag,
		commandPlan,
		summary
	};
}
const memberViewSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	role: z.enum(["lead", "teammate"]),
	phase: z.enum([
		"provisioning",
		"active",
		"failed"
	]),
	sessionId: z.string().min(1)
}).strict();
const taskViewSchema = z.object({
	id: z.string().min(1),
	subject: z.string(),
	description: z.string(),
	status: z.enum([
		"pending",
		"in_progress",
		"completed",
		"failed",
		"cancelled"
	]),
	ownerId: z.string().min(1).nullable(),
	blockedBy: z.array(z.string().min(1)),
	writeScopes: z.array(z.string()),
	revision: z.number().int().positive()
}).strict();
const taskInsightViewSchema = z.object({
	taskId: z.string().min(1),
	subject: z.string(),
	status: z.enum([
		"pending",
		"in_progress",
		"completed",
		"failed",
		"cancelled"
	]),
	readiness: z.enum([
		"ready",
		"blocked",
		"orphaned",
		"stalled",
		"failed",
		"cancelled"
	]),
	reasons: z.array(z.string()),
	severity: z.enum([
		"low",
		"medium",
		"high"
	]),
	ownerId: z.string().min(1).nullable(),
	dependencyDepth: z.number().int().nonnegative(),
	interventionPriority: z.number().int().nonnegative()
}).strict();
const memberLoadViewSchema = z.object({
	memberId: z.string().min(1),
	memberName: z.string(),
	level: z.enum([
		"idle",
		"focused",
		"stretched",
		"overloaded"
	]),
	activeTaskCount: z.number().int().nonnegative(),
	pendingOwnedTaskCount: z.number().int().nonnegative(),
	stalledTaskCount: z.number().int().nonnegative(),
	orphanedTaskCount: z.number().int().nonnegative()
}).strict();
const messageViewSchema = z.object({
	id: z.string().min(1),
	senderId: z.string().min(1),
	senderName: z.string(),
	targetId: z.string().min(1),
	delivery: z.enum(["quiet", "wakeup"]),
	content: z.array(contentBlockSchema),
	delivered: z.boolean()
}).strict();
const messageRiskViewSchema = z.object({
	messageId: z.string().min(1),
	senderName: z.string(),
	targetId: z.string().min(1),
	delivery: z.enum(["quiet", "wakeup"]),
	delivered: z.boolean(),
	riskLevel: z.enum([
		"low",
		"medium",
		"high"
	]),
	reasons: z.array(z.string())
}).strict();
const filterOptionSchema = z.object({
	key: z.string().min(1),
	label: z.string(),
	count: z.number().int().nonnegative()
}).strict();
const quickFiltersViewSchema = z.object({
	taskFilters: z.array(filterOptionSchema),
	memberFilters: z.array(filterOptionSchema),
	messageFilters: z.array(filterOptionSchema)
}).strict();
const timelineEntryViewSchema = z.object({
	id: z.string().min(1),
	kind: z.enum([
		"member",
		"task",
		"message"
	]),
	title: z.string(),
	detail: z.string(),
	tone: z.enum([
		"neutral",
		"good",
		"warn",
		"danger"
	]),
	time: z.number().int().nonnegative().optional(),
	seq: z.number().int().nonnegative().optional(),
	count: z.number().int().positive().optional()
}).strict();
const timelineSummaryViewSchema = z.object({
	totalEvents: z.number().int().nonnegative(),
	memberEvents: z.number().int().nonnegative(),
	taskEvents: z.number().int().nonnegative(),
	messageEvents: z.number().int().nonnegative(),
	coalescedEntries: z.number().int().nonnegative(),
	firstSeq: z.number().int().nonnegative().nullable(),
	lastSeq: z.number().int().nonnegative().nullable(),
	firstTime: z.number().int().nonnegative().nullable(),
	lastTime: z.number().int().nonnegative().nullable(),
	latestTitle: z.string().nullable()
}).strict();
const timelineMilestoneWindowViewSchema = z.object({
	windowId: z.string().min(1),
	startSeq: z.number().int().nonnegative().nullable(),
	endSeq: z.number().int().nonnegative().nullable(),
	entryCount: z.number().int().positive(),
	eventCount: z.number().int().positive(),
	memberEvents: z.number().int().nonnegative(),
	taskEvents: z.number().int().nonnegative(),
	messageEvents: z.number().int().nonnegative(),
	headline: z.string().min(1),
	headlineTone: z.enum([
		"neutral",
		"good",
		"warn",
		"danger"
	])
}).strict();
const commandSuggestionViewSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(AGENT_TEAM_COMMAND_KINDS),
	label: z.string(),
	targetId: z.string().min(1),
	targetLabel: z.string(),
	priority: z.enum([
		"low",
		"medium",
		"high"
	]),
	rationale: z.string()
}).strict();
const commandPlanViewSchema = z.object({
	version: z.literal(1),
	generatedFromTeamId: z.string().min(1),
	total: z.number().int().nonnegative(),
	highPriorityCount: z.number().int().nonnegative(),
	mediumPriorityCount: z.number().int().nonnegative(),
	lowPriorityCount: z.number().int().nonnegative(),
	commands: z.array(commandSuggestionViewSchema)
}).strict();
const dagNodeViewSchema = z.object({
	id: z.string().min(1),
	subject: z.string(),
	status: z.enum([
		"pending",
		"in_progress",
		"completed",
		"failed",
		"cancelled"
	]),
	tone: z.enum([
		"neutral",
		"good",
		"warn",
		"danger"
	]),
	ownerName: z.string().nullable(),
	level: z.number().int().nonnegative(),
	position: z.number().int().nonnegative(),
	dependencyDepth: z.number().int().nonnegative()
}).strict();
const dagEdgeViewSchema = z.object({
	from: z.string().min(1),
	to: z.string().min(1)
}).strict();
const dagViewSchema = z.object({
	nodes: z.array(dagNodeViewSchema),
	edges: z.array(dagEdgeViewSchema),
	levels: z.number().int().nonnegative()
}).strict();
const summaryViewSchema = z.object({
	memberCount: z.number().int().nonnegative(),
	failedMemberCount: z.number().int().nonnegative(),
	taskCount: z.number().int().nonnegative(),
	pendingTaskCount: z.number().int().nonnegative(),
	inProgressTaskCount: z.number().int().nonnegative(),
	completedTaskCount: z.number().int().nonnegative(),
	blockedTaskCount: z.number().int().nonnegative(),
	stalledTaskCount: z.number().int().nonnegative(),
	orphanedTaskCount: z.number().int().nonnegative(),
	readyTaskCount: z.number().int().nonnegative(),
	overloadedMemberCount: z.number().int().nonnegative(),
	messageCount: z.number().int().nonnegative(),
	undeliveredMessageCount: z.number().int().nonnegative(),
	wakeupMessageCount: z.number().int().nonnegative(),
	highRiskMessageCount: z.number().int().nonnegative(),
	healthScore: z.number().int().min(0).max(100),
	statusLabel: z.string(),
	overview: z.string(),
	alerts: z.array(z.string()),
	recommendedActions: z.array(z.string()),
	captainBriefing: z.array(z.string()),
	topInterventions: z.array(z.string())
}).strict();
const agentTeamProjectionDefinition = {
	key: "agentTeam",
	stateSchema,
	init: initAgentTeamProjection,
	apply: applyAgentTeamEvent,
	wire: {
		viewSchema: z.object({
			teamId: z.string().min(1),
			leadMemberId: z.string().min(1),
			members: z.array(memberViewSchema),
			tasks: z.array(taskViewSchema),
			messages: z.array(messageViewSchema),
			blockedTasks: z.array(taskViewSchema),
			activeTasks: z.array(taskViewSchema),
			pendingTasks: z.array(taskViewSchema),
			completedTasks: z.array(taskViewSchema),
			stalledTasks: z.array(taskViewSchema),
			orphanedTasks: z.array(taskViewSchema),
			readyTasks: z.array(taskViewSchema),
			taskInsights: z.array(taskInsightViewSchema),
			memberLoads: z.array(memberLoadViewSchema),
			messageRisks: z.array(messageRiskViewSchema),
			quickFilters: quickFiltersViewSchema,
			timeline: z.array(timelineEntryViewSchema),
			timelineSummary: timelineSummaryViewSchema,
			timelineMilestones: z.array(timelineMilestoneWindowViewSchema),
			dependencyDag: dagViewSchema,
			commandPlan: commandPlanViewSchema,
			summary: summaryViewSchema
		}).strict().nullable(),
		view: viewAgentTeam
	},
	stateVersion: 1
};
//#endregion
//#region src/index.ts
const inject = ["sessionProjections"];
function apply(ctx) {
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(agentTeamProjectionDefinition);
	});
}
//#endregion
export { agentTeamProjectionDefinition, apply, inject };

//# sourceMappingURL=index.js.map