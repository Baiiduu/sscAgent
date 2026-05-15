import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { builtinAgents } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { createAITools, createBuiltinToolRegistry } from "../tool"

const DEFAULT_REPO_URL = "https://github.com/snyk-labs/nodejs-goof.git"

export async function runAgentSmoke() {
  await loadLocalEnv()

  const runtime = createAgentRuntime()
  const { session, workspace } = await runtime.createSession({
    title: process.env.SMOKE_TITLE ?? "Smoke: agent session",
  })
  const registry = createBuiltinToolRegistry()
  const tools = createAITools({ registry })
  const provider = createSmokeProviderRuntime()
  const model = resolveSmokeModel(provider)
  const agent = builtinAgents()[process.env.SMOKE_AGENT ?? "build"] ?? builtinAgents().build
  const events: Array<{
    type: string
    toolName?: string
    input?: unknown
    output?: string
    error?: string
  }> = []

  const prompt = await resolveSmokePrompt()

  try {
    await runtime.store.appendMessage(session.id, createUserMessage(prompt))

    const permission = createPermissionRuntime({
      onAsk: async (request) => {
        events.push({
          type: "permission",
          toolName: request.permission,
          input: request.patterns,
        })
        return process.env.SMOKE_PERMISSION_REPLY === "always" ? "always" : "once"
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
      maxIterations: Number(process.env.SMOKE_MAX_ITERATIONS ?? 10),
      onEvent: async (event) => {
        if (event.type === "tool-call") {
          events.push({
            type: "tool-call",
            toolName: event.toolName,
            input: event.input,
          })
        }
        if (event.type === "tool-result") {
          events.push({
            type: "tool-result",
            toolName: event.toolName,
            output: event.output.slice(0, 1_000),
          })
        }
        if (event.type === "tool-error") {
          events.push({
            type: "tool-error",
            toolName: event.toolName,
            error: event.error,
          })
        }
      },
    })

    await runOptionalAssertions(workspace.root)

    return {
      name: "agent-smoke",
      status: "passed" as const,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      tools: registry.list().map((tool) => tool.id),
      result,
      events,
    }
  } catch (error) {
    return {
      name: "agent-smoke",
      status: "failed" as const,
      sessionID: session.id,
      workspace: workspace.root,
      model: `${model.providerID}/${model.id}`,
      tools: registry.list().map((tool) => tool.id),
      events,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }
  }
}

async function resolveSmokePrompt() {
  const configured = process.env.SMOKE_PROMPT_FILE
    ? await readFile(path.resolve(process.env.SMOKE_PROMPT_FILE), "utf8")
    : process.env.SMOKE_PROMPT

  const task = configured?.trim() || defaultGitClonePrompt()

  return [
    "这是一次 agent smoke 测试。请调用当前 agent 已装配的工具完成任务，不要只给文字说明。",
    "可用 skills 已由 system prompt 自动提供。需要专门流程时，请先调用 skill 工具加载对应 skill，再按 skill 执行。",
    "任务提示词如下：",
    task,
  ].join("\n")
}

function defaultGitClonePrompt() {
  return [
    "请只完成 Git 克隆任务。",
    "第一步使用 skill 工具加载 git-clone 技能，并按技能内容执行。",
    `仓库地址：${DEFAULT_REPO_URL}`,
    "完成后报告本地仓库路径和当前 commit。",
    "不要安装依赖，不要运行扫描，不要执行构建，不要清理目录。",
  ].join("\n")
}

function createSmokeProviderRuntime() {
  const env = createEnvironment(process.env)
  const providerID = process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini")

  return createProviderRuntime({
    defaultModel: {
      providerID,
      modelID,
    },
    providers:
      providerID === "deepseek"
        ? {
            deepseek: {
              id: "deepseek",
              kind: "openai-compatible",
              name: "DeepSeek",
              env: ["DEEPSEEK_API_KEY"],
              options: {
                baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
              },
              models: {
                "deepseek-v4-flash": {
                  id: "deepseek-v4-flash",
                  name: "DeepSeek V4 Flash",
                  providerID: "deepseek",
                  api: {
                    id: "deepseek-v4-flash",
                    npm: "@ai-sdk/openai-compatible",
                  },
                  limit: {
                    context: 64_000,
                    output: 8_000,
                  },
                },
              },
            },
          }
        : undefined,
    env,
  })
}

function resolveSmokeModel(provider: ReturnType<typeof createProviderRuntime>) {
  const ref = provider.defaultModel()
  return provider.getModel(ref.providerID, ref.modelID)
}

async function runOptionalAssertions(workspace: string) {
  const expectedRepo = process.env.SMOKE_EXPECT_REPO
  if (!expectedRepo) return

  const repositoryPath = path.isAbsolute(expectedRepo) ? expectedRepo : path.resolve(workspace, expectedRepo)
  const info = await stat(path.join(repositoryPath, ".git")).catch(() => undefined)
  if (!info?.isDirectory()) {
    throw new Error(`Expected cloned git repository at ${repositoryPath}`)
  }
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
  console.log(JSON.stringify(await runAgentSmoke(), null, 2))
}
