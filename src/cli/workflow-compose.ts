import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { Tool } from "ai"
import { createAgentRegistry } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { createAITools, createBuiltinToolRegistry, type ToolRegistry } from "../tool"

const REPO_CONTEXT_PROMPT = `You are the repo-context agent.

Your role is repository context construction and delegation.

You are the primary agent for a two-agent GitHub Actions workflow composition flow. First understand the user's request and the target repository context. Then call the task tool with subagent_type="workflow-composer" to generate the workflow.

Before delegating, build a concise RepoContext that covers:
- repository language, frameworks, package managers, and build systems
- important project structure and key files
- existing GitHub Actions workflows or CI configuration
- available test, build, lint, coverage, dependency, and security scan signals
- relevant secrets, permissions, or environment assumptions visible from the repository

When calling workflow-composer, include both the original user request and the RepoContext. After the subagent returns, summarize the final workflow and any usage notes for the user.`

const WORKFLOW_COMPOSER_PROMPT = `You are the workflow-composer agent.

Your role is GitHub Actions Marketplace and workflow composition.

You receive a user request plus RepoContext from the repo-context agent. Generate a practical GitHub Actions workflow that fits the repository.

Focus on:
- understanding the requested workflow capability
- choosing appropriate GitHub Actions components
- designing triggers, jobs, steps, permissions, caches, and secrets usage
- producing complete workflow YAML
- explaining required secrets, assumptions, and usage notes

Do not call other subagents. Return the workflow YAML and a concise explanation.`

export function createWorkflowAgentRegistry() {
  return createAgentRegistry({
    agents: {
      "repo-context": {
        name: "repo-context",
        description: "Build repository context and delegate workflow composition.",
        mode: "primary",
        prompt: REPO_CONTEXT_PROMPT,
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "task", pattern: "*", action: "deny" },
          { permission: "task", pattern: "workflow-composer", action: "allow" },
        ],
      },
      "workflow-composer": {
        name: "workflow-composer",
        description: "Compose GitHub Actions workflows from user requirements and repository context.",
        mode: "subagent",
        prompt: WORKFLOW_COMPOSER_PROMPT,
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "task", pattern: "*", action: "deny" },
        ],
      },
    },
    defaultAgent: "repo-context",
  })
}

async function main() {
  await loadLocalEnv()

  const options = parseArgs(process.argv.slice(2))
  const runtime = createAgentRuntime()
  const cwd = process.cwd()
  const session = await runtime.store.create({
    title: "Workflow composition",
    cwd,
    workspace: cwd,
    directory: cwd,
  })
  const agentRegistry = createWorkflowAgentRegistry()
  const agent = agentRegistry.defaultAgent()
  const provider = createConfiguredProviderRuntime()
  const modelRef = provider.defaultModel()
  const model = provider.getModel(modelRef.providerID, modelRef.modelID)
  const permission = createPermissionRuntime({
    onAsk: async () => "always",
  })

  let registry: ToolRegistry
  const toolsRef: Record<string, Tool> = {}
  registry = createBuiltinToolRegistry({
    task: {
      store: runtime.store,
      provider,
      model,
      agentRegistry,
      tools: toolsRef,
      createToolExecutor: ({ ruleset }) =>
        runtime.createToolExecutor({
          registry,
          permission,
          ruleset,
        }),
      maxIterations: Number(process.env.WORKFLOW_COMPOSE_MAX_ITERATIONS ?? "60"),
    },
  })
  Object.assign(toolsRef, createAITools({ registry }))

  await runtime.store.appendMessage(session.id, createUserMessage(createRepoContextRequest(options)))

  const result = await createAgentHarness().runSession({
    sessionID: session.id,
    store: runtime.store,
    provider,
    model,
    agent,
    tools: toolsRef,
    createToolExecutor: runtime.createToolExecutor({
      registry,
      permission,
      ruleset: agent.permission,
    }),
    maxIterations: Number(process.env.WORKFLOW_COMPOSE_MAX_ITERATIONS ?? "60"),
    onEvent: async (event) => {
      if (event.type === "tool-call") console.error(`[tool-call] ${event.toolName}`)
      if (event.type === "tool-result") console.error(`[tool-result] ${event.toolName}`)
      if (event.type === "tool-error") console.error(`[tool-error] ${event.toolName}: ${event.error}`)
    },
  })

  const output = result.result.text.trim()
  await writeResult(output, {
    sessionID: session.id,
    model: `${model.providerID}/${model.id}`,
  })
  console.log(output)
}

interface WorkflowComposeOptions {
  repoUrl: string
  request: string
}

function parseArgs(args: string[]): WorkflowComposeOptions {
  const repoUrl = process.env.REPO_URL?.trim()
  const requestFromEnv = process.env.REPO_CONTEXT_REQUEST?.trim()
  const requestFromArgs = args.join(" ").trim()
  const request = requestFromArgs || requestFromEnv

  if (!repoUrl) {
    throw new Error("REPO_URL is required")
  }
  if (!isRepositoryUrl(repoUrl)) {
    throw new Error(`Invalid repository URL: ${repoUrl}`)
  }
  if (!request) {
    throw new Error("REPO_CONTEXT_REQUEST or CLI request argument is required")
  }

  return {
    repoUrl,
    request,
  }
}

function createRepoContextRequest(options: WorkflowComposeOptions) {
  return [
    "Run the two-agent workflow composition flow for this repository.",
    "",
    `Repository URL: ${options.repoUrl}`,
    "",
    "User request for the repo-context agent:",
    options.request,
    "",
    "First clone or inspect the repository, then build RepoContext, then delegate to workflow-composer.",
  ].join("\n")
}

function isRepositoryUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "git:" || url.protocol === "ssh:"
  } catch {
    return false
  }
}

function createConfiguredProviderRuntime() {
  const env = createEnvironment(process.env)
  const providerID = process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-5.5")

  return createProviderRuntime({
    defaultModel: {
      providerID,
      modelID,
    },
    providers: process.env.DEEPSEEK_BASE_URL
      ? {
          deepseek: {
            options: {
              baseURL: process.env.DEEPSEEK_BASE_URL,
            },
          },
        }
      : undefined,
    env,
  })
}

async function writeResult(output: string, metadata: { sessionID: string; model: string }) {
  const dir = path.resolve(".agent-data/workflow-compose")
  await mkdir(dir, { recursive: true })
  await Bun.write(
    path.join(dir, "result.md"),
    [`# Workflow Compose Result`, "", `- Session: ${metadata.sessionID}`, `- Model: ${metadata.model}`, "", output].join(
      "\n",
    ),
  )

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  await Bun.write(
    summaryPath,
    [`## Workflow Compose`, "", `- Session: ${metadata.sessionID}`, `- Model: ${metadata.model}`, "", output].join(
      "\n",
    ),
  )
}

async function loadLocalEnv() {
  const envPath = path.resolve(import.meta.dir, "../../.env")
  const text = await readFile(envPath, "utf8").catch(() => "")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    process.env[key] ??= unquote(value)
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
