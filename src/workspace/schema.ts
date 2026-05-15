export interface CreateSessionWorkspaceInput {
  sessionID: string
  workspaceRoot?: string
}

export interface SessionWorkspace {
  id: string
  sessionID: string
  root: string
  reposDir: string
  artifactsDir: string
  logsDir: string
  tmpDir: string
  metadataPath: string
}

export interface SessionWorkspaceMetadata {
  id: string
  sessionID: string
  root: string
  reposDir: string
  artifactsDir: string
  logsDir: string
  tmpDir: string
  createdAt: string
  updatedAt: string
}
