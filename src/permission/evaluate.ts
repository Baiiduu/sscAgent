import type { PermissionRule, PermissionRuleset } from "./schema"

export function evaluatePermission(permission: string, pattern: string, ...rulesets: PermissionRuleset[]): PermissionRule {
  const rules = rulesets.flat()
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]
    if (wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern)) {
      return rule
    }
  }
  return {
    permission,
    pattern: "*",
    action: "ask",
  }
}

export function wildcardMatch(value: string, pattern: string) {
  if (pattern === "*") return true
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
  return new RegExp(`^${escaped}$`).test(value)
}
