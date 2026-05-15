import type { ModelMessage, Tool } from "ai"
import type { SharedV3ProviderOptions } from "@ai-sdk/provider"
import type { ModelInfo, ProviderRuntime } from "../provider"

export type ToolChoice = "auto" | "required" | "none"

export interface AgentProfile {
  name: string
  prompt?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: SharedV3ProviderOptions
}

export interface UserContext {
  id?: string
  system?: string
  tools?: Record<string, boolean>
  model?: {
    variant?: string
  }
}

export interface LLMRuntimeInput {
  provider: ProviderRuntime
  model: ModelInfo
  agent: AgentProfile
  messages: ModelMessage[]
  user?: UserContext
  system?: string[]
  tools?: Record<string, Tool>
  toolChoice?: ToolChoice
  retries?: number
  abortSignal?: AbortSignal
}

export interface LLMGenerateInput extends Omit<LLMRuntimeInput, "messages"> {
  prompt: string
}
