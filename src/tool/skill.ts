import path from "node:path"
import { z } from "zod"
import { formatAvailableSkills, formatLoadedSkill, loadSkill, discoverSkills } from "../skill"
import type { ToolDef } from "./schema"

export interface SkillToolInput {
  name?: string
}

export interface CreateSkillToolInput {
  roots?: string[]
}

export function createSkillTool(input: CreateSkillToolInput = {}): ToolDef<SkillToolInput> {
  return {
    id: "skill",
    description: [
      "Load a specialized skill when the task matches one of the available skills listed in the system prompt.",
      "Use the exact skill name from <available_skills>.",
      "The output injects a <skill_content name=\"...\"> block with detailed instructions for the current conversation.",
      "Call without a name only to inspect the available skills list.",
    ].join("\n"),
    inputSchema: z.object({
      name: z.string().optional().describe("Exact skill name from <available_skills>. Omit only to list skills."),
    }),
    execute: async (params, ctx) => {
      const roots = input.roots ?? [path.resolve(ctx.cwd, "skills"), path.resolve(import.meta.dir, "../../skills")]
      const skills = await discoverSkills({ roots })

      if (!params.name) {
        return {
          title: "Available skills",
          output: formatAvailableSkills(skills, { verbose: false }),
          metadata: {
            skills: skills.map((skill) => skill.name),
          },
        }
      }

      const known = skills.find((skill) => skill.name === params.name)
      if (!known) {
        throw new Error(`Skill "${params.name}" not found. Available skills: ${skills.map((skill) => skill.name).join(", ") || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        metadata: {
          name: params.name,
          path: known.path,
        },
      })

      const skill = await loadSkill({ roots, name: params.name })
      return {
        title: `Loaded skill: ${skill.name}`,
        output: formatLoadedSkill(skill),
        metadata: {
          name: skill.name,
          path: skill.path,
          description: skill.description,
        },
      }
    },
  }
}
