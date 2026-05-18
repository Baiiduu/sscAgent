# Run 级别回退

当前 agent 会按每一次 `runSession()` 记录文件变更，并支持一次回退一个已完成的 run。

## 存储位置

默认情况下，`createAgentRuntime()` 会把 agent 数据存放在：

```text
.agent-data
```

会话工作区存放在：

```text
.agent-data/workspaces/sessions/<sessionID>
```

快照存放在：

```text
.agent-data/snapshots
```

每个 snapshot 目录都是某个 workspace 对应的内部 bare git 存储。它不是项目本身的 git 仓库。不要直接读取 `objects/` 文件，应通过 snapshot service 的接口访问。

## 工作原理

每次 `runSession()` 开始时，harness 会创建一条 `SessionRun`，并记录本次 run 开始前的 baseline 快照：

```ts
const baselineHash = await runtime.snapshot.track({ workspace: session.workspace })
```

本次 run 中产生的消息和文件快照都会绑定同一个 `runID`。

执行 revert 时，系统会：

1. 如果没有指定 `runID`，选择最近一次已完成的 run。
2. 记录当前 workspace 状态，作为后续 `unrevert` 的恢复快照。
3. 找到所选 run 产生的全部 snapshots。
4. 将被修改的文件恢复到该 run 修改前的状态，并删除该 run 新增的文件。
5. 将 run 标记为 `reverted`，并在 session 上记录 revert 元数据。

`unrevert` 会把 workspace 恢复到 revert 前记录的恢复快照，并清空 session 的 revert 状态。

## 回退最近一次已完成 run

在 agent 包目录下执行：

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { revertSessionSnapshot } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await revertSessionSnapshot({ store: runtime.store, sessionID: 'session_xxx', snapshotService: runtime.snapshot }));"
```

## 回退指定 run

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { revertSessionSnapshot } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await revertSessionSnapshot({ store: runtime.store, sessionID: 'session_xxx', runID: 'run_xxx', snapshotService: runtime.snapshot }));"
```

## 恢复刚才的回退

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { unrevertSession } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await unrevertSession({ store: runtime.store, sessionID: 'session_xxx', snapshotService: runtime.snapshot }));"
```

## 查看某个 session 的 runs

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; const runtime = createAgentRuntime(); console.log(await runtime.store.runs?.('session_xxx'));"
```

## Smoke 测试

真实链路 smoke 测试：

```powershell
bun src/smoke/revert-run.ts
```

该测试会使用默认 `.agent-data` runtime，调用真实 agent 和真实 `write` tool，在 session workspace 中创建一个文件，然后回退这次 run。
