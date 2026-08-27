# 私有化遗留引用审计结论（已收敛）

日期：2026-08-27 · 审计：refactor-design-team · 状态：**已完成并收敛**

## 审计范围

针对历史上游方案（`@nanmicoder/dsh-agent-teams` 包名、`agent-teams/*` 事件格式、
`.agent-teams/` 状态目录）的遗留引用做全量检查。**不含**本插件自身命名：
`/agent-teams` 命令、`agent_teams_*` 工具、`agent-teams-activity` / `agent-teams`
surface key、`agent-teams: usage/route` 日志标签、`agent-team-web/*` 私有事件。

## 结论摘要

1. 源码、测试、示例与现行文档中，指向“需要额外安装上游 dsh-agent-teams 包”或
   “依赖 `agent-teams/*` 事件 / `.agent-teams/` 目录”的引用**已全部收敛**为私有方案
   （`@deepseek-ai/dsh-experimental-agent-team-web`、`agent-team-web/*`、`.agent-team-web/`）。
2. 上游相关的历史文件已处理：
   - fixture 已私有化：`tests/fixtures/team-lifecycle.ts`（`agent-team-web/*` 事件）；
   - 契约对齐文档已标注为历史迁移记录：`docs/contract-alignment.md`；
   - 路线图已加历史标注：`docs/product-roadmap.md` 顶部注明为历史规划文档。
3. 仓库根目录 `.agent-teams/`（上游运行状态残留）已删除；`.gitignore` 已同时忽略
   `.agent-teams/` 与 `.agent-team-web/`。
4. 本地 `.claude/settings.local.json` 中指向 `/tmp/dsh-agent-teams.*` 的调试 allow 规则已清理。
5. `src/client/ActivityPanel.tsx` 注释中的过期路由 `/plugins/dsh-agent-team-web/state`
   已修正为 `/plugins/agent-team-web/state`。

## 本轮补充收敛

- `docs/command-bridge-execution.md`：移除“上游 runtime”措辞，明确为
  本 bundle 内置的 agent-team-web runtime。
- `examples/profile-patch.agent-team-web.yml`：注释不再出现 AgentTeams 产品化表述。
- `docs/real-profile-smoke-check.md`：标题改为“本 bundle + Team 活动监视器”。
- `docs/compatibility.md`：删除“还需额外 Agent Teams 包”的误导，改为
  “本 bundle 自带私有 runtime surface”。

## 保留项（历史记录，不再视为现行指引）

| 位置 | 说明 |
| --- | --- |
| `docs/product-roadmap.md` | 带日期的历史规划，含早期与外部方案的对比与迁移决策；顶部已加“历史规划文档”标注 |
| `docs/contract-alignment.md` | 历史迁移记录：早期与上游事件契约的差异分析；已明确“以 README / verification-checklist / examples 为准” |
| `.superpowers/**` | 工具历史工作记录，不随包发布 |
| `.claude/worktrees/**` | git 工作树中的旧代码副本，独立于主树 |

## 无需改动（已确认干净）

- `src/` 全部：`agent-teams` 字符串均为插件自身命名（命令、工具、surface key、日志标签）。
- `tests/`：全部为私有包名 / 私有 surface key 断言。
- `package.json` / `pnpm-lock.yaml`：无任何上游依赖条目。
- `cordis.patch.yml`、`preview-panel.html`、构建配置：无上游引用。

## 验证

- `pnpm test` 全绿（28 个测试文件、187 个用例）。
- `grep -ri "nanmicoder\|dsh-agent-teams"` 主工作区（排除 node_modules / .claude/worktrees）
  仅剩上述历史记录文档中的对照性提及。
