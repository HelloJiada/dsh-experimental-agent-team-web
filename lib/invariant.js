//#region src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-experimental-agent-team-web";
const name = "agent-team-web-invariant";
const inject = ["invariants"];
const install = () => {};
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));

//#endregion
export { apply, inject, name };
//# sourceMappingURL=invariant.js.map