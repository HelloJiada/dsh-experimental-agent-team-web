window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-experimental-agent-team-web",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		/** Use a fill-width grid when the task graph has no real dependency edges. */
		function usesParallelTaskGrid(tasks) {
			if (tasks.length === 0) return false;
			const taskIds = new Set(tasks.map((task) => task.id));
			return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)));
		}
		/**
		* Whether an expanded activity panel still belongs to the current session.
		*
		* The panel is mounted in the root-scoped shell overlay, so React does not
		* remount it when the conversation route changes. Ownership keeps an expanded
		* panel from leaking onto the new-session screen (or another conversation)
		* while its local open state is being reset.
		*/
		function activityPanelExpandedForSession(open, owner, current) {
			return open && owner !== void 0 && owner === current;
		}
		/**
		* Resolve the task whose dependency chain should be highlighted.
		*
		* A pinned task is an explicit user choice. Keyboard focus takes precedence
		* over delayed pointer intent so an older hover timer cannot steal the active
		* chain from someone navigating the task map with the keyboard.
		*/
		function dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId) {
			return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId;
		}
		/** Group tasks by their precomputed dependency depth. */
		function taskStages(tasks) {
			const byDepth = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
				const stage = byDepth.get(depth) ?? [];
				stage.push(task);
				byDepth.set(depth, stage);
			}
			return [...byDepth.entries()].sort(([left], [right]) => left - right).map(([depth, stageTasks]) => ({
				depth,
				tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }))
			}));
		}
		/**
		* Lay tasks out as the reference panel's compact left-to-right DAG.
		*
		* Columns are dependency-depth stages. Rows are stable task-id order within
		* each stage. Edges use cubic curves so fan-in remains readable without
		* turning every task into a large card.
		*/
		function compactDagLayout(tasks) {
			const stages = taskStages(tasks);
			const positions = /* @__PURE__ */ new Map();
			const nodes = [];
			for (const [column, stage] of stages.entries()) for (const [row, task] of stage.tasks.entries()) {
				const x = column * 118;
				const y = row * 38;
				positions.set(task.id, {
					x,
					y
				});
				nodes.push({
					task,
					x,
					y
				});
			}
			const edges = [];
			for (const task of tasks) {
				const target = positions.get(task.id);
				if (target === void 0) continue;
				for (const dependency of task.dependencies) {
					const source = positions.get(dependency);
					if (source === void 0) continue;
					const x1 = source.x + 92;
					const y1 = source.y + 30 / 2;
					const x2 = target.x;
					const y2 = target.y + 30 / 2;
					edges.push({
						from: dependency,
						to: task.id,
						path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`
					});
				}
			}
			const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length));
			return {
				width: stages.length === 0 ? 0 : stages.length * 92 + (stages.length - 1) * 26,
				height: stages.length === 0 ? 0 : rows * 30 + (rows - 1) * 8,
				nodes,
				edges
			};
		}
		/**
		* Return the complete upstream/downstream chain around one task.
		*
		* Traversal uses both dependency directions and remains cycle-safe, so the UI
		* can highlight every handoff related to the focused task even if malformed
		* durable data contains a cycle.
		*/
		function relatedTaskIds(taskId, tasks) {
			const byId = new Map(tasks.map((task) => [task.id, task]));
			if (!byId.has(taskId)) return /* @__PURE__ */ new Set();
			const dependents = /* @__PURE__ */ new Map();
			for (const task of tasks) for (const dependency of task.dependencies) {
				const targets = dependents.get(dependency) ?? [];
				targets.push(task.id);
				dependents.set(dependency, targets);
			}
			const related = /* @__PURE__ */ new Set();
			const upstreamSeen = /* @__PURE__ */ new Set();
			const downstreamSeen = /* @__PURE__ */ new Set();
			const visitUpstream = (id) => {
				if (upstreamSeen.has(id)) return;
				upstreamSeen.add(id);
				related.add(id);
				for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency);
			};
			const visitDownstream = (id) => {
				if (downstreamSeen.has(id)) return;
				downstreamSeen.add(id);
				related.add(id);
				for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent);
			};
			visitUpstream(taskId);
			visitDownstream(taskId);
			return related;
		}
		//#endregion
		//#region src/client/archive-filter.ts
		/** 默认筛选:全部团队 / 全部时间 / 全部复盘。 */
		const ARCHIVE_DEFAULT_FILTER = {
			team: "",
			timeRange: "all",
			retro: "all"
		};
		/** 时间区间毫秒数(近 N 天)。 */
		const ARCHIVE_TIME_RANGE_MS = {
			"7d": 10080 * 60 * 1e3,
			"30d": 720 * 60 * 60 * 1e3,
			"90d": 2160 * 60 * 60 * 1e3
		};
		/** 下拉候选顺序(稳定展示)。 */
		const ARCHIVE_TIME_RANGES = [
			"all",
			"7d",
			"30d",
			"90d"
		];
		const ARCHIVE_RETRO_FILTERS = [
			"all",
			"hasRetro",
			"overran",
			"noRetro"
		];
		/** 团队时间锚点:最晚的终结时间(completedAt 优先,回退 retro.createdAt)。 */
		function archiveTeamTimeMs(team) {
			let latest;
			for (const task of team.tasks) {
				const candidate = task.completedAt ?? task.retro?.createdAt;
				if (candidate !== void 0 && (latest === void 0 || candidate > latest)) latest = candidate;
			}
			return latest;
		}
		/** 扫描团队任务的复盘状态,派生画像(纯函数)。 */
		function archiveTeamRetroProfile(team) {
			let hasRetro = false;
			let overran = false;
			let missingRetro = false;
			for (const task of team.tasks) if (task.retro !== void 0 && task.retro !== null) {
				hasRetro = true;
				if (task.retro.overran === true) overran = true;
			} else if (task.status === "completed") missingRetro = true;
			return {
				hasRetro,
				overran,
				missingRetro
			};
		}
		/** 单团队是否通过筛选(纯函数)。 */
		function archiveTeamMatches(team, filter, now) {
			if (filter.team !== "" && filter.team !== team.name) return false;
			if (filter.timeRange !== "all") {
				const anchor = archiveTeamTimeMs(team);
				if (anchor === void 0) return false;
				if (now - anchor > ARCHIVE_TIME_RANGE_MS[filter.timeRange]) return false;
			}
			if (filter.retro !== "all") {
				const profile = archiveTeamRetroProfile(team);
				if (filter.retro === "hasRetro" && !profile.hasRetro) return false;
				if (filter.retro === "overran" && !profile.overran) return false;
				if (filter.retro === "noRetro" && !profile.missingRetro) return false;
			}
			return true;
		}
		/**
		* 按筛选状态过滤归档团队(保持原顺序)。纯函数。
		* 泛型保留具体团队类型(如 ActivityTeam),调用方无需窄化。
		* `now` 显式传入以便测试边界;默认取当前时刻。
		*/
		function filterArchivedTeams(teams, filter, now = Date.now()) {
			return teams.filter((team) => archiveTeamMatches(team, filter, now));
		}
		/** 全部归档团队的团队名候选(用于团队下拉),按出现顺序去重。 */
		function archivedTeamNames(teams) {
			const seen = /* @__PURE__ */ new Set();
			const names = [];
			for (const team of teams) {
				if (seen.has(team.name)) continue;
				seen.add(team.name);
				names.push(team.name);
			}
			return names;
		}
		//#endregion
		//#region src/web-auth-constants.ts
		/**
		* Wire constants shared by the host routes and the browser panel. Both halves
		* must agree on these literals, so they live in one dependency-free module
		* (no `node:*` imports) compiled into each face.
		* @module dsh-agent-team-web/web-auth-constants
		*/
		/** `globalThis` name the boot token rides into the served HTML (index-inject global row). */
		const TOKEN_GLOBAL = "__DSH_AGENT_TEAMS_TOKEN";
		/** Header the browser panel echoes with the boot token. */
		const TOKEN_HEADER = "x-dsh-agent-teams-token";
		/** Exact route path serving live and archived team snapshots. */
		const STATE_PATH = "/plugins/agent-team-web/state";
		//#endregion
		//#region src/client/activity-monitor.ts
		const targets = /* @__PURE__ */ new Map();
		const targetListeners = /* @__PURE__ */ new Set();
		const snapshotListeners = /* @__PURE__ */ new Set();
		let targetSnapshot = [];
		let activitySnapshots = {
			teams: [],
			archivedTeams: []
		};
		function targetKey(sessionId, teamId) {
			return `${sessionId}\u0000${teamId}`;
		}
		function publishTargets() {
			targetSnapshot = [...targets.values()].filter((target) => target.active).map(({ key, sessionId, teamId }) => ({
				key,
				sessionId,
				teamId
			}));
			for (const listener of targetListeners) listener();
		}
		/** Subscribe to the active monitor-target list (React external-store shape). */
		function subscribeActivityMonitorTargets(listener) {
			targetListeners.add(listener);
			return () => {
				targetListeners.delete(listener);
			};
		}
		/** Read the stable active-target snapshot. */
		function getActivityMonitorTargetsSnapshot() {
			return targetSnapshot;
		}
		/**
		* Register one successful AgentTeams card as a monitoring demand.
		*
		* The returned cleanup is reference-counted so multiple cards and React
		* StrictMode remounts cannot stop another card's monitor.
		*/
		function monitorAgentTeam(sessionId, teamId) {
			const owner = sessionId.trim();
			const id = teamId.trim();
			if (owner === "" || id === "") return () => {};
			const key = targetKey(owner, id);
			const existing = targets.get(key);
			if (existing === void 0) {
				targets.set(key, {
					key,
					sessionId: owner,
					teamId: id,
					refs: 1,
					active: true
				});
				publishTargets();
			} else {
				existing.refs += 1;
				if (!existing.active) {
					existing.active = true;
					publishTargets();
				}
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = targets.get(key);
				if (current === void 0) return;
				current.refs -= 1;
				if (current.refs <= 0) {
					targets.delete(key);
					if (current.active) publishTargets();
				}
			};
		}
		/** Stop polling targets whose final archived snapshot has been captured. */
		function settleActivityMonitorTargets(keys) {
			let changed = false;
			for (const key of keys) {
				const target = targets.get(key);
				if (target?.active !== true) continue;
				target.active = false;
				changed = true;
			}
			if (changed) publishTargets();
		}
		/** Subscribe to the shared live/archive snapshot. */
		function subscribeActivitySnapshots(listener) {
			snapshotListeners.add(listener);
			return () => {
				snapshotListeners.delete(listener);
			};
		}
		/** Read the stable shared live/archive snapshot. */
		function getActivitySnapshotsSnapshot() {
			return activitySnapshots;
		}
		/** Publish one or both successful state-route responses. */
		function updateActivitySnapshots(update) {
			const next = {
				teams: update.teams ?? activitySnapshots.teams,
				archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams
			};
			if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return;
			activitySnapshots = next;
			for (const listener of snapshotListeners) listener();
		}
		/** Poll cadence for the live host snapshot route. */
		const ACTIVITY_POLL_MS = 1e3;
		/**
		* Low-frequency probe cadence while a cardless discovery session still owns
		* no team. The probe keeps the panel able to pick up a team created later in
		* that session (e.g. a run_code-wrapped agent_teams_create) without turning
		* every ordinary session into a one-second filesystem scan.
		*/
		const ACTIVITY_PROBE_MS = 5e3;
		/** Host route serving live and archived team snapshots. */
		const ACTIVITY_STATE_URL = STATE_PATH;
		/** The boot token injected into the served HTML, or undefined outside the GUI. */
		function agentTeamsWebToken() {
			const token = globalThis[TOKEN_GLOBAL];
			return typeof token === "string" && token !== "" ? token : void 0;
		}
		/** Fetch init for AgentTeams web routes, carrying the boot token when present. */
		function agentTeamsFetchInit(signal) {
			const token = agentTeamsWebToken();
			return {
				cache: "no-store",
				signal,
				...token === void 0 ? {} : { headers: { [TOKEN_HEADER]: token } }
			};
		}
		/**
		* Start the single polling loop for the current session's requested targets.
		*
		* With neither targets nor a discovery session this is deliberately inert.
		* Explicit card targets poll at the live cadence from the start. A discovery
		* session performs an immediate live+archive restore pass, then — while it
		* still owns no team — probes on a low-frequency cadence, so a team created
		* later in that session (e.g. a run_code-wrapped agent_teams_create) is
		* discovered without a manual reload, without turning every ordinary session
		* into a one-second filesystem scan. The moment a team for the discovery
		* session appears, the controller upgrades to the live one-second cadence for
		* the rest of its lifetime. The caller — the session view, which stops the
		* controller when the session is no longer current — bounds the lifetime, and
		* archive state is refreshed when a target or a previously discovered live
		* team disappears.
		*/
		function startActivityPolling(monitorTargets, runtime = {}) {
			const discoverySessionId = runtime.discoverySessionId?.trim();
			if (monitorTargets.length === 0 && (discoverySessionId === void 0 || discoverySessionId === "")) return {
				firstTick: Promise.resolve(),
				stop: () => {}
			};
			const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init));
			const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
			const cancel = runtime.cancel ?? ((timer) => {
				clearInterval(timer);
			});
			const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots;
			const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets;
			let cancelled = false;
			let inFlight = false;
			let hot = monitorTargets.length > 0;
			let discoveryComplete = false;
			let discoveredLiveKeys = /* @__PURE__ */ new Set();
			let controller;
			let timer;
			const intervalMs = () => hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS;
			const reschedule = () => {
				cancel(timer);
				timer = schedule(() => {
					tick();
				}, intervalMs());
			};
			const tick = async () => {
				if (inFlight || cancelled) return;
				inFlight = true;
				controller = new AbortController();
				try {
					const liveResponse = await fetchState(ACTIVITY_STATE_URL, agentTeamsFetchInit(controller.signal));
					if (!liveResponse.ok) return;
					const body = await liveResponse.json();
					if (cancelled || !Array.isArray(body.teams)) return;
					const liveTeams = body.teams;
					publishSnapshots({ teams: liveTeams });
					const previousDiscoveredKeys = discoveredLiveKeys;
					discoveredLiveKeys = new Set(discoverySessionId === void 0 || discoverySessionId === "" ? [] : liveTeams.filter((team) => team.captainSessionId === discoverySessionId).map((team) => team.teamId));
					if (!hot && discoveredLiveKeys.size > 0) {
						hot = true;
						reschedule();
					}
					const discoveredTeamArchived = [...previousDiscoveredKeys].some((teamId) => !discoveredLiveKeys.has(teamId));
					const missing = monitorTargets.filter((target) => !liveTeams.some((team) => team.captainSessionId === target.sessionId && team.teamId === target.teamId));
					const needsDiscoveryArchive = discoverySessionId !== void 0 && discoverySessionId !== "" && !discoveryComplete;
					if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return;
					const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, agentTeamsFetchInit(controller.signal));
					if (!archivedResponse.ok) return;
					const archivedBody = await archivedResponse.json();
					if (cancelled || !Array.isArray(archivedBody.teams)) return;
					publishSnapshots({ archivedTeams: archivedBody.teams });
					discoveryComplete = true;
					settleTargets(new Set(missing.map((target) => target.key)));
				} catch (error) {
					if (error?.name === "AbortError") return;
				} finally {
					inFlight = false;
				}
			};
			const firstTick = tick();
			if (timer === void 0) timer = schedule(() => {
				tick();
			}, intervalMs());
			return {
				firstTick,
				stop: () => {
					if (cancelled) return;
					cancelled = true;
					controller?.abort();
					cancel(timer);
				}
			};
		}
		//#endregion
		//#region src/client/artwork.ts
		/**
		* Shared whale artwork lookup for the activity panel and the conversation
		* card: role keywords map to the packaged role images; the captain always
		* uses the lead whale.
		* @module dsh-agent-team-web/client/artwork
		*/
		/** Artwork route prefix served by the plugin host half. */
		const ART_BASE = "/plugins/agent-team-web/assets/";
		/** V2 whale role artwork per role keyword. */
		const ROLE_ART = [
			[/commissar|political|政委|政治委员|监督/, "member-commissar-v2.png"],
			[/data|analys|metric|performance|数据|分析|指标|性能|情报/, "member-data-v2.png"],
			[/resear|investig|explor|study|研究|调查|探索|调研|侦察|参谋/, "member-researcher-v2.png"],
			[/\bqa\b|test|verif|quality|测试|质量|验证|质检/, "member-qa-v2.png"],
			[/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程|技术/, "member-engineer-v2.png"],
			[/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍|文宣|宣传|干事/, "member-designer-v2.png"],
			[/\breviewer\b|审查员|核验/, "member-security-v2.png"],
			[/secur|audit|risk|threat|review|安全|审计|审查|风险|警卫/, "member-security-v2.png"],
			[/docs|writer|product|spec|撰写|文案|写作|文档|规范|文书/, "member-docs-v2.png"],
			[/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调|后勤|保障/, "member-operator-v2.png"]
		];
		/** Captain artwork (always the lead whale). */
		const LEAD_ART = `${ART_BASE}team-lead-v2.png`;
		/** Status action artwork per member activity. */
		const ACTION_ART = {
			working: `${ART_BASE}action-working-v2.png`,
			idle: `${ART_BASE}action-sleeping-v2.png`,
			unknown: `${ART_BASE}action-thinking-v2.png`
		};
		/**
		* Member artwork URL, or null when no role matches (initial-letter fallback).
		* @param name - the member's display name.
		* @param role - the member's role text.
		* @returns the artwork URL, or null when unmatched.
		*/
		function memberArtUrl(name, role) {
			const identity = `${name} ${role}`.toLowerCase();
			for (const [pattern, art] of ROLE_ART) if (pattern.test(identity)) return `${ART_BASE}${art}`;
			return null;
		}
		//#endregion
		//#region src/client/locales.ts
		/** `agentTeamWeb` namespace dictionaries for every plugin-owned Web surface. */
		/** Dictionary namespace owned by the AgentTeams client plugin. */
		const AGENT_TEAMS_LOCALE_NAMESPACE = "agentTeamWeb";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"card.memberCount": "{count} 名成员",
			"action.openActivityPanel": "打开活动面板",
			"activity.panelButton": "活动面板",
			"activity.badgeAria": "AgentTeams 活动，{count} 个团队",
			"activity.panelAria": "AgentTeams 活动面板",
			"activity.title": "AgentTeams 活动",
			"activity.float": "切换为浮动面板",
			"activity.dockRight": "停靠到右侧",
			"activity.collapse": "收起活动面板",
			"activity.close": "结束并归档团队",
			"activity.closeDisabled": "任务执行中，暂不可关闭",
			"activity.closing": "归档中…",
			"activity.closeError": "归档失败，请重试",
			"activity.empty": "暂无团队活动",
			"format.listSeparator": "、",
			"task.status.pending": "待领取",
			"task.status.claimed": "已认领",
			"task.status.inProgress": "进行中",
			"task.status.completed": "已完成",
			"task.status.failed": "失败",
			"task.status.cancelled": "已取消",
			"member.state.working": "工作中",
			"member.state.failed": "有失败",
			"member.state.waiting": "等待",
			"member.state.delivered": "已交付",
			"member.state.left": "已离队",
			"member.state.removed": "已移除",
			"member.state.pending": "待执行",
			"member.state.unassigned": "待派工",
			"member.status.executing": "正在执行 {taskId}",
			"member.status.helping": "正在协助 {taskId}",
			"member.status.working": "正在处理已派任务",
			"member.status.waitingOn": "等待 {taskId} · {assignee}",
			"member.status.waitingPrerequisite": "等待前置任务",
			"member.status.waitingAssignment": "等待队长派工",
			"member.status.delivered": "任务已交付",
			"member.status.idle": "待继续执行",
			"member.status.unknown": "状态未知",
			"task.assignee.unclaimed": "待认领",
			"task.summary.waitingBreakdown": "等待队长拆解任务",
			"task.summary.allDelivered": "全部 {count} 项任务已交付",
			"task.summary.blockedAndRunning": "{tasks}{more} 等待前置，其余已开工",
			"task.summary.more": " 等 {count} 项",
			"task.summary.running": "{tasks} 正在执行",
			"task.summary.ready": "{tasks} 已就绪待开工",
			"task.summary.blocked": "{tasks} 等待前置",
			"task.summary.waitingSchedule": "等待下一轮调度",
			"progress.aria": "团队总进度",
			"progress.title": "总进度",
			"progress.running": "■ 进行中 {count}",
			"progress.blocked": "■ 等待依赖 {count}",
			"progress.delivered": "■ 已交付 {count}",
			"dependency.aria": "任务依赖链",
			"dependency.parallel": "并行任务",
			"dependency.title": "任务依赖",
			"dependency.hint.parallel": "无前后依赖 · 点击查看详情",
			"dependency.hint.chain": "悬停高亮依赖链 · 点击固定",
			"dependency.hint.pinned": "{taskId} 已固定 · Esc 取消",
			"settings.providers.title": "Provider 授权",
			"settings.providers.locked": "默认",
			"settings.providers.toggleAria": "授权开关",
			"settings.providers.hint": "未授权的 Provider 在成员创建时自动回退 deepseek-official",
			"task.runningAria": "运行中",
			"task.review.pending": "待政委复核",
			"task.review.passed": "政委已复核（{reviewer}）",
			"task.review.rejected": "政委驳回：{comment}",
			"task.intermediate.blockedReview": "待复核",
			"task.intermediate.awaitingInput": "待输入",
			"task.intermediate.blockedReviewDetail": "完成被门禁拦截，等待政委复核",
			"task.intermediate.awaitingInputDetail": "等待队长/成员提供输入",
			"task.helping": "{member} 协助中",
			"timing.estimated": "预估 {value}",
			"timing.actual": "实际 {value}",
			"timing.elapsed": "已用 {value}",
			"timing.overrun": "超时 {value}",
			"timing.memberElapsed": "已耗时 {value}",
			"timing.memberElapsedApprox": "已耗时 {value}（近似）",
			"timing.deviation": "偏差 {value} 级",
			"timing.signals": "产出信号：回合 {turns} 次 · 工具 {toolCalls} · 输出 {bytes} 字符",
			"timing.selfReport": "成员自报：{note}",
			"timing.retroNote": "经验：{note}",
			"timing.recommendation": "建议：{note}",
			"timing.gateWait": "含政委等待",
			"timing.hasHelper": "有 helper 介入",
			"timing.over": "超时",
			"timing.warn": "超预算",
			"selfGrowth.title": "自成长",
			"selfGrowth.insufficient": "样本不足，暂不输出校准结论",
			"retro.cause.underestimated": "任务被低估",
			"retro.cause.dependencyBlocked": "依赖阻塞",
			"retro.cause.requirementChange": "需求变化",
			"retro.cause.memberEfficiency": "成员效率",
			"retro.cause.environment": "环境问题",
			"retro.cause.onTime": "按时完成",
			"retro.cause.other": "其他",
			"retro.causeLabel": "复盘：{cause}",
			"task.calibration.pending": "待校准",
			"task.calibration.detail": "复盘待队长校准（无成员经验 · 无队长校准）",
			"task.detail.completed": "已完成并交付",
			"task.detail.noPrerequisite": "无前置，可立即开工",
			"task.detail.ready": "前置已就绪，可开工",
			"task.detail.waitingOn": "等待 {tasks}",
			"task.detail.noDownstream": "无下游任务",
			"task.detail.unlocks": "完成后解锁 {tasks}",
			"team.ended": "已结束",
			"team.stats.members": "{count} 名成员",
			"team.stats.completed": "{completed}/{total} 完成",
			"team.stats.messages": "{count} 条消息",
			"delegation.aria": "队长派工关系",
			"priority.title": "优先干预",
			"priority.aria": "优先干预建议",
			"milestone.title": "最新里程碑",
			"risk.high": "{count} 条风险消息",
			"load.aria": "{name} 负载",
			"captain.name": "队长",
			"captain.role": "拆解 · 派发 · 汇总",
			"role.captain": "队长",
			"role.researcher": "侦察参谋",
			"role.engineer": "技术员",
			"role.qa": "质检员",
			"role.reviewer": "审查员",
			"role.designer": "文宣干事",
			"role.security": "警卫员",
			"role.docs": "文书",
			"role.data": "情报分析员",
			"role.operator": "后勤保障员",
			"role.commissar": "政委",
			"commissar.duty": "监督目标 · 审查风险 · 把关质量 · 上报分歧",
			"commissar.dutyShort": "独立监督",
			"commissar.dutyFull": "目标监督、风险与纪律监督、质量监督、分歧上报（规范第 5 节）",
			"commissar.state.supervising": "监督中",
			"commissar.state.standby": "随时待命",
			"commissar.state.unknown": "状态未知",
			"commissar.state.reported": "分歧已上报",
			"commissar.state.paused": "已暂停风险任务",
			"captain.summary": "已派发 {tasks} 项任务给 {members} 名成员",
			"captain.state.working": "{count} 人执行中",
			"captain.state.collected": "已收齐",
			"captain.state.waiting": "等待回报",
			"members.toggle": "{count} 名成员",
			"members.collapse": "收起",
			"members.expand": "展开",
			"members.empty": "暂无成员，等待队长组建团队",
			"assignment.label": "队长派发",
			"assignment.empty": "暂无任务",
			"archive.label": "已结束 · 历史归档",
			"archive.filterTeam": "按团队",
			"archive.filterTeamAll": "全部团队",
			"archive.filterTime": "按时间",
			"archive.time.all": "全部时间",
			"archive.time.7d": "近 7 天",
			"archive.time.30d": "近 30 天",
			"archive.time.90d": "近 90 天",
			"archive.filterRetro": "按复盘",
			"archive.retro.all": "全部复盘",
			"archive.retro.hasRetro": "有复盘",
			"archive.retro.overran": "超时复盘",
			"archive.retro.noRetro": "缺复盘",
			"archive.filterCount": "显示 {shown} / {total} 个归档团队",
			"archive.filterEmpty": "没有匹配的归档团队"
		};
		/** English dictionary, checked complete against the Chinese source key set. */
		const en = {
			"card.memberCount": "{count} members",
			"action.openActivityPanel": "Open activity panel",
			"activity.panelButton": "Activity panel",
			"activity.badgeAria": "AgentTeams activity, {count} teams",
			"activity.panelAria": "AgentTeams activity panel",
			"activity.title": "AgentTeams activity",
			"activity.float": "Switch to floating panel",
			"activity.dockRight": "Dock to the right",
			"activity.collapse": "Collapse activity panel",
			"activity.close": "End & archive team",
			"activity.closeDisabled": "Tasks in progress — close disabled",
			"activity.closing": "Archiving…",
			"activity.closeError": "Archive failed, try again",
			"activity.empty": "No team activity",
			"format.listSeparator": ", ",
			"task.status.pending": "Unclaimed",
			"task.status.claimed": "Claimed",
			"task.status.inProgress": "In progress",
			"task.status.completed": "Completed",
			"task.status.failed": "Failed",
			"task.status.cancelled": "Cancelled",
			"member.state.working": "Working",
			"member.state.failed": "Has failures",
			"member.state.waiting": "Waiting",
			"member.state.delivered": "Delivered",
			"member.state.left": "Left team",
			"member.state.removed": "Removed",
			"member.state.pending": "Pending",
			"member.state.unassigned": "Awaiting assignment",
			"member.status.executing": "Working on {taskId}",
			"member.status.helping": "Helping on {taskId}",
			"member.status.working": "Working on assigned tasks",
			"member.status.waitingOn": "Waiting for {taskId} · {assignee}",
			"member.status.waitingPrerequisite": "Waiting for prerequisites",
			"member.status.waitingAssignment": "Waiting for the captain to assign work",
			"member.status.delivered": "Tasks delivered",
			"member.status.idle": "Ready to continue",
			"member.status.unknown": "Status unknown",
			"task.assignee.unclaimed": "Unclaimed",
			"task.summary.waitingBreakdown": "Waiting for the captain to break down the work",
			"task.summary.allDelivered": "All {count} tasks delivered",
			"task.summary.blockedAndRunning": "{tasks}{more} waiting on prerequisites; other work has started",
			"task.summary.more": " and {count} more",
			"task.summary.running": "{tasks} in progress",
			"task.summary.ready": "{tasks} ready to start",
			"task.summary.blocked": "{tasks} waiting on prerequisites",
			"task.summary.waitingSchedule": "Waiting for the next scheduling round",
			"progress.aria": "Overall team progress",
			"progress.title": "Overall progress",
			"progress.running": "■ In progress {count}",
			"progress.blocked": "■ Waiting {count}",
			"progress.delivered": "■ Delivered {count}",
			"dependency.aria": "Task dependency chain",
			"dependency.parallel": "Parallel tasks",
			"dependency.title": "Task dependencies",
			"dependency.hint.parallel": "No dependencies · Click for details",
			"dependency.hint.chain": "Hover to highlight dependencies · Click to pin",
			"dependency.hint.pinned": "{taskId} pinned · Esc to clear",
			"task.runningAria": "Running",
			"task.review.pending": "Awaiting commissar review",
			"task.review.passed": "Reviewed by commissar ({reviewer})",
			"task.review.rejected": "Rejected by commissar: {comment}",
			"task.intermediate.blockedReview": "Awaiting review",
			"task.intermediate.awaitingInput": "Awaiting input",
			"task.intermediate.blockedReviewDetail": "Completion gated — awaiting commissar review",
			"task.intermediate.awaitingInputDetail": "Awaiting input from the captain/members",
			"task.helping": "{member} helping",
			"timing.estimated": "est {value}",
			"timing.actual": "actual {value}",
			"timing.elapsed": "used {value}",
			"timing.overrun": "over by {value}",
			"timing.memberElapsed": "elapsed {value}",
			"timing.memberElapsedApprox": "elapsed {value} (approx)",
			"timing.deviation": "{value} level deviation",
			"timing.signals": "Signals: {turns} turns · {toolCalls} tool calls · {bytes} output chars",
			"timing.selfReport": "Self report: {note}",
			"timing.retroNote": "Lesson: {note}",
			"timing.recommendation": "Suggestion: {note}",
			"timing.gateWait": "includes gate wait",
			"timing.hasHelper": "helper involved",
			"timing.over": "Over time",
			"timing.warn": "Over budget",
			"selfGrowth.title": "Self-growth",
			"selfGrowth.insufficient": "Insufficient samples — calibration withheld",
			"retro.cause.underestimated": "Underestimated",
			"retro.cause.dependencyBlocked": "Dependency blocked",
			"retro.cause.requirementChange": "Requirement change",
			"retro.cause.memberEfficiency": "Member efficiency",
			"retro.cause.environment": "Environment",
			"retro.cause.onTime": "On time",
			"retro.cause.other": "Other",
			"retro.causeLabel": "Retro: {cause}",
			"task.calibration.pending": "Needs calibration",
			"task.calibration.detail": "Retro awaits captain calibration (no member lesson · no captain verdict)",
			"task.detail.completed": "Completed and delivered",
			"task.detail.noPrerequisite": "No prerequisites; ready to start",
			"task.detail.ready": "Prerequisites ready; can start",
			"task.detail.waitingOn": "Waiting for {tasks}",
			"task.detail.noDownstream": "No downstream tasks",
			"task.detail.unlocks": "Unlocks {tasks} when complete",
			"team.ended": "Ended",
			"team.stats.members": "{count} members",
			"team.stats.completed": "{completed}/{total} completed",
			"team.stats.messages": "{count} messages",
			"delegation.aria": "Captain delegation map",
			"priority.title": "Priorities",
			"priority.aria": "Priority interventions",
			"milestone.title": "Latest milestone",
			"risk.high": "{count} risky messages",
			"load.aria": "{name} load",
			"captain.name": "Captain",
			"captain.role": "Break down · Delegate · Synthesize",
			"role.captain": "Captain",
			"role.researcher": "Recon Staff Officer",
			"role.engineer": "Technician",
			"role.qa": "Quality Inspector",
			"role.reviewer": "Reviewer",
			"role.designer": "Cultural & Publicity Officer",
			"role.security": "Guard",
			"role.docs": "Clerk",
			"role.data": "Intelligence Analyst",
			"role.operator": "Logistics Support Staff",
			"role.commissar": "Commissar",
			"commissar.duty": "Oversee goals · Review risk · Gate quality · Escalate disputes",
			"commissar.dutyShort": "Independent oversight",
			"commissar.dutyFull": "Goal oversight, risk & discipline review, quality gating, dispute escalation (spec §5)",
			"commissar.state.supervising": "Supervising",
			"commissar.state.standby": "On standby",
			"commissar.state.unknown": "Status unknown",
			"commissar.state.reported": "Dispute escalated",
			"commissar.state.paused": "Risky task paused",
			"captain.summary": "Assigned {tasks} tasks to {members} members",
			"captain.state.working": "{count} active",
			"captain.state.collected": "All reports received",
			"captain.state.waiting": "Waiting for reports",
			"members.toggle": "Members {count}",
			"members.collapse": "Collapse",
			"members.expand": "Expand",
			"members.empty": "No members yet; waiting for the captain to assemble the team",
			"assignment.label": "Captain assigned",
			"assignment.empty": "No tasks",
			"archive.label": "Ended · Archived history",
			"archive.filterTeam": "Team",
			"archive.filterTeamAll": "All teams",
			"archive.filterTime": "Time",
			"archive.time.all": "Any time",
			"archive.time.7d": "Last 7 days",
			"archive.time.30d": "Last 30 days",
			"archive.time.90d": "Last 90 days",
			"archive.filterRetro": "Retro",
			"archive.retro.all": "Any retro",
			"archive.retro.hasRetro": "Has retro",
			"archive.retro.overran": "Overran",
			"archive.retro.noRetro": "Missing retro",
			"archive.filterCount": "Showing {shown} / {total} archived teams",
			"archive.filterEmpty": "No archived teams match the filters",
			"settings.providers.title": "Provider access",
			"settings.providers.locked": "Default",
			"settings.providers.toggleAria": "authorization switch",
			"settings.providers.hint": "Unauthorized providers fall back to deepseek-official when members are created"
		};
		//#endregion
		//#region src/client/roles.ts
		/** Canonical role key → military-title locale key (see `role.*` in locales.ts).
		* Preset: captain + the 7 behavioral executing roles + reviewer + commissar.
		* operator is a compatibility entry for legacy members and
		* custom role strings (not preset, no dedicated seat or behavior template). */
		const ROLE_TITLE_KEY = {
			captain: "role.captain",
			researcher: "role.researcher",
			engineer: "role.engineer",
			qa: "role.qa",
			designer: "role.designer",
			data: "role.data",
			docs: "role.docs",
			reviewer: "role.reviewer",
			commissar: "role.commissar",
			security: "role.security",
			operator: "role.operator"
		};
		/** Normalize a role/name for canonical-key lookup: lowercase, trim, and
		* strip display suffixes such as `-v2` / `_v2`. */
		function canonicalKey(value) {
			return value.trim().toLowerCase().replace(/[-_\s]+v2$/, "").trim();
		}
		/**
		* Member role display title: canonical keys map to the localized military
		* title; anything unknown falls back to the raw role text (never blank,
		* never throws).
		*/
		function roleTitle(role, t) {
			const key = ROLE_TITLE_KEY[canonicalKey(role)];
			return key === void 0 ? role : t(key);
		}
		/**
		* Member name display title: when a member is named after a canonical role
		* key (or a display variant such as `engineer-v2`), show the localized
		* military title instead of the raw English key. Any other name (real
		* person, mailbox address, …) is returned unchanged — the data layer's
		* assignee matching and prompt identity keep using the original name.
		*/
		function nameTitle(name, t) {
			const key = ROLE_TITLE_KEY[canonicalKey(name)];
			return key === void 0 ? name : t(key);
		}
		/** A Chinese-ordinal suffix like `一号` / `二号` / `十号` (also tolerates a
		* leading space and legacy no-space names). */
		const ORDINAL_SUFFIX = /^(?:\s*[一二三四五六七八九十]+\d*号)$/;
		/** True when the name itself is a canonical role name — the role title is
		* then already expressed by the name, so the role chip can be omitted.
		* Recognizes both plain role names (`技术员`, `engineer`) and auto-numbered
		* names (`技术员 一号`, legacy `技术员一号`). */
		function isRoleName(name) {
			const raw = name.trim();
			if (raw === "") return false;
			if (ROLE_TITLE_KEY[canonicalKey(raw)] !== void 0) return true;
			for (const localeKey of Object.values(ROLE_TITLE_KEY)) {
				const title = zh[localeKey];
				if (title === void 0) continue;
				if (raw === title) return true;
				const withoutPrefix = raw.startsWith(title) ? raw.slice(title.length) : "";
				if (withoutPrefix !== "" && ORDINAL_SUFFIX.test(withoutPrefix)) return true;
			}
			return false;
		}
		//#endregion
		//#region src/client/task-review.ts
		/**
		* Badge condition: the task is under the commissar gate and has no `pass`
		* verdict yet, and is not completed. True for `pending` and `rejected`
		* (rejected tasks are still awaiting a passing review).
		*/
		function taskReviewPending(task) {
			return task.status !== "completed" && task.reviewRequired === true && task.review?.verdict !== "pass";
		}
		/**
		* Detail-line state for the gate review line: `null` when the task is not
		* under the gate; `'pending'` awaiting review; `'passed'` after a pass
		* verdict; `'rejected'` after a reject verdict (task stays in progress).
		*/
		function taskReviewState(task) {
			if (task.reviewRequired !== true && task.review === void 0) return null;
			if (task.review === void 0) return "pending";
			return task.review.verdict === "pass" ? "passed" : "rejected";
		}
		//#endregion
		//#region src/client/task-intermediate.ts
		/**
		* 中间态「待复核」:任务完成被政委门禁拦截,等待 pass 复核。
		* 终结状态(completed/failed/cancelled)恒为 false,兜底脏数据。
		*/
		function taskBlockedByReview(task) {
			return task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled" && task.blockedByReview === true;
		}
		/**
		* 中间态「待输入」:任务等待队长/成员提供输入。
		*/
		function taskAwaitingInput(task) {
			return task.awaitingInput === true;
		}
		/** 任务行的中间态标记(供 data-intermediate 属性与展示判定的单一来源)。 */
		function taskIntermediateFlag(task) {
			if (taskBlockedByReview(task)) return "blockedReview";
			if (taskAwaitingInput(task)) return "awaitingInput";
		}
		//#endregion
		//#region src/client/task-helping.ts
		/** The helper of a non-terminal task, or undefined when nobody is helping. */
		function taskHelper(task) {
			if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") return void 0;
			const helper = task.helper;
			return helper === void 0 || helper === "" ? void 0 : helper;
		}
		//#endregion
		//#region src/duration.ts
		/**
		* 耗时格式化纯函数(服务端与客户端共用)。
		*
		* 面板展示约定:12m / 1h 05m —— 不足 1 分钟显示 `<1m`,不足 1 小时显示
		* `Nm`,达到 1 小时显示 `Xh YYm`(分钟两位补零)。
		* @module dsh-agent-team-web/duration
		*/
		/** 格式化毫秒为面板展示用的紧凑耗时文本。 */
		function formatDuration(ms) {
			if (!Number.isFinite(ms) || ms < 0) return "0m";
			const totalMinutes = Math.floor(ms / 6e4);
			if (totalMinutes < 1) return "<1m";
			if (totalMinutes < 60) return `${totalMinutes}m`;
			const hours = Math.floor(totalMinutes / 60);
			const minutes = totalMinutes % 60;
			return `${hours}h ${String(minutes).padStart(2, "0")}m`;
		}
		//#endregion
		//#region src/types.ts
		/** 等级参考区间(分钟)与毫秒上限 —— 集中可调的唯一位置。 */
		const ESTIMATE_LEVEL_RANGES = {
			S: {
				maxMinutes: 15,
				maxMs: 15 * 6e4,
				label: "≤15m"
			},
			M: {
				maxMinutes: 45,
				maxMs: 45 * 6e4,
				label: "≤45m"
			},
			L: {
				maxMinutes: Number.POSITIVE_INFINITY,
				maxMs: Number.POSITIVE_INFINITY,
				label: ">45m"
			}
		};
		//#endregion
		//#region src/client/task-timing.ts
		/**
		* 面板耗时展示与超时警示的客户端辅助(与服务端 retro.ts 同阈值)。
		*
		* 判定规则与 tools/intelligence/snapshot 完全一致:
		* 预算 = 预估等级区间上限(ESTIMATE_LEVEL_RANGES)或内部毫秒;
		* 已用/实际 > 预算 → warn(黄),> 预算 × 1.5 → over(红)。
		* @module dsh-agent-team-web/client/task-timing
		*/
		/** 预估预算(ms):等级区间上限优先,其次内部毫秒;都无则 undefined。 */
		function estimateBudgetMs(task) {
			if (task.estimateLevel !== void 0) {
				const maxMs = ESTIMATE_LEVEL_RANGES[task.estimateLevel].maxMs;
				if (Number.isFinite(maxMs)) return maxMs;
			}
			return task.estimatedMs !== void 0 && task.estimatedMs > 0 ? task.estimatedMs : void 0;
		}
		/** 任务当前展示用的耗时(ms):已完成取实际耗时,进行中取 now - claimedAt。 */
		function taskElapsedMs(task, now) {
			if (task.actualMs !== void 0 && task.actualMs >= 0) return task.actualMs;
			if (task.claimedAt !== void 0) return Math.max(0, now - task.claimedAt);
			return 0;
		}
		/** 超时档位(与服务端 taskTimingState 一致,等级优先口径)。 */
		function taskTimingState(task, now) {
			const budget = estimateBudgetMs(task);
			const elapsed = taskElapsedMs(task, now);
			if (budget === void 0 || elapsed <= 0) return "ok";
			if (elapsed > budget * 1.5) return "over";
			if (elapsed > budget) return "warn";
			return "ok";
		}
		/** 预估展示文本:等级优先(S(≤15m)),其次毫秒。 */
		function estimateText(task, t) {
			if (task.estimateLevel !== void 0) {
				const range = ESTIMATE_LEVEL_RANGES[task.estimateLevel].label;
				return `${task.estimateLevel}(${range})`;
			}
			if (task.estimatedMs !== void 0 && task.estimatedMs > 0) return formatDuration(task.estimatedMs);
			return null;
		}
		/** 任务行的"预估 vs 实际/已用"文本;无预估返回 null。 */
		function taskTimingText(task, t, now = Date.now()) {
			const estimate = estimateText(task, t);
			if (estimate === null) return null;
			if (task.actualMs !== void 0 && task.actualMs >= 0) {
				const actual = formatDuration(task.actualMs);
				const overrun = task.actualMs - (task.estimatedMs ?? 0);
				const overrunText = task.estimatedMs !== void 0 && overrun > 0 ? t("timing.overrun", { value: formatDuration(overrun) }) : null;
				return [
					t("timing.estimated", { value: estimate }),
					t("timing.actual", { value: actual }),
					overrunText
				].filter((part) => part !== null).join(" · ");
			}
			const elapsed = taskElapsedMs(task, now);
			if (elapsed <= 0) return t("timing.estimated", { value: estimate });
			return `${t("timing.estimated", { value: estimate })} · ${t("timing.elapsed", { value: formatDuration(elapsed) })}`;
		}
		/** 成员状态行的"已耗时"文本;无当前任务或未计时返回 null。 */
		function memberElapsedText(member, t) {
			if (member.currentTaskElapsedMs <= 0) return null;
			const value = formatDuration(member.currentTaskElapsedMs);
			return member.currentTaskElapsedApprox === true ? t("timing.memberElapsedApprox", { value }) : t("timing.memberElapsed", { value });
		}
		/** 成员当前任务的超时档位(用于已耗时文本的警示着色)。 */
		function memberTimingState(member, tasks, now = Date.now()) {
			const current = tasks.find((task) => task.id === member.currentTask);
			if (current === void 0) return "ok";
			return taskTimingState(current, now);
		}
		/** 任务详情的产出信号行(含成员自报);无信号返回 null。 */
		function taskSignalsText(task, t) {
			if (task.signals === void 0) return null;
			const parts = [t("timing.signals", {
				turns: task.signals.turns ?? 0,
				toolCalls: task.signals.toolCalls ?? 0,
				bytes: task.signals.outputBytes
			})];
			if (task.signals.selfReport !== void 0 && task.signals.selfReport !== "") parts.push(t("timing.selfReport", { note: task.signals.selfReport }));
			return parts.join(" · ");
		}
		/** 复盘原因 → 本地化 key 的静态映射(避免动态字符串索引)。 */
		const RETRO_CAUSE_KEYS = {
			underestimated: "retro.cause.underestimated",
			"dependency-blocked": "retro.cause.dependencyBlocked",
			"requirement-change": "retro.cause.requirementChange",
			"member-efficiency": "retro.cause.memberEfficiency",
			environment: "retro.cause.environment",
			on_time: "retro.cause.onTime",
			other: "retro.cause.other"
		};
		/** 复盘原因标签(zh/en 双语)。 */
		function retroCauseLabel(cause, t) {
			const key = RETRO_CAUSE_KEYS[cause];
			return key === void 0 ? cause : t(key);
		}
		/** 任务详情的复盘行(原因/经验/边界标注/队长校准);无复盘返回 null。 */
		function retroDetailText(task, t) {
			const retro = task.retro;
			if (retro === void 0) return null;
			const parts = [t("retro.causeLabel", { cause: retroCauseLabel(retro.cause, t) })];
			if (retro.recommendation !== void 0 && retro.recommendation !== "") parts.push(t("timing.recommendation", { note: retro.recommendation }));
			if (retro.retroNote !== void 0 && retro.retroNote !== "") parts.push(t("timing.retroNote", { note: retro.retroNote }));
			if (retro.includesGateWait === true) parts.push(t("timing.gateWait"));
			if (retro.hasHelper === true) parts.push(t("timing.hasHelper"));
			if (retro.captainVerdict !== void 0) parts.push(`captain: ${retro.captainVerdict}`);
			return parts.join(" · ");
		}
		/**
		* 复盘质量闭环:任务行/详情「待校准」徽标条件。与服务端
		* retroPendingCalibration 同口径(high/critical + 终结 + 无 retro_note +
		* 无 captainVerdict),并优先信任服务端快照透出的 pendingCalibration 标志。
		*/
		function taskPendingCalibration(task) {
			if (task.pendingCalibration === true) return true;
			const retro = task.retro;
			if (retro === void 0) return false;
			if (task.status !== "completed" && task.status !== "failed") return false;
			if (task.riskLevel !== "high" && task.riskLevel !== "critical") return false;
			return !(retro.retroNote !== void 0 && retro.retroNote.trim() !== "") && retro.captainVerdict === void 0;
		}
		//#endregion
		//#region \0agent-team-css:src/client/AgentTeamsCard.module.css.mjs
		const cssText$2 = ".plNana_root{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:10px;flex-direction:column;gap:8px;width:100%;min-width:0;padding:10px 12px;display:flex}.plNana_head{align-items:center;gap:8px;min-width:0;display:flex}.plNana_leadAvatar{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0;flex:none;width:30px;height:30px}.plNana_teamName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}.plNana_memberCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;margin-left:auto;font-size:11px;line-height:16px}.plNana_panelButton{border:1px solid var(--dsw-alias-line-strong);background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;flex:none;padding:2px 8px;font-size:10.5px;font-weight:600;line-height:16px;transition:border-color .12s,color .12s}.plNana_panelButton:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.plNana_panelButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.plNana_members{flex-wrap:wrap;gap:6px;min-width:0;display:flex}.plNana_member{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);max-width:160px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:5px;padding:3px 8px 3px 3px;font-size:11px;font-weight:500;line-height:16px;transition:border-color .12s,background-color .12s;display:inline-flex}.plNana_member:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-fill-neutral)}.plNana_member:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.plNana_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d482e);background:0 0;border:0;border-radius:0;width:24px;height:24px}.plNana_memberInitial{background:var(--dsw-alias-bg-fill-business);width:20px;height:20px;color:var(--dsw-alias-label-on-fill);border-radius:50%;justify-content:center;align-items:center;font-size:10px;font-weight:600;line-height:20px;display:inline-flex}.plNana_memberName{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
		const cssTagId$2 = "@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamsCard.module.css";
		if (typeof document !== "undefined" && document.head && document.head.querySelector("style[data-plugin-css=\"@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamsCard.module.css\"]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-experimental-agent-team-web";
			style.dataset.pluginCss = cssTagId$2;
			style.textContent = cssText$2;
			document.head.appendChild(style);
		}
		var AgentTeamsCard_module_css_default = {
			"head": "plNana_head",
			"leadAvatar": "plNana_leadAvatar",
			"member": "plNana_member",
			"memberArt": "plNana_memberArt",
			"memberCount": "plNana_memberCount",
			"memberInitial": "plNana_memberInitial",
			"memberName": "plNana_memberName",
			"members": "plNana_members",
			"panelButton": "plNana_panelButton",
			"root": "plNana_root",
			"teamName": "plNana_teamName"
		};
		//#endregion
		//#region src/client/AgentTeamsCard.tsx
		/**
		* AgentTeams conversation card: the lightweight in-conversation summary for
		* one team — the captain's whale avatar and name, the member roster as
		* clickable whale avatars (opening the member's subagent transcript), and
		* an "activity panel" button that re-activates the top-right floater.
		*
		* The floater and this card share the `agent-teams:open-panel` window event
		* so the card can summon the panel even after it was closed (or when an old
		* session is re-opened for review).
		* @module dsh-agent-team-web/client/card
		*/
		/** Window event name the floater listens for to open itself. */
		const OPEN_PANEL_EVENT = "agent-team-web:open-panel";
		/** Re-activate the top-right activity panel, carrying this team's summary
		* so the panel can show it even when the team no longer exists on disk
		* (historical session review). */
		function openActivityPanel(data) {
			window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: {
				teamId: data.teamId,
				captainSessionId: data.captainSessionId,
				teamName: data.teamName,
				members: data.members
			} }));
		}
		/** Render one durable team as a compact conversation card. */
		function AgentTeamsCard({ node, openMember, sessionId, t }) {
			const data = node.data;
			const owner = data.captainSessionId || sessionId;
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			(0, react.useEffect)(() => {
				return monitorAgentTeam(owner, data.teamId);
			}, [data.teamId, owner]);
			const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner)) ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner));
			const resolved = (0, react.useMemo)(() => ({
				...data,
				captainSessionId: snapshot?.captainSessionId ?? owner,
				teamName: snapshot?.name ?? data.teamName,
				members: snapshot?.members.map((member) => ({
					id: member.id,
					name: member.name,
					role: member.role
				})) ?? data.members
			}), [
				data,
				owner,
				snapshot
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: AgentTeamsCard_module_css_default.root,
				"data-agent-teams-card": true,
				"data-team-id": resolved.teamId,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: AgentTeamsCard_module_css_default.head,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.leadAvatar,
							src: LEAD_ART,
							alt: "",
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.teamName,
							title: resolved.teamName,
							children: resolved.teamName
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberCount,
							children: t("card.memberCount", { count: resolved.members.length })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AgentTeamsCard_module_css_default.panelButton,
							onClick: () => {
								openActivityPanel(resolved);
							},
							"aria-label": t("action.openActivityPanel"),
							title: t("action.openActivityPanel"),
							children: t("activity.panelButton")
						})
					]
				}), resolved.members.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: AgentTeamsCard_module_css_default.members,
					children: resolved.members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: AgentTeamsCard_module_css_default.member,
						onClick: () => {
							if (member.id !== "") openMember(owner, member.id);
						},
						title: member.role === "" || isRoleName(member.name) ? nameTitle(member.name, t) : `${nameTitle(member.name, t)} · ${roleTitle(member.role, t)}`,
						children: [memberArtUrl(member.name, member.role) !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.memberArt,
							src: memberArtUrl(member.name, member.role) ?? "",
							alt: "",
							"aria-hidden": true
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberInitial,
							children: member.name.trim().slice(0, 1).toUpperCase() || "?"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberName,
							children: nameTitle(member.name, t)
						})]
					}, member.id))
				})]
			});
		}
		//#endregion
		//#region src/client/panel-geometry.ts
		const PANEL_LAYOUT_STORAGE_KEY = "agent-team-web:activity-panel:v1";
		const DEFAULT_PANEL_LAYOUT = Object.freeze({
			mode: "docked",
			x: 0,
			y: 64,
			width: 388,
			height: 640,
			heightMode: "auto"
		});
		function clamp(value, minimum, maximum) {
			return Math.min(Math.max(value, minimum), maximum);
		}
		function finite(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		/** Decode one versioned localStorage value, rejecting partial/corrupt state. */
		function parsePanelLayout(value) {
			if (value === null) return DEFAULT_PANEL_LAYOUT;
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_LAYOUT;
				const record = parsed;
				if (record.mode !== "docked" && record.mode !== "floating" || !finite(record.x) || !finite(record.y) || !finite(record.width) || !finite(record.height)) return DEFAULT_PANEL_LAYOUT;
				return {
					mode: record.mode,
					x: record.x,
					y: record.y,
					width: record.width,
					height: record.height,
					heightMode: record.mode === "floating" && record.heightMode === "manual" ? "manual" : "auto"
				};
			} catch {
				return DEFAULT_PANEL_LAYOUT;
			}
		}
		/** Whether the panel should become a simple inset overlay with no gestures. */
		function compactPanelForBounds(bounds) {
			return bounds.width <= 960;
		}
		/** Docked and compact panels always fit content; floating panels may be user-sized. */
		function panelUsesAutoHeight(layout, bounds) {
			return compactPanelForBounds(bounds) || layout.mode === "docked" || layout.heightMode === "auto";
		}
		/**
		* Docked-panel right anchor: the settled conversation's right edge, or —
		* while no conversation is settled (hero/settling phases, session switch) —
		* the previous anchor clamped to the shell. Falling back to the shell's own
		* right edge here would dock the panel on top of an open details column,
		* because the shell overlay spans the sidebar|center|details tracks while the
		* conversation only spans the center one.
		*/
		function panelDockAnchor(previousAnchor, overlayWidth, conversationRight) {
			const width = Math.max(1, overlayWidth);
			if (conversationRight === null) return clamp(previousAnchor, 0, width);
			return clamp(conversationRight, 0, width);
		}
		/** CSS max-height ceiling that keeps an auto-height panel inside its shell. */
		function panelMaximumHeight(layout, bounds) {
			const bottomInset = compactPanelForBounds(bounds) || layout.mode === "floating" ? 12 : 48;
			return Math.max(1, bounds.height - layout.y - bottomInset);
		}
		/** Resolve persisted state into a visible rectangle inside the current shell. */
		function resolvePanelGeometry(layout, bounds) {
			const boundsWidth = Math.max(1, bounds.width);
			const boundsHeight = Math.max(1, bounds.height);
			if (compactPanelForBounds(bounds)) return {
				...layout,
				x: 12,
				y: 12,
				width: Math.max(1, boundsWidth - 24),
				height: Math.max(1, boundsHeight - 24)
			};
			const maximumWidth = Math.max(1, Math.min(640, boundsWidth - 24));
			const minimumWidth = Math.min(320, maximumWidth);
			const width = clamp(layout.width, minimumWidth, maximumWidth);
			const maximumHeight = Math.max(1, boundsHeight - 24);
			const minimumHeight = Math.min(360, maximumHeight);
			if (layout.mode === "docked") {
				const y = clamp(64, 12, Math.max(12, boundsHeight - minimumHeight - 12));
				const availableHeight = Math.max(1, boundsHeight - y - 48);
				const height = clamp(availableHeight, Math.min(minimumHeight, availableHeight), maximumHeight);
				const anchorRight = clamp(bounds.anchorRight, 0, boundsWidth);
				const maximumX = Math.max(12, boundsWidth - width - 12);
				return {
					mode: "docked",
					x: clamp(anchorRight - 18 - width, 12, maximumX),
					y,
					width,
					height,
					heightMode: layout.heightMode
				};
			}
			const height = clamp(layout.height, minimumHeight, maximumHeight);
			return {
				mode: "floating",
				x: clamp(layout.x, 12, Math.max(12, boundsWidth - width - 12)),
				y: clamp(layout.y, 12, Math.max(12, boundsHeight - height - 12)),
				width,
				height,
				heightMode: layout.heightMode
			};
		}
		/** Undock without a visual jump by adopting the panel's resolved rectangle. */
		function floatPanelLayout(geometry, bounds) {
			return resolvePanelGeometry({
				...geometry,
				mode: "floating"
			}, bounds);
		}
		/** Return to the right dock, preserving width and restoring content-fit height. */
		function dockPanelLayout(layout, bounds) {
			return resolvePanelGeometry({
				...layout,
				mode: "docked",
				heightMode: "auto"
			}, bounds);
		}
		/** Translate a floating panel and clamp it back into the visible shell. */
		function movePanelLayout(start, dx, dy, bounds) {
			return resolvePanelGeometry({
				...start,
				mode: "floating",
				x: start.x + dx,
				y: start.y + dy
			}, bounds);
		}
		/** Resize while keeping the edge opposite the active handle stationary. */
		function resizePanelLayout(start, edge, dx, dy, bounds) {
			if (start.mode === "docked") {
				if (edge !== "left") return resolvePanelGeometry(start, bounds);
				return resolvePanelGeometry({
					...start,
					width: start.width - dx
				}, bounds);
			}
			const resolved = resolvePanelGeometry(start, bounds);
			const minimumWidth = Math.min(320, resolved.x + resolved.width - 12);
			const minimumHeight = Math.min(360, bounds.height - resolved.y - 12);
			if (edge === "left") {
				const right = resolved.x + resolved.width;
				const maximumWidth = Math.max(1, Math.min(640, right - 12));
				const width = clamp(resolved.width - dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
				return {
					...resolved,
					x: right - width,
					width
				};
			}
			const maximumHeight = Math.max(1, bounds.height - resolved.y - 12);
			const height = clamp(resolved.height + dy, Math.min(minimumHeight, maximumHeight), maximumHeight);
			if (edge === "bottom") return {
				...resolved,
				height,
				heightMode: "manual"
			};
			const maximumWidth = Math.max(1, Math.min(640, bounds.width - resolved.x - 12));
			const width = clamp(resolved.width + dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
			return {
				...resolved,
				width,
				height,
				heightMode: "manual"
			};
		}
		//#endregion
		//#region \0agent-team-css:src/client/ActivityPanel.module.css.mjs
		const cssText$1 = "html{--agent-team-web-panel-shift:420px}html[data-agent-team-web-panel-open] [data-phase=active]{box-sizing:border-box;padding-right:var(--agent-team-web-panel-shift)}.lmmxYa_badge,.lmmxYa_panel{--at-bg-panel:#fff;--at-bg-raised:#fafbfc;--at-bg-fill:#f4f6f9;--at-border:#e8ebf0;--at-border-strong:#d9dee8;--at-text-primary:#1b1f27;--at-text-secondary:#5a6474;--at-text-tertiary:#8f97a6;--at-accent:#2d5ca8;--at-accent-hover:#3568b8;--at-accent-strong:#244a8a;--at-success:#15875a;--at-warning:#a4681a;--at-danger:#c23b42;--at-on-accent:#fff;--at-shadow-badge:0 8px 24px #17203014;--at-shadow-panel:0 12px 32px #17203012, 0 32px 72px #1720301c;--at-shadow-active:0 16px 40px #1720301a, 0 36px 80px #17203024;--dsw-alias-bg-module:var(--at-bg-panel);--dsw-alias-bg-module-platform:var(--at-bg-raised);--dsw-alias-bg-fill-neutral:var(--at-bg-fill);--dsw-alias-bg-fill-business:var(--at-accent);--dsw-alias-bg-fill-success:var(--at-success);--dsw-alias-bg-fill-warning:var(--at-warning);--dsw-alias-bg-fill-danger:var(--at-danger);--dsw-alias-state-business-primary:var(--at-accent);--dsw-alias-state-success:var(--at-success);--dsw-alias-state-warning:var(--at-warning);--dsw-alias-state-danger:var(--at-danger);--dsw-alias-label-primary:var(--at-text-primary);--dsw-alias-label-secondary:var(--at-text-secondary);--dsw-alias-label-tertiary:var(--at-text-tertiary);--dsw-alias-label-on-fill:var(--at-on-accent);--dsw-alias-line-normal:var(--at-border);--dsw-alias-line-strong:var(--at-border-strong)}@media (prefers-color-scheme:dark){.lmmxYa_badge,.lmmxYa_panel{--at-bg-panel:#1e1f22;--at-bg-raised:#202125;--at-bg-fill:#2a2c30;--at-border:#2e3136;--at-border-strong:#3a3e45;--at-text-primary:#f5f6f8;--at-text-secondary:#b9bdc6;--at-text-tertiary:#8b90a0;--at-accent:#5b8dd9;--at-accent-hover:#6d9be0;--at-accent-strong:#4a7cc9;--at-success:#3ecf7f;--at-warning:#f0a83c;--at-danger:#f0606a;--at-on-accent:#fff;--at-shadow-badge:0 8px 24px #00000073;--at-shadow-panel:0 12px 32px #00000073, 0 32px 72px #0000008c;--at-shadow-active:0 16px 40px #00000080, 0 36px 80px #0009}.lmmxYa_stateArt{filter:drop-shadow(0 0 1px var(--dsw-alias-bg-module)) drop-shadow(0 1px 1px #00000073)}}.lmmxYa_badge{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, transparent);backdrop-filter:blur(16px);height:34px;box-shadow:var(--at-shadow-badge);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:7px;padding:0 12px;font-size:12px;font-weight:600;line-height:20px;transition:border-color .12s,transform .12s;display:inline-flex;position:absolute;top:64px;right:18px}.lmmxYa_badge:hover{border-color:var(--dsw-alias-line-strong);transform:translateY(-1px)}.lmmxYa_badge:active{transform:translateY(0)scale(.97)}.lmmxYa_badge:focus-visible,.lmmxYa_iconButton:focus-visible,.lmmxYa_memberRow:focus-visible,.lmmxYa_membersToggle:focus-visible,.lmmxYa_sectionToggleTitle:focus-visible,.lmmxYa_dagNode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.lmmxYa_badgeDot,.lmmxYa_panelDot{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:7px;height:7px}.lmmxYa_badgeDot[data-busy=true],.lmmxYa_panelDot[data-busy=true]{background:var(--dsw-alias-state-business-primary);animation:1.25s ease-in-out infinite lmmxYa_agentTeamsPulse}.lmmxYa_badgeCount,.lmmxYa_memberCount,.lmmxYa_teamStats,.lmmxYa_stageLabel,.lmmxYa_taskId{font-variant-numeric:tabular-nums}.lmmxYa_panel{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-line-strong) 58%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-module) 95%, transparent);backdrop-filter:blur(20px)saturate(1.08);box-shadow:var(--at-shadow-panel);will-change:transform;border-radius:16px;flex-direction:column;animation:.16s ease-out lmmxYa_agentTeamsPanelIn;display:flex;position:absolute;top:0;left:0;overflow:hidden}.lmmxYa_panel[data-dragging],.lmmxYa_panel[data-resizing]{user-select:none;box-shadow:var(--at-shadow-active)}@keyframes lmmxYa_agentTeamsPanelIn{0%{opacity:0}to{opacity:1}}@keyframes lmmxYa_agentTeamsPulse{0%,to{opacity:.42}50%{opacity:1}}.lmmxYa_panelHead{border-bottom:1px solid var(--dsw-alias-line-normal);cursor:grab;touch-action:none;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:0 14px;display:flex}.lmmxYa_panelHead:active,.lmmxYa_panel[data-dragging] .lmmxYa_panelHead{cursor:grabbing}.lmmxYa_panel[data-compact] .lmmxYa_panelHead{cursor:default;touch-action:auto}.lmmxYa_panelTitle{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.lmmxYa_panelControls{flex:none;align-items:center;gap:2px;display:inline-flex}.lmmxYa_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:7px;justify-content:center;align-items:center;padding:0;transition:background-color .12s,color .12s,transform .12s;display:inline-flex}.lmmxYa_iconButton:hover{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-primary)}.lmmxYa_iconButton:active{transform:scale(.94)}.lmmxYa_iconButton[data-control=dock][data-mode=docked] svg{transform:scaleX(-1)}.lmmxYa_iconButton[data-control=close]:hover:not(:disabled){background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.lmmxYa_iconButton[data-control=close]:disabled{opacity:.45;cursor:not-allowed}.lmmxYa_closeError{color:var(--dsw-alias-state-danger);border-top:1px solid var(--dsw-alias-line-normal);padding:4px 14px;font-size:12px;line-height:16px}.lmmxYa_resizeHandle{z-index:1;touch-action:none;position:absolute}.lmmxYa_resizeHandle[data-resize-edge=left]{cursor:ew-resize;width:8px;top:44px;bottom:8px;left:0}.lmmxYa_resizeHandle[data-resize-edge=bottom]{cursor:ns-resize;height:8px;bottom:0;left:12px;right:12px}.lmmxYa_resizeHandle[data-resize-edge=corner]{cursor:nwse-resize;width:18px;height:18px;bottom:0;right:0}.lmmxYa_resizeHandle[data-resize-edge=corner]:after{border-right:1px solid var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-label-tertiary);content:\"\";opacity:.52;width:7px;height:7px;position:absolute;bottom:4px;right:4px}.lmmxYa_teams{overscroll-behavior:contain;scrollbar-color:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent) transparent;scrollbar-width:thin;flex-direction:column;min-height:0;display:flex;overflow-y:auto}.lmmxYa_teams::-webkit-scrollbar{width:6px}.lmmxYa_teams::-webkit-scrollbar-track{background:0 0}.lmmxYa_teams::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent);background-clip:padding-box;border:2px solid #0000;border-radius:999px}.lmmxYa_teams:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 44%, transparent);background-clip:padding-box}.lmmxYa_team{border-bottom:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:12px;padding:12px 14px 14px;display:flex}.lmmxYa_team:last-child{border-bottom:0}.lmmxYa_teamHead{align-items:center;gap:10px;min-width:0;display:flex}.lmmxYa_teamName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.lmmxYa_teamStats{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;gap:8px;font-size:10px;line-height:16px;display:inline-flex}.lmmxYa_sectionHead{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.lmmxYa_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.lmmxYa_sectionHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.lmmxYa_delegationSection{flex-direction:column;gap:10px;min-width:0;display:flex}.lmmxYa_captainNode{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-module));border-radius:10px;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:56px;padding:6px 10px;display:grid}.lmmxYa_commandLayer{grid-template-columns:1fr;gap:10px;display:grid}.lmmxYa_commandLayer[data-leadership=solo]{grid-template-columns:1fr}.lmmxYa_commissarNode{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--at-accent) 32%, var(--at-border));background:color-mix(in srgb, var(--at-accent) 5%, var(--at-bg-panel));border-radius:10px;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:56px;padding:6px 10px;display:grid;position:relative}.lmmxYa_commissarNode:before{background:var(--at-accent);content:\"\";border-radius:2px;width:2px;position:absolute;top:8px;bottom:8px;left:0}.lmmxYa_commissarState{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;text-align:right;font-size:10px;line-height:14px;overflow:hidden}.lmmxYa_commissarState[data-activity=working]{color:var(--dsw-alias-state-business-primary);font-weight:600}.lmmxYa_captainAvatar,.lmmxYa_memberAvatar{flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative}.lmmxYa_captainAvatar{width:46px;height:46px}.lmmxYa_leadAvatar,.lmmxYa_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0}.lmmxYa_leadAvatar{width:44px;height:44px}.lmmxYa_memberArt{width:40px;height:40px}.lmmxYa_captainInfo,.lmmxYa_memberInfo{flex-direction:column;min-width:0;display:flex}.lmmxYa_captainInfo{gap:2px}.lmmxYa_captainLine,.lmmxYa_memberLine{align-items:center;gap:6px;min-width:0;display:flex}.lmmxYa_captainName,.lmmxYa_memberName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;line-height:18px;overflow:hidden}.lmmxYa_captainRole,.lmmxYa_memberRole{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.lmmxYa_memberModel{color:color-mix(in srgb, var(--dsw-alias-label-tertiary) 78%, transparent);text-overflow:ellipsis;white-space:nowrap;flex:none;margin-left:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px;line-height:12px;overflow:hidden}.lmmxYa_captainSummary,.lmmxYa_memberStatusLine{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;overflow:hidden}.lmmxYa_memberElapsed{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:4px;flex:none;align-items:center;margin-left:6px;padding:0 4px;font-size:8.5px;font-weight:600;line-height:14px;display:inline-flex}.lmmxYa_memberElapsed[data-timing=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning) 14%, transparent);color:var(--dsw-alias-state-warning)}.lmmxYa_memberElapsed[data-timing=over]{background:color-mix(in srgb, var(--dsw-alias-state-danger) 14%, transparent);color:var(--dsw-alias-state-danger)}.lmmxYa_captainState,.lmmxYa_memberState{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;align-items:center;gap:5px;font-size:10px;font-weight:500;line-height:15px;display:inline-flex}.lmmxYa_captainState[data-busy=true],.lmmxYa_memberState[data-activity=working]{color:var(--dsw-alias-state-business-primary)}.lmmxYa_workGlyph rect{opacity:.5}.lmmxYa_workGlyph[data-active=true] rect{animation:1.1s ease-in-out infinite lmmxYa_agentTeamsDot}@keyframes lmmxYa_agentTeamsDot{0%,to{opacity:.25}50%{opacity:1}}.lmmxYa_progressOverview{flex-direction:column;gap:7px;display:flex}.lmmxYa_progressTitle{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:16px}.lmmxYa_progressSegments{gap:3px;display:flex}.lmmxYa_progressSegments>span,.lmmxYa_progressEmpty{background:var(--dsw-alias-line-strong);border-radius:2px;flex:1;height:5px}.lmmxYa_progressEmpty{width:100%;display:block}.lmmxYa_progressSegments>span[data-state=running]{background:var(--dsw-alias-state-business-primary)}.lmmxYa_progressSegments>span[data-state=blocked]{background:var(--dsw-alias-state-warning)}.lmmxYa_progressSegments>span[data-state=completed]{background:var(--dsw-alias-state-success)}.lmmxYa_progressSegments>span[data-state=failed]{background:var(--dsw-alias-state-danger)}.lmmxYa_progressSegments>span[data-state=cancelled]{opacity:.55}.lmmxYa_progressLegend{color:var(--dsw-alias-label-tertiary);gap:10px;font-size:9px;line-height:14px;display:flex}.lmmxYa_progressLegend>span[data-state=running]{color:var(--dsw-alias-state-business-primary)}.lmmxYa_progressLegend>span[data-state=blocked]{color:var(--dsw-alias-state-warning)}.lmmxYa_progressLegend>span[data-state=completed]{color:var(--dsw-alias-state-success)}.lmmxYa_progressSummary{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-module));min-width:0;color:var(--dsw-alias-label-secondary);border-radius:8px;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;line-height:15px;display:flex}.lmmxYa_progressSummary[data-state=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warning) 8%, var(--dsw-alias-bg-module))}.lmmxYa_progressSummary[data-state=completed]{background:color-mix(in srgb, var(--dsw-alias-state-success) 8%, var(--dsw-alias-bg-module))}.lmmxYa_progressSummary>span:last-child{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.lmmxYa_progressSummaryDot{background:var(--dsw-alias-state-business-primary);border-radius:50%;flex:none;width:5px;height:5px}.lmmxYa_progressSummary[data-state=warning] .lmmxYa_progressSummaryDot{background:var(--dsw-alias-state-warning)}.lmmxYa_progressSummary[data-state=completed] .lmmxYa_progressSummaryDot{background:var(--dsw-alias-state-success)}.lmmxYa_membersToggle{background:var(--dsw-alias-bg-module-platform);width:100%;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:0;border-radius:8px;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-size:10px;font-weight:600;line-height:15px;transition:background-color .12s;display:flex}.lmmxYa_membersToggle:hover{background:var(--dsw-alias-bg-fill-neutral)}.lmmxYa_membersToggle>span{align-items:center;gap:5px;display:inline-flex}.lmmxYa_membersToggle>span:last-child{color:var(--dsw-alias-state-business-primary)}.lmmxYa_chevron{flex:none;transition:transform .12s}.lmmxYa_chevron[data-open=true]{transform:rotate(90deg)}.lmmxYa_delegationTree{flex-direction:column;gap:2px;margin-left:18px;padding:0 0 0 20px;display:flex;position:relative}.lmmxYa_delegationTree:before{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));content:\"\";width:1px;position:absolute;top:0;bottom:22px;left:0}.lmmxYa_memberBlock{flex-direction:column;min-width:0;padding:3px 0 7px;display:flex;position:relative}.lmmxYa_memberBranch{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));width:20px;height:1px;display:block;position:absolute;top:27px;right:100%}.lmmxYa_memberBranch:before{background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:5px;height:5px;position:absolute;top:-2px;right:-1px}.lmmxYa_memberRow{box-sizing:border-box;width:100%;min-width:0;min-height:48px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 6px;transition:background-color .12s,transform .12s;display:grid}.lmmxYa_memberRow:hover,.lmmxYa_memberRow[data-activity=working]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module))}.lmmxYa_memberRow:active{transform:scale(.99)}.lmmxYa_memberAvatar{width:42px;height:42px}.lmmxYa_memberAvatar[data-unread=true]:after{box-sizing:border-box;border:1px solid var(--dsw-alias-bg-module);background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:6px;height:6px;animation:1.8s ease-in-out infinite lmmxYa_agentTeamsUnreadPulse;position:absolute;top:0;right:-1px}@keyframes lmmxYa_agentTeamsUnreadPulse{0%,to{opacity:.78;transform:scale(.92)}50%{opacity:1;transform:scale(1.16)}}.lmmxYa_memberInitial{background:var(--dsw-alias-bg-fill-business);width:38px;height:38px;color:var(--dsw-alias-label-on-fill);border-radius:50%;justify-content:center;align-items:center;font-size:15px;font-weight:600;line-height:20px;display:inline-flex}.lmmxYa_stateArt{box-sizing:border-box;object-fit:contain;width:22px;height:22px;filter:drop-shadow(0 0 1px var(--dsw-alias-bg-module)) drop-shadow(0 1px 1px #122d483d);background:0 0;border:0;border-radius:0;position:absolute;bottom:-3px;right:-5px}.lmmxYa_stateArt[data-activity=working]{animation:2.4s ease-in-out infinite lmmxYa_agentTeamsFloat}.lmmxYa_stateArt[data-activity=idle]{animation:4.2s ease-in-out infinite lmmxYa_agentTeamsBreathe}.lmmxYa_stateArt[data-activity=unknown]{animation:2.8s ease-in-out infinite lmmxYa_agentTeamsThink}@keyframes lmmxYa_agentTeamsFloat{0%,to{transform:translateY(0)rotate(-4deg)}50%{transform:translateY(-2px)rotate(4deg)}}@keyframes lmmxYa_agentTeamsBreathe{0%,to{opacity:.82;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}@keyframes lmmxYa_agentTeamsThink{0%,to{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}.lmmxYa_memberRight{flex:none;align-items:center;gap:8px;display:inline-flex}.lmmxYa_memberCount{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.lmmxYa_assignmentLine{align-items:center;gap:7px;min-width:0;padding:0 6px 0 60px;display:flex}.lmmxYa_assignmentLabel{color:var(--dsw-alias-label-tertiary);flex:none;font-size:9px;line-height:14px}.lmmxYa_assignmentTasks{flex-wrap:wrap;flex:1;gap:4px;min-width:0;display:flex}.lmmxYa_assignmentChip{background:var(--dsw-alias-bg-fill-neutral);min-height:16px;color:var(--dsw-alias-label-secondary);border-radius:4px;align-items:center;padding:0 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:600;line-height:14px;display:inline-flex}.lmmxYa_assignmentChip[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.lmmxYa_assignmentChip[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.lmmxYa_assignmentChip[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.lmmxYa_assignmentChip[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.lmmxYa_assignmentChip[data-state=cancelled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.lmmxYa_assignmentChip[data-review=pending]{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-warning) 55%, transparent);outline-offset:-1px}.lmmxYa_assignmentChip[data-helping=true]{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, transparent);outline-offset:-1px}.lmmxYa_reviewChip,.lmmxYa_helpingChip,.lmmxYa_calibrationChip,.lmmxYa_blockedChip,.lmmxYa_inputChip{box-sizing:border-box;white-space:nowrap;min-height:16px;color:inherit;background:0 0;border-radius:4px;flex:none;align-items:center;margin-left:4px;padding:0 3px;font-family:inherit;font-size:8.5px;font-weight:700;line-height:16px;display:inline-flex}.lmmxYa_reviewChip{outline:1px dashed color-mix(in srgb, var(--dsw-alias-state-warning) 70%, transparent);outline-offset:-1px}.lmmxYa_blockedChip{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-warning) 75%, transparent);outline-offset:-1px}.lmmxYa_inputChip{outline:1px dashed color-mix(in srgb, var(--dsw-alias-label-secondary) 70%, transparent);outline-offset:-1px}.lmmxYa_helpingChip{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 65%, transparent);outline-offset:-1px}.lmmxYa_calibrationChip{outline:1px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 70%, transparent);outline-offset:-1px}.lmmxYa_assignmentChip[data-timing=warn]{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-warning) 55%, transparent);outline-offset:-1px}.lmmxYa_assignmentChip[data-timing=over]{outline:1px solid color-mix(in srgb, var(--dsw-alias-state-danger) 62%, transparent);outline-offset:-1px}.lmmxYa_timingChip{box-sizing:border-box;white-space:nowrap;border-radius:4px;flex:none;align-items:center;min-height:16px;margin-left:4px;padding:0 3px;font-family:inherit;font-size:8.5px;font-weight:700;line-height:16px;display:inline-flex}.lmmxYa_timingChip[data-timing=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning) 16%, transparent);color:var(--dsw-alias-state-warning)}.lmmxYa_timingChip[data-timing=over]{background:color-mix(in srgb, var(--dsw-alias-state-danger) 16%, transparent);color:var(--dsw-alias-state-danger)}.lmmxYa_unreadPill{color:var(--dsw-alias-state-business-primary);white-space:nowrap;flex:none;font-size:9px;font-weight:600;line-height:14px}.lmmxYa_taskEmpty{color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:14px}.lmmxYa_dependencySection{border-top:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:7px;min-width:0;padding-top:10px;display:flex}.lmmxYa_sectionToggleTitle{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.lmmxYa_dagViewport{scrollbar-width:thin;min-width:0;padding:2px 0 4px;overflow-x:auto}.lmmxYa_dagCanvas{min-width:100%;position:relative}.lmmxYa_dagCanvas[data-layout=parallel]{flex-wrap:wrap;gap:8px;display:flex}.lmmxYa_dagCanvas[data-layout=parallel] .lmmxYa_dagNode{flex:92px;min-width:92px;position:relative}.lmmxYa_dagEdges{pointer-events:none;position:absolute;inset:0;overflow:visible}.lmmxYa_dagEdges path{fill:none;stroke:var(--dsw-alias-line-strong);stroke-width:1px;transition:opacity .12s,stroke .12s,stroke-width .12s}.lmmxYa_dagEdges path[data-active=true]{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6px}.lmmxYa_dagEdges path[data-dimmed=true]{opacity:.24}.lmmxYa_dagNode{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;border-radius:6px;flex-direction:column;justify-content:center;gap:1px;padding:0 6px;transition:border-color .12s,background-color .12s,opacity .12s;display:flex;position:absolute}.lmmxYa_dagNode:hover,.lmmxYa_dagNode[data-focused=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module))}.lmmxYa_dagNode[data-dimmed=true]{opacity:.3}.lmmxYa_dagNode[data-state=running][data-dimmed=true]{opacity:.58}.lmmxYa_dagNode[data-state=completed]{border-color:color-mix(in srgb, var(--dsw-alias-state-success) 48%, var(--dsw-alias-line-normal))}.lmmxYa_dagNode[data-state=blocked]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning) 52%, var(--dsw-alias-line-normal))}.lmmxYa_dagNode[data-review=pending]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning) 78%, var(--dsw-alias-line-normal));box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warning) 42%, transparent)}.lmmxYa_dagNode[data-helping=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 70%, var(--dsw-alias-line-normal));box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, transparent)}.lmmxYa_dagNode[data-timing=warn]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning) 78%, var(--dsw-alias-line-normal));box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warning) 42%, transparent)}.lmmxYa_dagNode[data-timing=over]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 78%, var(--dsw-alias-line-normal));box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-danger) 46%, transparent)}.lmmxYa_dagNode[data-state=failed]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 56%, var(--dsw-alias-line-normal))}.lmmxYa_dagNodeHead{color:var(--dsw-alias-label-primary);align-items:center;gap:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:700;display:flex}.lmmxYa_dagNodeDot{background:var(--dsw-alias-line-strong);border-radius:2px;flex:none;width:5px;height:5px}.lmmxYa_dagNode[data-state=running] .lmmxYa_dagNodeDot{background:var(--dsw-alias-state-business-primary)}.lmmxYa_dagNode[data-state=running] .lmmxYa_dagNodeHead{padding-right:12px}.lmmxYa_dagRunningState{width:9px;height:9px;color:var(--dsw-alias-state-business-primary);pointer-events:none;justify-content:center;align-items:center;display:inline-flex;position:absolute;top:4px;right:5px}.lmmxYa_dagRunningState .lmmxYa_workGlyph{width:9px;height:9px}.lmmxYa_dagNode[data-state=blocked] .lmmxYa_dagNodeDot{background:var(--dsw-alias-state-warning)}.lmmxYa_dagNode[data-state=completed] .lmmxYa_dagNodeDot{background:var(--dsw-alias-state-success)}.lmmxYa_dagNode[data-state=failed] .lmmxYa_dagNodeDot{background:var(--dsw-alias-state-danger)}.lmmxYa_dagNodeLabel{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:11px;overflow:hidden}.lmmxYa_taskDetail{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:8px;flex-direction:column;gap:3px;min-width:0;padding:7px 9px;display:flex}.lmmxYa_taskDetailHead{align-items:center;gap:6px;min-width:0;display:flex}.lmmxYa_taskDetailId{color:var(--dsw-alias-state-business-primary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700}.lmmxYa_taskDetailSubject{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;line-height:16px;overflow:hidden}.lmmxYa_taskDetailBadge{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:0 5px;font-size:8.5px;font-weight:600;line-height:14px}.lmmxYa_taskDetailBadge[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.lmmxYa_taskDetailBadge[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.lmmxYa_taskDetailBadge[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.lmmxYa_taskDetailBadge[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.lmmxYa_taskDetailLine,.lmmxYa_taskDetailMeta{color:var(--dsw-alias-label-secondary);font-size:9px;line-height:14px}.lmmxYa_taskDetailMeta{color:var(--dsw-alias-label-tertiary)}.lmmxYa_taskDetailTiming{color:var(--dsw-alias-label-secondary);font-size:9px;line-height:14px}.lmmxYa_taskDetailTiming[data-timing=warn]{color:var(--dsw-alias-state-warning)}.lmmxYa_taskDetailTiming[data-timing=over]{color:var(--dsw-alias-state-danger);font-weight:600}.lmmxYa_taskDetailSignals,.lmmxYa_taskDetailRetro{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:13px;overflow:hidden}.lmmxYa_taskDetailRetro[data-cause=underestimated],.lmmxYa_taskDetailRetro[data-cause=dependency-blocked]{color:var(--dsw-alias-state-danger)}.lmmxYa_taskDetailRetro[data-cause=on_time]{color:var(--dsw-alias-state-success)}.lmmxYa_taskDetailReview{color:var(--dsw-alias-state-warning);font-size:9px;font-weight:600;line-height:14px}.lmmxYa_taskDetailReview[data-verdict=pass]{color:var(--dsw-alias-state-success)}.lmmxYa_taskDetailReview[data-verdict=reject]{color:var(--dsw-alias-state-danger)}.lmmxYa_taskDetailCalibration{color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px}.lmmxYa_taskDetailBlocked{color:var(--dsw-alias-state-warning);font-size:9px;font-weight:700;line-height:14px}.lmmxYa_taskDetailInput{color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px}.lmmxYa_emptyHint{color:var(--dsw-alias-label-tertiary);padding:10px 14px;font-size:11px;line-height:16px}.lmmxYa_historicPill{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;margin-left:auto;padding:1px 7px;font-size:9px;font-weight:600;line-height:15px}.lmmxYa_members{flex-direction:column;gap:3px;display:flex}.lmmxYa_archiveLabel{color:var(--dsw-alias-label-tertiary);padding:5px 14px 0;font-size:9px;font-weight:600;line-height:14px;display:block}.lmmxYa_archiveFilterBar{flex-wrap:wrap;align-items:center;gap:6px 8px;padding:6px 14px 2px;display:flex}.lmmxYa_archiveFilterField{color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;font-size:9px;line-height:14px;display:inline-flex}.lmmxYa_archiveFilterCaption{white-space:nowrap;font-weight:600}.lmmxYa_archiveSelect{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);max-width:120px;color:var(--dsw-alias-label-primary);border-radius:4px;padding:1px 2px;font-size:9px;line-height:14px}.lmmxYa_archiveFilterCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin-left:auto;font-size:9px}.lmmxYa_archiveEmpty{color:var(--dsw-alias-label-tertiary);padding:4px 14px 2px;font-size:9px;display:block}@media (prefers-reduced-motion:reduce){.lmmxYa_panel,.lmmxYa_badge,.lmmxYa_badgeDot,.lmmxYa_panelDot,.lmmxYa_workGlyph rect,.lmmxYa_stateArt,.lmmxYa_memberAvatar[data-unread=true]:after{transition:none;animation:none}}@media (width<=960px){html[data-agent-team-web-panel-open] [data-phase=active]{padding-right:0}.lmmxYa_team{padding:12px 12px 14px}.lmmxYa_delegationTree{margin-left:12px;padding-left:15px}.lmmxYa_memberBranch{width:15px}}@media (width<=640px){.lmmxYa_badge{top:56px;right:10px}.lmmxYa_teamStats span[data-stat=messages]{display:none}.lmmxYa_captainNode{grid-template-columns:48px minmax(0,1fr)}.lmmxYa_captainState{display:none}.lmmxYa_assignmentLine{padding-left:60px}}.lmmxYa_healthChip{box-sizing:border-box;background:color-mix(in srgb,var(--dsw-alias-bg-fill-neutral) 70%,var(--dsw-alias-bg-module));border:1px solid var(--dsw-alias-line-normal);border-radius:999px;flex:none;align-items:center;gap:5px;padding:1px 8px;font-size:10px;line-height:15px;display:inline-flex}.lmmxYa_healthChip strong{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:11px;font-weight:700}.lmmxYa_healthChip em{color:var(--dsw-alias-label-secondary);font-style:normal}.lmmxYa_healthChip[data-level=ok] strong{color:var(--dsw-alias-state-success)}.lmmxYa_healthChip[data-level=warn] strong{color:var(--dsw-alias-state-warning)}.lmmxYa_healthChip[data-level=critical] strong,.lmmxYa_riskStat{color:var(--dsw-alias-state-danger)}.lmmxYa_prioritySection{flex-direction:column;gap:5px;min-width:0;display:flex}.lmmxYa_priorityCard{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);border-radius:8px;align-items:flex-start;gap:8px;padding:6px 8px;display:flex}.lmmxYa_priorityCard[data-severity=high]{border-color:color-mix(in srgb,var(--dsw-alias-state-danger) 45%,var(--dsw-alias-line-normal))}.lmmxYa_priorityCard[data-severity=medium]{border-color:color-mix(in srgb,var(--dsw-alias-state-warning) 40%,var(--dsw-alias-line-normal))}.lmmxYa_priorityBadge{background:var(--dsw-alias-bg-fill-business);min-width:22px;height:18px;color:var(--dsw-alias-label-on-fill);border-radius:6px;flex:none;justify-content:center;align-items:center;font-size:10px;font-weight:700;display:inline-flex}.lmmxYa_priorityBody{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}.lmmxYa_priorityTitle{flex-wrap:wrap;align-items:center;gap:5px;min-width:0;display:flex}.lmmxYa_priorityTitle strong{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;line-height:16px;overflow:hidden}.lmmxYa_chip{border-radius:999px;padding:0 6px;font-size:8.5px;font-style:normal;font-weight:600;line-height:14px;display:inline-flex}.lmmxYa_chip[data-readiness=blocked],.lmmxYa_chip[data-readiness=orphaned],.lmmxYa_chip[data-readiness=stalled],.lmmxYa_chip[data-readiness=failed],.lmmxYa_chip[data-severity=high]{background:color-mix(in srgb,var(--dsw-alias-state-danger) 14%,var(--dsw-alias-bg-module));color:var(--dsw-alias-state-danger)}.lmmxYa_chip[data-severity=medium],.lmmxYa_chip[data-readiness=ready]{background:color-mix(in srgb,var(--dsw-alias-state-warning) 14%,var(--dsw-alias-bg-module));color:var(--dsw-alias-state-warning)}.lmmxYa_chip[data-severity=low],.lmmxYa_chip[data-readiness=cancelled]{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-tertiary)}.lmmxYa_priorityReasons{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:14px}.lmmxYa_milestoneRow{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:10px;line-height:15px;display:flex}.lmmxYa_milestoneRow strong{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}.lmmxYa_loadBar{background:var(--dsw-alias-line-strong);border-radius:999px;flex:none;align-items:stretch;width:44px;min-width:0;height:6px;display:inline-flex;overflow:hidden}.lmmxYa_loadBar>span{display:block}.lmmxYa_loadActive{background:var(--dsw-alias-state-business-primary)}.lmmxYa_loadPending{background:var(--dsw-alias-state-warning)}.lmmxYa_loadStalled,.lmmxYa_loadOrphaned{background:var(--dsw-alias-state-danger)}";
		const cssTagId$1 = "@deepseek-ai/dsh-experimental-agent-team-web/ActivityPanel.module.css";
		if (typeof document !== "undefined" && document.head && document.head.querySelector("style[data-plugin-css=\"@deepseek-ai/dsh-experimental-agent-team-web/ActivityPanel.module.css\"]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-experimental-agent-team-web";
			style.dataset.pluginCss = cssTagId$1;
			style.textContent = cssText$1;
			document.head.appendChild(style);
		}
		var ActivityPanel_module_css_default = {
			"agentTeamsBreathe": "lmmxYa_agentTeamsBreathe",
			"agentTeamsDot": "lmmxYa_agentTeamsDot",
			"agentTeamsFloat": "lmmxYa_agentTeamsFloat",
			"agentTeamsPanelIn": "lmmxYa_agentTeamsPanelIn",
			"agentTeamsPulse": "lmmxYa_agentTeamsPulse",
			"agentTeamsThink": "lmmxYa_agentTeamsThink",
			"agentTeamsUnreadPulse": "lmmxYa_agentTeamsUnreadPulse",
			"archiveEmpty": "lmmxYa_archiveEmpty",
			"archiveFilterBar": "lmmxYa_archiveFilterBar",
			"archiveFilterCaption": "lmmxYa_archiveFilterCaption",
			"archiveFilterCount": "lmmxYa_archiveFilterCount",
			"archiveFilterField": "lmmxYa_archiveFilterField",
			"archiveLabel": "lmmxYa_archiveLabel",
			"archiveSelect": "lmmxYa_archiveSelect",
			"assignmentChip": "lmmxYa_assignmentChip",
			"assignmentLabel": "lmmxYa_assignmentLabel",
			"assignmentLine": "lmmxYa_assignmentLine",
			"assignmentTasks": "lmmxYa_assignmentTasks",
			"badge": "lmmxYa_badge",
			"badgeCount": "lmmxYa_badgeCount",
			"badgeDot": "lmmxYa_badgeDot",
			"blockedChip": "lmmxYa_blockedChip",
			"calibrationChip": "lmmxYa_calibrationChip",
			"captainAvatar": "lmmxYa_captainAvatar",
			"captainInfo": "lmmxYa_captainInfo",
			"captainLine": "lmmxYa_captainLine",
			"captainName": "lmmxYa_captainName",
			"captainNode": "lmmxYa_captainNode",
			"captainRole": "lmmxYa_captainRole",
			"captainState": "lmmxYa_captainState",
			"captainSummary": "lmmxYa_captainSummary",
			"chevron": "lmmxYa_chevron",
			"chip": "lmmxYa_chip",
			"closeError": "lmmxYa_closeError",
			"commandLayer": "lmmxYa_commandLayer",
			"commissarNode": "lmmxYa_commissarNode",
			"commissarState": "lmmxYa_commissarState",
			"dagCanvas": "lmmxYa_dagCanvas",
			"dagEdges": "lmmxYa_dagEdges",
			"dagNode": "lmmxYa_dagNode",
			"dagNodeDot": "lmmxYa_dagNodeDot",
			"dagNodeHead": "lmmxYa_dagNodeHead",
			"dagNodeLabel": "lmmxYa_dagNodeLabel",
			"dagRunningState": "lmmxYa_dagRunningState",
			"dagViewport": "lmmxYa_dagViewport",
			"delegationSection": "lmmxYa_delegationSection",
			"delegationTree": "lmmxYa_delegationTree",
			"dependencySection": "lmmxYa_dependencySection",
			"emptyHint": "lmmxYa_emptyHint",
			"healthChip": "lmmxYa_healthChip",
			"helpingChip": "lmmxYa_helpingChip",
			"historicPill": "lmmxYa_historicPill",
			"iconButton": "lmmxYa_iconButton",
			"inputChip": "lmmxYa_inputChip",
			"leadAvatar": "lmmxYa_leadAvatar",
			"loadActive": "lmmxYa_loadActive",
			"loadBar": "lmmxYa_loadBar",
			"loadOrphaned": "lmmxYa_loadOrphaned",
			"loadPending": "lmmxYa_loadPending",
			"loadStalled": "lmmxYa_loadStalled",
			"memberArt": "lmmxYa_memberArt",
			"memberAvatar": "lmmxYa_memberAvatar",
			"memberBlock": "lmmxYa_memberBlock",
			"memberBranch": "lmmxYa_memberBranch",
			"memberCount": "lmmxYa_memberCount",
			"memberElapsed": "lmmxYa_memberElapsed",
			"memberInfo": "lmmxYa_memberInfo",
			"memberInitial": "lmmxYa_memberInitial",
			"memberLine": "lmmxYa_memberLine",
			"memberModel": "lmmxYa_memberModel",
			"memberName": "lmmxYa_memberName",
			"memberRight": "lmmxYa_memberRight",
			"memberRole": "lmmxYa_memberRole",
			"memberRow": "lmmxYa_memberRow",
			"memberState": "lmmxYa_memberState",
			"memberStatusLine": "lmmxYa_memberStatusLine",
			"members": "lmmxYa_members",
			"membersToggle": "lmmxYa_membersToggle",
			"milestoneRow": "lmmxYa_milestoneRow",
			"panel": "lmmxYa_panel",
			"panelControls": "lmmxYa_panelControls",
			"panelDot": "lmmxYa_panelDot",
			"panelHead": "lmmxYa_panelHead",
			"panelTitle": "lmmxYa_panelTitle",
			"priorityBadge": "lmmxYa_priorityBadge",
			"priorityBody": "lmmxYa_priorityBody",
			"priorityCard": "lmmxYa_priorityCard",
			"priorityReasons": "lmmxYa_priorityReasons",
			"prioritySection": "lmmxYa_prioritySection",
			"priorityTitle": "lmmxYa_priorityTitle",
			"progressEmpty": "lmmxYa_progressEmpty",
			"progressLegend": "lmmxYa_progressLegend",
			"progressOverview": "lmmxYa_progressOverview",
			"progressSegments": "lmmxYa_progressSegments",
			"progressSummary": "lmmxYa_progressSummary",
			"progressSummaryDot": "lmmxYa_progressSummaryDot",
			"progressTitle": "lmmxYa_progressTitle",
			"resizeHandle": "lmmxYa_resizeHandle",
			"reviewChip": "lmmxYa_reviewChip",
			"riskStat": "lmmxYa_riskStat",
			"sectionHead": "lmmxYa_sectionHead",
			"sectionHint": "lmmxYa_sectionHint",
			"sectionTitle": "lmmxYa_sectionTitle",
			"sectionToggleTitle": "lmmxYa_sectionToggleTitle",
			"stageLabel": "lmmxYa_stageLabel",
			"stateArt": "lmmxYa_stateArt",
			"taskDetail": "lmmxYa_taskDetail",
			"taskDetailBadge": "lmmxYa_taskDetailBadge",
			"taskDetailBlocked": "lmmxYa_taskDetailBlocked",
			"taskDetailCalibration": "lmmxYa_taskDetailCalibration",
			"taskDetailHead": "lmmxYa_taskDetailHead",
			"taskDetailId": "lmmxYa_taskDetailId",
			"taskDetailInput": "lmmxYa_taskDetailInput",
			"taskDetailLine": "lmmxYa_taskDetailLine",
			"taskDetailMeta": "lmmxYa_taskDetailMeta",
			"taskDetailRetro": "lmmxYa_taskDetailRetro",
			"taskDetailReview": "lmmxYa_taskDetailReview",
			"taskDetailSignals": "lmmxYa_taskDetailSignals",
			"taskDetailSubject": "lmmxYa_taskDetailSubject",
			"taskDetailTiming": "lmmxYa_taskDetailTiming",
			"taskEmpty": "lmmxYa_taskEmpty",
			"taskId": "lmmxYa_taskId",
			"team": "lmmxYa_team",
			"teamHead": "lmmxYa_teamHead",
			"teamName": "lmmxYa_teamName",
			"teamStats": "lmmxYa_teamStats",
			"teams": "lmmxYa_teams",
			"timingChip": "lmmxYa_timingChip",
			"unreadPill": "lmmxYa_unreadPill",
			"workGlyph": "lmmxYa_workGlyph"
		};
		//#endregion
		//#region src/client/ActivityPanel.tsx
		/**
		* AgentTeams activity panel: the top-right floater monitoring every team.
		*
		* Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
		* panel that docks at the conversation's top-right edge by default, can be
		* dragged into a floating window, resized, and folded into an activity badge.
		* On wide viewports the docked panel makes the conversation column yield
		* space; narrow viewports keep a simple inset overlay. It
		* polls the host `/plugins/agent-team-web/state` route for
		* server-side snapshots (durable files + live subagent activity), with a
		* collapsed badge that auto-expands once when activity appears. Archived
		* teams stay available for the owning conversation after live work ends.
		*
		* The floater mounts in ui-layout's additive `shell.overlay`; it is not a
		* conversation node — the in-conversation panel was removed in favor of this
		* always-available monitor.
		* @module dsh-agent-team-web/client/activity
		*/
		/**
		* Page-settle window after mount: activity restored on page load only shows
		* the collapsed badge, so the panel never yanks the conversation column
		* right after load. New activity after this window auto-expands as usual.
		*/
		const AUTO_OPEN_SETTLE_MS = 4e3;
		/** Root marker shared with the panel CSS while the shell overlay is expanded. */
		const PANEL_OPEN_ATTRIBUTE = "data-agent-team-web-panel-open";
		/** Shared width concession consumed by the conversation root CSS. */
		const PANEL_SHIFT_PROPERTY = "--agent-team-web-panel-shift";
		const PANEL_CONVERSATION_GAP = 14;
		const MOVE_THRESHOLD = 4;
		function initialPanelLayout() {
			if (typeof window === "undefined") return DEFAULT_PANEL_LAYOUT;
			return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
		}
		function initialPanelBounds() {
			if (typeof window === "undefined") return {
				width: 1440,
				height: 900,
				anchorRight: 1440
			};
			return {
				width: window.innerWidth,
				height: window.innerHeight,
				anchorRight: window.innerWidth
			};
		}
		/** Initial-letter fallback for unmatched roles. */
		function memberInitial(name) {
			return name.trim().slice(0, 1).toUpperCase() || "?";
		}
		function stableHash(value) {
			let hash = 0;
			for (let index = 0; index < value.length; index += 1) hash = (hash << 5) - hash + value.charCodeAt(index) | 0;
			return Math.abs(hash);
		}
		const ACCENTS = [
			"var(--dsw-alias-state-business-primary)",
			"var(--dsw-alias-state-success)",
			"var(--dsw-alias-state-danger)",
			"var(--dsw-alias-state-warning)",
			"var(--dsw-alias-label-tertiary)"
		];
		function accentOf(id) {
			return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0];
		}
		/** Badge text follows the raw task status (finer than the 4 visual states):
		* claimed/pending/failed/cancelled keep their own labels and colors. */
		const TASK_STATUS_LABEL = {
			pending: "task.status.pending",
			claimed: "task.status.claimed",
			in_progress: "task.status.inProgress",
			completed: "task.status.completed",
			failed: "task.status.failed",
			cancelled: "task.status.cancelled"
		};
		function taskStatusLabel(status, t) {
			const key = TASK_STATUS_LABEL[status];
			return key === void 0 ? status : t(key);
		}
		/** 成员模型小字标签(t7,用户最终格式):`ds-v4-flash · high`。
		* deepseek-official → 品牌缩写 `ds` + 完整型号去 provider 前缀段
		* (`deepseek-v4-flash` → `ds-v4-flash`);其他 provider 取 id 首段为品牌,
		* 模型带该前缀则去掉、否则保留完整;effort(high/max/low/off)以 ` · ` 跟后。
		* model 缺失 → null(旧数据不显示小字)。 */
		function memberModelLabel(provider, model, reasoningEffort) {
			const trimmed = model?.trim();
			if (trimmed === void 0 || trimmed === "") return null;
			const p = provider?.trim();
			let label;
			if (p === "deepseek-official") label = `ds-${trimmed.startsWith("deepseek-") ? trimmed.slice(9) : trimmed}`;
			else if (p !== void 0 && p !== "") {
				const brand = p.split("-")[0] ?? p;
				const prefix = `${brand}-`;
				label = trimmed.startsWith(prefix) ? `${brand}-${trimmed.slice(prefix.length)}` : trimmed;
			} else label = trimmed;
			const effort = reasoningEffort?.trim();
			return effort === void 0 || effort === "" ? label : `${label} · ${effort}`;
		}
		function formatTaskIds(ids, t) {
			return ids.join(t("format.listSeparator"));
		}
		/** Badge/bar coloring key: visual state, widened for terminal statuses. */
		function taskTone(state, status) {
			if (status === "failed") return "failed";
			if (status === "cancelled") return "cancelled";
			return state;
		}
		/** 任务耗时超时档位(ok 不输出警示;warn/over 分别黄/红)。 */
		function timingData(task) {
			return taskTimingState(task, Date.now());
		}
		function Chevron({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.chevron,
				"data-open": open,
				width: "9",
				height: "9",
				viewBox: "0 0 10 10",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.5 2l3 3-3 3" })
			});
		}
		function WorkGlyph({ active }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.workGlyph,
				"data-active": active,
				width: "11",
				height: "11",
				viewBox: "0 0 11 11",
				fill: "currentColor",
				"aria-hidden": true,
				children: [
					[0, 0],
					[4.2, 0],
					[8.4, 0],
					[0, 4.2],
					[4.2, 4.2],
					[8.4, 4.2]
				].map(([x, y], index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x,
					y,
					width: "2.6",
					height: "2.6",
					rx: ".6",
					style: { animationDelay: `${index * .15}s` }
				}, `${x}:${y}`))
			});
		}
		/** Collapsed badge: an always-visible corner pill while any team exists. */
		function CollapsedBadge({ count, busy, onClick, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ActivityPanel_module_css_default.badge,
				"data-agent-team-web-collapsed": true,
				"data-busy": busy,
				onClick,
				"aria-label": t("activity.badgeAria", { count }),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeDot,
					"data-busy": busy,
					"aria-hidden": true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeCount,
					children: count
				})]
			});
		}
		function memberStateLabel(member, tasks, historic, t) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			if (member.activity === "working") return t("member.state.working");
			if (owned.some((task) => task.status === "failed")) return t("member.state.failed");
			if (owned.some((task) => task.state === "blocked")) return t("member.state.waiting");
			if (owned.length > 0 && owned.every((task) => task.status === "completed")) return t("member.state.delivered");
			if (member.status === "removed") return t(historic ? "member.state.left" : "member.state.removed");
			if (owned.length > 0) return t("member.state.pending");
			return t("member.state.unassigned");
		}
		function memberStatusText(member, tasks, t) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			const current = owned.find((task) => task.id === member.currentTask);
			const blocked = owned.find((task) => task.state === "blocked");
			if (member.helpingTask !== void 0) return t("member.status.helping", { taskId: member.helpingTask });
			if (member.activity === "working" && current !== void 0) return t("member.status.executing", { taskId: current.id });
			if (member.activity === "working") return t("member.status.working");
			if (blocked !== void 0) {
				const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== "completed");
				if (dependency !== void 0) return t("member.status.waitingOn", {
					taskId: dependency.id,
					assignee: dependency.assignee || t("task.assignee.unclaimed")
				});
				return t("member.status.waitingPrerequisite");
			}
			if (member.total === 0) return t("member.status.waitingAssignment");
			if (member.done === member.total) return t("member.status.delivered");
			return t(member.activity === "idle" ? "member.status.idle" : "member.status.unknown");
		}
		function compactTaskLabel(subject) {
			const withoutVerb = subject.replace(/^开发\s*/u, "").replace(/^\d+[-_.、\s]*/u, "");
			const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb;
			return head.length > 18 ? `${head.slice(0, 17)}…` : head;
		}
		function taskSummary(team, t) {
			const completed = team.tasks.filter((task) => task.status === "completed");
			const running = team.tasks.filter((task) => task.state === "running");
			const blocked = team.tasks.filter((task) => task.state === "blocked");
			const ready = team.tasks.filter((task) => task.state === "open" && task.status !== "completed");
			if (team.tasks.length === 0) return t("task.summary.waitingBreakdown");
			if (completed.length === team.tasks.length) return t("task.summary.allDelivered", { count: completed.length });
			if (blocked.length > 0 && running.length > 0) return t("task.summary.blockedAndRunning", {
				tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
				more: blocked.length > 3 ? t("task.summary.more", { count: blocked.length - 3 }) : ""
			});
			if (running.length > 0) return t("task.summary.running", { tasks: formatTaskIds(running.map((task) => task.id), t) });
			if (ready.length > 0) return t("task.summary.ready", { tasks: formatTaskIds(ready.map((task) => task.id), t) });
			if (blocked.length > 0) return t("task.summary.blocked", { tasks: formatTaskIds(blocked.map((task) => task.id), t) });
			return t("task.summary.waitingSchedule");
		}
		function ProgressOverview({ team, t }) {
			const running = team.tasks.filter((task) => task.state === "running").length;
			const blocked = team.tasks.filter((task) => task.state === "blocked").length;
			const completed = team.tasks.filter((task) => task.status === "completed").length;
			const summaryTone = blocked > 0 ? "warning" : completed === team.tasks.length && team.tasks.length > 0 ? "completed" : "running";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.progressOverview,
				"aria-label": t("progress.aria"),
				"data-progress-summary": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.progressTitle,
						children: t("progress.title")
					}),
					team.tasks.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.progressSegments,
						"aria-hidden": true,
						children: team.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { "data-state": taskTone(task.state, task.status) }, task.id))
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.progressEmpty }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.progressLegend,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-state": "running",
								children: t("progress.running", { count: running })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-state": "blocked",
								children: t("progress.blocked", { count: blocked })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-state": "completed",
								children: t("progress.delivered", { count: completed })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.progressSummary,
						"data-state": summaryTone,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.progressSummaryDot }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: taskSummary(team, t) })]
					})
				]
			});
		}
		function DependencyMap({ tasks, t, compact = false }) {
			const [open, setOpen] = (0, react.useState)(true);
			const [hoverTaskId, setHoverTaskId] = (0, react.useState)(null);
			const [keyboardTaskId, setKeyboardTaskId] = (0, react.useState)(null);
			const [pinnedTaskId, setPinnedTaskId] = (0, react.useState)(null);
			const hoverTimer = (0, react.useRef)(null);
			const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId);
			const layout = (0, react.useMemo)(() => compactDagLayout(tasks), [tasks]);
			const parallel = (0, react.useMemo)(() => usesParallelTaskGrid(tasks), [tasks]);
			const related = (0, react.useMemo)(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
			const scheduleHover = (id) => {
				if (hoverTimer.current !== null) {
					clearTimeout(hoverTimer.current);
					hoverTimer.current = null;
				}
				if (id === null) {
					setHoverTaskId(null);
					return;
				}
				hoverTimer.current = setTimeout(() => {
					hoverTimer.current = null;
					setHoverTaskId(id);
				}, 180);
			};
			(0, react.useEffect)(() => () => {
				if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
			}, []);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") setPinnedTaskId(null);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, []);
			if (tasks.length === 0) return null;
			const fallbackTask = tasks.find((task) => task.state === "blocked") ?? tasks.find((task) => task.state === "running") ?? tasks[0];
			const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask;
			const waitingOn = detailTask.dependencies.filter((dependency) => tasks.find((task) => task.id === dependency)?.status !== "completed");
			const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.dependencySection,
				"aria-label": t("dependency.aria"),
				"data-dependency-map": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.sectionHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.sectionToggleTitle,
						onClick: () => {
							setOpen((current) => !current);
						},
						"aria-expanded": open,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { open }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),
							" ",
							t(parallel ? "dependency.parallel" : "dependency.title")
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionHint,
						children: pinnedTaskId === null ? t(parallel ? "dependency.hint.parallel" : "dependency.hint.chain") : t("dependency.hint.pinned", { taskId: pinnedTaskId })
					})]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ActivityPanel_module_css_default.dagViewport,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.dagCanvas,
						"data-layout": parallel ? "parallel" : "dependency",
						style: parallel ? void 0 : {
							width: layout.width,
							height: layout.height
						},
						children: [!parallel && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: ActivityPanel_module_css_default.dagEdges,
							width: layout.width,
							height: layout.height,
							"aria-hidden": true,
							children: layout.edges.map((edge) => {
								const active = related !== null && related.has(edge.from) && related.has(edge.to);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: edge.path,
									"data-active": active,
									"data-dimmed": related !== null && !active
								}, `${edge.from}:${edge.to}`);
							})
						}), layout.nodes.map(({ task, x, y }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.dagNode,
							style: parallel ? { height: 30 } : {
								left: x,
								top: y,
								width: 92,
								height: 30
							},
							"data-task-id": task.id,
							"data-state": taskTone(task.state, task.status),
							"data-review": taskReviewPending(task) ? "pending" : void 0,
							"data-helping": taskHelper(task) !== void 0 ? "true" : void 0,
							"data-timing": timingData(task) === "ok" ? void 0 : timingData(task),
							"data-focused": related?.has(task.id) ?? false,
							"data-dimmed": related !== null && !related.has(task.id),
							"aria-pressed": pinnedTaskId === task.id,
							title: `${task.id} · ${task.subject}${taskHelper(task) !== void 0 ? ` · ${t("task.helping", { member: taskHelper(task) })}` : ""}`,
							onClick: () => {
								setPinnedTaskId((current) => current === task.id ? null : task.id);
							},
							onMouseEnter: () => {
								scheduleHover(task.id);
							},
							onMouseLeave: () => {
								scheduleHover(null);
							},
							onFocus: () => {
								setKeyboardTaskId(task.id);
							},
							onBlur: () => {
								setKeyboardTaskId(null);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.dagNodeHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.dagNodeDot }), task.id]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.dagNodeLabel,
									children: compactTaskLabel(task.subject)
								}),
								task.state === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.dagRunningState,
									"aria-label": t("task.runningAria"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkGlyph, { active: true })
								})
							]
						}, task.id))]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: ActivityPanel_module_css_default.taskDetail,
					"data-task-detail": detailTask.id,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailHead,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailId,
									children: detailTask.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailSubject,
									title: detailTask.subject,
									children: detailTask.subject.replace(/^开发\s*/u, "")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailBadge,
									"data-state": taskTone(detailTask.state, detailTask.status),
									children: taskStatusLabel(detailTask.status, t)
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailLine,
							children: [
								detailTask.assignee || t("task.assignee.unclaimed"),
								" · ",
								detailTask.status === "completed" ? t("task.detail.completed") : detailTask.dependencies.length === 0 ? t("task.detail.noPrerequisite") : waitingOn.length === 0 ? t("task.detail.ready") : t("task.detail.waitingOn", { tasks: formatTaskIds(waitingOn, t) })
							]
						}),
						taskTimingText(detailTask, t) !== null && !compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailTiming,
							"data-timing": timingData(detailTask),
							children: taskTimingText(detailTask, t)
						}),
						taskSignalsText(detailTask, t) !== null && !compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailSignals,
							"data-timing": timingData(detailTask),
							children: taskSignalsText(detailTask, t)
						}),
						retroDetailText(detailTask, t) !== null && !compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailRetro,
							"data-cause": detailTask.retro?.cause,
							children: retroDetailText(detailTask, t)
						}),
						taskPendingCalibration(detailTask) && !compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailCalibration,
							"data-calibration": "pending",
							children: t("task.calibration.detail")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailMeta,
							children: dependents.length === 0 ? t("task.detail.noDownstream") : t("task.detail.unlocks", { tasks: formatTaskIds(dependents.map((task) => task.id), t) })
						}),
						taskReviewState(detailTask) !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailReview,
							"data-verdict": detailTask.review?.verdict ?? "pending",
							children: detailTask.review?.verdict === "pass" ? t("task.review.passed", { reviewer: detailTask.review.reviewerName }) : detailTask.review?.verdict === "reject" ? t("task.review.rejected", { comment: detailTask.review.comment ?? "" }) : t("task.review.pending")
						}),
						taskBlockedByReview(detailTask) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailBlocked,
							"data-intermediate": "blockedReview",
							children: t("task.intermediate.blockedReviewDetail")
						}),
						taskAwaitingInput(detailTask) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailInput,
							"data-intermediate": "awaitingInput",
							children: t("task.intermediate.awaitingInputDetail")
						})
					]
				})] })]
			});
		}
		/** 健康档位:0-49 需要立即干预,50-79 存在风险,80+ 运行平稳。 */
		function healthLevel(score) {
			if (score < 50) return "critical";
			if (score < 80) return "warn";
			return "ok";
		}
		/** 高风险消息计数(融合分析层)。 */
		function healthRiskCount(team) {
			return team.intelligence?.messageRisks.filter((risk) => risk.riskLevel === "high").length ?? 0;
		}
		/** 成员负载条:active / pending / stalled / orphaned 四段。 */
		function loadBarFor(team, member) {
			const load = team.intelligence?.memberLoads.find((entry) => entry.memberName === member.name);
			if (load === void 0) return null;
			const total = load.activeTaskCount + load.pendingOwnedTaskCount + load.stalledTaskCount + load.orphanedTaskCount;
			if (total <= 0) return null;
			const pct = (count) => `${Math.round(count / total * 100)}%`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ActivityPanel_module_css_default.loadBar,
				role: "img",
				title: `${member.name} load`,
				"data-level": load.level,
				children: [
					load.activeTaskCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.loadActive,
						style: { width: pct(load.activeTaskCount) }
					}),
					load.pendingOwnedTaskCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.loadPending,
						style: { width: pct(load.pendingOwnedTaskCount) }
					}),
					load.stalledTaskCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.loadStalled,
						style: { width: pct(load.stalledTaskCount) }
					}),
					load.orphanedTaskCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.loadOrphaned,
						style: { width: pct(load.orphanedTaskCount) }
					})
				]
			});
		}
		/** Commissar supervision-state label derived from member activity. */
		function commissarStateLabel(activity, t) {
			if (activity === "working") return t("commissar.state.supervising");
			if (activity === "idle") return t("commissar.state.standby");
			return t("commissar.state.unknown");
		}
		function TeamSection({ team, onNavigate, t, historic = false, compact = false }) {
			const [membersOpen, setMembersOpen] = (0, react.useState)(true);
			const commissar = team.members.find((member) => member.role === "commissar");
			const execMembers = team.members.filter((member) => member.role !== "commissar");
			const busyCount = execMembers.filter((member) => member.activity === "working").length;
			const assignedCount = team.tasks.filter((task) => task.assignee !== "").length;
			const completedCount = team.tasks.filter((task) => task.status === "completed").length;
			const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.team,
				"data-team-id": team.teamId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.teamHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.teamName,
								title: team.name,
								children: team.name
							}),
							historic && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.historicPill,
								children: t("team.ended")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.teamStats,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-stat": "members",
										children: t("team.stats.members", { count: team.members.length })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-stat": "tasks",
										children: t("team.stats.completed", {
											completed: completedCount,
											total: team.tasks.length
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-stat": "messages",
										children: t("team.stats.messages", { count: team.messageCount })
									}),
									team.intelligence !== void 0 && healthRiskCount(team) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-stat": "risks",
										className: ActivityPanel_module_css_default.riskStat,
										children: t("risk.high", { count: healthRiskCount(team) })
									})
								]
							}),
							team.intelligence !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.healthChip,
								"data-level": healthLevel(team.intelligence.health.score),
								title: team.intelligence.health.overview,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: team.intelligence.health.score }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: team.intelligence.health.statusLabel })]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.delegationSection,
						"aria-label": t("delegation.aria"),
						"data-delegation-map": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.commandLayer,
								"data-leadership": commissar === void 0 ? "solo" : "pair",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ActivityPanel_module_css_default.captainNode,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.captainAvatar,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: ActivityPanel_module_css_default.leadAvatar,
												src: LEAD_ART,
												alt: "",
												"aria-hidden": true
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.captainInfo,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: ActivityPanel_module_css_default.captainLine,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.captainName,
													children: t("captain.name")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.captainRole,
													children: t("captain.role")
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.captainSummary,
												children: t("captain.summary", {
													tasks: assignedCount,
													members: execMembers.length
												})
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.captainState,
											"data-busy": busyCount > 0,
											title: busyCount > 0 ? t("captain.state.working", { count: busyCount }) : t(allCompleted ? "captain.state.collected" : "captain.state.waiting"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkGlyph, { active: busyCount > 0 }), busyCount > 0 ? t("captain.state.working", { count: busyCount }) : t(allCompleted ? "captain.state.collected" : "captain.state.waiting")]
										})
									]
								}), commissar !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ActivityPanel_module_css_default.commissarNode,
									"data-activity": commissar.activity,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.captainAvatar,
											children: [memberArtUrl(commissar.name, commissar.role) !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: ActivityPanel_module_css_default.leadAvatar,
												src: memberArtUrl(commissar.name, commissar.role) ?? "",
												alt: "",
												"aria-hidden": true
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberInitial,
												style: { background: accentOf(commissar.id) },
												children: memberInitial(commissar.name)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: ActivityPanel_module_css_default.stateArt,
												"data-activity": commissar.activity,
												src: ACTION_ART[commissar.activity],
												alt: "",
												"aria-hidden": true
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.captainInfo,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: ActivityPanel_module_css_default.captainLine,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.captainName,
													children: roleTitle(commissar.role, t)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.captainRole,
													children: t("commissar.dutyShort")
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.captainSummary,
												title: t("commissar.dutyFull"),
												children: t("commissar.duty")
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.commissarState,
											"data-activity": commissar.activity,
											children: commissarStateLabel(commissar.activity, t)
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressOverview, {
								team,
								t
							}),
							team.intelligence !== void 0 && team.intelligence.priorities.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: ActivityPanel_module_css_default.prioritySection,
								"aria-label": t("priority.aria"),
								"data-priority-map": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.sectionTitle,
									children: t("priority.title")
								}), team.intelligence.priorities.slice(0, 3).map((priority, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ActivityPanel_module_css_default.priorityCard,
									"data-severity": priority.severity,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.priorityBadge,
										children: ["P", index + 1]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.priorityBody,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.priorityTitle,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: priority.subject }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
													className: ActivityPanel_module_css_default.chip,
													"data-readiness": priority.readiness,
													children: priority.readiness
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
													className: ActivityPanel_module_css_default.chip,
													"data-severity": priority.severity,
													children: priority.severity
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.priorityReasons,
											children: priority.reasons.join(" ")
										})]
									})]
								}, priority.taskId))]
							}),
							team.intelligence !== void 0 && team.intelligence.milestones.latestTitle !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.milestoneRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.sectionTitle,
									children: t("milestone.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									title: team.intelligence.milestones.latestTitle,
									children: team.intelligence.milestones.latestTitle
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.membersToggle,
								onClick: () => {
									setMembersOpen((current) => !current);
								},
								"aria-expanded": membersOpen,
								"data-members-toggle": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { open: membersOpen }), t("members.toggle", { count: execMembers.length })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(membersOpen ? "members.collapse" : "members.expand") })]
							}),
							membersOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.delegationTree,
								children: [execMembers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.emptyHint,
									children: t("members.empty")
								}), execMembers.map((member) => {
									const owned = team.tasks.filter((task) => task.assignee === member.name);
									const modelLabel = memberModelLabel(member.provider, member.model, member.reasoningEffort);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ActivityPanel_module_css_default.memberBlock,
										"data-activity": member.activity,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberBranch,
												"aria-hidden": true,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: ActivityPanel_module_css_default.memberRow,
												"data-activity": member.activity,
												onClick: () => {
													if (member.id !== "") onNavigate(team.captainSessionId, member.id);
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberAvatar,
														"data-unread": member.unread > 0,
														children: [memberArtUrl(member.name, member.role) !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
															className: ActivityPanel_module_css_default.memberArt,
															src: memberArtUrl(member.name, member.role) ?? "",
															alt: "",
															"aria-hidden": true
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: ActivityPanel_module_css_default.memberInitial,
															style: { background: accentOf(member.id) },
															children: memberInitial(member.name)
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
															className: ActivityPanel_module_css_default.stateArt,
															"data-activity": member.activity,
															src: ACTION_ART[member.activity],
															alt: "",
															"aria-hidden": true
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberInfo,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: ActivityPanel_module_css_default.memberLine,
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: ActivityPanel_module_css_default.memberName,
																	children: nameTitle(member.name, t)
																}),
																member.role !== "" && !isRoleName(member.name) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: ActivityPanel_module_css_default.memberRole,
																	children: roleTitle(member.role, t)
																}),
																modelLabel !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: ActivityPanel_module_css_default.memberModel,
																	children: modelLabel
																})
															]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: ActivityPanel_module_css_default.memberStatusLine,
															children: [memberStatusText(member, team.tasks, t), memberElapsedText(member, t) !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.memberElapsed,
																"data-timing": memberTimingState(member, team.tasks),
																children: memberElapsedText(member, t)
															})]
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberRight,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: ActivityPanel_module_css_default.memberState,
																"data-activity": member.activity,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkGlyph, { active: member.activity === "working" }), memberStateLabel(member, team.tasks, historic, t)]
															}),
															loadBarFor(team, member),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: ActivityPanel_module_css_default.memberCount,
																children: [
																	member.done,
																	"/",
																	member.total
																]
															})
														]
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: ActivityPanel_module_css_default.assignmentLine,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentLabel,
													children: t("assignment.label")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentTasks,
													children: owned.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.taskEmpty,
														children: t("assignment.empty")
													}) : owned.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.assignmentChip,
														"data-state": taskTone(task.state, task.status),
														"data-review": taskReviewPending(task) ? "pending" : void 0,
														"data-intermediate": taskIntermediateFlag(task),
														"data-helping": taskHelper(task) !== void 0 ? "true" : void 0,
														"data-timing": timingData(task),
														title: `${task.id} · ${task.subject}`,
														children: [
															task.id,
															taskBlockedByReview(task) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.blockedChip,
																children: t("task.intermediate.blockedReview")
															}) : taskReviewPending(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.reviewChip,
																children: t("task.review.pending")
															}),
															taskAwaitingInput(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.inputChip,
																children: t("task.intermediate.awaitingInput")
															}),
															taskPendingCalibration(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.calibrationChip,
																children: t("task.calibration.pending")
															}),
															taskHelper(task) !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.helpingChip,
																children: t("task.helping", { member: taskHelper(task) })
															}),
															!compact && timingData(task) !== "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.timingChip,
																"data-timing": timingData(task),
																children: t(timingData(task) === "over" ? "timing.over" : "timing.warn")
															})
														]
													}, task.id))
												})]
											})
										]
									}, member.id);
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DependencyMap, {
						tasks: team.tasks,
						t,
						compact
					})
				]
			});
		}
		/** Legacy conversation cards may outlive their host archive. Project their
		* durable roster through the same rebuilt panel instead of a second UI. */
		function historicCardTeam(data, owner) {
			return {
				workspace: "",
				teamId: data.teamId,
				name: data.teamName,
				captainSessionId: data.captainSessionId || owner,
				members: data.members.map((member) => ({
					...member,
					status: "removed",
					activity: "idle",
					progress: 0,
					done: 0,
					total: 0,
					currentTask: "",
					currentTaskElapsedMs: 0,
					currentTaskElapsedApprox: false,
					unread: 0
				})),
				tasks: [],
				messageCount: 0,
				captainInbox: []
			};
		}
		function ActivityPanel({ sessionsList, openMember, t }) {
			const navigateToSession = (parentId, childId) => {
				setOpen(false);
				setWasActive(false);
				openMember(parentId, childId);
			};
			const [open, setOpen] = (0, react.useState)(false);
			const [openOwner, setOpenOwner] = (0, react.useState)();
			const [autoOpened, setAutoOpened] = (0, react.useState)(false);
			const [wasActive, setWasActive] = (0, react.useState)(false);
			const [historic, setHistoric] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [layout, setLayout] = (0, react.useState)(initialPanelLayout);
			const [bounds, setBounds] = (0, react.useState)(initialPanelBounds);
			const [interaction, setInteraction] = (0, react.useState)(null);
			const [closing, setClosing] = (0, react.useState)(false);
			const [closeError, setCloseError] = (0, react.useState)(null);
			const panelRef = (0, react.useRef)(null);
			const boundsRef = (0, react.useRef)(bounds);
			const gestureRef = (0, react.useRef)(null);
			const frameRef = (0, react.useRef)(null);
			const pendingLayoutRef = (0, react.useRef)(null);
			const current = (0, react.useSyncExternalStore)(sessionsList.subscribe, sessionsList.getSnapshot).current;
			const monitorTargets = (0, react.useSyncExternalStore)(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const currentTargets = (0, react.useMemo)(() => current === void 0 ? [] : monitorTargets.filter((target) => target.sessionId === current), [current, monitorTargets]);
			const currentRef = (0, react.useRef)(current);
			(0, react.useEffect)(() => {
				currentRef.current = current;
			}, [current]);
			const mountedAtRef = (0, react.useRef)(performance.now());
			const expanded = activityPanelExpandedForSession(open, openOwner, current);
			const geometry = (0, react.useMemo)(() => resolvePanelGeometry(layout, bounds), [layout, bounds]);
			const compact = compactPanelForBounds(bounds);
			const commitLayout = (0, react.useCallback)((next) => {
				setLayout(next);
			}, []);
			(0, react.useEffect)(() => {
				window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
			}, [layout]);
			(0, react.useLayoutEffect)(() => {
				const overlay = document.querySelector("[data-shell-overlay]");
				if (overlay === null) return;
				let frame = null;
				let observed = null;
				const measure = () => {
					frame = null;
					const conversation = document.querySelector("[data-phase]");
					if (conversation !== observed) {
						if (observed !== null) observer?.unobserve(observed);
						observed = conversation;
						if (conversation !== null) observer?.observe(conversation);
					}
					const overlayRect = overlay.getBoundingClientRect();
					const conversationRect = conversation?.getBoundingClientRect();
					const next = {
						width: overlayRect.width,
						height: overlayRect.height,
						anchorRight: panelDockAnchor(boundsRef.current.anchorRight, overlayRect.width, conversationRect === void 0 ? null : conversationRect.right - overlayRect.left)
					};
					const previous = boundsRef.current;
					if (previous.width === next.width && previous.height === next.height && previous.anchorRight === next.anchorRight) return;
					boundsRef.current = next;
					setBounds(next);
				};
				const scheduleMeasure = () => {
					frame ??= requestAnimationFrame(measure);
				};
				const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
				measure();
				observer?.observe(overlay);
				window.addEventListener("resize", scheduleMeasure);
				return () => {
					if (frame !== null) cancelAnimationFrame(frame);
					observer?.disconnect();
					window.removeEventListener("resize", scheduleMeasure);
				};
			}, [current]);
			(0, react.useLayoutEffect)(() => {
				if (openOwner === void 0 || openOwner === current) return;
				setOpen(false);
				setOpenOwner(void 0);
				setWasActive(false);
				setAutoOpened(false);
			}, [current, openOwner]);
			(0, react.useLayoutEffect)(() => {
				const root = document.documentElement;
				if (expanded && geometry.mode === "docked" && !compact) {
					root.setAttribute(PANEL_OPEN_ATTRIBUTE, "");
					root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`);
				} else {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				}
				return () => {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				};
			}, [
				compact,
				expanded,
				geometry.mode,
				geometry.width
			]);
			(0, react.useEffect)(() => {
				if (current === void 0) return;
				const controller = startActivityPolling(currentTargets, { discoverySessionId: current });
				return () => {
					controller.stop();
				};
			}, [current, currentTargets]);
			(0, react.useEffect)(() => {
				const onOpenPanel = (event) => {
					const activeSession = currentRef.current;
					if (activeSession === void 0) return;
					setOpenOwner(activeSession);
					setOpen(true);
					const detail = event.detail;
					if (detail?.teamId !== void 0) {
						const owner = detail.captainSessionId !== "" ? detail.captainSessionId : currentRef.current ?? "";
						const teamKey = `${owner}:${detail.teamId}`;
						setHistoric((previous) => {
							const next = new Map(previous);
							next.set(teamKey, {
								data: detail,
								owner
							});
							return next;
						});
					}
				};
				window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				return () => {
					window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				};
			}, []);
			const visibleTeams = (0, react.useMemo)(() => current === void 0 ? [] : teams.filter((team) => team.captainSessionId === current), [teams, current]);
			const visibleHistoric = (0, react.useMemo)(() => current === void 0 ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId) && !archivedTeams.some((archived) => archived.captainSessionId === current && archived.teamId === data.teamId)), [
				historic,
				current,
				teams,
				archivedTeams
			]);
			const visibleArchived = (0, react.useMemo)(() => current === void 0 ? [] : archivedTeams.filter((team) => team.captainSessionId === current && !teams.some((live) => live.captainSessionId === current && live.teamId === team.teamId)), [
				archivedTeams,
				current,
				teams
			]);
			const [archiveFilter, setArchiveFilter] = (0, react.useState)(ARCHIVE_DEFAULT_FILTER);
			const filteredArchived = (0, react.useMemo)(() => filterArchivedTeams(visibleArchived, archiveFilter), [visibleArchived, archiveFilter]);
			const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length;
			(0, react.useEffect)(() => {
				if (visibleCount > 0) {
					setWasActive(true);
					const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
					if (!autoOpened && settled) {
						setOpenOwner(current);
						setOpen(true);
						setAutoOpened(true);
					}
					return;
				}
			}, [
				visibleCount,
				autoOpened,
				wasActive
			]);
			const busy = (0, react.useMemo)(() => visibleTeams.some((team) => team.members.some((member) => member.activity === "working")), [visibleTeams]);
			const hasTeams = visibleCount > 0;
			const liveTeam = visibleTeams.length === 1 ? visibleTeams[0] : void 0;
			const closeable = liveTeam !== void 0 && (liveTeam.tasks.length === 0 || liveTeam.tasks.every((task) => task.status === "completed"));
			const closeTeam = (0, react.useCallback)(async () => {
				if (liveTeam === void 0 || current === void 0) return;
				setClosing(true);
				setCloseError(null);
				try {
					const token = agentTeamsWebToken();
					const response = await fetch("/plugins/agent-team-web/close", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							...token === void 0 ? {} : { [TOKEN_HEADER]: token }
						},
						body: JSON.stringify({
							teamId: liveTeam.teamId,
							captainSessionId: liveTeam.captainSessionId
						})
					});
					if (!response.ok) {
						console.warn(`agent-team-web: close request failed (${response.status})`);
						setCloseError(t("activity.closeError"));
						return;
					}
				} catch (error) {
					console.warn("agent-team-web: close request failed", error);
					setCloseError(t("activity.closeError"));
				} finally {
					setClosing(false);
				}
			}, [
				liveTeam,
				current,
				t
			]);
			(0, react.useEffect)(() => {
				if (closeError === null) return;
				const timer = setTimeout(() => {
					setCloseError(null);
				}, 4e3);
				return () => {
					clearTimeout(timer);
				};
			}, [closeError]);
			const panelGeometryForGesture = (0, react.useCallback)(() => {
				const measuredHeight = panelRef.current?.getBoundingClientRect().height;
				if (measuredHeight === void 0 || measuredHeight <= 0) return geometry;
				return {
					...geometry,
					height: measuredHeight
				};
			}, [geometry]);
			const flushScheduledLayout = (0, react.useCallback)(() => {
				if (frameRef.current !== null) {
					cancelAnimationFrame(frameRef.current);
					frameRef.current = null;
				}
				const pending = pendingLayoutRef.current;
				pendingLayoutRef.current = null;
				if (pending !== null) commitLayout(pending);
			}, [commitLayout]);
			const scheduleLayout = (0, react.useCallback)((next) => {
				pendingLayoutRef.current = next;
				frameRef.current ??= requestAnimationFrame(() => {
					frameRef.current = null;
					const pending = pendingLayoutRef.current;
					pendingLayoutRef.current = null;
					if (pending !== null) commitLayout(pending);
				});
			}, [commitLayout]);
			(0, react.useEffect)(() => () => {
				if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			}, []);
			const beginMove = (0, react.useCallback)((event) => {
				if (compact || event.button !== 0 || event.target.closest("button") !== null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "move",
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: false
				};
			}, [compact, panelGeometryForGesture]);
			const beginResize = (0, react.useCallback)((edge, event) => {
				if (compact || event.button !== 0 || geometry.mode === "docked" && edge !== "left") return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "resize",
					edge,
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: true
				};
				setInteraction("resizing");
			}, [
				compact,
				geometry.mode,
				panelGeometryForGesture
			]);
			const updateGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const dx = event.clientX - gesture.originX;
				const dy = event.clientY - gesture.originY;
				const activeBounds = boundsRef.current;
				if (gesture.kind === "move") {
					if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
					if (!gesture.activated) {
						gesture.activated = true;
						setInteraction("dragging");
					}
					scheduleLayout(movePanelLayout(floatPanelLayout(gesture.start, activeBounds), dx, dy, activeBounds));
					return;
				}
				scheduleLayout(resizePanelLayout(gesture.start, gesture.edge ?? "left", dx, dy, activeBounds));
			}, [scheduleLayout]);
			const endGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				updateGesture(event);
				flushScheduledLayout();
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout, updateGesture]);
			const cancelGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				flushScheduledLayout();
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout]);
			const toggleDock = (0, react.useCallback)(() => {
				const liveGeometry = panelGeometryForGesture();
				commitLayout(liveGeometry.mode === "docked" ? floatPanelLayout(liveGeometry, boundsRef.current) : dockPanelLayout(liveGeometry, boundsRef.current));
			}, [commitLayout, panelGeometryForGesture]);
			const autoHeight = panelUsesAutoHeight(geometry, bounds);
			const panelStyle = {
				width: geometry.width,
				height: autoHeight ? "auto" : geometry.height,
				maxHeight: panelMaximumHeight(geometry, bounds),
				transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`
			};
			if (!hasTeams && !expanded) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CollapsedBadge, {
				count: visibleCount,
				busy,
				t,
				onClick: () => {
					if (current === void 0) return;
					setOpenOwner(current);
					setOpen(true);
				}
			}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				ref: panelRef,
				className: ActivityPanel_module_css_default.panel,
				style: panelStyle,
				"data-agent-team-web-activity": true,
				"data-panel-mode": geometry.mode,
				"data-height-mode": autoHeight ? "auto" : "manual",
				"data-compact": compact || void 0,
				"data-dragging": interaction === "dragging" || void 0,
				"data-resizing": interaction === "resizing" || void 0,
				"aria-label": t("activity.panelAria"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.panelHead,
						onPointerDown: beginMove,
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"data-drag-handle": !compact || void 0,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelTitle,
							children: [t("activity.title"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.panelDot,
								"data-busy": busy,
								"aria-hidden": true
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelControls,
							children: [
								!compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ActivityPanel_module_css_default.iconButton,
									"data-control": "dock",
									"data-mode": geometry.mode,
									onClick: toggleDock,
									"aria-label": t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
									title: t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutline16, {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ActivityPanel_module_css_default.iconButton,
									"data-control": "collapse",
									onClick: () => {
										setOpen(false);
										setOpenOwner(void 0);
									},
									"aria-label": t("activity.collapse"),
									title: t("activity.collapse"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
								}),
								liveTeam !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ActivityPanel_module_css_default.iconButton,
									"data-control": "close",
									disabled: !closeable || closing,
									onClick: () => {
										closeTeam();
									},
									"aria-label": t(closeable ? "activity.close" : "activity.closeDisabled"),
									title: !closeable ? t("activity.closeDisabled") : closing ? t("activity.closing") : t("activity.close"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {})
								})
							]
						})]
					}),
					closeError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.closeError,
						role: "alert",
						children: closeError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.teams,
						children: visibleCount === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.emptyHint,
							children: t("activity.empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							visibleTeams.map((team) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TeamSection, {
								team,
								onNavigate: navigateToSession,
								t,
								compact
							}, team.teamId)),
							visibleArchived.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.archiveFilterBar,
								"data-archive-filter": true,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: ActivityPanel_module_css_default.archiveFilterField,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.archiveFilterCaption,
											children: t("archive.filterTeam")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: ActivityPanel_module_css_default.archiveSelect,
											"data-filter": "team",
											value: archiveFilter.team,
											onChange: (event) => setArchiveFilter({
												...archiveFilter,
												team: event.target.value
											}),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: t("archive.filterTeamAll")
											}), archivedTeamNames(visibleArchived).map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: name,
												children: name
											}, name))]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: ActivityPanel_module_css_default.archiveFilterField,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.archiveFilterCaption,
											children: t("archive.filterTime")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											className: ActivityPanel_module_css_default.archiveSelect,
											"data-filter": "time",
											value: archiveFilter.timeRange,
											onChange: (event) => setArchiveFilter({
												...archiveFilter,
												timeRange: event.target.value
											}),
											children: ARCHIVE_TIME_RANGES.map((range) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: range,
												children: t(`archive.time.${range}`)
											}, range))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: ActivityPanel_module_css_default.archiveFilterField,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.archiveFilterCaption,
											children: t("archive.filterRetro")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											className: ActivityPanel_module_css_default.archiveSelect,
											"data-filter": "retro",
											value: archiveFilter.retro,
											onChange: (event) => setArchiveFilter({
												...archiveFilter,
												retro: event.target.value
											}),
											children: ARCHIVE_RETRO_FILTERS.map((retro) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: retro,
												children: t(`archive.retro.${retro}`)
											}, retro))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.archiveFilterCount,
										"data-filter-count": true,
										children: t("archive.filterCount", {
											shown: filteredArchived.length,
											total: visibleArchived.length
										})
									})
								]
							}),
							visibleArchived.length > 0 && filteredArchived.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.archiveEmpty,
								children: t("archive.filterEmpty")
							}),
							filteredArchived.map((team) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								"data-team-id": team.teamId,
								"data-historic": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.archiveLabel,
									children: t("archive.label")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TeamSection, {
									team,
									onNavigate: navigateToSession,
									t,
									historic: true,
									compact
								})]
							}, `${team.captainSessionId}:${team.teamId}`)),
							visibleHistoric.map(({ data: team, owner }) => {
								const teamKey = `${owner}:${team.teamId}`;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TeamSection, {
									team: historicCardTeam(team, owner),
									onNavigate: navigateToSession,
									t,
									historic: true,
									compact
								}, teamKey);
							})
						] })
					}),
					!compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "left",
						onPointerDown: (event) => {
							beginResize("left", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}),
					!compact && geometry.mode === "floating" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "bottom",
						onPointerDown: (event) => {
							beginResize("bottom", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "corner",
						onPointerDown: (event) => {
							beginResize("corner", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					})] })
				]
			})] });
		}
		//#endregion
		//#region src/client/agent-teams-card-definition.ts
		/** Parse the only create-call fields the historic card owns. */
		function parseAgentTeamsCreateArgs(value) {
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string") return;
				const name = parsed.name.trim();
				if (name === "") return void 0;
				const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
				return {
					teamId: cleaned === "" ? "team" : cleaned,
					name
				};
			} catch {
				return;
			}
		}
		/** Durable first-party tool events folded into one keyed Chat node. */
		const agentTeamsCardDefinition = {
			kind: "agent-teams",
			target: "chat",
			match: (event) => {
				if (event.type === "tool/call" && event.data.name === "agent_teams_create") return parseAgentTeamsCreateArgs(event.data.arguments) === void 0 ? null : {
					id: String(event.data.callId),
					role: "start"
				};
				if (event.type === "tool/result" && event.data.message.source.kind === "tool") return {
					id: String(event.data.message.source.callId),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "tool/call") throw new Error("agent-teams card start requires agent_teams_create tool/call");
				const parsed = parseAgentTeamsCreateArgs(match.event.data.arguments);
				if (parsed === void 0) throw new Error("agent-teams card start requires valid create arguments");
				return {
					...parsed,
					accepted: false
				};
			},
			update: (context, match) => {
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.error !== void 0 || match.event.data.message.content.some((block) => block.type === "tool-result" && block.isError === true)) return context.state;
				return {
					...context.state,
					accepted: true
				};
			},
			buildViewNode: (context) => {
				if (context.start === void 0) return null;
				const state = context.state;
				if (!state.accepted) return null;
				return {
					key: context.key,
					kind: "agent-teams",
					id: context.id,
					target: "chat",
					anchorSeq: context.start.event.seq,
					location: context.start.location,
					visibility: "visible",
					data: {
						teamId: state.teamId,
						captainSessionId: "",
						teamName: state.name,
						members: []
					}
				};
			}
		};
		//#endregion
		//#region src/client/session-navigation.ts
		/**
		* Open one member's persisted transcript.
		*
		* Harness rc.8 intentionally removed cold subagents from the ordinary session
		* list. They must first be rediscovered in their parent's catalog, then opened
		* with the exact parent/child/mode address. Older runtimes have only `open()`;
		* the fallback preserves the plugin's rc.6 peer range.
		*/
		async function openAgentTeamMember(sessions, parentSessionId, childSessionId) {
			if (sessions.openSubagent === void 0 || sessions.refreshSubagents === void 0) {
				sessions.open(childSessionId);
				return "session";
			}
			await sessions.refreshSubagents(parentSessionId);
			const retained = sessions.subagentAddress?.(childSessionId);
			sessions.openSubagent(retained?.parentSessionId === parentSessionId ? retained : {
				parentSessionId,
				childSessionId,
				mode: "continuable"
			});
			return "subagent";
		}
		//#endregion
		//#region \0agent-team-css:src/client/ProviderGrantsSection.module.css.mjs
		const cssText = ".xoTlpq_section{flex-direction:column;gap:10px;display:flex}.xoTlpq_head{align-items:center;gap:8px;display:flex}.xoTlpq_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}.xoTlpq_list{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.xoTlpq_row{background:color-mix(in srgb, var(--dsw-alias-bg-module) 88%, transparent);border-radius:8px;align-items:center;gap:8px;min-width:0;padding:6px 8px;display:flex}.xoTlpq_row[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success) 8%, var(--dsw-alias-bg-module))}.xoTlpq_name{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:none;font-size:12px;font-weight:600;line-height:18px;overflow:hidden}.xoTlpq_id{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:16px;overflow:hidden}.xoTlpq_locked{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}.xoTlpq_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.xoTlpq_switch{box-sizing:border-box;border:1px solid var(--dsw-alias-line-strong);background:var(--dsw-alias-line-strong);cursor:pointer;border-radius:999px;flex:none;width:30px;height:17px;padding:0;transition:background .12s,border-color .12s;position:relative}.xoTlpq_switch[data-on=true]{border-color:var(--dsw-alias-state-success);background:var(--dsw-alias-state-success)}.xoTlpq_switchThumb{background:var(--dsw-alias-label-on-fill);border-radius:50%;width:13px;height:13px;transition:left .12s;position:absolute;top:1px;left:1px}.xoTlpq_switch[data-on=true] .xoTlpq_switchThumb{left:14px}";
		const cssTagId = "@deepseek-ai/dsh-experimental-agent-team-web/ProviderGrantsSection.module.css";
		if (typeof document !== "undefined" && document.head && document.head.querySelector("style[data-plugin-css=\"@deepseek-ai/dsh-experimental-agent-team-web/ProviderGrantsSection.module.css\"]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-experimental-agent-team-web";
			style.dataset.pluginCss = cssTagId;
			style.textContent = cssText;
			document.head.appendChild(style);
		}
		var ProviderGrantsSection_module_css_default = {
			"head": "xoTlpq_head",
			"hint": "xoTlpq_hint",
			"id": "xoTlpq_id",
			"list": "xoTlpq_list",
			"locked": "xoTlpq_locked",
			"name": "xoTlpq_name",
			"row": "xoTlpq_row",
			"section": "xoTlpq_section",
			"switch": "xoTlpq_switch",
			"switchThumb": "xoTlpq_switchThumb",
			"title": "xoTlpq_title"
		};
		//#endregion
		//#region src/client/ProviderGrantsSection.tsx
		/**
		* Provider 授权设置页卡片(t8)——补 settings.section slot。
		*
		* 后端 settings 命名空间(agent-team-web-providers)已注册,但 DSH 设置页
		* shell 依赖 client 侧 `settings.section` slot 渲染功能卡片——本组件即该
		* 卡片:列出 DSH 已注册 provider(ctx.llm 经快照 /state 透出)+ enabledProviders
		* 开关;deepseek-official 恒授权锁定显示「默认」;开关切换经 client
		* settingsScope.set('enabledProviders', nextMap) 写命名空间(宿主持久化,
		* spawn 校验随之下一次 add_member 生效)。
		*
		* 纯逻辑(providerGrantRows/toggleEnabledMap)导出供 node 环境直测,与
		* activity-panel-helpers.test 同构。
		* @module dsh-agent-team-web/client/provider-grants-section
		*/
		/**
		* Provider 授权命名空间(client 侧本地常量,与 host provider-grants.ts 的
		* agent-team-web-providers 保持一致;不导入 host 模块以保 client bundle
		* 纯净——provider-grants.ts 顶层执行 schemastery schema,会拖入 host 依赖)。
		*/
		const PROVIDER_GRANTS_NAMESPACE = "agent-team-web-providers";
		/** 快照缺省(scope 未就绪时的稳定引用)。 */
		const EMPTY_SNAPSHOT = {
			status: "loading",
			value: void 0,
			base: void 0,
			user: void 0,
			revision: void 0,
			writable: false,
			mode: "host"
		};
		/** 纯函数:provider 列表 + 授权 map → 行(deepseek-official 恒锁定且恒 enabled)。 */
		function providerGrantRows(providers, enabled) {
			return providers.map((provider) => ({
				id: provider.id,
				name: provider.name,
				enabled: provider.id === "deepseek-official" || enabled?.[provider.id] === true,
				locked: provider.id === "deepseek-official"
			}));
		}
		/** 纯函数:toggle 后的 enabledProviders map(保留其他项)。 */
		function toggleEnabledMap(current, provider, nextEnabled) {
			return {
				...current ?? {},
				[provider]: nextEnabled
			};
		}
		/** 从快照 /state 提取 DSH 已注册 provider 列表(经授权 token)。 */
		async function fetchRegisteredProviders() {
			const token = agentTeamsWebToken();
			const response = await fetch("/plugins/agent-team-web/state", { headers: token === void 0 ? {} : { [TOKEN_HEADER]: token } });
			if (!response.ok) return [];
			return (await response.json()).teams?.[0]?.providers ?? [];
		}
		/**
		* Provider 授权设置页卡片:provider 列表 + 授权开关。
		* 数据流:provider 列表 = 快照 /state 透出(注册表实时);授权状态 =
		* settingsScope 命名空间 resolved value(推送失效自动刷新)。开关写面 =
		* scope.set('enabledProviders', nextMap)(宿主持久化)。
		*/
		function ProviderGrantsSection(props) {
			const { scope, t = (key) => key } = props;
			const [providers, setProviders] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let alive = true;
				fetchRegisteredProviders().then((list) => {
					if (alive) setProviders(list);
				}).catch(() => void 0);
				return () => {
					alive = false;
				};
			}, []);
			const snapshot = (0, react.useSyncExternalStore)((callback) => scope?.subscribe(callback) ?? (() => void 0), () => scope?.getSnapshot() ?? EMPTY_SNAPSHOT);
			const rows = providerGrantRows(providers, snapshot.value?.enabledProviders);
			if (rows.length === 0) return null;
			const toggle = async (row) => {
				if (scope === void 0 || row.locked) return;
				await scope.set("enabledProviders", toggleEnabledMap(snapshot.value?.enabledProviders, row.id, !row.enabled));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProviderGrantsSection_module_css_default.section,
				"aria-label": t("settings.providers.title"),
				"data-provider-grants": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
						className: ProviderGrantsSection_module_css_default.head,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProviderGrantsSection_module_css_default.title,
							children: t("settings.providers.title")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: ProviderGrantsSection_module_css_default.list,
						children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ProviderGrantsSection_module_css_default.row,
							"data-enabled": row.enabled,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProviderGrantsSection_module_css_default.name,
									title: row.id,
									children: row.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProviderGrantsSection_module_css_default.id,
									children: row.id
								}),
								row.locked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProviderGrantsSection_module_css_default.locked,
									children: t("settings.providers.locked")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": row.enabled,
									"aria-label": `${row.name} ${t("settings.providers.toggleAria")}`,
									className: ProviderGrantsSection_module_css_default.switch,
									"data-on": row.enabled,
									onClick: () => {
										toggle(row);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ProviderGrantsSection_module_css_default.switchThumb })
								})
							]
						}, row.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProviderGrantsSection_module_css_default.hint,
						children: t("settings.providers.hint")
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Required services: conversation nodes, slots, sessions navigation, and locale. */
		const inject = [
			"conversationEvents",
			"slots",
			"sessions",
			"locale"
		];
		/** The replayed user message is the canonical transcript entry. */
		function HiddenAgentTeamsCommand() {
			return null;
		}
		/**
		* Register the activity monitor in the shell's additive overlay and the
		* in-conversation team card. The card's activity button re-opens a folded
		* monitor via a window event — the recovery path for an old session.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, {
				zh,
				en
			}), "agent-team-web: dictionaries");
			const openMember = (parentId, childId) => {
				openAgentTeamMember(ctx.sessions, parentId, childId).catch((error) => {
					console.warn(`agent-team-web: failed to open member transcript ${childId}: ${String(error)}`);
				});
			};
			const Panel = ({ t }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityPanel, {
				sessionsList: ctx.sessions.list,
				openMember,
				t
			});
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "agent-teams-activity",
				order: 80,
				label: "AgentTeams activity",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE
			}, Panel));
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "agent-teams"
			}, HiddenAgentTeamsCommand));
			ctx.conversationEvents.register(agentTeamsCardDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "agent-teams",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE,
				inject: () => ({ openMember })
			}, AgentTeamsCard));
			const sectionT = ctx.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "agent-team-web-providers",
				order: 100,
				label: () => sectionT("settings.providers.title"),
				inject: () => ({
					scope: ctx.settingsScope.bind({ namespace: PROVIDER_GRANTS_NAMESPACE }),
					t: sectionT
				})
			}, ProviderGrantsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map