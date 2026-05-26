import {
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createInvalidTool,
  createReadTool,
  createWriteTool,
} from "./builtin"
import { createPocEvaluateTool } from "./poc-evaluate"
import { createToolRegistry, type ToolRegistry } from "./registry"
import type { ToolDef } from "./schema"
import { createSkillTool } from "./skill"
import {
  createDependencyUpdateCheckTool,
  createVulnerabilityLookupTool,
} from "./ssc"

export interface CreateBuiltinToolRegistryInput {
  tools?: ToolDef[]
}

export function createBuiltinTools(extra: ToolDef[] = []): ToolDef[] {
  return [
    createInvalidTool(),
    createBashTool(),
    createReadTool(),
    createGlobTool(),
    createGrepTool(),
    createEditTool(),
    createWriteTool(),
    createSkillTool(),
    createDependencyUpdateCheckTool(),
    createVulnerabilityLookupTool(),
    createPocEvaluateTool(),
    ...extra,
  ]
}

export function createBuiltinToolRegistry(input: CreateBuiltinToolRegistryInput = {}): ToolRegistry {
  return createToolRegistry({
    tools: createBuiltinTools(input.tools),
  })
}
