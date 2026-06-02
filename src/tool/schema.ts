import type { PermissionRequest } from "../permission"
import type { z } from "zod"

export interface ToolContext {
  sessionID?: string
  runID?: string
  toolCallID?: string
  messageID?: string
  partID?: string
  cwd: string
  workspace: string
  allowedExternalPaths: string[]
  abortSignal: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): Promise<void>
  ask(input: Omit<PermissionRequest, "permission"> & { permission: string }): Promise<void>
}

export interface ToolResult {
  title?: string
  output: string
  metadata?: Record<string, unknown>
}

export interface ToolDef<Input = unknown> {
  id: string
  description: string
  inputSchema: z.ZodType<Input>
  permissionPatterns?(input: Input): string[]
  execute(input: Input, context: ToolContext): Promise<ToolResult>
}

export interface ToolExecutionRequest {
  toolCallID: string
  messageID?: string
  partID?: string
  toolName: string
  input: unknown
}

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`)
    this.name = "ToolNotFoundError"
  }
}
