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
import { createFindingCaptureTool } from "./finding-capture"
import { createToolRegistry, type ToolRegistry } from "./registry"
import type { ToolDef } from "./schema"
import { createSkillTool } from "./skill"
import { createTaskTool, type CreateTaskToolInput } from "./task"
import {
  createDependencyUpdateCheckTool,
  createVulnerabilityLookupTool,
} from "./ssc"

export interface CreateBuiltinToolRegistryInput {
  tools?: ToolDef[]
  task?: CreateTaskToolInput
}

export function createBuiltinTools(input: CreateBuiltinToolRegistryInput = {}): ToolDef[] {
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
    createFindingCaptureTool(),
    ...(input.task ? [createTaskTool(input.task)] : []),
    ...(input.tools ?? []),
  ]
}

export function createBuiltinToolRegistry(input: CreateBuiltinToolRegistryInput = {}): ToolRegistry {
  return createToolRegistry({
    tools: createBuiltinTools(input),
  })
}
