# Run-level revert

This agent records file changes per `runSession()` run and can revert one completed run at a time.

## Storage

By default, `createAgentRuntime()` stores agent data under:

```text
.agent-data
```

Session workspaces are stored under:

```text
.agent-data/workspaces/sessions/<sessionID>
```

Snapshots are stored under:

```text
.agent-data/snapshots
```

Each snapshot directory is an internal bare git store for one workspace. It is not the project repository. Use the snapshot service APIs instead of reading `objects/` files directly.

## How it works

At the beginning of each `runSession()` call, the harness creates a `SessionRun` and records a baseline snapshot:

```ts
const baselineHash = await runtime.snapshot.track({ workspace: session.workspace })
```

Messages and snapshots produced during the run are tagged with the same `runID`.

When reverting, the system:

1. Selects the latest completed run unless a `runID` is provided.
2. Records the current workspace state as a restore snapshot.
3. Finds all snapshots for the selected run.
4. Restores changed files to their pre-run state and removes files created by that run.
5. Marks the run as `reverted` and stores session revert metadata.

`unrevert` restores the workspace to the restore snapshot and clears the session revert state.

## Revert latest completed run

Run from the agent package directory:

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { revertSessionSnapshot } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await revertSessionSnapshot({ store: runtime.store, sessionID: 'session_xxx', snapshotService: runtime.snapshot }));"
```

## Revert a specific run

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { revertSessionSnapshot } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await revertSessionSnapshot({ store: runtime.store, sessionID: 'session_xxx', runID: 'run_xxx', snapshotService: runtime.snapshot }));"
```

## Unrevert

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; import { unrevertSession } from './src/session/index.ts'; const runtime = createAgentRuntime(); console.log(await unrevertSession({ store: runtime.store, sessionID: 'session_xxx', snapshotService: runtime.snapshot }));"
```

## List runs for a session

```powershell
bun -e "import { createAgentRuntime } from './src/runtime/index.ts'; const runtime = createAgentRuntime(); console.log(await runtime.store.runs?.('session_xxx'));"
```

## Smoke test

The real-chain smoke test is:

```powershell
bun src/smoke/revert-run.ts
```

It uses the default `.agent-data` runtime, calls the real agent with the real `write` tool, creates a file in the session workspace, and then reverts the run.
