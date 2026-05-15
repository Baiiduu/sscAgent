import path from "node:path"
import { z } from "zod"
import { createTextDiff } from "../diff"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

export interface WriteToolInput {
  filePath: string
  content: string
}

export function createWriteTool(): ToolDef<WriteToolInput> {
  return {
    id: "write",
    description: "Write content to a local file, creating parent directories when needed.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file to write. Relative paths resolve from the session cwd."),
      content: z.string().describe("Complete file content to write."),
    }),
    execute: async (params, ctx) => {
      if (!params.filePath) throw new Error("filePath is required")

      const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(ctx.cwd, params.filePath)
      await assertInsideWorkspace({
        filepath,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "file",
      })

      const exists = await Bun.file(filepath).exists()
      const oldContent = exists ? await Bun.file(filepath).text() : ""
      const diff = createTextDiff(filepath, oldContent, params.content)

      await ctx.ask({
        permission: "edit",
        patterns: [filepath],
        metadata: {
          filepath,
          diff: diff.patch,
          additions: diff.additions,
          deletions: diff.deletions,
          exists,
        },
      })

      await Bun.write(filepath, params.content)

      return {
        title: path.relative(ctx.cwd, filepath) || filepath,
        output: "Wrote file successfully.",
        metadata: {
          filepath,
          exists,
          diff: diff.patch,
          additions: diff.additions,
          deletions: diff.deletions,
        },
      }
    },
  }
}
