import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import type {
  SnapshotDiffInput,
  SnapshotFileDiff,
  SnapshotPatch,
  SnapshotRestoreInput,
  SnapshotRevertInput,
  SnapshotService,
  SnapshotSinceInput,
  SnapshotTrackInput,
} from "./schema"

const DEFAULT_SNAPSHOT_ROOT = path.resolve(import.meta.dir, "../../.snapshots")
const DEFAULT_EXCLUDES = [".git", ".workspaces", ".snapshots", ".tmp", "node_modules", "dist", "build", "__pycache__"]

export interface GitSnapshotServiceInput {
  snapshotRoot?: string
  excludes?: string[]
}

export function createGitSnapshotService(input: GitSnapshotServiceInput = {}): SnapshotService {
  return new GitSnapshotService(input)
}

class GitSnapshotService implements SnapshotService {
  constructor(private readonly input: GitSnapshotServiceInput) {}

  async track(input: SnapshotTrackInput) {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)
    await this.git(state, ["add", "--all", "--", "."])
    return this.git(state, ["write-tree"])
  }

  async patch(input: SnapshotSinceInput): Promise<SnapshotPatch> {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)
    await this.stageChanges(state)
    const output = await this.git(state, ["diff", "--cached", "--name-only", "-z", input.hash])
    const files = output
      .split("\0")
      .filter(Boolean)
      .map((file) => path.join(state.worktree, file).replaceAll("\\", "/"))
    return {
      hash: input.hash,
      files,
    }
  }

  async restore(input: SnapshotRestoreInput) {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)
    await this.git(state, ["read-tree", input.hash])
    await this.git(state, ["checkout-index", "-a", "-f"])
  }

  async revert(input: SnapshotRevertInput) {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)

    const ops: Array<{ hash: string; file: string; rel: string }> = []
    const seen = new Set<string>()
    for (const patch of input.patches) {
      for (const file of patch.files) {
        const rel = path.relative(state.worktree, file).replaceAll("\\", "/")
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || seen.has(rel)) continue
        seen.add(rel)
        ops.push({ hash: patch.hash, file, rel })
      }
    }

    for (const op of ops) {
      const tree = await this.git(state, ["ls-tree", op.hash, "--", op.rel])
      if (tree.trim()) {
        await this.git(state, ["checkout", op.hash, "--", op.rel])
        continue
      }
      await rm(path.join(state.worktree, op.rel), { force: true, recursive: true })
      await this.git(state, ["rm", "--cached", "-f", "--ignore-unmatch", "--", op.rel])
    }
  }

  async diff(input: SnapshotSinceInput) {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)
    await this.stageChanges(state)
    return this.git(state, ["diff", "--cached", "--patch", "--binary", input.hash])
  }

  async diffFull(input: SnapshotDiffInput) {
    const state = await this.state(input.workspace)
    await this.ensureInitialized(state)
    const names = await this.changedFiles(state, input.from, input.to)
    const stats = await this.numstat(state, input.from, input.to)

    return Promise.all(
      names.map(async (item): Promise<SnapshotFileDiff> => ({
        file: item.file,
        patch: await this.git(state, ["diff", "--patch", "--binary", input.from, input.to, "--", item.file]),
        additions: stats.get(item.file)?.additions ?? 0,
        deletions: stats.get(item.file)?.deletions ?? 0,
        status: item.status,
      })),
    )
  }

  private async state(workspace: string) {
    const worktree = path.resolve(workspace)
    return {
      worktree,
      gitdir: path.join(this.input.snapshotRoot ?? DEFAULT_SNAPSHOT_ROOT, `${hash(worktree)}.git`),
    }
  }

  private async ensureInitialized(state: { worktree: string; gitdir: string }) {
    await mkdir(state.gitdir, { recursive: true })
    await mkdir(state.worktree, { recursive: true })
    await this.raw(["init", "--bare", state.gitdir])
    await this.writeExclude(state)
  }

  private async stageChanges(state: { worktree: string; gitdir: string }) {
    await this.git(state, ["add", "--all", "--", "."])
  }

  private async writeExclude(state: { gitdir: string }) {
    await mkdir(path.join(state.gitdir, "info"), { recursive: true })
    await Bun.write(
      path.join(state.gitdir, "info", "exclude"),
      this.excludes()
        .map((item) => `/${item.replaceAll("\\", "/")}`)
        .join("\n") + "\n",
    )
  }

  private excludes() {
    return this.input.excludes ?? DEFAULT_EXCLUDES
  }

  private async changedFiles(state: { worktree: string; gitdir: string }, from: string, to: string) {
    const output = await this.git(state, ["diff", "--name-status", "-z", from, to])
    const parts = output.split("\0").filter(Boolean)
    const result: Array<{ file: string; status?: SnapshotFileDiff["status"] }> = []

    for (let index = 0; index < parts.length; ) {
      const status = parts[index++]
      if (!status) continue
      if (status.startsWith("R") || status.startsWith("C")) {
        index++
        const next = parts[index++]
        if (next) result.push({ file: next, status: "modified" })
        continue
      }

      const file = parts[index++]
      if (!file) continue
      result.push({
        file,
        status: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      })
    }

    return result
  }

  private async numstat(state: { worktree: string; gitdir: string }, from: string, to: string) {
    const output = await this.git(state, ["diff", "--numstat", "-z", from, to])
    const parts = output.split("\0").filter(Boolean)
    const stats = new Map<string, { additions: number; deletions: number }>()

    for (const part of parts) {
      const [additions, deletions, file] = part.split("\t")
      if (!file) continue
      stats.set(file, {
        additions: Number(additions) || 0,
        deletions: Number(deletions) || 0,
      })
    }

    return stats
  }

  private async git(state: { worktree: string; gitdir: string }, args: string[]) {
    return this.raw(["--git-dir", state.gitdir, "--work-tree", state.worktree, ...args], state.worktree)
  }

  private async raw(args: string[], cwd?: string) {
    const proc = Bun.spawn(["git", "-c", "core.longpaths=true", "-c", "core.autocrlf=false", ...args], {
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
}

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24)
}
