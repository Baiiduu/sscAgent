import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import type {
  Finding,
  FindingCaptureInput,
  FindingEvent,
  FindingEventSource,
  FindingEventType,
} from "./schema"

export interface SQLiteFindingStoreInput {
  filepath: string
}

interface FindingRow {
  id: string
  session_id: string
  run_id: string | null
  stable_key: string
  title: string
  kind: Finding["kind"]
  severity: Finding["severity"] | null
  primary_identifier: string | null
  package_name: string | null
  purl: string | null
  file_path: string | null
  created_at: number
  updated_at: number
}

interface FindingEventRow {
  id: string
  finding_id: string
  session_id: string
  run_id: string | null
  type: FindingEventType
  source: FindingEventSource
  summary: string
  data_json: string | null
  artifact_path: string | null
  created_at: number
}

export class SQLiteFindingStore {
  private readonly db: Database

  constructor(private readonly input: SQLiteFindingStoreInput) {
    mkdirSync(dirname(input.filepath), { recursive: true })
    this.db = new Database(input.filepath)
    this.migrate()
  }

  capture(input: FindingCaptureInput, context: { sessionID: string; runID?: string }) {
    if (input.action === "open") {
      return this.openFinding(input, context)
    }
    return this.appendEvent(input, context)
  }

  openFinding(input: Extract<FindingCaptureInput, { action: "open" }>, context: { sessionID: string; runID?: string }) {
    const now = Date.now()
    const existing = this.getByStableKey(context.sessionID, input.stableKey)

    if (existing) {
      this.db
        .query(
          `UPDATE finding SET
            run_id = COALESCE($run_id, run_id),
            title = $title,
            kind = $kind,
            severity = $severity,
            primary_identifier = $primary_identifier,
            package_name = $package_name,
            purl = $purl,
            file_path = $file_path,
            updated_at = $updated_at
          WHERE id = $id`,
        )
        .run({
          $id: existing.id,
          $run_id: context.runID ?? null,
          $title: input.title,
          $kind: input.kind,
          $severity: input.severity ?? null,
          $primary_identifier: input.primaryIdentifier ?? null,
          $package_name: input.packageName ?? null,
          $purl: input.purl ?? null,
          $file_path: input.filePath ?? null,
          $updated_at: now,
        })
      return this.get(existing.id) ?? existing
    }

    const finding: Finding = {
      id: createID("finding"),
      sessionID: context.sessionID,
      runID: context.runID,
      stableKey: input.stableKey,
      title: input.title,
      kind: input.kind,
      severity: input.severity,
      primaryIdentifier: input.primaryIdentifier,
      packageName: input.packageName,
      purl: input.purl,
      filePath: input.filePath,
      createdAt: now,
      updatedAt: now,
    }

    this.db
      .query(
        `INSERT INTO finding (
          id, session_id, run_id, stable_key, title, kind, severity, primary_identifier,
          package_name, purl, file_path, created_at, updated_at
        ) VALUES (
          $id, $session_id, $run_id, $stable_key, $title, $kind, $severity, $primary_identifier,
          $package_name, $purl, $file_path, $created_at, $updated_at
        )`,
      )
      .run(findingParams(finding))

    this.insertEvent({
      id: createID("finding_event"),
      findingID: finding.id,
      sessionID: context.sessionID,
      runID: context.runID,
      type: "opened",
      source: "agent",
      summary: input.title,
      data: {
        stableKey: input.stableKey,
        kind: input.kind,
        severity: input.severity,
        primaryIdentifier: input.primaryIdentifier,
        packageName: input.packageName,
        purl: input.purl,
        filePath: input.filePath,
      },
      createdAt: now,
    })

    return finding
  }

  appendEvent(
    input: Extract<FindingCaptureInput, { action: "append_event" }>,
    context: { sessionID: string; runID?: string },
  ) {
    const finding = this.getByStableKey(context.sessionID, input.stableKey)
    if (!finding) {
      throw new Error(`Finding not found for stableKey: ${input.stableKey}`)
    }

    const now = Date.now()
    const event: FindingEvent = {
      id: createID("finding_event"),
      findingID: finding.id,
      sessionID: context.sessionID,
      runID: context.runID,
      type: input.type,
      source: input.source,
      summary: input.summary,
      data: input.data,
      artifactPath: input.artifactPath,
      createdAt: now,
    }

    this.insertEvent(event)
    this.db.query("UPDATE finding SET updated_at = ? WHERE id = ?").run(now, finding.id)
    return event
  }

