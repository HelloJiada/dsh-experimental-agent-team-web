import { jsx, jsxs } from "react/jsx-runtime";

//#region src/client/AgentTeamWorkspace.tsx
function renderInlineContent(blocks) {
	return blocks.map((block) => {
		if ("text" in block && typeof block.text === "string") return block.text;
		if (block.type === "tool-call" && "name" in block && typeof block.name === "string") return `[tool:${block.name}]`;
		if (block.type === "tool-result") return "[tool result]";
		if (block.type === "image") return "[image]";
		return `[${block.type}]`;
	}).join(" ");
}
function AgentTeamWorkspace({ useProjection }) {
	const team = useProjection("agentTeam");
	if (team === void 0 || team === null) return /* @__PURE__ */ jsxs("section", { children: [/* @__PURE__ */ jsx("h2", { children: "Agent Team" }), /* @__PURE__ */ jsx("p", { children: "当前会话没有 Team 数据。" })] });
	return /* @__PURE__ */ jsxs("section", { children: [
		/* @__PURE__ */ jsx("h2", { children: "Agent Team" }),
		/* @__PURE__ */ jsxs("p", { children: ["Lead Session: ", team.teamId] }),
		/* @__PURE__ */ jsx("h3", { children: "成员" }),
		team.members.length === 0 ? /* @__PURE__ */ jsx("p", { children: "暂无成员记录。" }) : /* @__PURE__ */ jsx("ul", { children: team.members.map((member) => /* @__PURE__ */ jsxs("li", { children: [
			/* @__PURE__ */ jsx("strong", { children: member.name }),
			"（",
			member.role,
			"，",
			member.phase,
			"）"
		] }, member.id)) }),
		/* @__PURE__ */ jsx("h3", { children: "任务" }),
		team.tasks.length === 0 ? /* @__PURE__ */ jsx("p", { children: "暂无任务记录。" }) : /* @__PURE__ */ jsx("ul", { children: team.tasks.map((task) => /* @__PURE__ */ jsxs("li", { children: [
			/* @__PURE__ */ jsx("strong", { children: task.subject }),
			" — ",
			task.status,
			" — rev ",
			task.revision,
			task.ownerId !== null ? ` — owner ${task.ownerId}` : ""
		] }, task.id)) }),
		/* @__PURE__ */ jsx("h3", { children: "邮箱" }),
		team.messages.length === 0 ? /* @__PURE__ */ jsx("p", { children: "暂无消息记录。" }) : /* @__PURE__ */ jsx("ul", { children: team.messages.map((message) => /* @__PURE__ */ jsxs("li", { children: [
			message.senderName,
			" → ",
			message.targetId,
			" [",
			message.delivery,
			"] ",
			message.delivered ? "已送达" : "待送达",
			"：",
			renderInlineContent(message.content)
		] }, message.id)) })
	] });
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
export { AgentTeamWorkspace, apply, inject };
//# sourceMappingURL=client.js.map