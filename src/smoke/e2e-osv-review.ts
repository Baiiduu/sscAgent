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
    title: "OSV Vulnerability Review",
  })
  const registry = createBuiltinToolRegistry()
  const tools = createAITools({ registry })
  const provider = createSmokeProviderRuntime()
  const model = resolveSmokeModel(provider)
  const agent = builtinAgents().build

  const prompt = [
    "请对 nodejs-goof 项目进行 OSV 漏洞审查。",
    "项目 SBOM 已就绪，直接依赖中包含以下重要 PURL：",
    "pkg:npm/express@4.12.4",
    "pkg:npm/lodash@4.17.4",
    "pkg:npm/marked@0.3.5",
    "pkg:npm/ejs@1.0.0",
    "pkg:npm/mongoose@4.2.4",
    "pkg:npm/mysql@2.18.1",
    "pkg:npm/body-parser@1.9.0",
    "pkg:npm/express-session@1.17.2",
    "pkg:npm/express-fileupload@0.0.5",
    "pkg:npm/adm-zip@0.4.7",
    "pkg:npm/validator@13.5.2",
    "pkg:npm/typeorm@0.2.24",
    "",
    "请按以下步骤执行：",
    "1. 使用 vulnerability_lookup 工具，将以上 PURL 作为 osvPurls 参数传入（并设置 includeDetails=true）直接查询 OSV API。",
    "2. 分析结果，给出每个依赖的漏洞数量、严重程度、CVE ID。",
    "3. 给出修复建议（推荐升级版本）。",
    "4. 如果某个依赖有多个漏洞，按 CVSS 排序，优先说最严重的。",
    "5. 后续可以通过调用 skill 工具加载 vulnerability-impact-analysis 技能来进一步分析。",
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
    maxIterations: 5,
    onEvent: async (event) => {
      if (event.type === "tool-call") {
        console.log(`\n[TOOL CALL] ${event.toolName}`, JSON.stringify(event.input, null, 2))
      }
      if (event.type === "tool-result") {
        const data = JSON.parse(event.output)
        console.log(`\n[TOOL RESULT] ${event.toolName}`)
        if (data.summary) {
          console.log(`  PURLs: ${data.summary.totalPurls}, Vulns: ${data.summary.totalVulnerabilities}`)
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

  console.log("\n\n=== Done ===")
  console.log(`Session: ${session.id}`)
  console.log(`Workspace: ${workspace.root}`)
}

function createSmokeProviderRuntime() {
  const env = createEnvironment(process.env)
  const providerID = process.env.SMOKE_PROVIDER ?? (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
  const modelID = process.env.SMOKE_MODEL ?? (providerID === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini")

  return createProviderRuntime({
    defaultModel: { providerID, modelID },
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
                  api: { id: "deepseek-v4-flash", npm: "@ai-sdk/openai-compatible" },
                  limit: { context: 1_000_000, output: 8_000 },
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
