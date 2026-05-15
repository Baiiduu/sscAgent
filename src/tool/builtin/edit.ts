import path from "node:path"
import { z } from "zod"
import { createTextDiff } from "../diff"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

export interface EditToolInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

export function createEditTool(): ToolDef<EditToolInput> {
  return {
    id: "edit",
    description: "Replace text in a local file. Use oldString and newString to apply a precise edit.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file to edit. Relative paths resolve from the session cwd."),
      oldString: z.string().describe("Exact text to replace. Include enough context to make the match unique."),
      newString: z.string().describe("Replacement text."),
      replaceAll: z.boolean().optional().describe("Replace every occurrence of oldString instead of requiring one match."),
    }),
    execute: async (params, ctx) => {
      if (!params.filePath) throw new Error("filePath is required")
      if (params.oldString === params.newString) {
        throw new Error("No changes to apply: oldString and newString are identical.")
      }

      const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(ctx.cwd, params.filePath)
      await assertInsideWorkspace({
        filepath,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "file",
      })

      const file = Bun.file(filepath)
      if (!(await file.exists())) throw new Error(`File not found: ${filepath}`)

      const content = await file.text()
      const oldString = convertToLineEnding(normalizeLineEndings(params.oldString), detectLineEnding(content))
      const newString = convertToLineEnding(normalizeLineEndings(params.newString), detectLineEnding(content))
      const next = replace(content, oldString, newString, params.replaceAll)
      const diff = createTextDiff(filepath, content, next)

      await ctx.ask({
        permission: "edit",
        patterns: [filepath],
        metadata: {
          filepath,
          diff: diff.patch,
          additions: diff.additions,
          deletions: diff.deletions,
        },
      })

      await Bun.write(filepath, next)

      return {
        title: path.relative(ctx.cwd, filepath) || filepath,
        output: "Edited file successfully.",
        metadata: {
          filepath,
          diff: diff.patch,
          additions: diff.additions,
          deletions: diff.deletions,
        },
      }
    },
  }
}

function replace(content: string, oldString: string, newString: string, replaceAll = false) {
  if (!content.includes(oldString)) {
    throw new Error("oldString was not found in the file.")
  }

  if (!replaceAll && content.indexOf(oldString) !== content.lastIndexOf(oldString)) {
    throw new Error("oldString appears multiple times. Set replaceAll to true or provide more context.")
  }

  return replaceAll ? content.replaceAll(oldString, newString) : content.replace(oldString, newString)
}

function normalizeLineEndings(text: string) {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n") {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}
