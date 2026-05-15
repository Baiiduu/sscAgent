import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const DEFAULT_READ_LIMIT = 2_000
const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const SAMPLE_BYTES = 4_096

export interface ReadToolInput {
  filePath: string
  offset?: number
  limit?: number
}

export function createReadTool(): ToolDef<ReadToolInput> {
  return {
    id: "read",
    description:
      "Read a file or directory from the local filesystem. Returns line-numbered file content or directory entries.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file or directory to read. Relative paths resolve from the session cwd."),
      offset: z.number().int().positive().optional().describe("1-based line or entry offset to start reading from."),
      limit: z.number().int().positive().optional().describe("Maximum number of lines or entries to return."),
    }),
    execute: async (params, ctx) => {
      if (params.offset !== undefined && params.offset < 1) {
        throw new Error("offset must be greater than or equal to 1")
      }

      const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(ctx.cwd, params.filePath)
      await assertInsideWorkspace({
        filepath,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "file",
      })

      await ctx.ask({
        permission: "read",
        patterns: [filepath],
        metadata: {
          filePath: filepath,
        },
      })

      const file = Bun.file(filepath)
      const exists = await file.exists()
      if (!exists) throw new Error(`File not found: ${filepath}`)

      if ((await isDirectory(filepath)) === true) {
        return readDirectory(filepath, params)
      }

      if (await isBinaryFile(filepath)) {
        throw new Error(`Cannot read binary file: ${filepath}`)
      }

      return readTextFile(filepath, params)
    },
  }
}

async function readDirectory(filepath: string, params: ReadToolInput) {
  const entries = (await Array.fromAsync(new Bun.Glob("*").scan({ cwd: filepath, dot: true }))).sort((a, b) =>
    a.localeCompare(b),
  )
  const offset = params.offset ?? 1
  const limit = params.limit ?? DEFAULT_READ_LIMIT
  const start = offset - 1
  const sliced = entries.slice(start, start + limit)
  const truncated = start + sliced.length < entries.length

  return {
    title: filepath,
    output: [
      `<path>${filepath}</path>`,
      `<type>directory</type>`,
      `<entries>`,
      sliced.join("\n"),
      truncated
        ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use offset ${offset + sliced.length} to continue.)`
        : `\n(${entries.length} entries)`,
      `</entries>`,
    ].join("\n"),
    metadata: {
      count: entries.length,
      truncated,
    },
  }
}

async function readTextFile(filepath: string, params: ReadToolInput) {
  const offset = params.offset ?? 1
  const limit = params.limit ?? DEFAULT_READ_LIMIT
  const lines = (await Bun.file(filepath).text()).split(/\r?\n/)
  if (lines.length < offset && !(lines.length === 1 && lines[0] === "" && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${lines.length} lines)`)
  }

  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < lines.length
  const output = [
    `<path>${filepath}</path>`,
    `<type>file</type>`,
    `<content>`,
    selected.map((line, index) => `${offset + index}: ${truncateLine(line)}`).join("\n"),
    `</content>`,
    truncated ? `(File has more lines. Use offset ${offset + selected.length} to continue.)` : "",
  ]
    .filter(Boolean)
    .join("\n")

  return {
    title: filepath,
    output,
    metadata: {
      lines: lines.length,
      truncated,
    },
  }
}

async function isDirectory(filepath: string) {
  try {
    return (await Bun.file(filepath).stat()).isDirectory()
  } catch {
    return false
  }
}

async function isBinaryFile(filepath: string) {
  const bytes = new Uint8Array(await Bun.file(filepath).slice(0, SAMPLE_BYTES).arrayBuffer())
  if (bytes.length === 0) return false

  let nonPrintable = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++
  }

  return nonPrintable / bytes.length > 0.3
}

function truncateLine(line: string) {
  if (line.length <= MAX_LINE_LENGTH) return line
  return line.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
}
