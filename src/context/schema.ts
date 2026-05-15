import type { HarnessMessage } from "../harness"
import type { ModelInfo } from "../provider"

export interface ContextBudget {
  context: number
  input?: number
  output: number
  reserved: number
  usable: number
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export interface OverflowInput {
  model: ModelInfo
  usage: TokenUsage
  auto?: boolean
  reserved?: number
}

export interface CompactionInput {
  messages: HarnessMessage[]
  model: ModelInfo
  previousSummary?: string
  preserveRecentTokens?: number
  tailTurns?: number
}

export interface CompactionResult {
  summary: string
  compacted: HarnessMessage[]
  preserved: HarnessMessage[]
  prompt: string
}
