import path from "node:path"
import type { CreateSessionInput, HarnessSession } from "../harness"
import { createGitSnapshotService, type GitSnapshotServiceInput, type SnapshotService } from "../snapshot"
import { SQLiteSessionStore, type SQLiteSessionStoreInput } from "../storage"
import { createSessionToolExecutor, type CreateSessionToolExecutorInput } from "../tool"
import { createSessionWorkspace, type CreateSessionWorkspaceInput, type SessionWorkspace } from "../workspace"
import type { SessionStore } from "../harness"

export interface AgentRuntimeInput {
  dataDir?: string
  sessionStore?: SessionStore
  snapshotService?: SnapshotService
  sqlite?: Partial<SQLiteSessionStoreInput>
  snapshot?: GitSnapshotServiceInput
  workspace?: Omit<CreateSessionWorkspaceInput, "sessionID">
}

export interface RuntimeSession {
  session: HarnessSession
  workspace: SessionWorkspace
}

export interface AgentRuntime {
  dataDir: string
  store: SessionStore
  snapshot: SnapshotService
  createSession(input?: Omit<CreateSessionInput, "cwd" | "workspace" | "workspaceID">): Promise<RuntimeSession>
  createToolExecutor(input: Omit<CreateSessionToolExecutorInput, "snapshot"> & { snapshot?: false }): ReturnType<typeof createSessionToolExecutor>
}

export function createAgentRuntime(input: AgentRuntimeInput = {}): AgentRuntime {
  const dataDir = path.resolve(input.dataDir ?? path.join(import.meta.dir, "../../.agent-data"))
  const store =
    input.sessionStore ??
    new SQLiteSessionStore({
      filepath: input.sqlite?.filepath ?? path.join(dataDir, "session.sqlite"),
    })
  const snapshot =
    input.snapshotService ??
    createGitSnapshotService({
      snapshotRoot: input.snapshot?.snapshotRoot ?? path.join(dataDir, "snapshots"),
      excludes: input.snapshot?.excludes,
    })

  return {
    dataDir,
    store,
    snapshot,
    createSession: async (sessionInput = {}) => {
      const initial = await store.create({
        ...sessionInput,
        cwd: dataDir,
        workspace: dataDir,
      })
      const workspace = await createSessionWorkspace({
        sessionID: initial.id,
        workspaceRoot: input.workspace?.workspaceRoot ?? path.join(dataDir, "workspaces"),
      })
      const session = await store.update(initial.id, {
        workspaceID: workspace.id,
        directory: workspace.root,
        cwd: workspace.root,
        workspace: workspace.root,
      })
      return {
        session,
        workspace,
      }
    },
    createToolExecutor: (executorInput) =>
      createSessionToolExecutor({
        ...executorInput,
        snapshot: executorInput.snapshot === false ? undefined : { store, service: snapshot },
      }),
  }
}
