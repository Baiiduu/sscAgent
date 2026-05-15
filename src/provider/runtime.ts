import type { LanguageModelV3 } from "@ai-sdk/provider"
import { type AuthEnvironment, type AuthStore } from "./auth"
import { createProviderRegistry, type CreateProviderRegistryInput, type ProviderRegistry } from "./registry"
import { loadLanguageModel } from "./sdk-loader"
import { ModelID, ModelInfo, ModelRef, ProviderConfig, ProviderID, ProviderInfo } from "./schema"

export interface ProviderRuntime {
  list(): ProviderInfo[]
  getProvider(providerID: ProviderID): ProviderInfo
  getModel(providerID: ProviderID, modelID: ModelID): ModelInfo
  defaultModel(): ModelRef
  getLanguage(model: ModelInfo): Promise<LanguageModelV3>
}

export interface CreateProviderRuntimeInput extends CreateProviderRegistryInput {
  store?: AuthStore
  env?: AuthEnvironment
}

export function createProviderRuntime(input: CreateProviderRuntimeInput = {}): ProviderRuntime {
  const registry = createProviderRegistry(input)
  const configs = input.providers ?? {}
  const languages = new Map<string, Promise<LanguageModelV3>>()

  return {
    list: () => registry.list(),
    getProvider: (providerID) => registry.getProvider(providerID),
    getModel: (providerID, modelID) => registry.getModel(providerID, modelID),
    defaultModel: () => registry.defaultModel(),
    getLanguage: (model) => {
      const key = `${model.providerID}/${model.id}`
      const existing = languages.get(key)
      if (existing) return existing

      const provider = registry.getProvider(model.providerID)
      const next = loadLanguageModel({
        provider,
        model,
        config: configForProvider(configs, provider.id),
        store: input.store,
        env: input.env,
      })
      languages.set(key, next)
      return next
    },
  }
}

export function createProviderRuntimeFromRegistry(input: {
  registry: ProviderRegistry
  configs?: Record<string, ProviderConfig>
  store?: AuthStore
  env?: AuthEnvironment
}): ProviderRuntime {
  const languages = new Map<string, Promise<LanguageModelV3>>()

  return {
    list: () => input.registry.list(),
    getProvider: (providerID) => input.registry.getProvider(providerID),
    getModel: (providerID, modelID) => input.registry.getModel(providerID, modelID),
    defaultModel: () => input.registry.defaultModel(),
    getLanguage: (model) => {
      const key = `${model.providerID}/${model.id}`
      const existing = languages.get(key)
      if (existing) return existing

      const provider = input.registry.getProvider(model.providerID)
      const next = loadLanguageModel({
        provider,
        model,
        config: configForProvider(input.configs ?? {}, provider.id),
        store: input.store,
        env: input.env,
      })
      languages.set(key, next)
      return next
    },
  }
}

function configForProvider(configs: Record<string, ProviderConfig>, providerID: ProviderID) {
  return Object.entries(configs).find(([key, config]) => (config.id ?? key) === providerID)?.[1]
}

