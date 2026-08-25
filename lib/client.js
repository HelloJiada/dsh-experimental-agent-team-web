window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-experimental-agent-team-web",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/filter.ts
		function defaultAgentTeamFilterState() {
			return {
				taskFilter: "all",
				taskQuery: "",
				memberFilter: "all",
				memberQuery: "",
				messageFilter: "all"
			};
		}
		function filterAgentTeam(view, state) {
			const readinessByTaskId = new Map(view.taskInsights.map((insight) => [insight.taskId, insight.readiness]));
			const riskByMessageId = new Map(view.messageRisks.map((risk) => [risk.messageId, risk.riskLevel]));
			const loadByMemberId = new Map(view.memberLoads.map((load) => [load.memberId, load.level]));
			const taskQuery = state.taskQuery.trim().toLowerCase();
			const memberQuery = state.memberQuery.trim().toLowerCase();
			const tasks = view.tasks.filter((task) => {
				if (taskQuery !== "" && !task.subject.toLowerCase().includes(taskQuery)) return false;
				const readiness = readinessByTaskId.get(task.id);
				switch (state.taskFilter) {
					case "all": return true;
					case "in_progress": return task.status === "in_progress";
					case "completed": return task.status === "completed";
					case "ready": return readiness === "ready" && task.status === "pending";
					case "blocked": return readiness === "blocked";
					case "stalled": return readiness === "stalled";
					case "orphaned": return readiness === "orphaned";
					case "failed": return readiness === "failed";
					case "cancelled": return readiness === "cancelled";
				}
			});
			const taskIds = new Set(tasks.map((task) => task.id));
			const taskInsights = view.taskInsights.filter((insight) => taskIds.has(insight.taskId));
			const members = view.members.filter((member) => {
				if (memberQuery !== "" && !member.name.toLowerCase().includes(memberQuery)) return false;
				if (state.memberFilter === "all") return true;
				if (member.role === "lead") return false;
				return loadByMemberId.get(member.id) === state.memberFilter;
			});
			const memberIds = new Set(members.map((member) => member.id));
			const memberLoads = view.memberLoads.filter((load) => {
				if (!memberIds.has(load.memberId)) return false;
				if (memberQuery !== "" && !load.memberName.toLowerCase().includes(memberQuery)) return false;
				if (state.memberFilter === "all") return true;
				return load.level === state.memberFilter;
			});
			const messages = view.messages.filter((message) => {
				const risk = riskByMessageId.get(message.id);
				switch (state.messageFilter) {
					case "all": return true;
					case "undelivered": return !message.delivered;
					case "delivered": return message.delivered;
					case "wakeup": return message.delivery === "wakeup";
					case "quiet": return message.delivery === "quiet";
					case "high_risk": return risk === "high";
				}
			});
			const messageIds = new Set(messages.map((message) => message.id));
			return {
				tasks,
				taskInsights,
				members,
				memberLoads,
				messages,
				messageRisks: view.messageRisks.filter((risk) => messageIds.has(risk.messageId)),
				displayedCount: tasks.length + members.length + messages.length
			};
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
		//#region src/client/AgentTeamWorkspace.tsx
		const TABS = [
			{
				key: "overview",
				label: "概览"
			},
			{
				key: "tasks",
				label: "任务"
			},
			{
				key: "members",
				label: "成员"
			},
			{
				key: "messages",
				label: "消息"
			},
			{
				key: "timeline",
				label: "时间线"
			}
		];
		function renderInlineContent(blocks) {
			return blocks.map((block) => {
				if ("text" in block && typeof block.text === "string") return block.text;
				if (block.type === "tool-call" && "name" in block && typeof block.name === "string") return `[tool:${block.name}]`;
				if (block.type === "tool-result") return "[tool result]";
				if (block.type === "image") return "[image]";
				return `[${block.type}]`;
			}).join(" ");
		}
		function statCard(label, value, tone = "neutral") {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					border: "1px solid #e2e8f0",
					borderRadius: 12,
					padding: 12,
					minWidth: 120,
					background: "#fff"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						color: "#64748b",
						marginBottom: 4
					},
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 22,
						fontWeight: 700,
						color: {
							neutral: "#334155",
							good: "#166534",
							warn: "#92400e",
							danger: "#991b1b"
						}[tone]
					},
					children: value
				})]
			});
		}
		function pill(text, tone) {
			const style = {
				neutral: {
					bg: "#e2e8f0",
					fg: "#334155"
				},
				good: {
					bg: "#dcfce7",
					fg: "#166534"
				},
				warn: {
					bg: "#fef3c7",
					fg: "#92400e"
				},
				danger: {
					bg: "#fee2e2",
					fg: "#991b1b"
				}
			}[tone];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					display: "inline-block",
					padding: "2px 8px",
					borderRadius: 999,
					fontSize: 12,
					fontWeight: 600,
					background: style.bg,
					color: style.fg
				},
				children: text
			});
		}
		function toneOfHealth(score) {
			if (score >= 80) return "good";
			if (score >= 50) return "warn";
			return "danger";
		}
		function insightTone(severity) {
			switch (severity) {
				case "low": return "good";
				case "medium": return "warn";
				case "high": return "danger";
			}
		}
		function readinessTone(readiness, severity) {
			if (readiness === "failed") return "danger";
			if (readiness === "cancelled") return "warn";
			return insightTone(severity);
		}
		function statusTone(status) {
			switch (status) {
				case "completed": return "good";
				case "in_progress": return "warn";
				case "failed": return "danger";
				case "cancelled": return "neutral";
				case "pending": return "neutral";
			}
		}
		function loadTone(level) {
			switch (level) {
				case "idle": return "neutral";
				case "focused": return "good";
				case "stretched": return "warn";
				case "overloaded": return "danger";
			}
		}
		function riskTone(riskLevel) {
			switch (riskLevel) {
				case "low": return "good";
				case "medium": return "warn";
				case "high": return "danger";
			}
		}
		function tabBar(active, onSelect) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					display: "flex",
					gap: 8,
					flexWrap: "wrap",
					borderBottom: "1px solid #e2e8f0",
					paddingBottom: 8
				},
				children: TABS.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => onSelect(tab.key),
					style: {
						padding: "6px 14px",
						borderRadius: 999,
						border: active === tab.key ? "1px solid #2563eb" : "1px solid #e2e8f0",
						background: active === tab.key ? "#eff6ff" : "#fff",
						color: active === tab.key ? "#1d4ed8" : "#334155",
						fontWeight: active === tab.key ? 600 : 400,
						cursor: "pointer"
					},
					children: tab.label
				}, tab.key))
			});
		}
		function filterChip({ label, count, active, onClick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick,
				style: {
					display: "inline-block",
					padding: "3px 10px",
					borderRadius: 999,
					fontSize: 12,
					background: active ? "#2563eb" : "#f1f5f9",
					color: active ? "#fff" : "#334155",
					border: active ? "1px solid #2563eb" : "1px solid #e2e8f0",
					cursor: "pointer"
				},
				children: [
					label,
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: count })
				]
			});
		}
		function filterGroup(title, options, activeKey, onSelect) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { marginBottom: 8 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						color: "#64748b",
						marginBottom: 4
					},
					children: title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						gap: 6,
						flexWrap: "wrap"
					},
					children: options.map((option) => filterChip({
						label: option.label,
						count: option.count,
						active: option.key === activeKey,
						onClick: () => onSelect(option.key)
					}))
				})]
			});
		}
		function searchInput(value, placeholder, onChange) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "search",
				value,
				placeholder,
				onChange: (event) => onChange(event.target.value),
				style: {
					padding: "6px 10px",
					borderRadius: 8,
					border: "1px solid #e2e8f0",
					fontSize: 13,
					minWidth: 220
				}
			});
		}
		function commandTone(kind) {
			switch (kind) {
				case "task:reassign":
				case "member:restart": return "danger";
				case "task:unblock":
				case "message:redeliver": return "warn";
				default: return "neutral";
			}
		}
		function CommandBridgeSection({ team }) {
			const plan = team.commandPlan;
			const commands = plan.commands;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					style: { marginBottom: 8 },
					children: "Command Bridge（建议命令）"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					style: {
						margin: "0 0 8px",
						color: "#64748b",
						fontSize: 12
					},
					children: [
						"计划 v",
						plan.version,
						" · 共 ",
						plan.total,
						" 条",
						plan.highPriorityCount > 0 ? ` · 高优先级 ${plan.highPriorityCount}` : "",
						plan.mediumPriorityCount > 0 ? ` · 中优先级 ${plan.mediumPriorityCount}` : "",
						plan.lowPriorityCount > 0 ? ` · 低优先级 ${plan.lowPriorityCount}` : ""
					]
				}),
				commands.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前没有需要执行层的命令建议。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					style: {
						display: "grid",
						gap: 8,
						paddingLeft: 20
					},
					children: commands.map((command) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						style: {
							border: "1px solid #e2e8f0",
							borderRadius: 10,
							padding: "8px 10px",
							background: "#fff"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: command.label }),
							" ",
							pill(command.kind, commandTone(command.kind)),
							" ",
							pill(command.priority, command.priority === "high" ? "danger" : command.priority === "medium" ? "warn" : "neutral"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									color: "#475569",
									marginTop: 4,
									fontSize: 13
								},
								children: [command.rationale, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { color: "#64748b" },
									children: [" · target ", command.targetId]
								})]
							})
						]
					}, command.id))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					style: { marginTop: 8 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
						style: {
							fontSize: 12,
							color: "#64748b",
							cursor: "pointer"
						},
						children: "宿主可消费的命令计划（只读 envelope）"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: {
							margin: "8px 0 0",
							padding: 10,
							borderRadius: 8,
							background: "#f8fafc",
							border: "1px solid #e2e8f0",
							fontSize: 11,
							lineHeight: 1.5,
							overflowX: "auto",
							whiteSpace: "pre-wrap"
						},
						children: JSON.stringify(plan, null, 2)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: {
						fontSize: 12,
						color: "#64748b",
						marginTop: 6
					},
					children: "命令建议由 committed Team facts 推导，执行需要宿主 runtime 工具层支持；本工作台保持只读。"
				})
			] });
		}
		function OverviewTab({ team }) {
			const healthTone = toneOfHealth(team.summary.healthScore);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 20
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: {
						display: "flex",
						gap: 12,
						flexWrap: "wrap"
					},
					children: [
						statCard("健康度", team.summary.healthScore, healthTone),
						statCard("成员数", team.summary.memberCount),
						statCard("Ready 任务", team.summary.readyTaskCount, team.summary.readyTaskCount > 0 ? "warn" : "good"),
						statCard("阻塞任务", team.summary.blockedTaskCount, team.summary.blockedTaskCount > 0 ? "danger" : "good"),
						statCard("Stalled 任务", team.summary.stalledTaskCount, team.summary.stalledTaskCount > 0 ? "danger" : "good"),
						statCard("Orphaned 任务", team.summary.orphanedTaskCount, team.summary.orphanedTaskCount > 0 ? "danger" : "good"),
						statCard("过载成员", team.summary.overloadedMemberCount, team.summary.overloadedMemberCount > 0 ? "danger" : "good"),
						statCard("高风险消息", team.summary.highRiskMessageCount, team.summary.highRiskMessageCount > 0 ? "danger" : "good"),
						statCard("待投递消息", team.summary.undeliveredMessageCount, team.summary.undeliveredMessageCount > 0 ? "danger" : "good"),
						statCard("失败成员", team.summary.failedMemberCount, team.summary.failedMemberCount > 0 ? "danger" : "good")
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: {
						display: "grid",
						gap: 12
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "Captain 摘要"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								margin: 0,
								color: "#334155"
							},
							children: team.summary.overview
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "Captain Briefing"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: {
								margin: 0,
								paddingLeft: 20
							},
							children: team.summary.captainBriefing.map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: line }, line))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "Top Interventions"
						}), team.summary.topInterventions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "暂无需要优先干预的任务。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
							style: {
								margin: 0,
								paddingLeft: 20
							},
							children: team.summary.topInterventions.map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: action }, action))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "优先建议"
						}), team.summary.recommendedActions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "暂无建议。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
							style: {
								margin: 0,
								paddingLeft: 20
							},
							children: team.summary.recommendedActions.map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: action }, action))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "风险与提醒"
						}), team.summary.alerts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: { margin: 0 },
							children: pill("无明显风险", "good")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: {
								margin: 0,
								paddingLeft: 20
							},
							children: team.summary.alerts.map((alert) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								style: { marginBottom: 4 },
								children: alert
							}, alert))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandBridgeSection, { team })
					]
				})]
			});
		}
		function TasksTab({ team, filter, onFilterChange }) {
			const filtered = (0, react.useMemo)(() => filterAgentTeam(team, filter), [team, filter]);
			const setTaskFilter = (taskFilter) => onFilterChange({
				...filter,
				taskFilter
			});
			const setTaskQuery = (taskQuery) => onFilterChange({
				...filter,
				taskQuery
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { marginBottom: 8 },
							children: searchInput(filter.taskQuery, "搜索任务…", setTaskQuery)
						}),
						filterGroup("任务筛选", team.quickFilters.taskFilters, filter.taskFilter, (key) => setTaskFilter(key)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: {
								fontSize: 12,
								color: "#64748b"
							},
							children: [
								"当前显示 ",
								filtered.tasks.length,
								" / ",
								team.tasks.length,
								" 个任务"
							]
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "任务洞察" }), filtered.taskInsights.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有任务洞察。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 10,
							paddingLeft: 20
						},
						children: filtered.taskInsights.map((insight) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: insight.subject }),
							" ",
							pill(insight.readiness, readinessTone(insight.readiness, insight.severity)),
							" ",
							pill(insight.severity, insightTone(insight.severity)),
							" ",
							insight.interventionPriority > 0 ? pill(`P${insight.interventionPriority}`, "warn") : null,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: { color: "#64748b" },
								children: ["下游依赖 ", insight.dependencyDepth]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									color: "#475569",
									marginTop: 4
								},
								children: insight.reasons.join(" ")
							})
						] }, insight.taskId))
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "全部任务（已筛选）" }), filtered.tasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有任务。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: filtered.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: task.subject }),
							" ",
							pill(task.status, statusTone(task.status)),
							task.ownerId !== null ? ` · owner ${task.ownerId}` : "",
							task.blockedBy.length > 0 ? ` · blocked by ${task.blockedBy.join(", ")}` : ""
						] }, task.id))
					})] })
				]
			});
		}
		function MembersTab({ team, filter, onFilterChange }) {
			const filtered = (0, react.useMemo)(() => filterAgentTeam(team, filter), [team, filter]);
			const setMemberFilter = (memberFilter) => onFilterChange({
				...filter,
				memberFilter
			});
			const setMemberQuery = (memberQuery) => onFilterChange({
				...filter,
				memberQuery
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { marginBottom: 8 },
							children: searchInput(filter.memberQuery, "搜索成员…", setMemberQuery)
						}),
						filterGroup("成员筛选", team.quickFilters.memberFilters, filter.memberFilter, (key) => setMemberFilter(key)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: {
								fontSize: 12,
								color: "#64748b"
							},
							children: [
								"当前显示 ",
								filtered.members.length,
								" / ",
								team.members.length,
								" 个成员"
							]
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "成员" }), filtered.members.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有成员。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: filtered.members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: member.name }),
							" ",
							member.role === "lead" ? pill("Lead", "neutral") : pill("Teammate", member.phase === "failed" ? "danger" : "good"),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: { color: "#475569" },
								children: ["session ", member.sessionId]
							}),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["phase: ", member.phase] })
						] }, member.id))
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "成员负载" }), filtered.memberLoads.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有负载数据。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: filtered.memberLoads.map((load) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: load.memberName }),
							" ",
							pill(load.level, loadTone(load.level)),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								"active ",
								load.activeTaskCount,
								" / pending-owned ",
								load.pendingOwnedTaskCount
							] }),
							load.stalledTaskCount > 0 ? ` · stalled ${load.stalledTaskCount}` : "",
							load.orphanedTaskCount > 0 ? ` · orphaned ${load.orphanedTaskCount}` : ""
						] }, load.memberId))
					})] })
				]
			});
		}
		function MessagesTab({ team, filter, onFilterChange }) {
			const filtered = (0, react.useMemo)(() => filterAgentTeam(team, filter), [team, filter]);
			const setMessageFilter = (messageFilter) => onFilterChange({
				...filter,
				messageFilter
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [filterGroup("消息筛选", team.quickFilters.messageFilters, filter.messageFilter, (key) => setMessageFilter(key)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: {
							fontSize: 12,
							color: "#64748b"
						},
						children: [
							"当前显示 ",
							filtered.messages.length,
							" / ",
							team.messages.length,
							" 条消息"
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "邮箱" }), filtered.messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有消息。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: filtered.messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							message.senderName,
							" → ",
							message.targetId,
							" ",
							pill(message.delivery === "wakeup" ? "Wakeup" : "Quiet", message.delivery === "wakeup" ? "warn" : "neutral"),
							" ",
							message.delivered ? pill("已送达", "good") : pill("待送达", "danger"),
							"：",
							renderInlineContent(message.content)
						] }, message.id))
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "消息风险" }), filtered.messageRisks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前筛选下没有消息风险数据。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: filtered.messageRisks.map((risk) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
								risk.senderName,
								" → ",
								risk.targetId
							] }),
							" ",
							pill(risk.riskLevel, riskTone(risk.riskLevel)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									color: "#475569",
									marginTop: 4
								},
								children: risk.reasons.join(" ")
							})
						] }, risk.messageId))
					})] })
				]
			});
		}
		function TimelineTab({ team }) {
			const summary = team.timelineSummary;
			const [windowMode, setWindowMode] = (0, react.useState)("count");
			const milestones = (0, react.useMemo)(() => timelineMilestonesView(team.timeline, { mode: windowMode }), [team.timeline, windowMode]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "Timeline"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 12,
								flexWrap: "wrap"
							},
							children: [
								statCard("事件总数", summary.totalEvents),
								statCard("任务事件", summary.taskEvents),
								statCard("成员事件", summary.memberEvents),
								statCard("消息事件", summary.messageEvents),
								statCard("合并条目", summary.coalescedEntries, summary.coalescedEntries > 0 ? "warn" : "neutral")
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: {
								marginTop: 10,
								color: "#475569"
							},
							children: [summary.firstSeq !== null && summary.lastSeq !== null ? `事件序号范围 #${summary.firstSeq} → #${summary.lastSeq}` : "当前时间线缺少事件序号。", summary.latestTitle !== null ? ` · 最新里程碑：${summary.latestTitle}` : ""]
						})
					] }),
					milestones.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: { marginBottom: 8 },
							children: "里程碑窗口（滚动摘要）"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 6,
								marginBottom: 8
							},
							children: ["count", "time"].map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setWindowMode(mode),
								style: {
									padding: "3px 10px",
									borderRadius: 999,
									fontSize: 12,
									background: windowMode === mode ? "#2563eb" : "#f1f5f9",
									color: windowMode === mode ? "#fff" : "#334155",
									border: windowMode === mode ? "1px solid #2563eb" : "1px solid #e2e8f0",
									cursor: "pointer"
								},
								children: mode === "count" ? "按行数（8/窗）" : "按时间（1h/窗）"
							}, mode))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: {
								display: "grid",
								gap: 8,
								paddingLeft: 20
							},
							children: milestones.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								style: {
									border: "1px solid #e2e8f0",
									borderRadius: 10,
									padding: "8px 10px",
									background: "#fff"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: window.headline }),
									" ",
									pill(window.headlineTone, window.headlineTone),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: { color: "#64748b" },
										children: [
											window.startSeq !== null && window.endSeq !== null ? `#${window.startSeq}→#${window.endSeq}` : "",
											" ",
											window.entryCount,
											" 行 / ",
											window.eventCount,
											" 事件",
											" ",
											"· 成员 ",
											window.memberEvents,
											" / 任务 ",
											window.taskEvents,
											" / 消息 ",
											window.messageEvents
										]
									})
								]
							}, window.windowId))
						})
					] }) : null,
					team.timeline.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "暂无时间线数据。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							display: "grid",
							gap: 8,
							paddingLeft: 20
						},
						children: team.timeline.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							entry.seq !== void 0 ? pill(`#${entry.seq}`, "neutral") : null,
							entry.count !== void 0 && entry.count > 1 ? pill(`×${entry.count}`, "neutral") : null,
							" ",
							pill(entry.kind, entry.tone),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.title }),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { color: "#475569" },
								children: entry.detail
							}),
							entry.time !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: { color: "#94a3b8" },
								children: [" · t=", entry.time]
							}) : null
						] }, entry.id))
					})
				]
			});
		}
		function AgentTeamWorkspace({ useProjection }) {
			const team = useProjection("agentTeam");
			const [tab, setTab] = (0, react.useState)("overview");
			const [filter, setFilter] = (0, react.useState)(defaultAgentTeamFilterState);
			if (team === void 0 || team === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Agent Team" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前会话没有 Team 数据。" })] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: { marginBottom: 8 },
						children: "Agent Team Dashboard"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: {
							margin: 0,
							color: "#475569"
						},
						children: [
							"Team ",
							team.teamId,
							" · 健康度 ",
							team.summary.healthScore,
							"/100 · ",
							team.summary.statusLabel
						]
					})] }),
					tabBar(tab, setTab),
					tab === "overview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewTab, { team }),
					tab === "tasks" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TasksTab, {
						team,
						filter,
						onFilterChange: setFilter
					}),
					tab === "members" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MembersTab, {
						team,
						filter,
						onFilterChange: setFilter
					}),
					tab === "messages" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessagesTab, {
						team,
						filter,
						onFilterChange: setFilter
					}),
					tab === "timeline" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TimelineTab, { team })
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "agent-team",
				order: 80,
				label: () => "Team"
			}, AgentTeamWorkspace));
		}
		//#endregion
		exports.AgentTeamWorkspace = AgentTeamWorkspace;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map