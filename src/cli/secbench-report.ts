import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"

interface SecbenchPatchReport {
  instance_id: string
  success: boolean
  reason?: string
  exit_code?: number
  model_name?: string
}

interface ReportOptions {
  instanceID: string
  mode: string
  reportPath: string
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await readReport(options)

  const summary = {
    name: "secbench-report",
    instanceID: options.instanceID,
    mode: options.mode,
    success: report.success,
    score: report.success ? "1 / 1" : "0 / 1",
    resolved: report.success ? "100%" : "0%",
    reason: report.reason ?? "",
    exitCode: report.exit_code,
    modelName: report.model_name,
    reportPath: options.reportPath,
  }

  console.log(JSON.stringify(summary, null, 2))
  await writeGitHubSummary(summary)

  if (!report.success) {
    process.exitCode = 1
  }
}

async function readReport(options: ReportOptions) {
  const text = await readFile(options.reportPath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const report = JSON.parse(trimmed) as SecbenchPatchReport
    if (report.instance_id === options.instanceID) return report
  }
  throw new Error(`SEC-bench report does not contain instance: ${options.instanceID}`)
}

function parseArgs(args: string[]): ReportOptions {
  const instanceID = readArg(args, "--instance") ?? process.env.SECBENCH_INSTANCE_ID
  const mode = readArg(args, "--mode") ?? process.env.SECBENCH_EVAL_MODE ?? "medium"
  const reportPath =
    readArg(args, "--report") ??
    process.env.SECBENCH_REPORT_PATH ??
    path.resolve(".agent-data", "secbench-eval", instanceID ?? "", `report_${mode}.jsonl`)

  if (!instanceID) {
    throw new Error("Usage: bun src/cli/secbench-report.ts --instance <instance-id> --report <report-jsonl>")
  }

  return {
    instanceID,
    mode,
    reportPath,
  }
}

function readArg(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

async function writeGitHubSummary(summary: {
  instanceID: string
  mode: string
  success: boolean
  score: string
  resolved: string
  reason: string
  exitCode?: number
  modelName?: string
  reportPath: string
}) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const lines = [
    "## SEC-bench Patch Result",
    "",
    `- Instance: ${summary.instanceID}`,
    "- Type: patch",
    `- Mode: ${summary.mode}`,
    `- Success: ${summary.success}`,
    `- Score: ${summary.score}`,
    `- Resolved: ${summary.resolved}`,
    `- Exit code: ${summary.exitCode ?? "unknown"}`,
    `- Model: ${summary.modelName ?? "unknown"}`,
    `- Report: ${summary.reportPath}`,
    "",
    "### Reason",
    "",
    summary.reason || "No reason provided.",
    "",
  ]

  await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8")
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
