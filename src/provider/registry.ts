import { ModelConfig, ModelID, ModelInfo, ModelRef, ProviderConfig, ProviderID, ProviderInfo, ProviderKind } from "./schema"

export class ProviderNotFoundError extends Error {
  constructor(providerID: ProviderID) {
    super(`Provider not found: ${providerID}`)
    this.name = "ProviderNotFoundError"
  }
}

export class ModelNotFoundError extends Error {
  constructor(providerID: ProviderID, modelID: ModelID) {
    super(`Model not found: ${providerID}/${modelID}`)
    this.name = "ModelNotFoundError"
  }
}

export interface ProviderRegistry {
  list(): ProviderInfo[]
  getProvider(providerID: ProviderID): ProviderInfo
  getModel(providerID: ProviderID, modelID: ModelID): ModelInfo
  defaultModel(): ModelRef
}

export interface CreateProviderRegistryInput {
  providers?: Record<string, ProviderConfig>
  defaultModel?: ModelRef
}

export function createProviderRegistry(input: CreateProviderRegistryInput = {}): ProviderRegistry {
  const providers = mergeProviders(builtinProviders(), input.providers ?? {})
  const fallback = input.defaultModel ?? {
    providerID: "openai",
    modelID: "gpt-4.1",
  }

  return {
    list: () => Object.values(providers),
    getProvider: (providerID) => {
      const provider = providers[providerID]
      if (!provider) throw new ProviderNotFoundError(providerID)
      return provider
    },
    getModel: (providerID, modelID) => {
      const provider = providers[providerID]
      if (!provider) throw new ProviderNotFoundError(providerID)
      const model = provider.models[modelID]
      if (!model) throw new ModelNotFoundError(providerID, modelID)
      return model
    },
    defaultModel: () => {
      const provider = providers[fallback.providerID]
      if (!provider) throw new ProviderNotFoundError(fallback.providerID)
      if (!provider.models[fallback.modelID]) throw new ModelNotFoundError(fallback.providerID, fallback.modelID)
      return fallback
    },
  }
}

function mergeProviders(base: Record<string, ProviderInfo>, configs: Record<string, ProviderConfig>) {
  return Object.fromEntries(
    Object.entries(configs).reduce(
      (entries, [key, config]) => {
        const id = config.id ?? key
        const existing = base[id]
        entries.push([
          id,
          ProviderInfo.parse({
            id,
            kind: config.kind ?? existing?.kind ?? inferKind(id),
            name: config.name ?? existing?.name ?? id,
            env: config.env ?? existing?.env ?? [],
            npm: config.npm ?? existing?.npm ?? npmForKind(config.kind ?? existing?.kind ?? inferKind(id)),
            api: config.api ?? existing?.api,
            options: {
              ...(existing?.options ?? {}),
              ...(config.options ?? {}),
            },
            models: mergeModels(id, existing, config),
          }),
        ])
        return entries
      },
      Object.entries(base),
    ),
  )
}

function mergeModels(providerID: ProviderID, existing: ProviderInfo | undefined, config: ProviderConfig) {
  return Object.fromEntries(
    (Object.entries(config.models ?? {}) as [string, ModelConfig][]).reduce(
      (entries, [modelID, model]) => {
        const base = existing?.models[modelID]
        entries.push([
          modelID,
          ModelInfo.parse({
            ...base,
            ...model,
            id: model.id ?? base?.id ?? modelID,
            providerID,
            name: model.name ?? base?.name ?? modelID,
            api: {
              id: model.api?.id ?? base?.api.id ?? modelID,
              npm: model.api?.npm ?? base?.api.npm ?? npmForKind(config.kind ?? existing?.kind ?? inferKind(providerID)),
              url: model.api?.url ?? base?.api.url,
            },
            headers: {
              ...(base?.headers ?? {}),
              ...(model.headers ?? {}),
            },
            options: {
              ...(base?.options ?? {}),
              ...(model.options ?? {}),
            },
            limit: model.limit ?? base?.limit ?? defaultLimit(),
            capabilities: {
              ...(base?.capabilities ?? {}),
              ...(model.capabilities ?? {}),
            },
            variants: {
              ...(base?.variants ?? {}),
              ...(model.variants ?? {}),
            },
          }),
        ])
        return entries
      },
      Object.entries(existing?.models ?? {}),
    ),
  )
}

function builtinProviders() {
  return {
    openai: provider({
      id: "openai",
      kind: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      npm: "@ai-sdk/openai",
      models: [
        model("openai", "gpt-4.1", "GPT-4.1", {
          context: 1_047_576,
          output: 32_768,
        }),
        model("openai", "gpt-4.1-mini", "GPT-4.1 Mini", {
          context: 1_047_576,
          output: 32_768,
        }),
        model("openai", "gpt-5", "GPT-5", {
          context: 400_000,
          output: 128_000,
        }),
        model("openai", "gpt-5-mini", "GPT-5 Mini", {
          context: 400_000,
          output: 128_000,
        }),
      ],
    }),
    anthropic: provider({
      id: "anthropic",
      kind: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      npm: "@ai-sdk/anthropic",
      models: [
        model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", {
          context: 200_000,
          output: 64_000,
        }),
        model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", {
          context: 200_000,
          output: 64_000,
        }),
      ],
    }),
    deepseek: provider({
      id: "deepseek",
      kind: "openai-compatible",
      name: "DeepSeek",
      env: ["DEEPSEEK_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: "https://api.deepseek.com",
      },
      models: [
        model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", {
          context: 1_000_000,
          output: 384_000,
        }),
        model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", {
          context: 1_000_000,
          output: 384_000,
        }),
      ],
    }),
  }
}

function provider(input: {
  id: ProviderID
  kind: ProviderKind
  name: string
  env: string[]
  npm: string
  options?: ProviderInfo["options"]
  models: ModelInfo[]
}) {
  return ProviderInfo.parse({
    ...input,
    models: Object.fromEntries(input.models.map((item) => [item.id, item])),
  })
}

function model(providerID: ProviderID, id: ModelID, name: string, limit = defaultLimit()) {
  return ModelInfo.parse({
    id,
    providerID,
    name,
    api: {
      id,
      npm: npmForKind(inferKind(providerID)),
    },
    limit,
  })
}

function inferKind(providerID: ProviderID): ProviderKind {
  if (providerID === "openai") return "openai"
  if (providerID === "anthropic") return "anthropic"
  return "openai-compatible"
}

function npmForKind(kind: ProviderKind) {
  if (kind === "openai") return "@ai-sdk/openai"
  if (kind === "anthropic") return "@ai-sdk/anthropic"
  return "@ai-sdk/openai-compatible"
}

function defaultLimit() {
  return {
    context: 128_000,
    output: 32_000,
  }
}
