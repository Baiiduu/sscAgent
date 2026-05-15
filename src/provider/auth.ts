import { AuthInfo, ProviderConfig, ProviderInfo, ProviderID } from "./schema"

export interface AuthStore {
  get(providerID: ProviderID): Promise<AuthInfo | undefined>
  all(): Promise<Record<string, AuthInfo>>
  set(providerID: ProviderID, info: AuthInfo): Promise<void>
  remove(providerID: ProviderID): Promise<void>
}

export interface AuthEnvironment {
  get(key: string): string | undefined
  all(): Record<string, string | undefined>
}

export interface ResolveAuthInput {
  provider: ProviderInfo
  config?: ProviderConfig
  store?: AuthStore
  env?: AuthEnvironment
}

export class MemoryAuthStore implements AuthStore {
  private readonly data = new Map<string, AuthInfo>()

  async get(providerID: ProviderID) {
    return this.data.get(normalizeProviderID(providerID))
  }

  async all() {
    return Object.fromEntries(this.data)
  }

  async set(providerID: ProviderID, info: AuthInfo) {
    this.data.set(normalizeProviderID(providerID), info)
  }

  async remove(providerID: ProviderID) {
    this.data.delete(normalizeProviderID(providerID))
  }
}

export function createEnvironment(env: Record<string, string | undefined>): AuthEnvironment {
  return {
    get: (key) => env[key],
    all: () => ({ ...env }),
  }
}

export async function resolveAuth(input: ResolveAuthInput): Promise<AuthInfo | undefined> {
  if (input.config?.options?.apiKey) {
    return {
      type: "api",
      key: input.config.options.apiKey,
    }
  }

  const envKey = input.provider.env.map((key) => input.env?.get(key)).find((value): value is string => Boolean(value))
  if (envKey) {
    return {
      type: "api",
      key: envKey,
    }
  }

  return input.store?.get(input.provider.id)
}

export function authToken(info: AuthInfo | undefined) {
  if (!info) return undefined
  if (info.type === "api") return info.key
  return info.access
}

export function normalizeProviderID(providerID: ProviderID) {
  return providerID.replace(/\/+$/, "")
}
