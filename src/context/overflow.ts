import type { ContextBudget, OverflowInput, TokenUsage } from "./schema"
import type { ModelInfo } from "../provider"

const COMPACTION_BUFFER = 20_000

export function contextBudget(input: { model: ModelInfo; reserved?: number }): ContextBudget {
  const context = input.model.limit.context
  const output = input.model.limit.output
  const reserved = input.reserved ?? Math.min(COMPACTION_BUFFER, output)
  const usable = input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - output)

  return {
    context,
    input: input.model.limit.input,
    output,
    reserved,
    usable,
  }
}

export function isOverflow(input: OverflowInput) {
  if (input.auto === false) return false
  if (input.model.limit.context === 0) return false
  return tokenTotal(input.usage) >= contextBudget(input).usable
}

export function tokenTotal(usage: TokenUsage) {
  return usage.total ?? usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

