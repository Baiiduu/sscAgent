import { ToolNotFoundError, type ToolDef } from "./schema"

export interface ToolRegistry {
  list(): ToolDef[]
  get(toolName: string): ToolDef
  has(toolName: string): boolean
}

export interface CreateToolRegistryInput {
  tools?: ToolDef[]
}

export function createToolRegistry(input: CreateToolRegistryInput = {}): ToolRegistry {
  const tools = new Map(input.tools?.map((tool) => [tool.id, tool]) ?? [])

  return {
    list: () => [...tools.values()],
    get: (toolName) => {
      const tool = tools.get(toolName)
      if (!tool) throw new ToolNotFoundError(toolName)
      return tool
    },
    has: (toolName) => tools.has(toolName),
  }
}

