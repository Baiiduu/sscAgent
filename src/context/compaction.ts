import { createMessage, createPartID, type HarnessMessage } from "../harness"
import { contextBudget } from "./overflow"
import type { CompactionInput, CompactionResult } from "./schema"
import { estimateMessagesTokens } from "./estimate"

const TOOL_OUTPUT_MAX_CHARS = 2_000
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000

export const COMPACTION_SYSTEM_PROMPT = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`

const SUMMARY_TEMPLATE = `Output exactly this Markdown structure and keep the section order unchanged:
---
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
---

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

export function prepareCompaction(input: CompactionInput): Omit<CompactionResult, "summary"> | undefined {
  const selected = selectCompactionRange(input)
  if (!selected) return

  return {
    compacted: selected.compacted,
    preserved: selected.preserved,
    prompt: buildCompactionPrompt({
      messages: selected.compacted,
      previousSummary: input.previousSummary,
    }),
  }
}

export function createCompactionMessage(summary: string) {
  return createMessage({
    role: "user",
    parts: [
      {
        id: createPartID(),
        type: "text",
        text: `<session-summary>\n${summary.trim()}\n</session-summary>`,
      },
    ],
  })
}

export function buildCompactionPrompt(input: { messages: HarnessMessage[]; previousSummary?: string }) {
  const anchor = input.previousSummary
    ? [
        "Update the anchored summary below using the conversation history above.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        "<previous-summary>",
        input.previousSummary,
        "</previous-summary>",
      ].join("\n")
    : "Create a new anchored summary from the conversation history above."

  return [anchor, SUMMARY_TEMPLATE, "<conversation-history>", serializeMessages(input.messages), "</conversation-history>"].join(
    "\n\n",
  )
}

function selectCompactionRange(input: CompactionInput) {
  const tailStart = selectTailStart(input)
  if (tailStart <= 0) return

  return {
    compacted: input.messages.slice(0, tailStart),
    preserved: input.messages.slice(tailStart),
  }
}

function selectTailStart(input: CompactionInput) {
  const userStarts = input.messages.flatMap((message, index) => (message.role === "user" ? [index] : []))
  if (userStarts.length <= 1) return 0

  const budget = input.preserveRecentTokens ?? preserveRecentBudget(input)
  const tailTurns = input.tailTurns ?? DEFAULT_TAIL_TURNS
  const candidateStarts = userStarts.slice(-Math.max(1, tailTurns))
  const budgetedStart = candidateStarts.find((start) => estimateMessagesTokens(input.messages.slice(start)) <= budget)
  if (budgetedStart !== undefined) return budgetedStart

  return candidateStarts.at(-1) ?? 0
}

function preserveRecentBudget(input: Pick<CompactionInput, "model">) {
  return Math.min(
    MAX_PRESERVE_RECENT_TOKENS,
    Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(contextBudget({ model: input.model }).usable * 0.25)),
  )
}

function serializeMessages(messages: HarnessMessage[]) {
  return messages.map(serializeMessage).join("\n\n")
}

function serializeMessage(message: HarnessMessage) {
  return [
    `<message role="${message.role}" id="${message.id}">`,
    message.parts.map(serializePart).filter(Boolean).join("\n"),
    `</message>`,
  ].join("\n")
}

function serializePart(part: HarnessMessage["parts"][number]) {
  if (part.type === "text") return `<text>\n${part.text}\n</text>`
  if (part.type === "reasoning") return `<reasoning>\n${part.text}\n</reasoning>`
  if (part.type === "error") return `<error>\n${part.error}\n</error>`
  if (part.type === "tool-call") {
    return [`<tool-call name="${part.toolName}" id="${part.toolCallID}">`, JSON.stringify(part.input), `</tool-call>`].join(
      "\n",
    )
  }
  if (part.type === "tool-result") {
    return [
      `<tool-result name="${part.toolName}" id="${part.toolCallID}">`,
      truncateToolOutput(String(part.output)),
      `</tool-result>`,
    ].join("\n")
  }
  return ""
}

function truncateToolOutput(output: string) {
  if (output.length <= TOOL_OUTPUT_MAX_CHARS) return output
  return `${output.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[Tool output truncated for compaction: omitted ${
    output.length - TOOL_OUTPUT_MAX_CHARS
  } chars]`
}
