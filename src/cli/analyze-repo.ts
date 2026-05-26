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
  executionMode: AnalysisExecutionMode
}

type AnalysisExecutionMode = "upstream_analysis" | "reachability_analysis" | "remediation_reproduction" | "benchmark"

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
    await runtime.store.appendMessage(session.id, createUserMessage(createAnalysisPrompt(options)))

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

function createAnalysisPrompt(options: AnalyzeRepoOptions) {
  const mode = options.executionMode
  const authorization = authorizationPrompt(mode)

  return [
    "你正在对一个开源项目执行安全分析。",
    "",
    `仓库地址：${options.repoUrl}`,
    `执行模式：${mode}`,
    `Benchmark 名称：${process.env.ANALYSIS_BENCHMARK_NAME ?? "未指定"}`,
    "",
    "默认流程：",
    "1. 加载 git-clone skill，将仓库克隆到当前 session workspace 的 ./repos/ 目录。",
    "2. 加载 vulnerability-impact-analysis skill，并按当前 execution_mode 执行对应阶段。",
    "3. 必须严格遵守下面的 GitHub Actions execution_mode 边界。",
    authorization,
    "5. 在漏洞匹配、可达性分析或修复复现前，必须确保依赖发现结果写入 ./artifacts/<repo-name>/dependency-discovery.json。",
    "6. 最终应尽量写出中文处置建议到 ./artifacts/<repo-name>/upgrade-plan.md。",
    "7. 如果当前模式允许修复复现或 benchmark，应优先生成教学型 PoC 到 ./artifacts/<repo-name>/poc.md，用于解释触发链路和修复前后现象；不要默认生成武器化 exploit。",
    "8. 修复必须建立在项目入口 PoC 验证成功之上：只有 poc_evaluate 返回 verified 的问题可以进入修复；not_triggered、invalid、inconclusive 或 unsafe_blocked 只能记录为候选/未验证风险，暂时不要修改目标代码。",
    "",
    "所有面向用户的进度、摘要、风险解释和修复建议都必须使用中文。",
    "每个主要阶段完成后都要清楚报告进展。依赖版本、漏洞编号、严重性、可达性结论和修复建议必须由仓库证据或工具结果支撑，不要编造。",
  ].join("\n")
}

function createConfiguredProviderRuntime(options: AnalyzeRepoOptions) {
  const env = createEnvironment(process.env)
  const providerID = options.providerID ?? process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = options.modelID ?? process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-5.5")

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
    maxIterations: Number(process.env.ANALYZE_MAX_ITERATIONS ?? process.env.SMOKE_MAX_ITERATIONS ?? 100),
    executionMode: parseExecutionMode(process.env.ANALYSIS_EXECUTION_MODE),
  }
}

function parseExecutionMode(value: string | undefined): AnalysisExecutionMode {
  if (
    value === "upstream_analysis" ||
    value === "reachability_analysis" ||
    value === "remediation_reproduction" ||
    value === "benchmark"
  ) {
    return value
  }
  return "reachability_analysis"
}

function authorizationPrompt(mode: AnalysisExecutionMode) {
  if (mode === "upstream_analysis") {
    return [
      "4. 当前为 upstream_analysis：只允许执行上游分析和候选发现。",
      "   允许执行 security-discovery；不允许执行 security-triage 的可达性结论，不允许执行 security-remediation。",
      "   不允许修改目标项目文件，不允许运行测试、构建、安装依赖或启动服务。",
    ].join("\n")
  }
  if (mode === "remediation_reproduction") {
    return [
      "4. 当前为 remediation_reproduction：允许执行上游分析、可达性分析、修复、复现和验证闭环。",
      "   可以加载并执行 security-discovery、security-triage 和 security-remediation。",
      "   只允许在目标仓库工作区内做与已确认问题直接相关的最小必要修改，并运行最小必要验证命令。",
    ].join("\n")
  }
  if (mode === "benchmark") {
    return [
      "4. 当前为 benchmark：按基准测试任务协议运行。",
      "   允许根据 benchmark 输入 checkout 指定 branch、tag、commit 或 base_commit，并执行规定的复现、修复和评测命令。",
      "   不要把 benchmark 模式当成普通仓库自由分析；必须优先遵守任务描述、评测脚本和输出格式。",
    ].join("\n")
  }
  return [
    "4. 当前为 reachability_analysis：允许执行上游分析和可达性分析，并生成中文处置建议。",
    "   可以加载并执行 security-discovery 和 security-triage；不允许执行 security-remediation。",
    "   不允许修改目标项目文件，不允许安装依赖、更新 lockfile、运行测试、构建或启动服务。",
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
