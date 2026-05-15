import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const DEFAULT_TIMEOUT = 120_000
const MAX_OUTPUT_LENGTH = 30_000

export interface BashToolInput {
  command: string
  timeout?: number
  workdir?: string
  description?: string
}

export interface CreateBashToolInput {
  shell?: string
}

export function createBashTool(input: CreateBashToolInput = {}): ToolDef<BashToolInput> {
  return {
    id: "bash",
    description: "Execute a shell command with an optional timeout and working directory.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute."),
      timeout: z.number().int().positive().optional().describe("Timeout in milliseconds."),
      workdir: z.string().optional().describe("Working directory. Relative paths resolve from the session cwd."),
      description: z.string().optional().describe("Short human-readable description of what the command does."),
    }),
    execute: async (params, ctx) => {
      if (!params.command) throw new Error("command is required")
      assertSafeShellCommand(params.command)

      const workdir = params.workdir
        ? path.isAbsolute(params.workdir)
          ? params.workdir
          : path.resolve(ctx.cwd, params.workdir)
        : ctx.cwd
      await assertInsideWorkspace({
        filepath: workdir,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "directory",
      })

      await ctx.ask({
        permission: "bash",
        patterns: [params.command],
        metadata: {
          command: params.command,
          description: params.description,
          workdir,
        },
      })

      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const timeoutController = new AbortController()
      const timeoutID = setTimeout(() => timeoutController.abort(), timeout)
      const signal = AbortSignal.any([ctx.abortSignal, timeoutController.signal])

      try {
        const proc = Bun.spawn([input.shell ?? preferredShell(), shellFlag(), params.command], {
          cwd: workdir,
          stdout: "pipe",
          stderr: "pipe",
          signal,
        })

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ])

        const output = formatOutput(stdout, stderr, exitCode)
        return {
          title: params.description ?? params.command,
          output: truncateOutput(output),
          metadata: {
            command: params.command,
            workdir,
            exitCode,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
            truncated: output.length > MAX_OUTPUT_LENGTH,
          },
        }
      } catch (error) {
        if (timeoutController.signal.aborted) {
          throw new Error(`Command timed out after ${timeout}ms`)
        }
        throw error
      } finally {
        clearTimeout(timeoutID)
      }
    },
  }
}

function assertSafeShellCommand(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim()
  const lower = normalized.toLowerCase()

  if (process.platform === "win32" && /\bcmd(?:\.exe)?\s*\/[ck]\b/i.test(normalized)) {
    throw new Error(
      "Refusing nested cmd.exe invocation from PowerShell. Cross-shell quoting can be misparsed and bypass path safety checks.",
    )
  }

  if (/\b(?:rmdir|rd)\b[^|&;]*\s\/s\b/i.test(normalized)) {
    throw new Error("Refusing recursive rmdir/rd command. Use a dedicated safe cleanup tool instead.")
  }

  if (/\b(?:remove-item|rm|del|erase)\b/i.test(lower) && /\b(?:-recurse|-r|-force|\/s|\/q)\b/i.test(lower)) {
    throw new Error("Refusing recursive or forced delete command in bash tool. Use a dedicated safe cleanup tool instead.")
  }

  if (/\bgit\s+clean\b/i.test(normalized) && /\s-[^\s]*[xfd]/i.test(normalized)) {
    throw new Error("Refusing destructive git clean command in bash tool.")
  }
}

function preferredShell() {
  if (process.platform === "win32") return "powershell"
  return "bash"
}

function shellFlag() {
  if (process.platform === "win32") return "-Command"
  return "-lc"
}

function formatOutput(stdout: string, stderr: string, exitCode: number) {
  return [
    `<exit_code>${exitCode}</exit_code>`,
    stdout ? `<stdout>\n${stdout}\n</stdout>` : "",
    stderr ? `<stderr>\n${stderr}\n</stderr>` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function truncateOutput(output: string) {
  if (output.length <= MAX_OUTPUT_LENGTH) return output
  return output.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)"
}
