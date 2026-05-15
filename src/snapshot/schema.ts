export interface SnapshotTrackInput {
  workspace: string
}

export interface SnapshotDiffInput {
  workspace: string
  from: string
  to: string
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
  diffFull(input: SnapshotDiffInput): Promise<SnapshotFileDiff[]>
}
