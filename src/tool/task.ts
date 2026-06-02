import type { Tool } from "ai"
import { z } from "zod"
import type { AgentInfo, AgentRegistry } from "../agent"
import {
  createUserMessage,
  runHarnessLoop,
  type HarnessSession,
  type SessionStore,
} from "../harness"
import type { ModelInfo, ProviderRuntime } from "../provider"
import type { PermissionRuleset } from "../permission"
import type { CreateSessionToolExecutorEvents, ToolExecutor } from "./executor"
import type { ToolDef, ToolResult } from "./schema"

export interface TaskToolInput {
  description: string
  prompt: string
  subagent_type: string
  task_id?: string
}

export interface CreateTaskToolInput {
  store: SessionStore
  provider: ProviderRuntime
  model: ModelInfo
  agentRegistry: AgentRegistry
  tools: Record<string, Tool>
  createToolExecutor(input: {
    ruleset: PermissionRuleset
  }): (session: HarnessSession, events?: CreateSessionToolExecutorEvents) => ToolExecutor
  maxIterations?: number
  retries?: number
}

export function createTaskTool(input: CreateTaskToolInput): ToolDef<TaskToolInput> {
  return {
    id: "task",
    description: taskDescription(input.agentRegistry),
    inputSchema: z.object({
      description: z.string().describe("A short 3-5 word description of the task."),
      prompt: z.string().describe("The full task for the subagent to perform."),
      subagent_type: z.string().describe("The specialized subagent type to use."),
      task_id: z.string().optional().describe("Existing child session ID to resume, if continuing a previous task."),
    }),
    permissionPatterns: (params) => [params.subagent_type],
    execute: async (params, ctx) => {
      if (!ctx.sessionID) throw new Error("task tool requires a sessionID")

      const agent = input.agentRegistry.get(params.subagent_type)
      assertCallableSubagent(agent)

      await ctx.ask({
        permission: "task",
        patterns: [agent.name],
        metadata: {
          description: params.description,
          subagent_type: agent.name,
          task_id: params.task_id,
        },
      })

      const parent = await input.store.get(ctx.sessionID)
      if (!parent) throw new Error(`Parent session not found: ${ctx.sessionID}`)

      const child = await getOrCreateChildSession({
        store: input.store,
        parent,
        taskID: params.task_id,
        title: `${params.description} (@${agent.name} subagent)`,
        permission: childSessionPermission(agent),
      })
      const model = agent.model ? input.provider.getModel(agent.model.providerID, agent.model.modelID) : input.model

      await ctx.metadata({
        title: params.description,
        metadata: {
          sessionID: child.id,
          subagent: agent.name,
          model: `${model.providerID}/${model.id}`,
        },
      })

      await input.store.appendMessage(child.id, createUserMessage(params.prompt))

      const result = await runHarnessLoop({
        sessionID: child.id,
        store: input.store,
        provider: input.provider,
        model,
        agent,
        tools: childTools(input.tools, agent),
        createToolExecutor: input.createToolExecutor({
          ruleset: [...agent.permission, ...(child.permission ?? [])],
        }),
        maxIterations: agent.steps ?? input.maxIterations,
        retries: input.retries,
        abortSignal: ctx.abortSignal,
      })

      return formatTaskResult({
        description: params.description,
        child,
        agent,
        model,
        text: result.result.text,
      })
    },
  }
}

function taskDescription(agentRegistry: AgentRegistry) {
  const agents = callableSubagents(agentRegistry)
  const descriptions = agents
    .map((agent) => `- ${agent.name}: ${agent.description ?? "Specialized subagent."}`)
    .join("\n")

  return [
    "Launch a specialized subagent to handle a complex or multi-step task autonomously.",
    "",
    "Available subagents:",
    descriptions || "- none",
    "",
    "Each invocation starts a fresh child session unless task_id is provided to resume an existing child session.",
    "Pass a detailed prompt with all context the subagent needs; the subagent does not automatically inherit the parent conversation.",
  ].join("\n")
}

function callableSubagents(agentRegistry: AgentRegistry) {
  return agentRegistry
    .list()
    .filter((agent) => !agent.hidden && (agent.mode === "subagent" || agent.mode === "all"))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function assertCallableSubagent(agent: AgentInfo) {
  if (agent.hidden) throw new Error(`Agent is hidden and cannot be called as a task: ${agent.name}`)
  if (agent.mode !== "subagent" && agent.mode !== "all") {
    throw new Error(`Agent is not callable as a subagent: ${agent.name}`)
  }
}

async function getOrCreateChildSession(input: {
  store: SessionStore
  parent: HarnessSession
  taskID?: string
  title: string
  permission: PermissionRuleset
}) {
  if (input.taskID) {
    const existing = await input.store.get(input.taskID)
    if (existing) return existing
  }

  return input.store.create({
    parentID: input.parent.id,
    title: input.title,
    cwd: input.parent.cwd,
    workspace: input.parent.workspace,
    directory: input.parent.directory,
    projectID: input.parent.projectID,
    workspaceID: input.parent.workspaceID,
    allowedExternalPaths: input.parent.allowedExternalPaths,
    permission: input.permission,
  })
}

function childSessionPermission(agent: AgentInfo): PermissionRuleset {
  if (canCallTask(agent)) return []

  return [
    {
      permission: "task",
      pattern: "*",
      action: "deny",
    },
  ]
}

function childTools(tools: Record<string, Tool>, agent: AgentInfo) {
  if (canCallTask(agent)) return tools

  const next = { ...tools }
  delete next.task
  return next
}

function canCallTask(agent: AgentInfo) {
  return agent.permission.some((rule) => rule.permission === "task" && rule.action === "allow")
}

function formatTaskResult(input: {
  description: string
  child: HarnessSession
  agent: AgentInfo
  model: ModelInfo
  text: string
}): ToolResult {
  return {
    title: input.description,
    metadata: {
      sessionID: input.child.id,
      subagent: input.agent.name,
      model: `${input.model.providerID}/${input.model.id}`,
    },
    output: [`task_id: ${input.child.id}`, "", "<task_result>", input.text.trim(), "</task_result>"].join("\n"),
  }
}
