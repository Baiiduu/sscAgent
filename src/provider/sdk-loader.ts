import type { LanguageModelV3 } from "@ai-sdk/provider"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { authToken, resolveAuth, type AuthEnvironment, type AuthStore } from "./auth"
import { ModelInfo, ProviderConfig, ProviderInfo } from "./schema"

export interface LoadLanguageModelInput {
  provider: ProviderInfo
  model: ModelInfo
  config?: ProviderConfig
  store?: AuthStore
  env?: AuthEnvironment
}

export class MissingProviderAuthError extends Error {
  constructor(provider: ProviderInfo) {
    super(`Missing API key for provider: ${provider.id}`)
    this.name = "MissingProviderAuthError"
  }
}

export class MissingProviderBaseURLError extends Error {
  constructor(provider: ProviderInfo) {
    super(`Missing baseURL for OpenAI-compatible provider: ${provider.id}`)
    this.name = "MissingProviderBaseURLError"
  }
}

export async function loadLanguageModel(input: LoadLanguageModelInput): Promise<LanguageModelV3> {
  const auth = await resolveAuth(input)
  const apiKey = authToken(auth)
  if (!apiKey) throw new MissingProviderAuthError(input.provider)

  const options = {
    name: input.provider.id,
    ...input.provider.options,
    ...input.model.options,
    apiKey,
    headers: {
      ...input.provider.options.headers,
      ...input.model.headers,
    },
  }

  if (input.provider.kind === "openai") {
    return createOpenAI(options).languageModel(input.model.api.id)
  }

  if (input.provider.kind === "anthropic") {
    return createAnthropic(options).languageModel(input.model.api.id)
  }

  if (!options.baseURL) throw new MissingProviderBaseURLError(input.provider)

  return createOpenAICompatible({
    ...options,
    baseURL: options.baseURL,
    includeUsage: input.provider.options.includeUsage !== false,
  }).languageModel(input.model.api.id)
}
