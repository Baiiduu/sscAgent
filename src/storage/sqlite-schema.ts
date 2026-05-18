export const SQLITE_SESSION_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  project_id TEXT,
  workspace_id TEXT,
  parent_id TEXT,
  directory TEXT NOT NULL,
  cwd TEXT NOT NULL,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  summary_json TEXT,
  permission_json TEXT,
  revert_json TEXT,
  allowed_external_paths_json TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_compacting INTEGER,
  time_archived INTEGER
);

CREATE INDEX IF NOT EXISTS session_project_idx ON session(project_id);
CREATE INDEX IF NOT EXISTS session_workspace_idx ON session(workspace_id);
CREATE INDEX IF NOT EXISTS session_parent_idx ON session(parent_id);
CREATE INDEX IF NOT EXISTS session_updated_idx ON session(time_updated);

CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  baseline_hash TEXT,
  restore_hash TEXT,
  first_message_id TEXT,
  last_message_id TEXT,
  summary_json TEXT,
  error TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_completed INTEGER,
  time_reverted INTEGER,
  FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS run_session_time_idx ON run(session_id, time_created, id);
CREATE INDEX IF NOT EXISTS run_session_status_idx ON run(session_id, status);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL,
  parent_id TEXT,
  finish_reason TEXT,
  time_created INTEGER NOT NULL,
  time_completed INTEGER,
  FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES run(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS message_session_time_idx ON message(session_id, time_created, id);
CREATE INDEX IF NOT EXISTS message_parent_idx ON message(parent_id);
CREATE INDEX IF NOT EXISTS message_run_idx ON message(run_id);

CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT,
  text TEXT,
  input_json TEXT,
  output_json TEXT,
  title TEXT,
  metadata_json TEXT,
  error TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_completed INTEGER,
  FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS part_message_idx ON part(message_id, time_created, id);
CREATE INDEX IF NOT EXISTS part_session_idx ON part(session_id);
CREATE INDEX IF NOT EXISTS part_tool_call_idx ON part(tool_call_id);

CREATE TABLE IF NOT EXISTS snapshot (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  message_id TEXT,
  part_id TEXT,
  tool_call_id TEXT,
  cwd TEXT NOT NULL,
  from_hash TEXT,
  to_hash TEXT,
  diffs_json TEXT NOT NULL,
  diff TEXT,
  time_created INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES run(id) ON DELETE SET NULL,
  FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE SET NULL,
  FOREIGN KEY(part_id) REFERENCES part(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS snapshot_session_time_idx ON snapshot(session_id, time_created, id);
CREATE INDEX IF NOT EXISTS snapshot_run_idx ON snapshot(run_id);
CREATE INDEX IF NOT EXISTS snapshot_tool_call_idx ON snapshot(tool_call_id);
`
