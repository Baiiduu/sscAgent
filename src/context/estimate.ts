import type { HarnessMessage } from "../harness"

const CHARS_PER_TOKEN = 4

export function estimateTextTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessageTokens(message: HarnessMessage) {
  return message.parts.reduce((sum, part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return sum + estimateTextTokens(part.text)
    }
    if (part.type === "tool-call") {
      return sum + estimateTextTokens(`${part.toolName}\n${JSON.stringify(part.input)}`)
    }
    if (part.type === "tool-result") {
      return sum + estimateTextTokens(`${part.toolName}\n${String(part.output)}`)
    }
    if (part.type === "error") {
      return sum + estimateTextTokens(part.error)
    }
    return sum
  }, 0)
}

export function estimateMessagesTokens(messages: HarnessMessage[]) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

