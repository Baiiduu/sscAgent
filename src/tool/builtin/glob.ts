import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const LIMIT = 100

export interface GlobToolInput {
  pattern: string
  path?: string
}

export function createGlobTool(): ToolDef<GlobToolInput> {
  return {
    id: "glob",
    description: "Find files by glob pattern. Returns matching paths sorted by most recently modified first.",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern to match, for example **/*.ts."),
      path: z.string().optional().describe("Directory to search. Relative paths resolve from the session cwd."),
    }),
    execute: async (params, ctx) => {
      if (!params.pattern) throw new Error("pattern is required")

      await ctx.ask({
        permission: "glob",
        patterns: [params.pattern],
        metadata: {
          pattern: params.pattern,
          path: params.path,
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

      if ((await isDirectory(search)) === false) {
        throw new Error(`glob path must be a directory: ${search}`)
      }

      const matches = await Array.fromAsync(new Bun.Glob(params.pattern).scan({ cwd: search, dot: true }))
      const files = (
        await Promise.all(
          matches.map(async (item) => {
            const full = path.resolve(search, item)
            const stat = await Bun.file(full).stat().catch(() => undefined)
            if (!stat?.isFile()) return
            return {
              path: full,
              mtime: stat.mtime.getTime(),
            }
          }),
        )
      )
        .filter((item): item is { path: string; mtime: number } => Boolean(item))
        .sort((a, b) => b.mtime - a.mtime)

      const truncated = files.length > LIMIT
      const final = truncated ? files.slice(0, LIMIT) : files

      return {
        title: params.pattern,
        output:
          final.length === 0
            ? "No files found"
            : [
                ...final.map((file) => file.path),
                truncated
                  ? `\n(Results are truncated: showing first ${LIMIT} results. Use a more specific pattern.)`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
        metadata: {
          count: final.length,
          truncated,
        },
      }
    },
  }
}

async function isDirectory(filepath: string) {
  return Bun.file(filepath)
    .stat()
    .then((stat) => stat.isDirectory())
    .catch(() => false)
}
