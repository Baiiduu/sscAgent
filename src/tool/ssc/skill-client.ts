export interface BackendClientInput {
  baseUrl?: string
}

export interface RequestJSONInput {
  method?: "GET" | "POST"
  path: string
  body?: unknown
}

export class BackendClient {
  readonly baseUrl: string

  constructor(input: BackendClientInput = {}) {
    this.baseUrl = normalizeBaseUrl(
      input.baseUrl ??
        process.env.SSC_BACKEND_URL ??
        process.env.SUPPLYCHAIN_BACKEND_URL ??
        process.env.BACKEND_URL ??
        "http://localhost:8000",
    )
  }

  async requestJSON(input: RequestJSONInput) {
    const response = await fetch(`${this.baseUrl}${input.path}`, {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"),
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const text = await response.text()
    const data = parseJSON(text)

    if (!response.ok) {
      const message = typeof data === "object" && data && "error" in data ? String(data.error) : text
      throw new Error(`Backend request failed (${response.status} ${response.statusText}): ${message}`)
    }

    return data
  }
}

export function createBackendClient(input: BackendClientInput = {}) {
  return new BackendClient(input)
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "")
}

function parseJSON(text: string) {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
