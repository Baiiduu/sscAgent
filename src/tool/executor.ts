import type { PermissionRuntime, PermissionRuleset } from "../permission"
import type { HarnessSession } from "../harness/session"
import type { SessionStore } from "../harness/session"
import type { SnapshotService } from "../snapshot"
import type { ToolExecutionRequest, ToolResult } from "./schema"
import type { ToolRegistry } from "./registry"

const DEFAULT_SNAPSHOT_TOOLS = new Set(["edit", "write", "bash"])

export interface ToolExecutor {
  execute(input: ToolExecutionRequest): Promise<ToolResult>
}

export interface ToolMetadataEvent {
  toolCallID: string
  title?: string
  metadata?: Record<string, unknown>
}

export interface CreateSessionToolExecutorEvents {
  onMetadata?: (input: ToolMetadataEvent) => void | Promise<void>
}

export interface CreateToolExecutorInput {
  registry: ToolRegistry
  permission: PermissionRuntime
  ruleset: PermissionRuleset
  cwd: string
  workspace: string
  allowedExternalPaths?: string[]
  abortSignal?: AbortSignal
  onMetadata?: (input: ToolMetadataEvent) => void | Promise<void>
  snapshot?: {
    sessionID: string
    store: SessionStore
    service: SnapshotService
    tools?: string[]
  }
}

export type CreateSessionToolExecutorInput = Omit<
  CreateToolExecutorInput,
  "cwd" | "workspace" | "allowedExternalPaths" | "snapshot"
> & {
  snapshot?: Omit<NonNullable<CreateToolExecutorInput["snapshot"]>, "sessionID">
}

export function createToolExecutor(input: CreateToolExecutorInput): ToolExecutor {
  return {
    execute: async (request) => {
      const tool = input.registry.get(request.toolName)

      await input.permission.ask({
        permission: request.toolName,
        patterns: ["*"],
        metadata: {
          toolCallID: request.toolCallID,
          input: request.input,
        },
        ruleset: input.ruleset,
      })

      const before = await captureSnapshotIfNeeded(input, request.toolName)
      const result = await tool.execute(request.input, {
        cwd: input.cwd,
        workspace: input.workspace,
        allowedExternalPaths: input.allowedExternalPaths ?? [],
        abortSignal: input.abortSignal ?? new AbortController().signal,
        metadata: (metadata) =>
          input.onMetadata?.({
            toolCallID: request.toolCallID,
            ...metadata,
          }) ?? Promise.resolve(),
        ask: (permissionRequest) =>
          input.permission.ask({
            ...permissionRequest,
            ruleset: input.ruleset,
          }),
      })
      await appendSnapshotIfChanged(input, request, before)
      return result
    },
  }
}

export function createSessionToolExecutor(input: CreateSessionToolExecutorInput) {
  return (session: HarnessSession, events?: CreateSessionToolExecutorEvents) =>
    createToolExecutor({
      ...input,
      cwd: session.cwd,
      workspace: session.workspace,
      allowedExternalPaths: session.allowedExternalPaths,
      snapshot: input.snapshot
        ? {
            ...input.snapshot,
            sessionID: session.id,
          }
        : undefined,
      onMetadata: async (metadata) => {
        await input.onMetadata?.(metadata)
        await events?.onMetadata?.(metadata)
      },
    })
}

async function captureSnapshotIfNeeded(input: CreateToolExecutorInput, toolName: string) {
  if (!input.snapshot) return
  if (!snapshotTools(input).has(toolName)) return
  return input.snapshot.service.track({
    workspace: input.workspace,
  })
}

async function appendSnapshotIfChanged(
  input: CreateToolExecutorInput,
  request: ToolExecutionRequest,
  before: string | undefined,
) {
  if (!input.snapshot || !before) return

  const after = await input.snapshot.service.track({
    workspace: input.workspace,
  })
  if (!after || before === after) return

  const diffs = await input.snapshot.service.diffFull({
    workspace: input.workspace,
    from: before,
    to: after,
  })
  if (diffs.length === 0) return

  const snapshot = await input.snapshot.store.appendSnapshot(
    {
      sessionID: input.snapshot.sessionID,
      cwd: input.cwd,
      messageID: request.messageID,
      partID: request.partID,
      toolCallID: request.toolCallID,
      fromHash: before,
      toHash: after,
      diffs,
      diff: diffs.map((item) => item.patch).join("\n\n"),
    },
  )

  await input.snapshot.store.update(input.snapshot.sessionID, {
    summary: {
      text: `Changed ${snapshot.diffs.length} file(s).`,
      additions: snapshot.diffs.reduce((sum, item) => sum + item.additions, 0),
      deletions: snapshot.diffs.reduce((sum, item) => sum + item.deletions, 0),
      files: snapshot.diffs.length,
    },
    revert: {
      messageID: request.messageID ?? "",
      partID: request.partID,
      snapshotID: snapshot.id,
      diff: snapshot.diff,
    },
  })
}

function snapshotTools(input: CreateToolExecutorInput) {
  return input.snapshot?.tools ? new Set(input.snapshot.tools) : DEFAULT_SNAPSHOT_TOOLS
}
