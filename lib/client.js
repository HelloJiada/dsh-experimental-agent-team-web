window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-experimental-agent-team-web",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		require("@deepseek-ai/dsh-client-ui-layout/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/activity-panel-view.ts
		function qualifiesForActivityPanel(team) {
			return team !== null && (team.activeTasks.length > 0 || team.blockedTasks.length > 0);
		}
		function priorityRankOf(intervention) {
			const match = /^P(\d+)\s*·/.exec(intervention);
			return match === null ? null : Number(match[1]);
		}
		function priorityRows(team) {
			const byPriority = new Map(team.taskInsights.map((insight) => [insight.interventionPriority, insight]));
			return (team.summary.topInterventions.length > 0 ? team.summary.topInterventions.map(priorityRankOf).map((priority) => priority === null ? void 0 : byPriority.get(priority)).filter((insight) => insight !== void 0) : team.taskInsights.filter((insight) => insight.status !== "completed" && insight.status !== "failed" && insight.status !== "cancelled")).slice(0, 3).map((insight) => ({
				taskId: String(insight.taskId),
				subject: insight.subject,
				status: insight.status,
				readiness: insight.readiness,
				severity: insight.severity,
				reasons: insight.reasons,
				interventionPriority: insight.interventionPriority,
				dependencyDepth: insight.dependencyDepth
			}));
		}
		function taskRows(team) {
			const insights = new Map(team.taskInsights.map((insight) => [String(insight.taskId), insight]));
			const rowFor = (task, category) => {
				const insight = insights.get(String(task.id));
				return {
					taskId: String(task.id),
					subject: task.subject,
					status: task.status,
					category,
					ownerId: task.ownerId,
					readiness: insight?.readiness ?? null,
					severity: insight?.severity ?? null,
					reasons: insight?.reasons ?? []
				};
			};
			return [...team.activeTasks.map((task) => rowFor(task, "active")), ...team.blockedTasks.map((task) => rowFor(task, "blocked"))];
		}
		function activityPanelView(team) {
			const priorities = priorityRows(team);
			return {
				overview: {
					memberCount: team.summary.memberCount,
					activeTaskCount: team.summary.inProgressTaskCount,
					blockedTaskCount: team.summary.blockedTaskCount,
					healthScore: team.summary.healthScore,
					statusLabel: team.summary.statusLabel,
					overview: team.summary.overview
				},
				priorities,
				members: team.memberLoads,
				tasks: taskRows(team),
				fallback: priorities.length === 0 ? {
					state: "healthy",
					message: team.summary.captainBriefing[0] ?? "当前团队没有明显异常，可以继续保持既有节奏。"
				} : null
			};
		}
		//#endregion
		//#region src/client/activity-panel-events.ts
		const OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT = "agent-team:open-activity-panel";
		function openAgentTeamActivityPanel() {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT));
		}
		//#endregion
		//#region src/client/panel-geometry.ts
		const PANEL_LAYOUT_STORAGE_KEY = "dsh-agent-team:activity-panel:v1";
		const DEFAULT_PANEL_LAYOUT = {
			mode: "docked",
			x: 0,
			y: 0,
			width: 388,
			height: 640,
			manualHeight: false
		};
		const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
		const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
		function parsePanelLayout(value) {
			try {
				const parsed = JSON.parse(value);
				if (parsed === null || typeof parsed !== "object") return DEFAULT_PANEL_LAYOUT;
				const candidate = parsed;
				if (candidate.mode !== "docked" && candidate.mode !== "floating" || !isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height) || typeof candidate.manualHeight !== "boolean") return DEFAULT_PANEL_LAYOUT;
				return {
					mode: candidate.mode,
					x: candidate.x,
					y: candidate.y,
					width: candidate.width,
					height: candidate.height,
					manualHeight: candidate.manualHeight
				};
			} catch {
				return DEFAULT_PANEL_LAYOUT;
			}
		}
		function compactPanelForBounds(bounds) {
			return bounds.width <= 960;
		}
		function panelUsesAutoHeight(layout) {
			return layout.mode === "docked" || !layout.manualHeight;
		}
		function panelMaximumHeight(layout, bounds) {
			if (compactPanelForBounds(bounds)) return Math.max(1, bounds.height - 24);
			if (layout.mode === "docked") return Math.max(1, bounds.height - 64 - 48 - 12);
			return Math.max(1, bounds.height - 24);
		}
		function visibleGeometry(geometry, bounds) {
			const maxWidth = Math.max(1, bounds.width - 24);
			const maxHeight = Math.max(1, bounds.height - 24);
			const width = clamp(geometry.width, 1, maxWidth);
			const height = clamp(geometry.height, 1, maxHeight);
			return {
				width,
				height,
				x: clamp(geometry.x, 12, bounds.width - 12 - width),
				y: clamp(geometry.y, 12, bounds.height - 12 - height)
			};
		}
		function resolvePanelGeometry(layout, bounds) {
			if (compactPanelForBounds(bounds)) {
				const marginX = Math.min(12, Math.floor(bounds.width / 2));
				const marginY = Math.min(12, Math.floor(bounds.height / 2));
				return {
					x: marginX,
					y: marginY,
					width: Math.max(1, bounds.width - marginX * 2),
					height: Math.max(1, bounds.height - marginY * 2)
				};
			}
			if (layout.mode === "docked") {
				const width = clamp(layout.width, 320, Math.min(640, bounds.width - 24));
				const height = panelUsesAutoHeight(layout) ? Math.max(1, bounds.height - 64 - 48 - 12) : clamp(layout.height, 360, panelMaximumHeight(layout, bounds));
				return visibleGeometry({
					x: bounds.anchorRight - 18 - width,
					y: 64,
					width,
					height
				}, bounds);
			}
			const width = clamp(layout.width, 320, Math.min(640, bounds.width - 24));
			const height = panelUsesAutoHeight(layout) ? Math.max(1, bounds.height - 24) : clamp(layout.height, 360, panelMaximumHeight(layout, bounds));
			return visibleGeometry({
				x: layout.x,
				y: layout.y,
				width,
				height
			}, bounds);
		}
		function floatPanelLayout(layout, bounds) {
			const geometry = resolvePanelGeometry(layout, bounds);
			return {
				...layout,
				mode: "floating",
				...geometry
			};
		}
		function dockPanelLayout(layout, bounds) {
			const geometry = resolvePanelGeometry({
				...layout,
				mode: "docked"
			}, bounds);
			return {
				...layout,
				mode: "docked",
				manualHeight: false,
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height
			};
		}
		function movePanelLayout(layout, dx, dy, bounds) {
			const current = resolvePanelGeometry(layout, bounds);
			const geometry = visibleGeometry({
				...current,
				x: current.x + dx,
				y: current.y + dy
			}, bounds);
			return {
				...layout,
				mode: "floating",
				...geometry
			};
		}
		function resizePanelLayout(layout, edge, dx, dy, bounds) {
			const current = resolvePanelGeometry({
				...layout,
				mode: "floating"
			}, bounds);
			let geometry;
			if (edge === "left") {
				const right = current.x + current.width;
				const width = clamp(current.width - dx, 1, Math.min(640, right - 12));
				geometry = {
					x: right - width,
					y: current.y,
					width,
					height: current.height
				};
			} else if (edge === "bottom") geometry = {
				...current,
				height: clamp(current.height + dy, 1, bounds.height - 12 - current.y)
			};
			else geometry = {
				...current,
				width: clamp(current.width + dx, 1, Math.min(640, bounds.width - 12 - current.x)),
				height: clamp(current.height + dy, 1, bounds.height - 12 - current.y)
			};
			return {
				...layout,
				mode: "floating",
				manualHeight: edge !== "left" || layout.manualHeight,
				...visibleGeometry(geometry, bounds)
			};
		}
		//#endregion
		//#region \0agent-team-css:src/client/AgentTeamActivityPanel.module.css.mjs
		const cssText = ".KZ92iW_root{--agent-team-panel-bg:var(--dsh-color-bg-elevated);--agent-team-panel-text:var(--dsh-color-text-primary);--agent-team-panel-muted:var(--dsh-color-text-secondary);--agent-team-panel-border:var(--dsh-color-border);--agent-team-panel-accent:var(--dsh-state-ongoing);--agent-team-panel-soft:var(--dsh-color-bg-subtle);pointer-events:none;color:var(--agent-team-panel-text);font:inherit;position:absolute;inset:0;overflow:hidden}.KZ92iW_panel{pointer-events:auto;box-sizing:border-box;border:1px solid var(--agent-team-panel-border);background:var(--agent-team-panel-bg);box-shadow:var(--dsh-shadow-overlay);border-radius:14px;flex-direction:column;animation:.16s ease-out KZ92iW_panelEnter;display:flex;position:absolute;overflow:hidden}.KZ92iW_badge{pointer-events:auto;border:1px solid var(--agent-team-panel-border);background:var(--agent-team-panel-bg);min-height:36px;color:var(--agent-team-panel-text);box-shadow:var(--dsh-shadow-floating);cursor:pointer;border-radius:999px;align-items:center;gap:8px;padding:0 12px;display:inline-flex;position:absolute;top:64px;right:18px}.KZ92iW_statusDot{background:var(--agent-team-panel-accent);border-radius:50%;flex:none;width:8px;height:8px;animation:1.8s ease-in-out infinite KZ92iW_statusPulse}.KZ92iW_header{border-bottom:1px solid var(--agent-team-panel-border);justify-content:space-between;align-items:center;gap:10px;min-height:52px;padding:0 10px 0 14px;display:flex}.KZ92iW_dragHandle,.KZ92iW_title{flex:1;align-items:center;gap:9px;min-width:0;display:flex}.KZ92iW_dragHandle{cursor:grab;touch-action:none;user-select:none}.KZ92iW_panel[data-dragging=true] .KZ92iW_dragHandle{cursor:grabbing}.KZ92iW_dragHandle div,.KZ92iW_memberRow span:first-child{flex-direction:column;align-items:flex-start;min-width:0;display:flex}.KZ92iW_dragHandle small,.KZ92iW_row small,.KZ92iW_memberRow small{color:var(--agent-team-panel-muted)}.KZ92iW_headerActions{gap:6px;display:flex}.KZ92iW_headerActions button,.KZ92iW_memberRow{border:1px solid var(--agent-team-panel-border);color:inherit;font:inherit;cursor:pointer;background:0 0;border-radius:8px}.KZ92iW_headerActions button{min-height:32px;padding:0 9px}.KZ92iW_headerActions button:focus-visible,.KZ92iW_memberRow:focus-visible,.KZ92iW_badge:focus-visible{outline:2px solid var(--agent-team-panel-accent);outline-offset:2px}.KZ92iW_content{flex:1;min-height:0;padding:14px;overflow-y:auto}.KZ92iW_overview,.KZ92iW_section{margin:0 0 18px}.KZ92iW_overview h2,.KZ92iW_section h2{letter-spacing:.04em;text-transform:uppercase;color:var(--agent-team-panel-muted);margin:0 0 8px;font-size:12px}.KZ92iW_overview p,.KZ92iW_fallback{margin:0 0 10px;line-height:1.45}.KZ92iW_metrics{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;display:grid}.KZ92iW_metrics span{background:var(--agent-team-panel-soft);color:var(--agent-team-panel-muted);border-radius:8px;flex-direction:column;padding:8px;font-size:11px;display:flex}.KZ92iW_metrics strong{color:var(--agent-team-panel-text);font-size:16px}.KZ92iW_row,.KZ92iW_memberRow{box-sizing:border-box;width:100%;margin:0 0 7px;padding:9px 10px}.KZ92iW_row{border-left:3px solid var(--agent-team-panel-accent);background:var(--agent-team-panel-soft);border-radius:7px;flex-direction:column;gap:3px;display:flex}.KZ92iW_memberRow{text-align:left;justify-content:space-between;align-items:center;display:flex}.KZ92iW_resizeHandle{z-index:2;touch-action:none;position:absolute}.KZ92iW_resizeLeft{cursor:ew-resize;width:9px;top:52px;bottom:10px;left:-4px}.KZ92iW_resizeBottom{cursor:ns-resize;height:9px;bottom:-4px;left:10px;right:10px}.KZ92iW_resizeCorner{cursor:nwse-resize;width:16px;height:16px;bottom:-4px;right:-4px}@keyframes KZ92iW_panelEnter{0%{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@keyframes KZ92iW_statusPulse{0%,to{opacity:1}50%{opacity:.45}}@media (width<=960px){.KZ92iW_panel{box-shadow:var(--dsh-shadow-overlay);border-radius:12px}.KZ92iW_metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (prefers-reduced-motion:reduce){.KZ92iW_panel,.KZ92iW_statusDot{animation:none}}";
		const cssTagId = "@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamActivityPanel.module.css";
		if (typeof document !== "undefined" && document.head && document.head.querySelector("style[data-plugin-css=\"@deepseek-ai/dsh-experimental-agent-team-web/AgentTeamActivityPanel.module.css\"]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-experimental-agent-team-web";
			style.dataset.pluginCss = cssTagId;
			style.textContent = cssText;
			document.head.appendChild(style);
		}
		var AgentTeamActivityPanel_module_css_default = {
			"badge": "KZ92iW_badge",
			"content": "KZ92iW_content",
			"dragHandle": "KZ92iW_dragHandle",
			"fallback": "KZ92iW_fallback",
			"header": "KZ92iW_header",
			"headerActions": "KZ92iW_headerActions",
			"memberRow": "KZ92iW_memberRow",
			"metrics": "KZ92iW_metrics",
			"overview": "KZ92iW_overview",
			"panel": "KZ92iW_panel",
			"panelEnter": "KZ92iW_panelEnter",
			"resizeBottom": "KZ92iW_resizeBottom",
			"resizeCorner": "KZ92iW_resizeCorner",
			"resizeHandle": "KZ92iW_resizeHandle",
			"resizeLeft": "KZ92iW_resizeLeft",
			"root": "KZ92iW_root",
			"row": "KZ92iW_row",
			"section": "KZ92iW_section",
			"statusDot": "KZ92iW_statusDot",
			"statusPulse": "KZ92iW_statusPulse",
			"title": "KZ92iW_title"
		};
		//#endregion
		//#region src/client/AgentTeamActivityPanel.tsx
		const DEFAULT_BOUNDS = {
			width: 1200,
			height: 800,
			anchorRight: 1200
		};
		const INTERACTIVE_SELECTOR = "button, a, input, select, textarea, [role=\"button\"]";
		function readLayout() {
			if (typeof window === "undefined") return DEFAULT_PANEL_LAYOUT;
			try {
				const value = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
				return value === null ? DEFAULT_PANEL_LAYOUT : parsePanelLayout(value);
			} catch {
				return DEFAULT_PANEL_LAYOUT;
			}
		}
		function writeLayout(layout) {
			if (typeof window === "undefined") return;
			try {
				window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
			} catch {}
		}
		function measuredBounds(element) {
			if (element === null) return DEFAULT_BOUNDS;
			const width = element.clientWidth || element.parentElement?.clientWidth || window.innerWidth || DEFAULT_BOUNDS.width;
			return {
				width,
				height: element.clientHeight || element.parentElement?.clientHeight || window.innerHeight || DEFAULT_BOUNDS.height,
				anchorRight: width
			};
		}
		function activityKey(current, teamId) {
			return `${String(current)}:${String(teamId)}`;
		}
		function AgentTeamActivityPanel({ useSessions, openMember }) {
			const current = useSessions((state) => state.current);
			const team = useSessions((state) => state.current === void 0 ? void 0 : state.byId[state.current]?.projectionValues?.agentTeam);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const pointerOperation = (0, react.useRef)(null);
			const activityLifetime = (0, react.useRef)(null);
			const manuallyCollapsed = (0, react.useRef)(false);
			const [layout, setLayout] = (0, react.useState)(readLayout);
			const [bounds, setBounds] = (0, react.useState)(DEFAULT_BOUNDS);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [resizing, setResizing] = (0, react.useState)(false);
			const qualifies = team !== void 0 && team !== null && qualifiesForActivityPanel(team);
			const key = qualifies && team !== null && team !== void 0 ? activityKey(current, team.teamId) : null;
			(0, react.useEffect)(() => {
				if (key === null) {
					activityLifetime.current = null;
					manuallyCollapsed.current = false;
					setExpanded(false);
					return;
				}
				if (activityLifetime.current !== key) {
					activityLifetime.current = key;
					manuallyCollapsed.current = false;
					setExpanded(true);
				}
			}, [key]);
			const measure = (0, react.useCallback)(() => setBounds(measuredBounds(rootRef.current)), []);
			(0, react.useEffect)(() => {
				measure();
				window.addEventListener("resize", measure);
				const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
				if (rootRef.current !== null) observer?.observe(rootRef.current);
				return () => {
					observer?.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, [measure, qualifies]);
			(0, react.useEffect)(() => {
				const open = () => {
					if (qualifies) setExpanded(true);
				};
				window.addEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, open);
				return () => window.removeEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, open);
			}, [qualifies]);
			(0, react.useEffect)(() => writeLayout(layout), [layout]);
			const compact = compactPanelForBounds(bounds);
			const geometry = resolvePanelGeometry(layout, bounds);
			const view = (0, react.useMemo)(() => team === void 0 || team === null || !qualifies ? null : activityPanelView(team), [qualifies, team]);
			const collapse = () => {
				manuallyCollapsed.current = true;
				setExpanded(false);
			};
			const updateLayout = (next) => {
				setLayout(next);
				writeLayout(next);
			};
			const toggleMode = () => updateLayout(layout.mode === "docked" ? floatPanelLayout(layout, bounds) : dockPanelLayout(layout, bounds));
			const beginPointer = (event, kind, edge) => {
				if (compact || event.button !== 0 || event.target.closest(INTERACTIVE_SELECTOR) !== null) return;
				pointerOperation.current = {
					kind,
					edge,
					pointerId: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					layout,
					captureTarget: event.currentTarget
				};
				event.currentTarget.setPointerCapture?.(event.pointerId);
				setDragging(kind === "drag");
				setResizing(kind === "resize");
			};
			const movePointer = (event) => {
				const operation = pointerOperation.current;
				if (operation === null || operation.pointerId !== event.pointerId) return;
				const dx = event.clientX - operation.x;
				const dy = event.clientY - operation.y;
				updateLayout(operation.kind === "drag" ? movePanelLayout(operation.layout, dx, dy, bounds) : resizePanelLayout(operation.layout, operation.edge ?? "corner", dx, dy, bounds));
			};
			const clearPointerOperation = () => {
				pointerOperation.current = null;
				setDragging(false);
				setResizing(false);
			};
			const endPointer = (event) => {
				const operation = pointerOperation.current;
				if (operation === null || operation.pointerId !== event.pointerId) return;
				if (operation.captureTarget.hasPointerCapture?.(event.pointerId)) operation.captureTarget.releasePointerCapture?.(event.pointerId);
				clearPointerOperation();
			};
			if (!qualifies || team === void 0 || team === null || view === null) return null;
			if (!expanded) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: AgentTeamActivityPanel_module_css_default.root,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: AgentTeamActivityPanel_module_css_default.badge,
					"aria-label": "Open team activity",
					onClick: () => setExpanded(true),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamActivityPanel_module_css_default.statusDot,
							"aria-hidden": "true"
						}),
						view.overview.activeTaskCount,
						" active · ",
						view.overview.blockedTaskCount,
						" blocked"
					]
				})
			});
			const panelStyle = {
				left: geometry.x,
				top: geometry.y,
				width: geometry.width,
				height: geometry.height
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: AgentTeamActivityPanel_module_css_default.root,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: panelRef,
					role: "complementary",
					"aria-label": "Team activity",
					className: AgentTeamActivityPanel_module_css_default.panel,
					style: panelStyle,
					"data-panel-mode": layout.mode,
					"data-compact": String(compact),
					"data-dragging": String(dragging),
					"data-resizing": String(resizing),
					onPointerMove: movePointer,
					onPointerUp: endPointer,
					onPointerCancel: endPointer,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: AgentTeamActivityPanel_module_css_default.header,
							children: [
								!compact && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: AgentTeamActivityPanel_module_css_default.dragHandle,
									"data-testid": "panel-drag-handle",
									onPointerDown: (event) => beginPointer(event, "drag"),
									onLostPointerCapture: clearPointerOperation,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: AgentTeamActivityPanel_module_css_default.statusDot,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Team activity" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: team.teamId })] })]
								}),
								compact && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: AgentTeamActivityPanel_module_css_default.title,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: AgentTeamActivityPanel_module_css_default.statusDot,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Team activity" })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: AgentTeamActivityPanel_module_css_default.headerActions,
									children: [!compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: toggleMode,
										children: layout.mode === "docked" ? "Float" : "Dock"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "Collapse team activity",
										onClick: collapse,
										children: "Collapse"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AgentTeamActivityPanel_module_css_default.content,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: AgentTeamActivityPanel_module_css_default.overview,
									"aria-labelledby": "activity-overview-heading",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
											id: "activity-overview-heading",
											children: "Overview"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: view.overview.overview }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: AgentTeamActivityPanel_module_css_default.metrics,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: view.overview.healthScore }), " health"] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: view.overview.memberCount }), " members"] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: view.overview.activeTaskCount }), " active"] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: view.overview.blockedTaskCount }), " blocked"] })
											]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: AgentTeamActivityPanel_module_css_default.section,
									"aria-labelledby": "activity-priorities-heading",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
											id: "activity-priorities-heading",
											children: "Priorities"
										}),
										view.priorities.map((priority) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
											className: AgentTeamActivityPanel_module_css_default.row,
											"data-testid": "activity-priority",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: priority.subject }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
												priority.readiness,
												" · ",
												priority.severity
											] })]
										}, priority.taskId)),
										view.fallback !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: AgentTeamActivityPanel_module_css_default.fallback,
											children: view.fallback.message
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: AgentTeamActivityPanel_module_css_default.section,
									"aria-labelledby": "activity-members-heading",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										id: "activity-members-heading",
										children: "Members"
									}), view.members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: AgentTeamActivityPanel_module_css_default.memberRow,
										"aria-label": `Open member ${member.memberName}`,
										onClick: () => openMember(String(member.memberId)),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: member.memberName }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: member.level })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [member.activeTaskCount, " active"] })]
									}, member.memberId))]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: AgentTeamActivityPanel_module_css_default.section,
									"aria-labelledby": "activity-tasks-heading",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										id: "activity-tasks-heading",
										children: "Active and blocked tasks"
									}), view.tasks.map((taskRow) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
										className: AgentTeamActivityPanel_module_css_default.row,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: taskRow.subject }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
											taskRow.category,
											" · ",
											taskRow.status
										] })]
									}, `${taskRow.category}:${taskRow.taskId}`))]
								})
							]
						}),
						!compact && layout.mode === "floating" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: `${AgentTeamActivityPanel_module_css_default.resizeHandle} ${AgentTeamActivityPanel_module_css_default.resizeLeft}`,
								"data-testid": "panel-resize-handle",
								onPointerDown: (event) => beginPointer(event, "resize", "left"),
								onLostPointerCapture: clearPointerOperation
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: `${AgentTeamActivityPanel_module_css_default.resizeHandle} ${AgentTeamActivityPanel_module_css_default.resizeBottom}`,
								onPointerDown: (event) => beginPointer(event, "resize", "bottom"),
								onLostPointerCapture: clearPointerOperation
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: `${AgentTeamActivityPanel_module_css_default.resizeHandle} ${AgentTeamActivityPanel_module_css_default.resizeCorner}`,
								onPointerDown: (event) => beginPointer(event, "resize", "corner"),
								onLostPointerCapture: clearPointerOperation
							})
						] })
					]
				})
			});
		}
		//#endregion
		//#region src/client/AgentTeamConversationSummary.tsx
		function AgentTeamConversationSummary({ useProjection }) {
			const team = useProjection("agentTeam");
			if (team === void 0 || team === null || !qualifiesForActivityPanel(team)) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
					"Team ",
					team.teamId,
					" · Health ",
					team.summary.healthScore,
					"/100 · ",
					team.summary.statusLabel
				] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
					team.summary.inProgressTaskCount,
					" active task",
					team.summary.inProgressTaskCount === 1 ? "" : "s",
					" · ",
					team.summary.blockedTaskCount,
					" blocked task",
					team.summary.blockedTaskCount === 1 ? "" : "s"
				] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: openAgentTeamActivityPanel,
					children: "Open team activity"
				})
			] });
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		function apply(ctx) {
			const openMember = (memberId) => {
				const sessionId = memberId;
				const address = ctx.sessions.subagentAddress(sessionId);
				if (address !== void 0) {
					ctx.sessions.openSubagent(address);
					return;
				}
				ctx.sessions.open(sessionId);
			};
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "agent-team-activity",
				order: 80,
				inject: () => ({ openMember })
			}, AgentTeamActivityPanel));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "agent-team",
				order: 80,
				label: () => "Team"
			}, AgentTeamConversationSummary));
		}
		//#endregion
		exports.AgentTeamActivityPanel = AgentTeamActivityPanel;
		exports.AgentTeamConversationSummary = AgentTeamConversationSummary;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map