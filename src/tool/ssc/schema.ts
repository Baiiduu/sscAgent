import { z } from "zod"

export const ProjectIDSchema = z.union([z.number().int().positive(), z.string().min(1)])

export const DependencyInputSchema = z.object({
  namespace: z.string().optional(),
  name: z.string(),
  version: z.string(),
  purl: z.string().optional(),
})

export type DependencyInput = z.infer<typeof DependencyInputSchema>

export const BackendToolOptionsSchema = z.object({
  baseUrl: z.string().url().optional(),
})

export function projectPath(projectID: string | number, suffix: string) {
  return `/api/projects/${encodeURIComponent(String(projectID))}/${suffix.replace(/^\/+/, "")}`
}
