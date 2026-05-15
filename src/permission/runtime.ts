import { evaluatePermission } from "./evaluate"
import {
  PermissionAskRequiredError,
  PermissionDeniedError,
  PermissionRejectedError,
  type PermissionRequest,
  type PermissionRule,
  type PermissionRuleset,
} from "./schema"

export interface PermissionRuntime {
  ask(input: PermissionRequest & { ruleset: PermissionRuleset }): Promise<void>
}

export interface CreatePermissionRuntimeInput {
  approved?: PermissionRuleset
  onAsk?: (input: PermissionRequest, rules: PermissionRule[]) => Promise<"once" | "always" | "reject">
}

export function createPermissionRuntime(input: CreatePermissionRuntimeInput = {}): PermissionRuntime {
  const approved = [...(input.approved ?? [])]

  return {
    ask: async (request) => {
      const relevant: PermissionRule[] = []
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluatePermission(request.permission, pattern, request.ruleset, approved)
        relevant.push(rule)

        if (rule.action === "deny") {
          throw new PermissionDeniedError(request, rule)
        }

        if (rule.action === "ask") {
          needsAsk = true
        }
      }

      if (!needsAsk) return

      if (!input.onAsk) {
        throw new PermissionAskRequiredError(request)
      }

      const reply = await input.onAsk(request, relevant)
      if (reply === "reject") {
        throw new PermissionRejectedError(request)
      }

      if (reply === "always") {
        approved.push(
          ...request.patterns.map((pattern) => ({
            permission: request.permission,
            pattern,
            action: "allow" as const,
          })),
        )
      }
    },
  }
}

