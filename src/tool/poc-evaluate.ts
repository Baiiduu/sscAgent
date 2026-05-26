import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "./external-directory"
import type { ToolContext, ToolDef } from "./schema"

const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 300
const MAX_OUTPUT_LENGTH = 20_000

const EntryPointEvidenceSchema = z.object({
  type: z.enum(["http", "cli", "test", "file", "plugin", "queue", "other"]),
  description: z.string().min(1),
})

const OracleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("exit_code"),
    code: z.number().int(),
  }),
  z.object({
    type: z.literal("stdout_contains"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("stderr_contains"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("output_contains"),
    value: z.string().min(1),
  }),
])

const InputSchema = z.object({
  repoDir: z.string().min(1).describe("Target repository directory. Relative paths resolve from the session cwd."),
  pocCommand: z.string().min(1).describe("Command that runs the PoC through the project's real entrypoint."),
  timeoutSeconds: z.number().int().positive().max(MAX_TIMEOUT_SECONDS).optional(),
  oracle: OracleSchema.describe("Machine-checkable signal that proves the PoC triggered the expected condition."),
  entrypointEvidence: EntryPointEvidenceSchema.describe("Why this PoC is claimed to use a real project entrypoint."),
  allowExternalNetwork: z.boolean().optional().describe("Allow non-localhost network targets in the PoC command."),
  resultPath: z.string().optional().describe("Optional JSON result path. Relative paths resolve from the session cwd."),
  writeResult: z.boolean().optional().describe("Write the evaluation JSON result to disk. Defaults to true."),
})

export type PocEvaluateInput = z.infer<typeof InputSchema>
export type PocEvaluateStatus = "verified" | "not_triggered" | "invalid" | "inconclusive" | "unsafe_blocked"

interface PocProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

interface PocEvaluationResult {
  status: PocEvaluateStatus
  entrypointVerified: boolean
  oracleMatched: boolean
  oracle: PocEvaluateInput["oracle"]
  entrypointEvidence: PocEvaluateInput["entrypointEvidence"]
  repoDir: string
  pocCommand: string
  timeoutSeconds: number
  exitCode: number | null
  timedOut: boolean
  stdoutExcerpt: string
  stderrExcerpt: string
  resultPath?: string
  reason: string
}

export function createPocEvaluateTool(): ToolDef<PocEvaluateInput> {
  return {
    id: "poc_evaluate",
    description:
      "Run a project-entry PoC command locally and evaluate it with an explicit oracle. The tool returns execution facts for reachability decisions.",
    inputSchema: InputSchema,
    execute: async (params, ctx) => {
      const repoDir = resolveFromCwd(ctx.cwd, params.repoDir)
      await assertInsideWorkspace({
        filepath: repoDir,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "directory",
      })

      const timeoutSeconds = params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      const unsafeReason = unsafeCommandReason(params)
      if (unsafeReason) {
        const result = buildResult({
          status: "unsafe_blocked",
          params,
          repoDir,
          timeoutSeconds,
          processResult: emptyProcessResult(),
          oracleMatched: false,
          reason: unsafeReason,
        })
        return formatToolResult(result)
      }

      await ctx.ask({
        permission: "poc_evaluate",
        patterns: [params.pocCommand],
        metadata: {
          repoDir,
          entrypointEvidence: params.entrypointEvidence,
          oracle: params.oracle,
          timeoutSeconds,
        },
      })

      const processResult = await runPocCommand({
        command: params.pocCommand,
        cwd: repoDir,
        timeoutSeconds,
        signal: ctx.abortSignal,
      })

      const oracleMatched = matchOracle(params.oracle, processResult)
      const status = statusFor(processResult, oracleMatched)
      const reason = reasonFor(status, params.oracle, processResult)
      const result = buildResult({
        status,
        params,
        repoDir,
        timeoutSeconds,
        processResult,
        oracleMatched,
        reason,
      })

      if (params.writeResult !== false) {
        result.resultPath = await writeEvaluationResult({ result, params, ctx, repoDir })
      }

      return formatToolResult(result)
    },
  }
}

function resolveFromCwd(cwd: string, filepath: string) {
  return path.isAbsolute(filepath) ? path.resolve(filepath) : path.resolve(cwd, filepath)
}

