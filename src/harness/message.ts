export type MessageRole = "user" | "assistant" | "tool"

export interface MessagePartBase {
  id: string
  sessionID?: string
  messageID?: string
  time?: {
    created: number
    updated?: number
    completed?: number
  }
}

export type MessagePart =
  | {
      id: string
      sessionID?: string
      messageID?: string
      time?: MessagePartBase["time"]
      type: "text"
      text: string
    }
  | {
      id: string
      sessionID?: string
      messageID?: string
      time?: MessagePartBase["time"]
      type: "reasoning"
      text: string
    }
  | {
      id: string
      sessionID?: string
      messageID?: string
      time?: MessagePartBase["time"]
      type: "tool-call"
      toolCallID: string
      toolName: string
      input: unknown
    }
  | {
      id: string
      sessionID?: string
      messageID?: string
      time?: MessagePartBase["time"]
      type: "tool-result"
      toolCallID: string
      toolName: string
      output: unknown
      title?: string
      metadata?: Record<string, unknown>
    }
  | {
      id: string
      sessionID?: string
      messageID?: string
      time?: MessagePartBase["time"]
      type: "error"
      error: string
    }

export interface HarnessMessage {
  id: string
  sessionID?: string
  role: MessageRole
  parentID?: string
  parts: MessagePart[]
  time: {
    created: number
    completed?: number
  }
  finishReason?: string
}

export function createMessage(input: {
  id?: string
  sessionID?: string
  role: MessageRole
  parentID?: string
  parts?: MessagePart[]
  time?: HarnessMessage["time"]
  finishReason?: string
}): HarnessMessage {
  const id = input.id ?? createID("msg")
  return {
    id,
    sessionID: input.sessionID,
    role: input.role,
    parentID: input.parentID,
    parts: (input.parts ?? []).map((part) => attachPartContext(part, input.sessionID, id)),
    time: input.time ?? {
      created: Date.now(),
    },
    finishReason: input.finishReason,
  }
}

export function createPartID() {
  return createID("part")
}

function createID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function attachPartContext(part: MessagePart, sessionID: string | undefined, messageID: string): MessagePart {
  return {
    ...part,
    sessionID: part.sessionID ?? sessionID,
    messageID: part.messageID ?? messageID,
    time: part.time ?? {
      created: Date.now(),
    },
  } as MessagePart
}
