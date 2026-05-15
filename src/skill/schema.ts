import { z } from "zod"

export const SkillInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
})

export const LoadedSkillSchema = SkillInfoSchema.extend({
  content: z.string(),
})

export type SkillInfo = z.infer<typeof SkillInfoSchema>
export type LoadedSkill = z.infer<typeof LoadedSkillSchema>

export interface SkillDiscoveryInput {
  roots?: string[]
}
