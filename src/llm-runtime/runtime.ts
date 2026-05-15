import { generateText, streamText } from "ai"
import { resolveGenerationOptions } from "./options"
import { buildSystemMessages } from "./system"
import type { LLMGenerateInput, LLMRuntimeInput } from "./schema"
import { resolveTools } from "./tools"

export function buildMessages(input: Pick<LLMRuntimeInput, "agent" | "model" | "messages" | "system" | "user">) {
  return buildSystemMessages(input).then((system) => [...system, ...input.messages])
}

export async function streamAgentText(input: LLMRuntimeInput) {
  const options = resolveGenerationOptions(input)
  const tools = resolveTools(input)
  return streamText({
    model: await input.provider.getLanguage(input.model),
    messages: await buildMessages(input),
    tools,
    activeTools: activeTools(tools),
    experimental_repairToolCall: repairInvalidToolCall,
    toolChoice: input.toolChoice,
    temperature: options.temperature,
    topP: options.topP,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: input.retries ?? 0,
    abortSignal: input.abortSignal,
    providerOptions: options.providerOptions,
  })
}

export async function generateAgentText(input: LLMGenerateInput) {
  const options = resolveGenerationOptions(input)
  const tools = resolveTools(input)
  return generateText({
    model: await input.provider.getLanguage(input.model),
    messages: [
      ...(await buildSystemMessages(input)),
      {
        role: "user",
        content: input.prompt,
      },
    ],
    tools,
    activeTools: activeTools(tools),
    experimental_repairToolCall: repairInvalidToolCall,
    toolChoice: input.toolChoice,
    temperature: options.temperature,
    topP: options.topP,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: input.retries ?? 0,
    abortSignal: input.abortSignal,
    providerOptions: options.providerOptions,
  })
}

function activeTools(tools: Record<string, unknown>) {
  return Object.keys(tools).filter((tool) => tool !== "invalid")
}

async function repairInvalidToolCall(failed: any) {
  const toolName = String(failed.toolCall.toolName)
  const lower = toolName.toLowerCase()

  if (lower !== toolName && failed.tools?.[lower]) {
    return {
      ...failed.toolCall,
      toolName: lower,
    }
  }

  if (!failed.tools?.invalid) return null

  return {
    ...failed.toolCall,
    toolName: "invalid",
    input: JSON.stringify({
      tool: toolName,
      error: failed.error instanceof Error ? failed.error.message : String(failed.error),
      input: parseToolInput(failed.toolCall.input),
      expected: await expectedSchema(failed, toolName),
      suggestion: `Call "${failed.tools?.[toolName] ? toolName : lower}" again with arguments that match its schema.`,
    }),
  }
}

async function expectedSchema(failed: any, toolName: string) {
  try {
    if (!failed.tools?.[toolName]) return undefined
    return JSON.stringify(await failed.inputSchema({ toolName }))
  } catch {
    return undefined
  }
}

function parseToolInput(input: unknown) {
  if (typeof input !== "string") return input
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}
