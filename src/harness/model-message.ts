import type { ModelMessage } from "ai"
import type { HarnessMessage } from "./message"

type AssistantContent = Extract<ModelMessage, { role: "assistant" }>["content"]
type AssistantContentPart = Exclude<AssistantContent, string>[number]

export function toModelMessages(messages: HarnessMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "user") {
      return [
        {
          role: "user" as const,
          content: textContent(message),
        },
      ]
    }

    if (message.role === "assistant") {
      return [
        {
          role: "assistant" as const,
          content: assistantContent(message),
        },
      ]
    }

    return message.parts
      .filter((part) => part.type === "tool-result")
      .map((part) => ({
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: part.toolCallID,
            toolName: part.toolName,
            output: {
              type: "text" as const,
              value: String(part.output),
            },
          },
        ],
      }))
  })
}

function textContent(message: HarnessMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function assistantContent(message: HarnessMessage): AssistantContent {
  const content = message.parts.flatMap((part): AssistantContentPart[] => {
    if (part.type === "text") {
      return [
        {
          type: "text" as const,
          text: part.text,
        },
      ]
    }

    if (part.type === "reasoning") {
      return [
        {
          type: "reasoning" as const,
          text: part.text,
        },
      ]
    }

    if (part.type === "tool-call") {
      return [
        {
          type: "tool-call" as const,
          toolCallId: part.toolCallID,
          toolName: part.toolName,
          input: part.input,
        },
      ]
    }

    return []
  })

  if (content.length === 1 && content[0]?.type === "text") return content[0].text
  return content
}
