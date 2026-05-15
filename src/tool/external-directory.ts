import path from "node:path"
import type { ToolContext } from "./schema"

export interface ExternalDirectoryGuardInput {
  filepath: string
  workspace: string
  ctx: ToolContext
  kind?: "file" | "directory"
  allowedExternalPaths?: string[]
}

export async function assertInsideWorkspace(input: ExternalDirectoryGuardInput) {
  const filepath = normalizePath(input.filepath)
  const workspace = normalizePath(input.workspace)
  const allowed = (input.allowedExternalPaths ?? []).map(normalizePath)

  if (isInside(filepath, workspace) || allowed.some((item) => isInside(filepath, item))) {
    return
  }

  await input.ctx.ask({
    permission: "external_directory",
    patterns: [filepath],
    metadata: {
      filepath,
      workspace,
      kind: input.kind ?? "file",
    },
  })
}

export function isInside(filepath: string, root: string) {
  const relative = path.relative(root, filepath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function normalizePath(filepath: string) {
  return path.resolve(filepath)
}

