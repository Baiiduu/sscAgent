import type { HarnessSession, SessionSnapshot, SessionStore } from "../harness/session"

export interface RevertSessionSnapshotInput {
  store: SessionStore
  sessionID: string
  snapshotID?: string
}

export interface RevertSessionSnapshotResult {
  snapshot: SessionSnapshot | { id: string; cwd: string }
  output: string
}

export async function revertSessionSnapshot(
  input: RevertSessionSnapshotInput,
): Promise<RevertSessionSnapshotResult> {
  const session = await input.store.get(input.sessionID)
  if (!session) throw new Error(`Session not found: ${input.sessionID}`)

  // 优先使用 run 级别 baseline 回滚
  if (session.revert?.runBaselineHash) {
    return revertRunBaseline(session, input.store)
  }

  // 回退到 per-tool snapshot 回滚
  return revertPerToolSnapshot(session, input.store, input.snapshotID)
}

async function revertRunBaseline(
  session: HarnessSession,
  store: SessionStore,
): Promise<RevertSessionSnapshotResult> {
  const baselineHash = session.revert!.runBaselineHash!
  const cwd = session.cwd || session.workspace

  const output = await applyBaselineDiff(cwd, baselineHash)

  await store.update(session.id, {
    revert: null,
    summary: null,
  })

  return {
    snapshot: { id: baselineHash, cwd },
    output,
  }
}

async function revertPerToolSnapshot(
  session: HarnessSession,
  store: SessionStore,
  snapshotID?: string,
): Promise<RevertSessionSnapshotResult> {
  const snapshots = await store.snapshots(session.id)
  const sid = snapshotID ?? session.revert?.snapshotID
  const snapshot = sid ? snapshots.find((item) => item.id === sid) : snapshots.at(-1)
  if (!snapshot) {
    throw new Error(
      sid ? `Snapshot not found: ${sid}` : `No snapshots found for session: ${session.id}`,
    )
  }
  if (!snapshot.diff) throw new Error(`Snapshot has no diff to revert: ${snapshot.id}`)

  const output = await applyReversePatch(snapshot.cwd, snapshot.diff)

  await store.update(session.id, {
    revert: null,
    summary: null,
  })

  return { snapshot, output }
}

async function applyBaselineDiff(cwd: string, baselineHash: string) {
  // 1. 暂存当前所有变更
  await git(cwd, ["add", "--all", "--", "."])

  // 2. 获取 baseline 到当前状态的完整 diff
  const diff = await git(cwd, ["diff", "--binary", baselineHash, "HEAD"])

  if (!diff) {
    return "No changes to revert — working tree matches baseline."
  }

  // 3. 反向应用 diff 恢复 baseline
  const output = await applyReversePatch(cwd, diff)

  // 4. 重置暂存区
  await git(cwd, ["reset", "HEAD", "."])

  return output
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

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", "-c", "core.longpaths=true", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}
