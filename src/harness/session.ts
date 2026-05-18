import { createMessage, createPartID, type HarnessMessage } from "./message"
import type { PermissionRuleset } from "../permission"
import type { SnapshotFileDiff } from "../snapshot"

export interface HarnessSession {
  id: string
  slug: string
  projectID?: string
  workspaceID?: string
  directory: string
  title: string
  version: string
  parentID?: string
  cwd: string
  workspace: string
  allowedExternalPaths: string[]
  summary?: SessionSummary
  permission?: PermissionRuleset
  revert?: SessionRevert
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
}

export interface SessionSummary {
  text: string
  additions?: number
  deletions?: number
  files?: number
}

export interface SessionRevert {
  messageID: string
  partID?: string
  snapshotID?: string
  runID?: string
  snapshot?: string
  diff?: string
  cleanup?: "run" | "message"
  runBaselineHash?: string
}

export type SessionRunStatus = "running" | "completed" | "failed" | "reverted"

export interface SessionRun {
  id: string
  sessionID: string
  status: SessionRunStatus
  baselineHash?: string
  restoreHash?: string
  firstMessageID?: string
  lastMessageID?: string
  summary?: SessionSummary
  error?: string
  time: {
    created: number
    updated: number
    completed?: number
    reverted?: number
  }
}

export interface SessionSnapshot {
  id: string
  sessionID: string
  runID?: string
  messageID?: string
  partID?: string
  toolCallID?: string
  cwd: string
  fromHash?: string
  toHash?: string
  diffs: SnapshotFileDiff[]
  diff?: string
  time: {
    created: number
  }
}

export interface CreateSessionInput {
  id?: string
  slug?: string
  projectID?: string
  workspaceID?: string
  title?: string
  version?: string
  parentID?: string
  directory?: string
  cwd: string
  workspace: string
  allowedExternalPaths?: string[]
  summary?: SessionSummary
  permission?: PermissionRuleset
}

export interface UpdateSessionPatch {
  projectID?: string
  workspaceID?: string
  directory?: string
  title?: string
  version?: string
  parentID?: string
  cwd?: string
  workspace?: string
  allowedExternalPaths?: string[]
  summary?: SessionSummary | null
  permission?: PermissionRuleset | null
  revert?: SessionRevert | null
  time?: Partial<HarnessSession["time"]>
}

export interface SessionStore {
  create(input: CreateSessionInput): Promise<HarnessSession>
  get(sessionID: string): Promise<HarnessSession | undefined>
  update(sessionID: string, patch: UpdateSessionPatch): Promise<HarnessSession>
  touch(sessionID: string): Promise<void>
  children(parentID: string): Promise<HarnessSession[]>
  messages(sessionID: string): Promise<HarnessMessage[]>
  appendMessage(sessionID: string, message: HarnessMessage): Promise<void>
  updateMessage(sessionID: string, message: HarnessMessage): Promise<void>
  replaceMessages(sessionID: string, messages: HarnessMessage[]): Promise<void>
  appendPart(sessionID: string, messageID: string, part: HarnessMessage["parts"][number]): Promise<void>
  updatePart(sessionID: string, messageID: string, part: HarnessMessage["parts"][number]): Promise<void>
  runs?(sessionID: string): Promise<SessionRun[]>
  getRun?(sessionID: string, runID: string): Promise<SessionRun | undefined>
  appendRun?(run: Omit<SessionRun, "id" | "time"> & { id?: string; time?: SessionRun["time"] }): Promise<SessionRun>
  updateRun?(sessionID: string, runID: string, patch: UpdateSessionRunPatch): Promise<SessionRun>
  snapshots(sessionID: string): Promise<SessionSnapshot[]>
  appendSnapshot(snapshot: Omit<SessionSnapshot, "id" | "time"> & { id?: string; time?: SessionSnapshot["time"] }): Promise<SessionSnapshot>
}

export interface UpdateSessionRunPatch {
  status?: SessionRunStatus
  baselineHash?: string
  restoreHash?: string
  firstMessageID?: string
  lastMessageID?: string
  summary?: SessionSummary | null
  error?: string | null
  time?: Partial<SessionRun["time"]>
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, HarnessSession>()
  private readonly history = new Map<string, HarnessMessage[]>()
  private readonly runHistory = new Map<string, SessionRun[]>()
  private readonly snapshotHistory = new Map<string, SessionSnapshot[]>()

  async create(input: CreateSessionInput) {
    const now = Date.now()
    const session = {
      id: input.id ?? createSessionID(),
      slug: input.slug ?? createSlug(input.title),
      projectID: input.projectID,
      workspaceID: input.workspaceID,
      directory: input.directory ?? input.cwd,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      version: input.version ?? "0.1.0",
      parentID: input.parentID,
      cwd: input.cwd,
      workspace: input.workspace,
      allowedExternalPaths: input.allowedExternalPaths ?? [],
      summary: input.summary,
      permission: input.permission,
      time: {
        created: now,
        updated: now,
      },
    }
    this.sessions.set(session.id, session)
    this.history.set(session.id, [])
    return session
  }

  async get(sessionID: string) {
    return this.sessions.get(sessionID)
  }

  async update(sessionID: string, patch: UpdateSessionPatch) {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)