async function runPocCommand(input: {
  command: string
  cwd: string
  timeoutSeconds: number
  signal: AbortSignal
}): Promise<PocProcessResult> {
  const timeoutController = new AbortController()
  const timeoutID = setTimeout(() => timeoutController.abort(), input.timeoutSeconds * 1_000)
  const signal = AbortSignal.any([input.signal, timeoutController.signal])

  try {
    const proc = Bun.spawn([preferredShell(), shellFlag(), input.command], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal,
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return {
      exitCode,
      stdout,
      stderr,
      timedOut: false,
    }
  } catch (error) {
    if (timeoutController.signal.aborted) {
      return {
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: true,
      }
    }
    throw error
  } finally {
    clearTimeout(timeoutID)
  }
}

function matchOracle(oracle: PocEvaluateInput["oracle"], result: PocProcessResult) {
  if (result.timedOut) return false
  if (oracle.type === "exit_code") return result.exitCode === oracle.code
  if (oracle.type === "stdout_contains") return result.stdout.includes(oracle.value)
  if (oracle.type === "stderr_contains") return result.stderr.includes(oracle.value)
  return `${result.stdout}\n${result.stderr}`.includes(oracle.value)
}

function statusFor(result: PocProcessResult, oracleMatched: boolean): PocEvaluateStatus {
  if (result.timedOut) return "inconclusive"
  return oracleMatched ? "verified" : "not_triggered"
}

function reasonFor(
  status: PocEvaluateStatus,
  oracle: PocEvaluateInput["oracle"],
  result: PocProcessResult,
) {
  if (status === "verified") return `PoC matched oracle: ${oracleDescription(oracle)}.`
  if (status === "not_triggered") {
    return `PoC finished with exit code ${result.exitCode}, but did not match oracle: ${oracleDescription(oracle)}.`
  }
  if (status === "inconclusive") return "PoC command timed out before the oracle could be evaluated."
  return "PoC evaluation did not complete."
}

function oracleDescription(oracle: PocEvaluateInput["oracle"]) {
  if (oracle.type === "exit_code") return `exit_code == ${oracle.code}`
  return `${oracle.type} includes ${JSON.stringify(oracle.value)}`
}

function buildResult(input: {
  status: PocEvaluateStatus
  params: PocEvaluateInput
  repoDir: string
  timeoutSeconds: number
  processResult: PocProcessResult
  oracleMatched: boolean
  reason: string
}): PocEvaluationResult {
  return {
    status: input.status,
    entrypointVerified: true,
    oracleMatched: input.oracleMatched,
    oracle: input.params.oracle,
    entrypointEvidence: input.params.entrypointEvidence,
    repoDir: input.repoDir,
    pocCommand: input.params.pocCommand,
    timeoutSeconds: input.timeoutSeconds,
    exitCode: input.processResult.exitCode,
    timedOut: input.processResult.timedOut,
    stdoutExcerpt: truncate(input.processResult.stdout),
    stderrExcerpt: truncate(input.processResult.stderr),
    reason: input.reason,
  }
}

async function writeEvaluationResult(input: {
  result: PocEvaluationResult
  params: PocEvaluateInput
  ctx: ToolContext
  repoDir: string
}) {
  const resultPath = input.params.resultPath
    ? resolveFromCwd(input.ctx.cwd, input.params.resultPath)
    : path.resolve(input.ctx.workspace, "artifacts", path.basename(input.repoDir), "poc-evaluation-result.json")

  await assertInsideWorkspace({
    filepath: resultPath,
    workspace: input.ctx.workspace,
    allowedExternalPaths: input.ctx.allowedExternalPaths,
    ctx: input.ctx,
    kind: "file",
  })
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(input.result, null, 2)}\n`, "utf8")
  return resultPath
}

function formatToolResult(result: PocEvaluationResult) {
  return {
    title: `PoC evaluation: ${result.status}`,
    output: JSON.stringify(result, null, 2),
    metadata: {
      status: result.status,
      oracleMatched: result.oracleMatched,
      entrypointVerified: result.entrypointVerified,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      resultPath: result.resultPath,
    },
  }
}

function unsafeCommandReason(params: PocEvaluateInput) {
  const command = params.pocCommand.replace(/\s+/g, " ").trim()
  const lower = command.toLowerCase()

  if (!params.allowExternalNetwork && hasNonLocalhostUrl(command)) {
    return "Blocked PoC command because it contains a non-localhost URL and allowExternalNetwork is not true."
  }
  if (process.platform === "win32" && /\bcmd(?:\.exe)?\s*\/[ck]\b/i.test(command)) {
    return "Blocked nested cmd.exe invocation from PowerShell."
  }
  if (/\b(?:remove-item|rm|del|erase|rmdir|rd)\b/i.test(lower) && /\b(?:-recurse|-r|-force|\/s|\/q)\b/i.test(lower)) {
    return "Blocked recursive or forced deletion in PoC command."
  }
  if (/\bgit\s+clean\b/i.test(command) && /\s-[^\s]*[xfd]/i.test(command)) {
    return "Blocked destructive git clean command in PoC command."
  }
  return undefined
}

function hasNonLocalhostUrl(command: string) {
  const urls = command.match(/https?:\/\/[^\s"'`<>]+/gi) ?? []
  return urls.some((item) => {
    try {
      const url = new URL(item)
      return !["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(url.hostname)
    } catch {
      return true
    }
  })
}

function emptyProcessResult(): PocProcessResult {
  return {
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
  }
}

function truncate(value: string) {
  if (value.length <= MAX_OUTPUT_LENGTH) return value
  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n... (output truncated)`
}

function preferredShell() {
  if (process.platform === "win32") return "powershell"
  return "bash"
}

function shellFlag() {
  if (process.platform === "win32") return "-Command"
  return "-lc"
}
