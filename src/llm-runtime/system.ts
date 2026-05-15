import type { ModelMessage } from "ai"
import type { ModelInfo } from "../provider"
import { discoverSkills } from "../skill/discovery"
import { formatAvailableSkills } from "../skill/formatter"
import type { AgentProfile, UserContext } from "./schema"

export function providerSystemPrompt(model: ModelInfo) {
  const id = model.api.id.toLowerCase()
  if (id.includes("claude")) return "You are Claude, a helpful AI assistant."
  if (id.includes("gpt")) return "You are ChatGPT, a helpful AI assistant."
  if (id.includes("deepseek")) return "You are DeepSeek, a helpful AI assistant."
  return "You are a helpful AI assistant."
}

export interface BuildSystemPromptInput {
  agent: AgentProfile
  model: ModelInfo
  system?: string[]
  user?: UserContext
}

export function buildSystemPrompt(input: BuildSystemPromptInput) {
  return [
    input.agent.prompt ?? providerSystemPrompt(input.model),
    ...(input.system ?? []),
    ...(input.user?.system ? [input.user.system] : []),
  ]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join("\n")
}

export async function buildSystemMessages(input: BuildSystemPromptInput): Promise<ModelMessage[]> {
  const content = [
    buildSystemPrompt(input),
    input.user?.tools?.skill === false ? undefined : await buildAvailableSkillsPrompt(),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join("\n\n")

  if (!content) return []
  return [
    {
      role: "system",
      content,
    },
  ]
}

async function buildAvailableSkillsPrompt() {
  const skills = await discoverSkills()
  if (skills.length === 0) return undefined

  return [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    formatAvailableSkills(skills, { verbose: true }),
  ].join("\n")
}