  list(sessionID?: string) {
    const rows = sessionID
      ? (this.db.query("SELECT * FROM finding WHERE session_id = ? ORDER BY updated_at DESC").all(sessionID) as FindingRow[])
      : (this.db.query("SELECT * FROM finding ORDER BY updated_at DESC").all() as FindingRow[])
    return rows.map(findingFromRow)
  }

  get(id: string) {
    const row = this.db.query("SELECT * FROM finding WHERE id = ?").get(id) as FindingRow | null
    return row ? findingFromRow(row) : undefined
  }

  getByStableKey(sessionID: string, stableKey: string) {
    const row = this.db
      .query("SELECT * FROM finding WHERE session_id = ? AND stable_key = ?")
      .get(sessionID, stableKey) as FindingRow | null
    return row ? findingFromRow(row) : undefined
  }

  events(findingID: string) {
    const rows = this.db
      .query("SELECT * FROM finding_event WHERE finding_id = ? ORDER BY created_at ASC, id ASC")
      .all(findingID) as FindingEventRow[]
    return rows.map(eventFromRow)
  }

  private insertEvent(event: FindingEvent) {
    this.db
      .query(
        `INSERT INTO finding_event (
          id, finding_id, session_id, run_id, type, source, summary, data_json, artifact_path, created_at
        ) VALUES (
          $id, $finding_id, $session_id, $run_id, $type, $source, $summary, $data_json, $artifact_path, $created_at
        )`,
      )
      .run(eventParams(event))
  }

  private migrate() {
    this.db.exec(SQLITE_FINDING_SCHEMA)
  }
}

export const SQLITE_FINDING_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finding (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  stable_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT,
  primary_identifier TEXT,
  package_name TEXT,
  purl TEXT,
  file_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, stable_key)
);

CREATE INDEX IF NOT EXISTS finding_session_updated_idx ON finding(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS finding_session_stable_key_idx ON finding(session_id, stable_key);

CREATE TABLE IF NOT EXISTS finding_event (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_json TEXT,
  artifact_path TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(finding_id) REFERENCES finding(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS finding_event_finding_time_idx ON finding_event(finding_id, created_at, id);
CREATE INDEX IF NOT EXISTS finding_event_session_time_idx ON finding_event(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS finding_event_type_idx ON finding_event(type);
`

function findingParams(finding: Finding) {
  return {
    $id: finding.id,
    $session_id: finding.sessionID,
    $run_id: finding.runID ?? null,
    $stable_key: finding.stableKey,
    $title: finding.title,
    $kind: finding.kind,
    $severity: finding.severity ?? null,
    $primary_identifier: finding.primaryIdentifier ?? null,
    $package_name: finding.packageName ?? null,
    $purl: finding.purl ?? null,
    $file_path: finding.filePath ?? null,
    $created_at: finding.createdAt,
    $updated_at: finding.updatedAt,
  }
}

function eventParams(event: FindingEvent) {
  return {
    $id: event.id,
    $finding_id: event.findingID,
    $session_id: event.sessionID,
    $run_id: event.runID ?? null,
    $type: event.type,
    $source: event.source,
    $summary: event.summary,
    $data_json: event.data === undefined ? null : JSON.stringify(event.data),
    $artifact_path: event.artifactPath ?? null,
    $created_at: event.createdAt,
  }
}

function findingFromRow(row: FindingRow): Finding {
  return {
    id: row.id,
    sessionID: row.session_id,
    runID: row.run_id ?? undefined,
    stableKey: row.stable_key,
    title: row.title,
    kind: row.kind,
    severity: row.severity ?? undefined,
    primaryIdentifier: row.primary_identifier ?? undefined,
    packageName: row.package_name ?? undefined,
    purl: row.purl ?? undefined,
    filePath: row.file_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function eventFromRow(row: FindingEventRow): FindingEvent {
  return {
    id: row.id,
    findingID: row.finding_id,
    sessionID: row.session_id,
    runID: row.run_id ?? undefined,
    type: row.type,
    source: row.source,
    summary: row.summary,
    data: fromJSON(row.data_json),
    artifactPath: row.artifact_path ?? undefined,
    createdAt: row.created_at,
  }
}

function fromJSON(value: string | null | undefined) {
  if (!value) return undefined
  return JSON.parse(value) as unknown
}

function createID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
