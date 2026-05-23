import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { builtinAgents } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { createAITools, createBuiltinToolRegistry } from "../tool"

interface AnalyzeRepoOptions {
  repoUrl: string
  providerID?: string
  modelID?: string
  maxIterations: number
}

interface RunEvent {
  type: string
  toolName?: string
  input?: unknown
  output?: string
  error?: string
}

async function main() {
  await loadLocalEnv()

  const options = parseArgs(process.argv.slice(2))
  const result = await analyzeRepo(options)

  console.log(JSON.stringify(result, null, 2))
  await writeGitHubSummary(result)

  if (result.status === "failed") {
    process.exitCode = 1
  }
}

async function analyzeRepo(options: AnalyzeRepoOptions) {
  const runtime = createAgentRuntime()
  const { session, workspace } = await runtime.createSession({
    title: `Supply-chain analysis: ${options.repoUrl}`,
  })
  const registry = createBuiltinToolRegistry()
  const tools = createAITools({ registry })
  const provider = createConfiguredProviderRuntime(options)
  const modelRef = provider.defaultModel()
  const model = provider.getModel(modelRef.providerID, modelRef.modelID)
  const agent = builtinAgents().build
  const events: RunEvent[] = []

  try {
    await runtime.store.appendMessage(session.id, createUserMessage(createAnalysisPrompt(options.repoUrl)))

    const permission = createPermissionRuntime({
      onAsk: async (request) => {
        events.push({
          type: "permission",
          toolName: request.permission,
          input: request.patterns,
        })
        return "always"
      },
    })

    const result = await createAgentHarness().runSession({
      sessionID: session.id,
      store: runtime.store,
      provider,
      model,
      agent,
      tools,
      createToolExecutor: runtime.createToolExecutor({
        registry,
        permission,
        ruleset: agent.permission,
      }),
      maxIterations: options.maxIterations,
      onEvent: async (event) => {
        if (event.type === "tool-call") {
          events.push({
            type: "tool-call",
            toolName: event.toolName,
            input: event.input,
          })
          console.error(`[tool-call] ${event.toolName}`)
        }
        if (event.type === "tool-result") {
          events.push({
            type: "tool-result",
            toolName: event.toolName,
            output: event.output.slice(0, 1_000),
          })
          console.error(`[tool-result] ${event.toolName}`)
        }
        if (event.type === "tool-error") {
          events.push({
            type: "tool-error",
            toolName: event.toolName,
            error: event.error,
          })
          console.error(`[tool-error] ${event.toolName}: ${event.error}`)
        }
        if (event.type === "text-delta") {
          process.stdout.write(event.text)
        }
      },
    })

    return {
      name: "analyze-repo",
      status: "passed" as const,
      repoUrl: options.repoUrl,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      result,
      events,
    }
  } catch (error) {
    return {
      name: "analyze-repo",
      status: "failed" as const,
      repoUrl: options.repoUrl,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      events,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }
  }
}

function createAnalysisPrompt(repoUrl: string) {
  return [
    "You are running a supply-chain security analysis for an open-source repository.",
    "",
    `Repository URL: ${repoUrl}`,
    "",
    "Follow this workflow:",
    "1. Load the git-clone skill and clone the repository into ./repos/ inside the session workspace.",
    "2. Explore the repository structure with read/glob/grep/bash and identify dependency manifests or lockfiles.",
    "3. Extract important direct runtime dependencies from project evidence such as package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, requirements.txt, pyproject.toml, poetry.lock, go.mod, pom.xml, or build.gradle.",
    "4. Construct valid PURLs with exact versions when available. Prefer lockfile versions; skip dependencies whose version cannot be determined with reasonable confidence.",
    "5. Select up to 15 important PURLs and query OSV with vulnerability_lookup and includeDetails=true.",
    "6. Summarize the findings: vulnerable packages, most severe CVEs/GHSAs, severity, affected versions, and upgrade guidance.",
    "7. Rank the recommended remediation work by risk, dependency role, source-code usage evidence, and likely impact.",
    "",
    "Use the relevant skills for dependency discovery, vulnerability impact analysis, and upgrade planning when helpful.",
    "Report progress clearly after each major step. Use only dependency versions and vulnerability data supported by repository evidence or tool results.",
  ].join("\n")
}

function createConfiguredProviderRuntime(options: AnalyzeRepoOptions) {
  const env = createEnvironment(process.env)
  const providerID = options.providerID ?? process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = options.modelID ?? process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini")

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

function parseArgs(args: string[]): AnalyzeRepoOptions {
  const repoUrl = args[0]?.trim() || process.env.REPO_URL?.trim()
  if (!repoUrl) {
    throw new Error("Usage: bun src/cli/analyze-repo.ts <repository-url>")
  }
  if (!isRepositoryUrl(repoUrl)) {
    throw new Error(`Invalid repository URL: ${repoUrl}`)
  }

  return {
    repoUrl,
    providerID: process.env.SMOKE_PROVIDER,
    modelID: process.env.SMOKE_MODEL,
    maxIterations: Number(process.env.ANALYZE_MAX_ITERATIONS ?? process.env.SMOKE_MAX_ITERATIONS ?? 30),
  }
}

function isRepositoryUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "git:" || url.protocol === "ssh:"
  } catch {
    return false
  }
}

async function writeGitHubSummary(result: Awaited<ReturnType<typeof analyzeRepo>>) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const lines = [
    "## Agent Supply-Chain Analysis",
    "",
    `- Status: ${result.status}`,
    `- Repository: ${result.repoUrl}`,
    `- Session: ${result.sessionID}`,
    `- Workspace: ${result.workspace}`,
    `- Model: ${result.model}`,
    "",
  ]

  if (result.status === "failed") {
    lines.push("### Error", "", "```text", result.error, "```", "")
  }

  await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8")
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