    const next = applySessionPatch(session, patch)
    this.sessions.set(sessionID, next)
    return next
  }

  async touch(sessionID: string) {
    await this.update(sessionID, {
      time: {
        updated: Date.now(),
      },
    })
  }

  async children(parentID: string) {
    return [...this.sessions.values()].filter((session) => session.parentID === parentID)
  }

  async messages(sessionID: string) {
    return [...(this.history.get(sessionID) ?? [])]
  }

  async appendMessage(sessionID: string, message: HarnessMessage) {
    await this.touch(sessionID)
    this.history.set(sessionID, [...(this.history.get(sessionID) ?? []), message])
  }

  async updateMessage(sessionID: string, message: HarnessMessage) {
    await this.touch(sessionID)
    this.history.set(
      sessionID,
      (this.history.get(sessionID) ?? []).map((item) => (item.id === message.id ? message : item)),
    )
  }

  async replaceMessages(sessionID: string, messages: HarnessMessage[]) {
    await this.touch(sessionID)
    this.history.set(sessionID, messages)
  }

  async appendPart(sessionID: string, messageID: string, part: HarnessMessage["parts"][number]) {
    const messages = this.history.get(sessionID) ?? []
    this.history.set(
      sessionID,
      messages.map((message) =>
        message.id === messageID
          ? {
              ...message,
              parts: [...message.parts, part],
            }
          : message,
      ),
    )
    await this.touch(sessionID)
  }

  async updatePart(sessionID: string, messageID: string, part: HarnessMessage["parts"][number]) {
    const messages = this.history.get(sessionID) ?? []
    this.history.set(
      sessionID,
      messages.map((message) =>
        message.id === messageID
          ? {
              ...message,
              parts: message.parts.map((item) => (item.id === part.id ? part : item)),
            }
          : message,
      ),
    )
    await this.touch(sessionID)
  }

  async runs(sessionID: string) {
    return [...(this.runHistory.get(sessionID) ?? [])]
  }

  async getRun(sessionID: string, runID: string) {
    return (this.runHistory.get(sessionID) ?? []).find((run) => run.id === runID)
  }

  async appendRun(input: Omit<SessionRun, "id" | "time"> & { id?: string; time?: SessionRun["time"] }) {
    const now = Date.now()
    const run: SessionRun = {
      ...input,
      id: input.id ?? createID("run"),
      time: input.time ?? {
        created: now,
        updated: now,
      },
    }
    this.runHistory.set(run.sessionID, [...(this.runHistory.get(run.sessionID) ?? []), run])
    await this.touch(run.sessionID)
    return run
  }

  async updateRun(sessionID: string, runID: string, patch: UpdateSessionRunPatch) {
    const runs = this.runHistory.get(sessionID) ?? []
    const current = runs.find((run) => run.id === runID)
    if (!current) throw new Error(`Session run not found: ${runID}`)

    const next = applySessionRunPatch(current, patch)
    this.runHistory.set(
      sessionID,
      runs.map((run) => (run.id === runID ? next : run)),
    )
    await this.touch(sessionID)
    return next
  }

  async snapshots(sessionID: string) {
    return [...(this.snapshotHistory.get(sessionID) ?? [])]
  }

  async appendSnapshot(input: Omit<SessionSnapshot, "id" | "time"> & { id?: string; time?: SessionSnapshot["time"] }) {
    const snapshot = {
      ...input,
      id: input.id ?? createID("snapshot"),
      time: input.time ?? {
        created: Date.now(),
      },
    }
    this.snapshotHistory.set(snapshot.sessionID, [...(this.snapshotHistory.get(snapshot.sessionID) ?? []), snapshot])
    await this.touch(snapshot.sessionID)
    return snapshot
  }
}

export function createUserMessage(text: string) {
  return createMessage({
    role: "user",
    parts: [
      {
        id: createPartID(),
        type: "text",
        text,
      },
    ],
  })
}

function createSessionID(prefix = "session") {
  return createID(prefix)
}

function createID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function createDefaultTitle(isChild: boolean) {
  return isChild ? "New child session" : "New session"
}

function createSlug(title?: string) {
  const slug = (title ?? "session")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "session"
}

function applySessionPatch(session: HarnessSession, patch: UpdateSessionPatch): HarnessSession {
  return {
    ...session,
    ...(patch.projectID !== undefined && { projectID: patch.projectID }),
    ...(patch.workspaceID !== undefined && { workspaceID: patch.workspaceID }),
    ...(patch.directory !== undefined && { directory: patch.directory }),
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.version !== undefined && { version: patch.version }),
    ...(patch.parentID !== undefined && { parentID: patch.parentID }),
    ...(patch.cwd !== undefined && { cwd: patch.cwd }),
    ...(patch.workspace !== undefined && { workspace: patch.workspace }),
    ...(patch.allowedExternalPaths !== undefined && { allowedExternalPaths: patch.allowedExternalPaths }),
    ...(patch.summary !== undefined && { summary: patch.summary ?? undefined }),
    ...(patch.permission !== undefined && { permission: patch.permission ?? undefined }),
    ...(patch.revert !== undefined && { revert: patch.revert ?? undefined }),
    time: {
      ...session.time,
      ...patch.time,
      updated: patch.time?.updated ?? Date.now(),
    },
  }
}

function applySessionRunPatch(run: SessionRun, patch: UpdateSessionRunPatch): SessionRun {
  return {
    ...run,
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.baselineHash !== undefined && { baselineHash: patch.baselineHash }),
    ...(patch.restoreHash !== undefined && { restoreHash: patch.restoreHash }),
    ...(patch.firstMessageID !== undefined && { firstMessageID: patch.firstMessageID }),
    ...(patch.lastMessageID !== undefined && { lastMessageID: patch.lastMessageID }),
    ...(patch.summary !== undefined && { summary: patch.summary ?? undefined }),
    ...(patch.error !== undefined && { error: patch.error ?? undefined }),
    time: {
      ...run.time,
      ...patch.time,
      updated: patch.time?.updated ?? Date.now(),
    },
  }
}
