import type { streamText } from "ai"
import type { HarnessEvent, HarnessFinishReason, HarnessResult } from "./schema"

type StreamResult = Awaited<ReturnType<typeof streamText>>
type StreamEvent = StreamResult["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface ProcessStreamInput {
  stream: StreamResult
  onEvent?: (event: HarnessEvent) => void | Promise<void>
}

export async function processStream(input: ProcessStreamInput): Promise<HarnessResult> {
  let text = ""
  let finishReason: HarnessFinishReason = "unknown"
  let usage: HarnessResult["usage"]

  await emit(input.onEvent, { type: "start" })

  try {
    for await (const event of input.stream.fullStream) {
      if (event.type === "text-delta") {
        text += event.text
        await emit(input.onEvent, {
          type: "text-delta",
          text: event.text,
        })
        continue
      }

      if (event.type === "reasoning-delta") {
        await emit(input.onEvent, {
          type: "reasoning-delta",
          text: event.text,
        })
        continue
      }

      if (event.type === "tool-call") {
        await emit(input.onEvent, {
          type: "tool-call",
          toolCallID: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        })
        continue
      }

      if (event.type === "finish") {
        finishReason = normalizeFinishReason(event.finishReason)
        usage = event.totalUsage
        await emit(input.onEvent, {
          type: "finish",
          reason: finishReason,
          usage,
        })
        continue
      }
    }
  } catch (error) {
    finishReason = "error"
    await emit(input.onEvent, {
      type: "error",
      error,
    })
    throw error
  }

  return {
    text,
    finishReason,
    usage,
  }
}

async function emit(onEvent: ProcessStreamInput["onEvent"], event: HarnessEvent) {
  await onEvent?.(event)
}

function normalizeFinishReason(reason: StreamEvent extends { type: "finish"; finishReason: infer R } ? R : unknown) {
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  if (reason === "content-filter") return "content-filter"
  if (reason === "tool-calls") return "tool-calls"
  return "unknown"
}
