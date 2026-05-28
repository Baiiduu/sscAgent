import path from "node:path"
import {
  FindingCaptureInputSchema,
  type FindingCaptureInput,
  type FindingCaptureRawInput,
} from "../finding/schema"
import { SQLiteFindingStore } from "../finding/store"
import type { ToolContext, ToolDef } from "./schema"

export function createFindingCaptureTool(): ToolDef<FindingCaptureRawInput> {
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

      const input = normalizeInput(params)
      const store = new SQLiteFindingStore({
        filepath: path.join(resolveDataDir(ctx.workspace), "session.sqlite"),
      })
      const result = store.capture(input, {
        sessionID,
        runID: ctx.runID,
      })

      return {
        title: input.action === "open" ? `Finding opened: ${result.id}` : `Finding event recorded: ${result.id}`,
        output: JSON.stringify(result, null, 2),
        metadata: {
          action: input.action,
          id: result.id,
          stableKey: input.stableKey,
        },
      }
    },
  }
}

function normalizeInput(input: FindingCaptureRawInput): FindingCaptureInput {
  if (input.action === "open") {
    if (!input.title) throw new Error("finding_capture action=open requires title")
    if (!input.kind) throw new Error("finding_capture action=open requires kind")
    return {
      action: "open",
      stableKey: input.stableKey,
      title: input.title,
      kind: input.kind,
      severity: input.severity,
      primaryIdentifier: input.primaryIdentifier,
      packageName: input.packageName,
      purl: input.purl,
      filePath: input.filePath,
    }
  }

  if (!input.type) throw new Error("finding_capture action=append_event requires type")
  if (!input.summary) throw new Error("finding_capture action=append_event requires summary")
  return {
    action: "append_event",
    stableKey: input.stableKey,
    type: input.type,
    source: input.source ?? "agent",
    summary: input.summary,
    data: input.data,
    artifactPath: input.artifactPath,
  }
}

function resolveDataDir(workspace: string) {
  const resolved = path.resolve(workspace)
  const parts = resolved.split(path.sep)
  const index = parts.lastIndexOf(".agent-data")
  if (index >= 0) return parts.slice(0, index + 1).join(path.sep)
  return path.resolve(resolved, "../..")
}
