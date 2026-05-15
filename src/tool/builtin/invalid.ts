import { z } from "zod"
import type { ToolDef } from "../schema"

export interface InvalidToolInput {
  tool: string
  error: string
  input?: unknown
  expected?: string
  suggestion?: string
}

export function createInvalidTool(): ToolDef<InvalidToolInput> {
  return {
    id: "invalid",
    description: "Internal fallback tool used when a requested tool call is invalid. Do not call directly.",
    inputSchema: z.object({
      tool: z.string().describe("Name of the tool that could not be called."),
      error: z.string().describe("Validation or routing error for the failed tool call."),
      input: z.unknown().optional().describe("Original invalid input, when available."),
      expected: z.string().optional().describe("Short description of the expected input schema, when available."),
      suggestion: z.string().optional().describe("Suggested correction, when available."),
    }),
    execute: async (params) => ({
      title: "Invalid Tool",
      output: formatInvalidToolOutput(params),
      metadata: {
        tool: params.tool,
        error: params.error,
        expected: params.expected,
        suggestion: params.suggestion,
      },
    }),
  }
}

function formatInvalidToolOutput(params: InvalidToolInput) {
  return JSON.stringify(
    {
      error: "invalid_tool_call",
      tool: params.tool,
      message: `The tool call for "${params.tool}" is invalid.`,
      reason: params.error,
      expected: params.expected,
      invalidInput: params.input,
      suggestion:
        params.suggestion ??
        "Call the same intended tool again with corrected argument names and value types. Do not repeat the invalid input.",
    },
    null,
    2,
  )
}
