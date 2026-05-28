import path from "node:path"
import { FindingCaptureInputSchema, type FindingCaptureInput } from "../finding/schema"
import { SQLiteFindingStore } from "../finding/store"
import type { ToolContext, ToolDef } from "./schema"

export function createFindingCaptureTool(): ToolDef<FindingCaptureInput> {
  return {
    id: "finding_capture",
    description: [
      "Record a single vulnerability finding and append per-finding investigation events.",
      "Use action=open when a distinct vulnerability hypothesis appears.",
      "Use action=append_event for dependency matches, source evidence, reachability notes, PoC results, fixes, and blockers.",
    ].join("\n"),
    inputSchema: FindingCaptureInputSchema,
    execute: async (params, ctx) => {
      const sessionID = ctx.sessionID
      if (!sessionID) {
        throw new Error("finding_capture requires ToolContext.sessionID")
      }

      const store = new SQLiteFindingStore({
        filepath: path.join(resolveDataDir(ctx.workspace), "session.sqlite"),
      })
      const result = store.capture(params, {
        sessionID,
        runID: ctx.runID,
      })

      return {
        title: params.action === "open" ? `Finding opened: ${result.id}` : `Finding event recorded: ${result.id}`,
        output: JSON.stringify(result, null, 2),
        metadata: {
          action: params.action,
          id: result.id,
          stableKey: params.stableKey,
        },
      }
    },
  }
}

function resolveDataDir(workspace: string) {
  const resolved = path.resolve(workspace)
  const parts = resolved.split(path.sep)
  const index = parts.lastIndexOf(".agent-data")
  if (index >= 0) return parts.slice(0, index + 1).join(path.sep)
  return path.resolve(resolved, "../..")
}
