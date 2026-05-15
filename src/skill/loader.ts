import { discoverSkills } from "./discovery"
import type { LoadedSkill, SkillDiscoveryInput } from "./schema"

export interface LoadSkillInput extends SkillDiscoveryInput {
  name: string
}

export async function loadSkill(input: LoadSkillInput): Promise<LoadedSkill> {
  const skills = await discoverSkills(input)
  const skill = skills.find((item) => item.name === input.name)
  if (!skill) throw new Error(`Skill not found: ${input.name}`)

  return {
    ...skill,
    content: await Bun.file(skill.path).text(),
  }
}
