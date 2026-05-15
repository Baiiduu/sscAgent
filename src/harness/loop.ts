import { toModelMessages } from "./model-message"
import { createMessage, createPartID, type HarnessMessage } from "./message"
import type { HarnessRunInput, HarnessResult } from "./schema"
import type { SessionStore } from "./session"
import { runAgentTurn } from "./turn"
import type { HarnessSession } from "./session"
import type { CreateSessionToolExecutorEvents, ToolExecutor } from "../tool"
import { COMPACTION_SYSTEM_PROMPT, createCompactionMessage, estimateMessagesTokens, isOverflow, prepareCompaction } from "../context"
import { generateAgentText } from "../llm-runtime"

export type HarnessLoopResult =
  | {
      type: "completed"
      message: HarnessMessage
      result: HarnessResult
    }
  | {
      type: "requires-tool-execution"
      message: HarnessMessage
      result: HarnessResult
      toolCalls: Extract<HarnessMessage["parts"][number], { type: "tool-call" }>[]
    }

export interface HarnessLoopInput extends Omit<HarnessRunInput, "messages"> {
  sessionID: string
  store: SessionStore
  toolExecutor?: ToolExecutor
  createToolExecutor?: (session: HarnessSession, events?: CreateSessionToolExecutorEvents) => ToolExecutor
  maxIterations?: number
  compaction?: {
    auto?: boolean
    preserveRecentTokens?: number
    tailTurns?: number
  }
}

export async function runHarnessLoop(input: HarnessLoopInput): Promise<HarnessLoopResult> {
  const maxIterations = input.maxIterations ?? 10
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const result = await runHarnessIteration(input)
    if (result.type === "completed") return result
    const session = await input.store.get(input.sessionID)
    if (!session) throw new Error(`Session not found: ${input.sessionID}`)

    const toolExecutor =
      input.toolExecutor ??
      input.createToolExecutor?.(session, {
        onMetadata: (metadata) =>
          input.onEvent?.({
            type: "tool-metadata",
            toolCallID: metadata.toolCallID,
            title: metadata.title,
            metadata: metadata.metadata,
          }),
      })
    if (!toolExecutor) return result

    for (const toolCall of result.toolCalls) {
      await executeToolCall(input, toolExecutor, result.message, toolCall)
    }
  }

  throw new Error(`Harness loop exceeded max iterations (${maxIterations})`)
}

async function executeToolCall(
  input: HarnessLoopInput,
  toolExecutor: ToolExecutor,
  assistant: HarnessMessage,
  toolCall: Extract<HarnessMessage["parts"][number], { type: "tool-call" }>,
) {
  try {
    const output = await toolExecutor.execute({
      toolCallID: toolCall.toolCallID,
      messageID: assistant.id,
      partID: toolCall.id,
      toolName: toolCall.toolName,
      input: toolCall.input,
    })

    await input.store.appendMessage(
      input.sessionID,
      createMessage({
        sessionID: input.sessionID,
        role: "tool",
        parts: [
          {
            id: createPartID(),
            type: "tool-result",
            toolCallID: toolCall.toolCallID,
            toolName: toolCall.toolName,
            output: output.output,
            title: output.title,
            metadata: output.metadata,
          },
        ],
      }),
    )

    await input.onEvent?.({
      type: "tool-result",
      toolCallID: toolCall.toolCallID,
      toolName: toolCall.toolName,
      output: output.output,
      metadata: output.metadata,
    })
    return
  } catch (error) {
    await input.store.appendMessage(
      input.sessionID,
      createMessage({
        sessionID: input.sessionID,
        role: "tool",
        parts: [
          {
            id: createPartID(),
            type: "tool-result",
            toolCallID: toolCall.toolCallID,
            toolName: toolCall.toolName,
            output: `Tool execution failed: ${errorMessage(error)}`,
            metadata: {
              error: true,
            },
          },
        ],
      }),
    )

    await input.onEvent?.({
      type: "tool-error",
      toolCallID: toolCall.toolCallID,
      toolName: toolCall.toolName,
      error: errorMessage(error),
    })
  }
}

async function runHarnessIteration(input: HarnessLoopInput): Promise<HarnessLoopResult> {
  await compactSessionIfNeeded(input)
  const history = await input.store.messages(input.sessionID)
  const assistant = createMessage({
    sessionID: input.sessionID,
    role: "assistant",
  })

  const result = await runAgentTurn({
    ...input,
    messages: toModelMessages(history),
    onEvent: async (event) => {
      if (event.type === "text-delta") {
        assistant.parts.push({
          id: createPartID(),
          type: "text",
          text: event.text,
        })
      }

      if (event.type === "reasoning-delta") {
        assistant.parts.push({
          id: createPartID(),
          type: "reasoning",
          text: event.text,
        })
      }

      if (event.type === "tool-call") {
        assistant.parts.push({
          id: createPartID(),
          type: "tool-call",
          toolCallID: event.toolCallID,
          toolName: event.toolName,
          input: event.input,
        })
      }

      if (event.type === "finish") {
        assistant.finishReason = event.reason
        assistant.time.completed = Date.now()
      }

      await input.onEvent?.(event)
    },
  })

  assistant.finishReason = result.finishReason
  assistant.time.completed = assistant.time.completed ?? Date.now()
  await input.store.appendMessage(input.sessionID, assistant)

  const toolCalls = assistant.parts.filter(
    (part): part is Extract<HarnessMessage["parts"][number], { type: "tool-call" }> => part.type === "tool-call",
  )

  if (toolCalls.length > 0) {
    return {
      type: "requires-tool-execution",
      message: assistant,
      result,
      toolCalls,
    }
  }

  return {
    type: "completed",
    message: assistant,
    result,
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function compactSessionIfNeeded(input: HarnessLoopInput) {
  if (input.compaction?.auto === false) return

  const messages = await input.store.messages(input.sessionID)
  if (
    !isOverflow({
      model: input.model,
      usage: {
        input: estimateMessagesTokens(messages),
        output: 0,
      },
      auto: input.compaction?.auto,
    })
  ) {
    return
  }

  const prepared = prepareCompaction({
    messages,
    model: input.model,
    preserveRecentTokens: input.compaction?.preserveRecentTokens,
    tailTurns: input.compaction?.tailTurns,
  })
  if (!prepared) return

  await input.store.update(input.sessionID, {
    time: {
      compacting: Date.now(),
    },
  })

  const result = await generateAgentText({
    provider: input.provider,
    model: input.model,
    agent: {
      ...input.agent,
      name: "compaction",
      prompt: COMPACTION_SYSTEM_PROMPT,
    },
    prompt: prepared.prompt,
    tools: {},
    retries: input.retries,
    abortSignal: input.abortSignal,
  })
  const summary = result.text.trim()
  await input.store.replaceMessages(input.sessionID, [
    {
      ...createCompactionMessage(summary),
      sessionID: input.sessionID,
    },
    ...prepared.preserved.map((message) => ({
      ...message,
      sessionID: message.sessionID ?? input.sessionID,
      parts: message.parts.map((part) => ({
        ...part,
        sessionID: part.sessionID ?? input.sessionID,
        messageID: part.messageID ?? message.id,
      })),
    })),
  ])
  await input.store.update(input.sessionID, {
    summary: {
      text: summary,
    },
    time: {
      compacting: undefined,
    },
  })
  await input.onEvent?.({
    type: "compaction",
    summary,
    compactedMessages: prepared.compacted.length,
    preservedMessages: prepared.preserved.length,
  })
}
