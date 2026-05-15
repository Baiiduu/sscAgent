import { z } from "zod"

export const ProviderKind = z.enum(["openai", "anthropic", "openai-compatible"])
export type ProviderKind = z.infer<typeof ProviderKind>

export const ProviderID = z.string().min(1)
export type ProviderID = z.infer<typeof ProviderID>

export const ModelID = z.string().min(1)
export type ModelID = z.infer<typeof ModelID>

export const AuthInfo = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api"),
    key: z.string().min(1),
  }),
  z.object({
    type: z.literal("oauth"),
    access: z.string().min(1),
    refresh: z.string().optional(),
    expires: z.number().optional(),
  }),
])
export type AuthInfo = z.infer<typeof AuthInfo>

export const ModelCost = z.object({
  input: z.number().default(0),
  output: z.number().default(0),
  cache: z
    .object({
      read: z.number().default(0),
      write: z.number().default(0),
    })
    .default({ read: 0, write: 0 }),
})
export type ModelCost = z.infer<typeof ModelCost>

export const ModelLimit = z.object({
  context: z.number().positive(),
  input: z.number().positive().optional(),
  output: z.number().positive(),
})
export type ModelLimit = z.infer<typeof ModelLimit>

export const ModelCapabilities = z.object({
  attachment: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  temperature: z.boolean().default(true),
  toolcall: z.boolean().default(true),
  input: z
    .object({
      text: z.boolean().default(true),
      audio: z.boolean().default(false),
      image: z.boolean().default(false),
      video: z.boolean().default(false),
      pdf: z.boolean().default(false),
    })
    .default({
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    }),
  output: z
    .object({
      text: z.boolean().default(true),
      audio: z.boolean().default(false),
      image: z.boolean().default(false),
      video: z.boolean().default(false),
      pdf: z.boolean().default(false),
    })
    .default({
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    }),
  interleaved: z
    .union([
      z.literal(false),
      z.literal(true),
      z.object({
        field: z.enum(["reasoning_content", "reasoning_details"]),
      }),
    ])
    .default(false),
})
export type ModelCapabilities = z.infer<typeof ModelCapabilities>

export const defaultModelCapabilities = {
  attachment: false,
  reasoning: false,
  temperature: true,
  toolcall: true,
  input: {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
  },
  output: {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
  },
  interleaved: false,
} satisfies ModelCapabilities

export const ProviderOptions = z
  .object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    includeUsage: z.boolean().optional(),
    timeout: z.union([z.number().positive(), z.literal(false)]).optional(),
    chunkTimeout: z.number().positive().optional(),
  })
  .catchall(z.unknown())
export type ProviderOptions = z.infer<typeof ProviderOptions>

export const ModelInfo = z.object({
  id: ModelID,
  providerID: ProviderID,
  name: z.string(),
  family: z.string().optional(),
  api: z.object({
    id: z.string(),
    npm: z.string(),
    url: z.string().optional(),
  }),
  status: z.enum(["active", "alpha", "beta", "deprecated"]).default("active"),
  headers: z.record(z.string(), z.string()).default({}),
  options: z.record(z.string(), z.unknown()).default({}),
  cost: ModelCost.default({ input: 0, output: 0, cache: { read: 0, write: 0 } }),
  limit: ModelLimit,
  capabilities: ModelCapabilities.default(defaultModelCapabilities),
  releaseDate: z.string().optional(),
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
})
export type ModelInfo = z.infer<typeof ModelInfo>

export const ModelConfig = ModelInfo.partial()
export type ModelConfig = z.infer<typeof ModelConfig>

export const ProviderInfo = z.object({
  id: ProviderID,
  kind: ProviderKind,
  name: z.string(),
  env: z.array(z.string()).default([]),
  npm: z.string(),
  api: z.string().optional(),
  options: ProviderOptions.default({}),
  models: z.record(z.string(), ModelInfo),
})
export type ProviderInfo = z.infer<typeof ProviderInfo>

export const ProviderConfig = z.object({
  id: ProviderID.optional(),
  kind: ProviderKind.optional(),
  name: z.string().optional(),
  env: z.array(z.string()).optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  options: ProviderOptions.optional(),
  models: z.record(z.string(), ModelConfig).optional(),
})
export type ProviderConfig = z.infer<typeof ProviderConfig>

export const ModelRef = z.object({
  providerID: ProviderID,
  modelID: ModelID,
})
export type ModelRef = z.infer<typeof ModelRef>
