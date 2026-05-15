import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { createMessage, type HarnessMessage, type MessagePart, type MessageRole } from "../harness/message"
import type {
  CreateSessionInput,
  HarnessSession,
  SessionSnapshot,
  SessionStore,
  UpdateSessionPatch,
} from "../harness/session"
import type { SnapshotFileDiff } from "../snapshot"
import { SQLITE_SESSION_SCHEMA } from "./sqlite-schema"

export interface SQLiteSessionStoreInput {
  filepath: string
}

interface SessionRow {
  id: string
  slug: string
  project_id: string | null
  workspace_id: string | null
  parent_id: string | null
  directory: string
  cwd: string
  workspace: string
  title: string
  version: string
  summary_json: string | null
  permission_json: string | null
  revert_json: string | null
  allowed_external_paths_json: string
  time_created: number
  time_updated: number
  time_compacting: number | null
  time_archived: number | null
}

interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  parent_id: string | null
  finish_reason: string | null
  time_created: number
  time_completed: number | null
}

interface PartRow {
  id: string
  session_id: string
  message_id: string
  type: MessagePart["type"]
  tool_call_id: string | null
  tool_name: string | null
  text: string | null
  input_json: string | null
  output_json: string | null
  title: string | null
  metadata_json: string | null
  error: string | null
  time_created: number
  time_updated: number | null
  time_completed: number | null
}

interface SnapshotRow {
  id: string
  session_id: string
  message_id: string | null
  part_id: string | null
  tool_call_id: string | null
  cwd: string
  from_hash: string | null
  to_hash: string | null
  diffs_json: string
  diff: string | null
  time_created: number
}

export class SQLiteSessionStore implements SessionStore {
  private readonly db: Database

  constructor(private readonly input: SQLiteSessionStoreInput) {
    mkdirSync(dirname(input.filepath), { recursive: true })
    this.db = new Database(input.filepath)
    this.db.exec(SQLITE_SESSION_SCHEMA)
  }

