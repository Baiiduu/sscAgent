import { builtinAgents, mergeRules } from "./builtin"
import { AgentNotFoundError, type AgentConfig, type AgentInfo } from "./schema"

export interface AgentRegistry {
  list(): AgentInfo[]
  get(agentName: string): AgentInfo
  defaultAgent(): AgentInfo
}

export interface CreateAgentRegistryInput {
  agents?: Record<string, AgentConfig>
  defaultAgent?: string
}

export function createAgentRegistry(input: CreateAgentRegistryInput = {}): AgentRegistry {
  const agents = mergeAgents(builtinAgents(), input.agents ?? {})
  const defaultName = input.defaultAgent ?? "build"

  return {
    list: () =>
      Object.values(agents).sort((a, b) => {
        if (a.name === defaultName) return -1
        if (b.name === defaultName) return 1
        return a.name.localeCompare(b.name)
      }),
    get: (agentName) => {
      const agent = agents[agentName]
      if (!agent) throw new AgentNotFoundError(agentName)
      return agent
    },
    defaultAgent: () => {
      const agent = agents[defaultName]
      if (!agent) throw new AgentNotFoundError(defaultName)
      if (agent.mode === "subagent") throw new Error(`Default agent cannot be a subagent: ${defaultName}`)
      if (agent.hidden) throw new Error(`Default agent cannot be hidden: ${defaultName}`)
      return agent
    },
  }
}

function mergeAgents(base: Record<string, AgentInfo>, configs: Record<string, AgentConfig>) {
  const agents = { ...base }

  for (const [key, config] of Object.entries(configs)) {
    if (config.disable) {
      delete agents[key]
      continue
    }

    const existing = agents[key]
    agents[key] = {
      name: config.name ?? existing?.name ?? key,
      description: config.description ?? existing?.description,
      mode: config.mode ?? existing?.mode ?? "all",
      prompt: config.prompt ?? existing?.prompt,
      permission: mergeRules(existing?.permission ?? [], config.permission ?? []),
      model: config.model ?? existing?.model,
      temperature: config.temperature ?? existing?.temperature,
      topP: config.topP ?? existing?.topP,
      maxOutputTokens: config.maxOutputTokens ?? existing?.maxOutputTokens,
      options: config.options ?? existing?.options,
      steps: config.steps ?? existing?.steps,
      hidden: config.hidden ?? existing?.hidden,
      native: existing?.native ?? false,
    }
  }

  return agents
}

