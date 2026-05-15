import { tool, zodSchema, type Tool } from "ai"
import type { ToolRegistry } from "./registry"

export interface CreateAIToolsInput {
  registry: ToolRegistry
  enabled?: Record<string, boolean>
}

export function createAITools(input: CreateAIToolsInput): Record<string, Tool> {
  return Object.fromEntries(
    input.registry
      .list()
      .filter((item) => input.enabled?.[item.id] !== false)
      .map((item) => [
        item.id,
        tool({
          description: item.description,
          inputSchema: zodSchema(item.inputSchema),
          strict: true,
        }),
      ]),
  )
}
