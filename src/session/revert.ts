import type { SessionSnapshot, SessionStore } from "../harness/session"

export interface RevertSessionSnapshotInput {
  store: SessionStore
  sessionID: string
  snapshotID?: string
}

export interface RevertSessionSnapshotResult {
  snapshot: SessionSnapshot
  output: string
}

export async function revertSessionSnapshot(input: RevertSessionSnapshotInput): Promise<RevertSessionSnapshotResult> {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)

  const snapshots = await input.store.snapshots(input.sessionID)
  const snapshotID = input.snapshotID ?? session.revert?.snapshotID
  const snapshot = snapshotID ? snapshots.find((item) => item.id === snapshotID) : snapshots.at(-1)
  if (!snapshot) {
    throw new Error(snapshotID ? `Snapshot not found: ${snapshotID}` : `No snapshots found for session: ${input.sessionID}`)
  }
  if (!snapshot.diff) throw new Error(`Snapshot has no diff to revert: ${snapshot.id}`)

  const output = await applyReversePatch(snapshot.cwd, snapshot.diff)
  await input.store.update(input.sessionID, {
    revert: null,
    summary: null,
  })

  return {
    snapshot,
    output,
  }
}

async function applyReversePatch(cwd: string, diff: string) {
  const proc = Bun.spawn(["git", "apply", "-R", "--whitespace=nowarn"], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin.write(diff)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `git apply -R failed with exit code ${exitCode}`)
  }

  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
}
