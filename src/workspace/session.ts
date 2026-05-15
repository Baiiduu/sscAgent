import { mkdir } from "node:fs/promises"
import type { CreateSessionWorkspaceInput, SessionWorkspaceMetadata } from "./schema"
import { resolveSessionWorkspace } from "./path"

export async function createSessionWorkspace(input: CreateSessionWorkspaceInput) {
  const workspace = resolveSessionWorkspace(input)
  await Promise.all([
    mkdir(workspace.reposDir, { recursive: true }),
    mkdir(workspace.artifactsDir, { recursive: true }),
    mkdir(workspace.logsDir, { recursive: true }),
    mkdir(workspace.tmpDir, { recursive: true }),
  ])

  const now = new Date().toISOString()
  const existing = await readMetadata(workspace.metadataPath)
  const metadata: SessionWorkspaceMetadata = {
    id: workspace.id,
    sessionID: workspace.sessionID,
    root: workspace.root,
    reposDir: workspace.reposDir,
    artifactsDir: workspace.artifactsDir,
    logsDir: workspace.logsDir,
    tmpDir: workspace.tmpDir,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await Bun.write(workspace.metadataPath, JSON.stringify(metadata, null, 2))
  return workspace
}

async function readMetadata(filepath: string): Promise<SessionWorkspaceMetadata | undefined> {
  const file = Bun.file(filepath)
  if (!(await file.exists())) return
  return file.json()
}
