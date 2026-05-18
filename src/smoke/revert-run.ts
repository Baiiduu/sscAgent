import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { builtinAgents } from "../agent"
import { createAgentHarness, createUserMessage } from "../harness"
import { createPermissionRuntime } from "../permission"
import { createEnvironment, createProviderRuntime } from "../provider"
import { createAgentRuntime } from "../runtime"
import { revertSessionSnapshot } from "../session"
import { createAITools, createBuiltinToolRegistry } from "../tool"

export async function runRevertRunSmoke() {
  await loadLocalEnv()

  const runtime = createAgentRuntime()
  const { session, workspace } = await runtime.createSession({
    title: "Smoke: run revert",
  })
  const registry = createBuiltinToolRegistry()
  const provider = createSmokeProviderRuntime()
  const model = resolveSmokeModel(provider)
  const agent = builtinAgents().build
  const target = "revert-real-agent.txt"
  const targetPath = path.join(workspace.root, target)

  await runtime.store.appendMessage(
    session.id,
    createUserMessage(
      [
        `Use the write tool to create a file named ${target} in the current workspace.`,
        "The file content must be exactly:",
        "created by real agent revert smoke",
        "Do not modify any other files.",
      ].join("\n"),
    ),
  )

  const permission = createPermissionRuntime({
    onAsk: async () => "always" as const,
  })

  await createAgentHarness().runSession({
    sessionID: session.id,
    store: runtime.store,
    provider,
    model,
    agent,
    tools: createAITools({ registry }),
    createToolExecutor: runtime.createToolExecutor({
      registry,
      permission,
      ruleset: agent.permission,
    }),
    snapshotService: runtime.snapshot,
    maxIterations: 6,
    onEvent: async (event) => {
      if (event.type === "tool-call") console.log(`[tool-call] ${event.toolName}`)
      if (event.type === "tool-result") console.log(`[tool-result] ${event.toolName}: ${event.output}`)
      if (event.type === "text-delta") process.stdout.write(event.text)
    },
  })

  const createdBeforeRevert = existsSync(targetPath)
  const contentBeforeRevert = createdBeforeRevert ? readFileSync(targetPath, "utf8") : undefined
  const runsBeforeRevert = await runtime.store.runs?.(session.id)
  const snapshotsBeforeRevert = await runtime.store.snapshots(session.id)

  const revert = await revertSessionSnapshot({
    store: runtime.store,
    sessionID: session.id,
    snapshotService: runtime.snapshot,
  })

  const updatedSession = await runtime.store.get(session.id)
  const updatedRun = revert.runID ? await runtime.store.getRun?.(session.id, revert.runID) : undefined

  return {
    dataDir: runtime.dataDir,
    sessionID: session.id,
    workspace: workspace.root,
    target,
    createdBeforeRevert,
    contentBeforeRevert,
    existsAfterRevert: existsSync(targetPath),
    runIDs: runsBeforeRevert?.map((run) => ({ id: run.id, status: run.status, baselineHash: run.baselineHash })),
    snapshots: snapshotsBeforeRevert.map((snapshot) => ({
      id: snapshot.id,
      runID: snapshot.runID,
      files: snapshot.diffs.map((diff) => diff.file),
    })),
    revert,
    sessionRevert: updatedSession?.revert,
    revertedRunStatus: updatedRun?.status,
  }
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
              options: { baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" },
              models: {
                "deepseek-v4-flash": {
                  id: "deepseek-v4-flash",
                  name: "DeepSeek V4 Flash",
                  providerID: "deepseek",
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
  console.log(JSON.stringify(await runRevertRunSmoke(), null, 2))
}
