import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const LIMIT = 100
const MAX_LINE_LENGTH = 2_000

export interface GrepToolInput {
  pattern: string
  path?: string
  include?: string
}

export function createGrepTool(): ToolDef<GrepToolInput> {
  return {
    id: "grep",
    description: "Search file contents using ripgrep. Returns matching files and line snippets.",
    inputSchema: z.object({
      pattern: z.string().describe("Search pattern passed to ripgrep."),
      path: z.string().optional().describe("File or directory to search. Relative paths resolve from the session cwd."),
      include: z.string().optional().describe("Optional glob filter, for example *.ts or **/*.md."),
    }),
    execute: async (params, ctx) => {
      if (!params.pattern) throw new Error("pattern is required")

      await ctx.ask({
        permission: "grep",
        patterns: [params.pattern],
        metadata: {
          pattern: params.pattern,
          path: params.path,
          include: params.include,
        },
      })

      const search = params.path
        ? path.isAbsolute(params.path)
          ? params.path
          : path.resolve(ctx.cwd, params.path)
        : ctx.cwd
      await assertInsideWorkspace({
        filepath: search,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "directory",
      })

      const args = [
        "--line-number",
        "--with-filename",
        "--color",
        "never",
        "--max-count",
        String(LIMIT + 1),
        ...(params.include ? ["--glob", params.include] : []),
        params.pattern,
        search,
      ]

      const proc = Bun.spawn(["rg", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        signal: ctx.abortSignal,
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      if (exitCode > 1) {
        throw new Error(stderr.trim() || `ripgrep failed with exit code ${exitCode}`)
      }

      const rows = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseRipgrepLine)
        .filter((row): row is GrepRow => Boolean(row))

      if (rows.length === 0) {
        return {
          title: params.pattern,
          output: "No files found",
          metadata: {
            matches: 0,
            truncated: false,
          },
        }
      }

      const truncated = rows.length > LIMIT
      const final = truncated ? rows.slice(0, LIMIT) : rows
      const output = [`Found ${rows.length} matches${truncated ? ` (showing first ${LIMIT})` : ""}`]

      let current = ""
      for (const row of final) {
        if (current !== row.file) {
          if (current) output.push("")
          current = row.file
          output.push(`${row.file}:`)
        }
        output.push(`  Line ${row.line}: ${truncateLine(row.text)}`)
      }

      if (truncated) {
        output.push("")
        output.push(`(Results truncated: showing ${LIMIT} of ${rows.length} matches. Use a more specific search.)`)
      }

      return {
        title: params.pattern,
        output: output.join("\n"),
        metadata: {
          matches: rows.length,
          truncated,
        },
      }
    },
  }
}

interface GrepRow {
  file: string
  line: number
  text: string
}

function parseRipgrepLine(line: string): GrepRow | undefined {
  const match = /^(.*?):(\d+):(.*)$/.exec(line)
  if (!match) return
  return {
    file: match[1],
    line: Number(match[2]),
    text: match[3],
  }
}

function truncateLine(line: string) {
  if (line.length <= MAX_LINE_LENGTH) return line
  return line.slice(0, MAX_LINE_LENGTH) + "..."
}
