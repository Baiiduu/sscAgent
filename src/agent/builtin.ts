import type { AgentInfo } from "./schema"
import type { PermissionRuleset } from "../permission"
import { CODE_PROMPT, COMPACTION_PROMPT, EXPLORE_PROMPT, REVIEW_PROMPT, SUMMARY_PROMPT, TEST_PROMPT, TITLE_PROMPT } from "./prompt"

export function defaultPermission(): PermissionRuleset {
  return [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "external_directory", pattern: "*", action: "ask" },
    { permission: "question", pattern: "*", action: "deny" },
    { permission: "plan_enter", pattern: "*", action: "deny" },
    { permission: "plan_exit", pattern: "*", action: "deny" },
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*.env", action: "ask" },
    { permission: "read", pattern: "*.env.*", action: "ask" },
    { permission: "read", pattern: "*.env.example", action: "allow" },
  ]
}

export function builtinAgents(): Record<string, AgentInfo> {
  const defaults = defaultPermission()
  return {
    build: {
      name: "build",
      description: "The default agent. Executes tools based on configured permissions.",
      permission: mergeRules(defaults, [
        { permission: "question", pattern: "*", action: "allow" },
        { permission: "plan_enter", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "allow" },
      ]),
      mode: "primary",
      native: true,
    },
    plan: {
      name: "plan",
      description: "Plan mode. Disallows edit tools.",
      permission: mergeRules(defaults, [
        { permission: "question", pattern: "*", action: "allow" },
        { permission: "plan_exit", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "*", action: "deny" },
      ]),
      mode: "primary",
      native: true,
    },
    general: {
      name: "general",
      description: "General-purpose subagent for research and multi-step tasks.",
      permission: mergeRules(defaults, [{ permission: "todowrite", pattern: "*", action: "deny" }]),
      mode: "subagent",
      native: true,
    },
    explore: {
      name: "explore",
      description: "Fast codebase exploration subagent.",
      prompt: EXPLORE_PROMPT,
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "grep", pattern: "*", action: "allow" },
        { permission: "glob", pattern: "*", action: "allow" },
        { permission: "bash", pattern: "*", action: "allow" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "external_directory", pattern: "*", action: "ask" },
      ],
      mode: "subagent",
      native: true,
    },
    code: {
      name: "code",
      description: "Execute one assigned implementation task.",
      prompt: CODE_PROMPT,
      permission: mergeRules(defaults, [
        { permission: "question", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "todowrite", pattern: "*", action: "deny" },
      ]),
      mode: "subagent",
      native: true,
    },
    test: {
      name: "test",
      description: "Add or run focused tests and verification for completed implementation work.",
      prompt: TEST_PROMPT,
      permission: mergeRules(defaults, [
        { permission: "question", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "todowrite", pattern: "*", action: "deny" },
      ]),
      mode: "subagent",
      native: true,
    },
    review: {
      name: "review",
      description: "Review completed implementation for bugs, regressions, missing tests, and risks.",
      prompt: REVIEW_PROMPT,
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "grep", pattern: "*", action: "allow" },
        { permission: "glob", pattern: "*", action: "allow" },
        { permission: "bash", pattern: "*", action: "allow" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "todowrite", pattern: "*", action: "deny" },
        { permission: "external_directory", pattern: "*", action: "ask" },
      ],
      mode: "subagent",
      native: true,
    },
    title: {
      name: "title",
      mode: "primary",
      hidden: true,
      native: true,
      temperature: 0.5,
      prompt: TITLE_PROMPT,
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    },
    summary: {
      name: "summary",
      mode: "primary",
      hidden: true,
      native: true,
      prompt: SUMMARY_PROMPT,
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    },
    compaction: {
      name: "compaction",
      mode: "primary",
      hidden: true,
      native: true,
      prompt: COMPACTION_PROMPT,
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    },
  }
}

export function mergeRules(...rulesets: PermissionRuleset[]): PermissionRuleset {
  return rulesets.flat()
}
