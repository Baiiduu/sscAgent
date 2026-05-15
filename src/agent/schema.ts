import type { SharedV3ProviderOptions } from "@ai-sdk/provider"
import type { ModelRef } from "../provider"
import type { PermissionRuleset } from "../permission"

export type AgentMode = "primary" | "subagent" | "all"

export interface AgentInfo {
  name: string
  description?: string
  mode: AgentMode
  prompt?: string
  permission: PermissionRuleset
  model?: ModelRef
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: SharedV3ProviderOptions
  steps?: number
  hidden?: boolean
  native?: boolean
}

export interface AgentConfig {
  name?: string
  description?: string
  mode?: AgentMode
  prompt?: string
  permission?: PermissionRuleset
  model?: ModelRef
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: SharedV3ProviderOptions
  steps?: number
  hidden?: boolean
  disable?: boolean
}

export class AgentNotFoundError extends Error {
  constructor(agentName: string) {
    super(`Agent not found: ${agentName}`)
    this.name = "AgentNotFoundError"
  }
}

