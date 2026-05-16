import { readFile } from "node:fs/promises"
import path from "node:path"
import { builtinAgents } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { createAITools, createBuiltinToolRegistry } from "../tool"

async function main() {
  await loadLocalEnv()

  const runtime = createAgentRuntime()
  const { session, workspace } = await runtime.createSession({
    title: "Full SSC Pipeline: clone → sbom → osv → upgrade",
  })
  const registry = createBuiltinToolRegistry()
  const tools = createAITools({ registry })
  const provider = createSmokeProviderRuntime()
  const model = resolveSmokeModel(provider)
  const agent = builtinAgents().build

  const prompt = [
    "请对一个 npm 项目进行完整的供应链安全分析。",
    "",
    "项目地址：https://github.com/snyk-labs/nodejs-goof.git",
    "",
    "请按以下流程执行：",
    "1. 加载 git-clone skill，将该项目克隆到会话工作区的 ./repos/ 目录。",
    "2. 使用 sbom_generate 工具，为已克隆的仓库生成 CycloneDX SBOM。",
    "3. 从 SBOM 的 directDependencies 中筛选出不超过 15 个最重要的直接依赖 PURL。筛选原则：运行时依赖优先、Web 框架/中间件/数据库驱动优先、版本明显过旧的优先。",
    "4. 使用 vulnerability_lookup 工具将筛选出的 PURL 作为 osvPurls 参数，向 OSV API 批量查询漏洞（includeDetails=true）。",
    "5. 汇总漏洞审查结果：列出每个依赖的漏洞数量、最严重 CVE、CVSS 评分、修复版本建议。",
    "6. 按风险严重程度给出综合优先级排序和升级方案。",
    "",
    "请不要跳过任何步骤，每一步完成后清晰报告当前进展。",
  ].join("\n")

  await runtime.store.appendMessage(session.id, createUserMessage(prompt))

  const permission = createPermissionRuntime({
    onAsk: async () => "always" as const,
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
    maxIterations: 30,
    onEvent: async (event) => {
      if (event.type === "tool-call") {
        console.log(`\n[TOOL CALL] ${event.toolName}`)
        if (typeof event.input === "object" && event.input) {
          const input = event.input as Record<string, unknown>
          if (event.toolName === "vulnerability_lookup" && Array.isArray(input.osvPurls)) {
            console.log(`  osvPurls count: ${input.osvPurls.length}`)
          } else if (event.toolName === "sbom_generate") {
            console.log(`  repositoryPath: ${String(input.repositoryPath ?? "N/A")}`)
          } else if (event.toolName === "skill" && typeof input.name === "string") {
            console.log(`  skill: ${input.name}`)
          }
        }
      }
      if (event.type === "tool-result") {
        try {
          const data = JSON.parse(event.output)
          if (data.summary) {
            console.log(`[TOOL RESULT] vulns=${data.summary.totalVulnerabilities ?? "?"}, packages=${data.summary.packagesWithVulns ?? "?"}`)
          } else if (data.checkedCount !== undefined) {
            console.log(`[TOOL RESULT] checked=${data.checkedCount}, updates=${data.updateAvailableCount}`)
          } else if (data.componentCount !== undefined) {
            console.log(`[TOOL RESULT] SBOM: ${data.componentCount} components, ${data.directDependencyCount} direct deps`)
          } else if (typeof data === "string" && data.includes("<skill_content")) {
            console.log(`[TOOL RESULT] skill loaded`)
          } else {
            console.log(`[TOOL RESULT] (received)`)
          }
        } catch {
          console.log(`[TOOL RESULT] (received)`)
        }
      }
      if (event.type === "text-delta") {
        process.stdout.write(event.text)
      }
      if (event.type === "error") {
        console.error("\n[ERROR]", event.error)
      }
    },
  })

  console.log("\n\n=== Pipeline Complete ===")
  console.log(`Session: ${session.id}`)
  console.log(`Workspace: ${workspace.root}`)
}

function createSmokeProviderRuntime() {
  const env = createEnvironment(process.env)
  const providerID = process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini")

  return createProviderRuntime({
    defaultModel: { providerID, modelID },
    providers: providerID === "deepseek"
      ? {
          deepseek: {
            id: "deepseek",
            kind: "openai-compatible",
            name: "DeepSeek",
            env: ["DEEPSEEK_API_KEY"],
            options: { baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" },
            models: {
              "deepseek-v4-flash": {
                id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", providerID: "deepseek",
                api: { id: "deepseek-v4-flash", npm: "@ai-sdk/openai-compatible" },
                limit: { context: 1000_000, output: 8_000 },
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
  main().catch(console.error)
}
