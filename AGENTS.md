# 本仓库作业规则（AgentTeams Web 插件）

> **本文件只承载"不能机械化"的约束。** 凡能写成测试/脚本/校验的，一律写成测试——本仓库的"行"在
> `src/*.test.ts` 与发布流程里，不在这份文档里。
> 本仓库没有 `CLAUDE.md`；本文件即本仓库的规则载体。上层 DSH checkout 的约定见该仓库的 `AGENTS.md`，
> **不得把 DSH 的约定套到本插件**（本插件是独立外部包，有自己的发布链与版本线）。

## 一、改动纪律

1. **只在隔离 worktree 改**，不直接改主工作区——主工作区常带既有未提交改动，必须隔离。
2. **依赖/构建/发布产物一律不入库**：`node_modules/`、`*.tgz`、`.release-verify/`、`.tmp-pack-check/` 已在
   `.gitignore`。**但暂存仍必须显式列出文件路径**——不要依赖 ignore 的完备性，**不要 `git add .`**。
   （ignore 是防止误伤的第一道；显式路径是第二道。）
3. 提交前必须全绿：`pnpm typecheck && pnpm test && pnpm build && git diff --check`。
4. 源码改动与 `lib/` 构建产物**同批提交**——本仓库提交 `lib/`，消费者不做构建。

## 二、发布链（缺一步不算发布）

```text
build → test → pack → 解包验证（cmp lib/client.js + 关键标记 grep）
→ 显式路径 commit → push
→ git tag -a → gh release create（上传 .tgz）
→ gh release download 并复核 SHA256 与构建值逐位一致
→ 装入 ~/.dsh/profiles/web → 重启 dsh web
→ 运行时验证（读【已安装的产物】，不只是源码）
```

- `package.json` 的版本号必须与 `README.md`、`README.zh-CN.md` 内的 tarball 版本号同步（有测试会拦，
  但先改再跑更省事）。
- 一个版本号只发布一次；已发布的版本号不得复用。
- 重启会中断正在服务的会话与在跑的成员回合——**在团队 idle 时重启**。

## 三、证据纪律（本项目反复吃过亏）

1. **哈希逐位粘贴，不得手抄**；每个 `md5`/`sha256` 必须与**测量时点**同列。
2. **引用任何状态前先查 durable**（磁盘实测、`team.json`），不得凭记忆或他人转述。
3. **计数断言**必须给：命令 ＋ 测量时点 ＋ 逐行/文件级明细。**不得写入"描述本文件自身当前状态"的数**
   （行数／字节／哈希／自指命中计数／自指版本号）——那类数字写入即过期；本仓库是"多写入方且无锁"的
   环境，快照会因**他人**写入失效，不只是因为你自己写。
4. 未跟踪文件要拿 diff：用**仓外快照 + `diff -u`**，不要用 `git add -N`（它会把 `??` 变成已入索引，
   破坏归属证据；且它给出的是"相对空基线"的整文件新增，不是跨批次基线对比）。
5. 报告完成前须含：**核了什么／未核什么** 与 **未承诺边界**。

## 四、AgentTeams 语义（本插件自身必须守的边界）

- `review required (将需复核·尚未提交)` ≠ `awaiting review (已提交待复核)`；门禁**只在 owner 提交产物后**才有意义。
- **签署 ≠ 实质改动**（仅签署区写入不触发"变化即失效"），三个条件缺一不可：签署区白名单、写入后立即重跑
  哈希与行数并与审查时点并列、diff 证明仅限签署区且比对基准在仓外。
- 门禁拒绝完成时**必须保留**该次提交的 output 与 signals（已有回归测试）。
- 状态快照对成员只渲染前 ~300 字符的 output，且截断是**显式**的（已有回归测试）；长交付用**双载体**
  （task output ＋ 消息全文）。

## 五、已机械化、不要再靠自觉的项（列出以免重复写进文档）

| 约束 | 机械化位置 |
|---|---|
| 工具输出 schema 与实际返回一致 | `src/tools-schema-consistency.test.ts` |
| 门禁拒绝不丢 output | `src/tools-workflow-guardrails.test.ts` |
| output 截断必须显式 | `src/render.test.ts` |
| 政委不得被派单/拥有/执行任务 | `src/scheduler.test.ts`、`src/tools-workflow-guardrails.test.ts` |
| 版本号与 README tarball 名同步 | `tests/package-layout.spec.ts` |
| 打包产物与工作区构建逐字节一致 | 发布链的 `cmp lib/client.js` |
