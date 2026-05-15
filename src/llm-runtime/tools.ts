import type { Tool } from "ai"
import type { UserContext } from "./schema"

export interface ResolveToolsInput {
  tools?: Record<string, Tool>
  user?: UserContext
}

export function resolveTools(input: ResolveToolsInput) {
  return Object.fromEntries(
    Object.entries(input.tools ?? {}).filter(([id]) => input.user?.tools?.[id] !== false),
  )
}

