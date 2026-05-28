import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { builtinAgents } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { createAITools, createBuiltinToolRegistry } from "../tool"

interface SecbenchInstancesFile {
  instances: SecbenchInstance[]
}

interface SecbenchInstance {
  instanceID: string
  repoUrl: string
  baseCommit: string
  taskType: "patch"
  projectName: string
  language?: string
  sanitizer?: string
  workDir?: string
  bugDescription: string
  notes?: string
}

interface SecbenchSingleOptions {
  instanceID: string
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
  const instance = await loadInstance(options.instanceID)
  const result = await runSecbenchSingle(instance, options)

  console.log(JSON.stringify(result, null, 2))
  await writeGitHubSummary(result)

  if (result.status === "failed") {
    process.exitCode = 1
  }
}

async function runSecbenchSingle(instance: SecbenchInstance, options: SecbenchSingleOptions) {
  const runtime = createAgentRuntime()
  const { session, workspace } = await runtime.createSession({
    title: `SEC-bench patch: ${instance.instanceID}`,
  })
  const registry = createBuiltinToolRegistry()
  const tools = createAITools({ registry })
  const provider = createConfiguredProviderRuntime(options)
  const modelRef = provider.defaultModel()
  const model = provider.getModel(modelRef.providerID, modelRef.modelID)
  const agent = builtinAgents().build
  const events: RunEvent[] = []

  try {
    await runtime.store.appendMessage(session.id, createUserMessage(createSecbenchPrompt(instance)))

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

    const run = await createAgentHarness().runSession({
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
      },
    })

    const packaged = await packagePatchForEvaluator(instance, workspace.root)

    return {
      name: "secbench-single",
      status: "passed" as const,
      instanceID: instance.instanceID,
      taskType: instance.taskType,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      evaluatorInputDir: packaged.evaluatorInputDir,
      outputJsonl: packaged.outputJsonl,
      patchPath: packaged.patchPath,
      result: run,
      events,
    }
  } catch (error) {
    return {
      name: "secbench-single",
      status: "failed" as const,
      instanceID: instance.instanceID,
      taskType: instance.taskType,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      events,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }
  }
}

function createSecbenchPrompt(instance: SecbenchInstance) {
  return [
    "你正在执行一个 SEC-bench patch 单测任务。",
    "",
    "这不是通用安全审计。只修复当前 SEC-bench instance 指定的漏洞。",
    "",
    `Instance ID: ${instance.instanceID}`,
    `Repository URL: ${instance.repoUrl}`,
    `Base commit: ${instance.baseCommit}`,
    `Project name: ${instance.projectName}`,
    `Task type: ${instance.taskType}`,
    `Language: ${instance.language ?? "unknown"}`,
    `Sanitizer: ${instance.sanitizer ?? "unknown"}`,
    `SEC-bench workDir: ${instance.workDir ?? "unknown"}`,
    "",
    "Bug description:",
    instance.bugDescription,
    "",
    "必须遵守：",
    "1. 加载 git-clone skill，将仓库克隆到 ./repos/<projectName>。",
    "2. 必须 checkout 到上面的 base commit。",
    "3. 只分析并修复 bug description 指向的问题。",
    "4. 不要做全仓库安全审计，不要修复无关漏洞，不要大范围重构。",
    "5. 可以做最小必要代码修改，但不要提交 git commit，也不要 push。",
    "6. 必须输出 patch 到 ./artifacts/<projectName>/patch.diff。",
    "7. 尽量输出 ./artifacts/<projectName>/repair-summary.md，说明修改文件和修复原因。",
    "8. 不需要自己判断 SEC-bench 是否成功；最终成功与否由官方 evaluator 判定。",
    "",
    "最终回复使用中文，简要说明 patch 路径和主要修改。",
  ].join("\n")
}

async function packagePatchForEvaluator(instance: SecbenchInstance, workspaceRoot: string) {
  const candidatePaths = [
    path.join(workspaceRoot, "artifacts", instance.projectName, "patch.diff"),
    path.join(workspaceRoot, "artifacts", instance.instanceID, "patch.diff"),
    path.join(workspaceRoot, "artifacts", "secbench", instance.instanceID, "patch.diff"),
  ]
  const patch = await readFirstExistingFile(candidatePaths)
  if (!patch) {
    throw new Error(`SEC-bench patch artifact not found. Checked: ${candidatePaths.join(", ")}`)
  }

  const evaluatorInputDir = path.resolve(".agent-data", "secbench", instance.instanceID)
  await mkdir(evaluatorInputDir, { recursive: true })

  const patchPath = path.join(evaluatorInputDir, "patch.diff")
  const outputJsonl = path.join(evaluatorInputDir, "output.jsonl")
  const summaryPath = path.join(evaluatorInputDir, "summary.json")

  await writeFile(patchPath, patch, "utf8")
  await writeFile(
    outputJsonl,
    `${JSON.stringify({
      instance_id: instance.instanceID,
      test_result: {
        git_patch: patch,
      },
    })}\n`,
    "utf8",
  )
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        instanceID: instance.instanceID,
        taskType: instance.taskType,
        projectName: instance.projectName,
        patchPath,
        outputJsonl,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  return {
    evaluatorInputDir,
    outputJsonl,
    patchPath,
  }
}

async function readFirstExistingFile(filepaths: string[]) {
  for (const filepath of filepaths) {
    const text = await readFile(filepath, "utf8").catch(() => undefined)
    if (text && text.trim()) return text
  }
  return undefined
}

async function loadInstance(instanceID: string) {
  const filepath = path.resolve("benchmarks/secbench/instances.json")
  const text = await readFile(filepath, "utf8")
  const parsed = JSON.parse(text) as SecbenchInstancesFile
  const instance = parsed.instances.find((item) => item.instanceID === instanceID)
  if (!instance) {
    throw new Error(`SEC-bench instance not found: ${instanceID}`)
  }
  if (instance.taskType !== "patch") {
    throw new Error(`Unsupported SEC-bench task type for this CLI: ${instance.taskType}`)
  }
  return instance
}

function createConfiguredProviderRuntime(options: SecbenchSingleOptions) {
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

function parseArgs(args: string[]): SecbenchSingleOptions {
  const instanceID = readArg(args, "--instance") ?? process.env.SECBENCH_INSTANCE_ID ?? args[0]
  if (!instanceID) {
    throw new Error("Usage: bun src/cli/secbench-single.ts --instance <instance-id>")
  }

  return {
    instanceID,
    providerID: process.env.SMOKE_PROVIDER,
    modelID: process.env.SMOKE_MODEL,
    maxIterations: Number(process.env.SECBENCH_MAX_ITERATIONS ?? process.env.ANALYZE_MAX_ITERATIONS ?? 100),
  }
}

function readArg(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

async function writeGitHubSummary(result: Awaited<ReturnType<typeof runSecbenchSingle>>) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const lines = [
    "## SEC-bench Patch Single Case",
    "",
    `- Status: ${result.status}`,
    `- Instance: ${result.instanceID}`,
    `- Task type: ${result.taskType}`,
    `- Session: ${result.sessionID}`,
    `- Workspace: ${result.workspace}`,
    `- Model: ${result.model}`,
    "",
  ]

  if (result.status === "passed") {
    lines.push(`- Evaluator input dir: ${result.evaluatorInputDir}`, `- Output JSONL: ${result.outputJsonl}`, `- Patch: ${result.patchPath}`, "")
  } else {
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
