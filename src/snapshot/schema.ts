export interface SnapshotTrackInput {
  workspace: string
}

export interface SnapshotDiffInput {
  workspace: string
  from: string
  to: string
}

export interface SnapshotSinceInput {
  workspace: string
  hash: string
}

export interface SnapshotRestoreInput {
  workspace: string
  hash: string
}

export interface SnapshotPatch {
  hash: string
  files: string[]
}

export interface SnapshotRevertInput {
  workspace: string
  patches: SnapshotPatch[]
}

export interface SnapshotFileDiff {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface SnapshotService {
  track(input: SnapshotTrackInput): Promise<string | undefined>
  patch?(input: SnapshotSinceInput): Promise<SnapshotPatch>
  restore?(input: SnapshotRestoreInput): Promise<void>
  revert?(input: SnapshotRevertInput): Promise<void>
  diff?(input: SnapshotSinceInput): Promise<string>
  diffFull(input: SnapshotDiffInput): Promise<SnapshotFileDiff[]>
}
