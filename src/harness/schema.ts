import type { LanguageModelUsage, ModelMessage, Tool } from "ai"
import type { AgentProfile } from "../llm-runtime"
import type { ModelInfo, ProviderRuntime } from "../provider"

export type HarnessFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "unknown"

export type HarnessEvent =
  | {
      type: "start"
    }
  | {
      type: "text-delta"
      text: string
    }
  | {
      type: "reasoning-delta"
      text: string
    }
  | {
      type: "tool-call"
      toolCallID: string
      toolName: string
      input: unknown
    }
  | {
      type: "tool-metadata"
      toolCallID: string
      title?: string
      metadata?: Record<string, unknown>
    }
  | {
      type: "tool-result"
      toolCallID: string
      toolName: string
      output: string
      metadata?: Record<string, unknown>
    }
  | {
      type: "tool-error"
      toolCallID: string
      toolName: string
      error: string
    }
  | {
      type: "compaction"
      summary: string
      compactedMessages: number
      preservedMessages: number
    }
  | {
      type: "finish"
      reason: HarnessFinishReason
      usage?: LanguageModelUsage
    }
  | {
      type: "error"
      error: unknown
    }

export interface HarnessRunInput {
  provider: ProviderRuntime
  model: ModelInfo
  agent: AgentProfile
  messages: ModelMessage[]
  system?: string[]
  tools?: Record<string, Tool>
  toolChoice?: "auto" | "required" | "none"
  retries?: number
  abortSignal?: AbortSignal
  onEvent?: (event: HarnessEvent) => void | Promise<void>
}

export interface HarnessResult {
  text: string
  finishReason: HarnessFinishReason
  usage?: LanguageModelUsage
}

export type HarnessStatus = "idle" | "busy"
