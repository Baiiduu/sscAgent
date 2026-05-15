import { discoverSkills } from "./discovery"
import { loadSkill } from "./loader"
import type { LoadedSkill, SkillDiscoveryInput, SkillInfo } from "./schema"

export interface SkillRegistry {
  list(): Promise<SkillInfo[]>
  get(name: string): Promise<LoadedSkill>
  has(name: string): Promise<boolean>
}

export function createSkillRegistry(input: SkillDiscoveryInput = {}): SkillRegistry {
  return {
    list: () => discoverSkills(input),
    get: (name) => loadSkill({ ...input, name }),
    has: async (name) => (await discoverSkills(input)).some((skill) => skill.name === name),
  }
}
