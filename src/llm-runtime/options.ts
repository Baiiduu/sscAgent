import type { ModelInfo } from "../provider"
import type { AgentProfile } from "./schema"

export const OUTPUT_TOKEN_MAX = 32_000

export interface ResolveGenerationOptionsInput {
  agent: AgentProfile
  model: ModelInfo
}

export function resolveGenerationOptions(input: ResolveGenerationOptionsInput) {
  return {
    temperature: input.model.capabilities.temperature ? input.agent.temperature : undefined,
    topP: input.agent.topP,
    maxOutputTokens: Math.min(
      input.agent.maxOutputTokens ?? input.model.limit.output ?? OUTPUT_TOKEN_MAX,
      input.model.limit.output ?? OUTPUT_TOKEN_MAX,
      OUTPUT_TOKEN_MAX,
    ),
    providerOptions: input.agent.options,
  }
}