  async create(input: CreateSessionInput) {
    const now = Date.now()
    const session: HarnessSession = {
      id: input.id ?? createID("session"),
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
    this.insertSession(session)
    return session
  }

  async get(sessionID: string) {
    const row = this.db.query("SELECT * FROM session WHERE id = ?").get(sessionID) as SessionRow | null
    if (!row) return
    return sessionFromRow(row)
  }

  async update(sessionID: string, patch: UpdateSessionPatch) {
    const session = await this.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    const next = applySessionPatch(session, patch)
    this.db
      .query(
        `UPDATE session SET
          project_id = $project_id,
          workspace_id = $workspace_id,
          parent_id = $parent_id,
          directory = $directory,
          cwd = $cwd,
          workspace = $workspace,
          title = $title,
          version = $version,
          summary_json = $summary_json,
          permission_json = $permission_json,
          revert_json = $revert_json,
          allowed_external_paths_json = $allowed_external_paths_json,
          time_updated = $time_updated,
          time_compacting = $time_compacting,
          time_archived = $time_archived
        WHERE id = $id`,
      )
      .run(sessionParams(next))
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
    return (
      this.db.query("SELECT * FROM session WHERE parent_id = ? ORDER BY time_updated DESC").all(parentID) as SessionRow[]
    ).map(sessionFromRow)
  }

  async messages(sessionID: string) {
    const messages = this.db
      .query("SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC")
      .all(sessionID) as MessageRow[]
    const parts = this.db
      .query("SELECT * FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC")
      .all(sessionID) as PartRow[]
    const partMap = new Map<string, MessagePart[]>()
    for (const part of parts.map(partFromRow)) {
      partMap.set(part.messageID ?? "", [...(partMap.get(part.messageID ?? "") ?? []), part])
    }
    return messages.map((message) =>
      createMessage({
        id: message.id,
        sessionID: message.session_id,
        role: message.role,
        parentID: message.parent_id ?? undefined,
        parts: partMap.get(message.id) ?? [],
        time: {
          created: message.time_created,
          completed: message.time_completed ?? undefined,
        },
        finishReason: message.finish_reason ?? undefined,
      }),
    )
  }

  async appendMessage(sessionID: string, message: HarnessMessage) {
    const normalized = normalizeMessage(sessionID, message)
    this.db.transaction(() => {
      this.insertMessage(normalized)
      for (const part of normalized.parts) this.insertPart(sessionID, normalized.id, part)
    })()
    await this.touch(sessionID)
  }

  async updateMessage(sessionID: string, message: HarnessMessage) {
    const normalized = normalizeMessage(sessionID, message)
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE message SET
            role = $role,
            parent_id = $parent_id,
            finish_reason = $finish_reason,
            time_created = $time_created,
            time_completed = $time_completed
          WHERE id = $id AND session_id = $session_id`,
        )
        .run(messageParams(normalized))
      this.db.query("DELETE FROM part WHERE session_id = ? AND message_id = ?").run(sessionID, normalized.id)
      for (const part of normalized.parts) this.insertPart(sessionID, normalized.id, part)
    })()
    await this.touch(sessionID)
  }

  async replaceMessages(sessionID: string, messages: HarnessMessage[]) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM message WHERE session_id = ?").run(sessionID)
      for (const message of messages.map((item) => normalizeMessage(sessionID, item))) {
        this.insertMessage(message)
        for (const part of message.parts) this.insertPart(sessionID, message.id, part)
      }
    })()
    await this.touch(sessionID)
  }

  async appendPart(sessionID: string, messageID: string, part: MessagePart) {
    this.insertPart(sessionID, messageID, normalizePart(sessionID, messageID, part))
    await this.touch(sessionID)
  }

  async updatePart(sessionID: string, messageID: string, part: MessagePart) {
    const normalized = normalizePart(sessionID, messageID, part)
    this.db
      .query(
        `UPDATE part SET
          type = $type,
          tool_call_id = $tool_call_id,
          tool_name = $tool_name,
          text = $text,
          input_json = $input_json,
          output_json = $output_json,
          title = $title,
          metadata_json = $metadata_json,
          error = $error,
          time_created = $time_created,
          time_updated = $time_updated,
          time_completed = $time_completed
        WHERE id = $id AND session_id = $session_id AND message_id = $message_id`,
      )
      .run(partParams(normalized))
    await this.touch(sessionID)
  }

  async snapshots(sessionID: string) {
    return (
      this.db.query("SELECT * FROM snapshot WHERE session_id = ? ORDER BY time_created ASC, id ASC").all(sessionID) as SnapshotRow[]
    ).map(snapshotFromRow)
  }

  async appendSnapshot(input: Omit<SessionSnapshot, "id" | "time"> & { id?: string; time?: SessionSnapshot["time"] }) {
    const snapshot: SessionSnapshot = {
      ...input,
      id: input.id ?? createID("snapshot"),
      time: input.time ?? {
        created: Date.now(),
      },
    }
    this.db
      .query(
        `INSERT INTO snapshot (
          id, session_id, message_id, part_id, tool_call_id, cwd, from_hash, to_hash, diffs_json, diff, time_created
        ) VALUES (
          $id, $session_id, $message_id, $part_id, $tool_call_id, $cwd, $from_hash, $to_hash, $diffs_json, $diff, $time_created
        )`,
      )
      .run({
        $id: snapshot.id,
        $session_id: snapshot.sessionID,
        $message_id: snapshot.messageID ?? null,
        $part_id: snapshot.partID ?? null,
        $tool_call_id: snapshot.toolCallID ?? null,
        $cwd: snapshot.cwd,
        $from_hash: snapshot.fromHash ?? null,
        $to_hash: snapshot.toHash ?? null,
        $diffs_json: JSON.stringify(snapshot.diffs),
        $diff: snapshot.diff ?? null,
        $time_created: snapshot.time.created,
      })
    await this.touch(snapshot.sessionID)
    return snapshot
  }

  private insertSession(session: HarnessSession) {
    this.db
      .query(
        `INSERT INTO session (
          id, slug, project_id, workspace_id, parent_id, directory, cwd, workspace, title, version,
          summary_json, permission_json, revert_json, allowed_external_paths_json,
          time_created, time_updated, time_compacting, time_archived
        ) VALUES (
          $id, $slug, $project_id, $workspace_id, $parent_id, $directory, $cwd, $workspace, $title, $version,
          $summary_json, $permission_json, $revert_json, $allowed_external_paths_json,
          $time_created, $time_updated, $time_compacting, $time_archived
        )`,
      )
      .run(sessionParams(session))
  }

  private insertMessage(message: HarnessMessage) {
    this.db
      .query(
        `INSERT INTO message (
          id, session_id, role, parent_id, finish_reason, time_created, time_completed
        ) VALUES (
          $id, $session_id, $role, $parent_id, $finish_reason, $time_created, $time_completed
        )`,
      )
      .run(messageParams(message))
  }

  private insertPart(sessionID: string, messageID: string, part: MessagePart) {
    this.db
      .query(
        `INSERT INTO part (
          id, session_id, message_id, type, tool_call_id, tool_name, text, input_json, output_json,
          title, metadata_json, error, time_created, time_updated, time_completed
        ) VALUES (
          $id, $session_id, $message_id, $type, $tool_call_id, $tool_name, $text, $input_json, $output_json,
          $title, $metadata_json, $error, $time_created, $time_updated, $time_completed
        )`,
      )
      .run(partParams(normalizePart(sessionID, messageID, part)))
  }
}

function sessionParams(session: HarnessSession) {
  return {
    $id: session.id,
    $slug: session.slug,
    $project_id: session.projectID ?? null,
    $workspace_id: session.workspaceID ?? null,
    $parent_id: session.parentID ?? null,
    $directory: session.directory,
    $cwd: session.cwd,
    $workspace: session.workspace,
    $title: session.title,
    $version: session.version,
    $summary_json: toJSON(session.summary),
    $permission_json: toJSON(session.permission),
    $revert_json: toJSON(session.revert),
    $allowed_external_paths_json: JSON.stringify(session.allowedExternalPaths),
    $time_created: session.time.created,
    $time_updated: session.time.updated,
    $time_compacting: session.time.compacting ?? null,
    $time_archived: session.time.archived ?? null,
  }
}

function messageParams(message: HarnessMessage) {
  if (!message.sessionID) throw new Error(`Message is missing sessionID: ${message.id}`)
  return {
    $id: message.id,
    $session_id: message.sessionID,
    $role: message.role,
    $parent_id: message.parentID ?? null,
    $finish_reason: message.finishReason ?? null,
    $time_created: message.time.created,
    $time_completed: message.time.completed ?? null,
  }
}

function partParams(part: MessagePart) {
  if (!part.sessionID) throw new Error(`Part is missing sessionID: ${part.id}`)
  if (!part.messageID) throw new Error(`Part is missing messageID: ${part.id}`)
  return {
    $id: part.id,
    $session_id: part.sessionID,
    $message_id: part.messageID,
    $type: part.type,
    $tool_call_id: "toolCallID" in part ? part.toolCallID : null,
    $tool_name: "toolName" in part ? part.toolName : null,
    $text: "text" in part ? part.text : null,
    $input_json: "input" in part ? JSON.stringify(part.input) : null,
    $output_json: "output" in part ? JSON.stringify(part.output) : null,
    $title: "title" in part ? (part.title ?? null) : null,
    $metadata_json: "metadata" in part ? toJSON(part.metadata) : null,
    $error: "error" in part ? part.error : null,
    $time_created: part.time?.created ?? Date.now(),
    $time_updated: part.time?.updated ?? null,
    $time_completed: part.time?.completed ?? null,
  }
}

function sessionFromRow(row: SessionRow): HarnessSession {
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id ?? undefined,
    workspaceID: row.workspace_id ?? undefined,
    parentID: row.parent_id ?? undefined,
    directory: row.directory,
    cwd: row.cwd,
    workspace: row.workspace,
    title: row.title,
    version: row.version,
    summary: fromJSON(row.summary_json),
    permission: fromJSON(row.permission_json),
    revert: fromJSON(row.revert_json),
    allowedExternalPaths: fromJSON<string[]>(row.allowed_external_paths_json) ?? [],
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

function partFromRow(row: PartRow): MessagePart {
  const base = {
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
    time: {
      created: row.time_created,
      updated: row.time_updated ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }

  if (row.type === "text") {
    return {
      ...base,
      type: "text",
      text: row.text ?? "",
    }
  }
  if (row.type === "reasoning") {
    return {
      ...base,
      type: "reasoning",
      text: row.text ?? "",
    }
  }
  if (row.type === "tool-call") {
    return {
      ...base,
      type: "tool-call",
      toolCallID: row.tool_call_id ?? "",
      toolName: row.tool_name ?? "",
      input: fromJSON(row.input_json),
    }
  }
  if (row.type === "tool-result") {
    return {
      ...base,
      type: "tool-result",
      toolCallID: row.tool_call_id ?? "",
      toolName: row.tool_name ?? "",
      output: fromJSON(row.output_json),
      title: row.title ?? undefined,
      metadata: fromJSON<Record<string, unknown>>(row.metadata_json),
    }
  }
  return {
    ...base,
    type: "error",
    error: row.error ?? "",
  }
}

function snapshotFromRow(row: SnapshotRow): SessionSnapshot {
  return {
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id ?? undefined,
    partID: row.part_id ?? undefined,
    toolCallID: row.tool_call_id ?? undefined,
    cwd: row.cwd,
    fromHash: row.from_hash ?? undefined,
    toHash: row.to_hash ?? undefined,
    diffs: fromJSON<SnapshotFileDiff[]>(row.diffs_json) ?? [],
    diff: row.diff ?? undefined,
    time: {
      created: row.time_created,
    },
  }
}

function normalizeMessage(sessionID: string, message: HarnessMessage): HarnessMessage {
  return createMessage({
    ...message,
    sessionID,
    parts: message.parts.map((part) => normalizePart(sessionID, message.id, part)),
  })
}

function normalizePart(sessionID: string, messageID: string, part: MessagePart): MessagePart {
  return {
    ...part,
    sessionID,
    messageID,
    time: part.time ?? {
      created: Date.now(),
    },
  } as MessagePart
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

function toJSON(value: unknown) {
  return value === undefined ? null : JSON.stringify(value)
}

function fromJSON<T = unknown>(value: string | null | undefined): T | undefined {
  if (!value) return undefined
  return JSON.parse(value) as T
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

function createID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
