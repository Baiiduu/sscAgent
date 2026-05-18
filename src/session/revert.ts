import path from "node:path"
import type { HarnessMessage } from "../harness/message"
import type { SessionRun, SessionSnapshot, SessionStore } from "../harness/session"
import type { SnapshotPatch, SnapshotService } from "../snapshot"

export interface RevertSessionSnapshotInput {
  store: SessionStore
  sessionID: string
  snapshotService?: SnapshotService
  runID?: string
}

export interface RevertSessionSnapshotResult {
  snapshot: SessionSnapshot | { id: string; cwd: string }
  output: string
  runID?: string
}

export interface UnrevertSessionInput {
  store: SessionStore
  sessionID: string
  snapshotService: SnapshotService
}

export async function revertSessionSnapshot(input: RevertSessionSnapshotInput): Promise<RevertSessionSnapshotResult> {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)
  if (!input.snapshotService) throw new Error("Snapshot service is required for run revert")
  if (!input.store.runs || !input.store.updateRun) throw new Error("Session store does not support runs")

  const run = await selectRun(input.store, input.sessionID, input.runID)
  if (!run) throw new Error(`No completed run found for session: ${input.sessionID}`)
  return revertSessionRun({ ...input, run, snapshotService: input.snapshotService })
}

export async function unrevertSession(input: UnrevertSessionInput) {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)
  if (!session.revert) return session
  if (!session.revert.snapshot) return session
  if (!input.snapshotService.restore) throw new Error("Snapshot service does not support restore")

  await input.snapshotService.restore({
    workspace: session.workspace,
    hash: session.revert.snapshot,
  })

  if (session.revert.runID && input.store.updateRun) {
    await input.store.updateRun(session.id, session.revert.runID, {
      status: "completed",
      restoreHash: undefined,
      time: {
        reverted: undefined,
      },
    })
  }

  return input.store.update(session.id, {
    revert: null,
    summary: null,
  })
}

export async function cleanupRevertedSession(input: { store: SessionStore; sessionID: string }) {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)
  if (!session.revert) return session

  if (session.revert.cleanup === "run" && session.revert.runID) {
    const messages = await input.store.messages(session.id)
    await input.store.replaceMessages(
      session.id,
      messages.filter((message) => runIDOf(message) !== session.revert?.runID),
    )
  }

  return input.store.update(session.id, {
    revert: null,
    summary: null,
  })
}

async function revertSessionRun(input: RevertSessionSnapshotInput & { run: SessionRun; snapshotService: SnapshotService }) {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)

  const restoreHash = await input.snapshotService.track({ workspace: session.workspace })
  const snapshots = (await input.store.snapshots(session.id)).filter((snapshot) => snapshot.runID === input.run.id)
  const patches = patchesFromSnapshots(snapshots)
  const diff = snapshots.map((snapshot) => snapshot.diff).filter(Boolean).join("\n\n")

  if (patches.length > 0) {
    if (!input.snapshotService.revert) throw new Error("Snapshot service does not support revert")
    await input.snapshotService.revert({
      workspace: session.workspace,
      patches,
    })
  }

  await input.store.updateRun?.(session.id, input.run.id, {
    status: "reverted",
    restoreHash,
    time: {
      reverted: Date.now(),
    },
  })

  const summary = summarizeSnapshots(snapshots)
  await input.store.update(session.id, {
    revert: {
      messageID: input.run.firstMessageID ?? "",
      runID: input.run.id,
      snapshot: restoreHash,
      diff,
      cleanup: "run",
    },
    summary,
  })

  return {
    snapshot: { id: restoreHash ?? input.run.baselineHash ?? input.run.id, cwd: session.workspace },
    output: patches.length > 0 ? `Reverted run ${input.run.id}.` : `Run ${input.run.id} had no file changes to revert.`,
    runID: input.run.id,
  }
}

async function selectRun(store: SessionStore, sessionID: string, runID?: string) {
  if (runID) {
    const run = await store.getRun?.(sessionID, runID)
    if (!run) throw new Error(`Session run not found: ${runID}`)
    return run
  }

  const runs = await store.runs?.(sessionID)
  return runs
    ?.filter((run) => run.status === "completed")
    .sort((a, b) => a.time.created - b.time.created)
    .at(-1)
}

function patchesFromSnapshots(snapshots: SessionSnapshot[]): SnapshotPatch[] {
  const patches = new Map<string, Set<string>>()
  for (const snapshot of snapshots) {
    if (!snapshot.fromHash) continue
    const files = patches.get(snapshot.fromHash) ?? new Set<string>()
    for (const diff of snapshot.diffs) {
      files.add(path.join(snapshot.cwd, diff.file).replaceAll("\\", "/"))
    }
    patches.set(snapshot.fromHash, files)
  }
  return [...patches.entries()].map(([hash, files]) => ({
    hash,
    files: [...files],
  }))
}

function summarizeSnapshots(snapshots: SessionSnapshot[]) {
  const diffs = snapshots.flatMap((snapshot) => snapshot.diffs)
  return {
    text: `Changed ${diffs.length} file(s).`,
    additions: diffs.reduce((sum, item) => sum + item.additions, 0),
    deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
    files: new Set(diffs.map((item) => item.file)).size,
  }
}

function runIDOf(message: HarnessMessage) {
  return (message as HarnessMessage & { runID?: string }).runID
}
