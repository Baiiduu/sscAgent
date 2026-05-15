import path from "node:path"
import type { CreateSessionWorkspaceInput, SessionWorkspace } from "./schema"

export const DEFAULT_WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../.agent-data/workspaces")

export function resolveWorkspaceRoot(workspaceRoot?: string) {
  return path.resolve(workspaceRoot ?? DEFAULT_WORKSPACE_ROOT)
}

export function resolveSessionWorkspace(input: CreateSessionWorkspaceInput): SessionWorkspace {
  const id = safeWorkspaceID(input.sessionID)
  const root = path.join(resolveWorkspaceRoot(input.workspaceRoot), "sessions", id)
  return {
    id,
    sessionID: input.sessionID,
    root,
    reposDir: path.join(root, "repos"),
    artifactsDir: path.join(root, "artifacts"),
    logsDir: path.join(root, "logs"),
    tmpDir: path.join(root, "tmp"),
    metadataPath: path.join(root, "metadata.json"),
  }
}

export function assertInsideWorkspace(filepath: string, workspaceRoot: string) {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(filepath)
  if (target === root || target.startsWith(root + path.sep)) return
  throw new Error(`Path escapes workspace root: ${target}`)
}

function safeWorkspaceID(sessionID: string) {
  return sessionID.replace(/[^a-zA-Z0-9._-]+/g, "_").toLowerCase()
}
