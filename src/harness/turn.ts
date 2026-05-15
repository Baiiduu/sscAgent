import { streamAgentText } from "../llm-runtime"
import { processStream } from "./processor"
import type { HarnessResult, HarnessRunInput } from "./schema"

export async function runAgentTurn(input: HarnessRunInput): Promise<HarnessResult> {
  const stream = await streamAgentText({
    provider: input.provider,
    model: input.model,
    agent: input.agent,
    messages: input.messages,
    system: input.system,
    tools: input.tools,
    toolChoice: input.toolChoice,
    retries: input.retries,
    abortSignal: input.abortSignal,
  })

  return processStream({
    stream,
    onEvent: input.onEvent,
  })
}

