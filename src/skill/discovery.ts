import path from "node:path"
import { stat } from "node:fs/promises"
import type { SkillDiscoveryInput, SkillInfo } from "./schema"

const DEFAULT_SKILL_ROOT = path.resolve(import.meta.dir, "../../skills")
const SKILL_FILE = "SKILL.md"

export async function discoverSkills(input: SkillDiscoveryInput = {}): Promise<SkillInfo[]> {
  const roots = input.roots?.length ? input.roots : [DEFAULT_SKILL_ROOT]
  const skills: SkillInfo[] = []

  for (const root of roots) {
    const base = path.resolve(root)
    if (!(await exists(base))) continue

    const matches = await Array.fromAsync(new Bun.Glob(`*/${SKILL_FILE}`).scan({ cwd: base, dot: true }))
    for (const match of matches.sort()) {
      const filepath = path.join(base, match)
      const content = await Bun.file(filepath).text().catch(() => "")
      const metadata = parseFrontmatter(content)
      const name = metadata.name ?? path.basename(path.dirname(filepath))
      skills.push({
        name,
        path: filepath,
        description: metadata.description ?? extractDescription(content),
      })
    }
  }

  return uniqueByName(skills)
}

function parseFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) return {}

  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return {}

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) return {}

  const data: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf(":")
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    const value = unquote(trimmed.slice(separator + 1).trim())
    if (key && value) data[key] = value
  }

  return {
    name: data.name,
    description: data.description,
  }
}

function extractDescription(content: string) {
  const lines = stripFrontmatter(content).split(/\r?\n/).map((line) => line.trim())
  const heading = lines.find((line) => line.startsWith("# "))
  if (heading) return heading.replace(/^#\s+/, "").trim()
  return lines.find((line) => line && !line.startsWith("#"))
}

function stripFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) return normalized

  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return normalized

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) return normalized

  return lines.slice(end + 1).join("\n")
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function uniqueByName(skills: SkillInfo[]) {
  const seen = new Set<string>()
  return skills.filter((skill) => {
    if (seen.has(skill.name)) return false
    seen.add(skill.name)
    return true
  })
}

async function exists(filepath: string) {
  return stat(filepath)
    .then((info) => info.isDirectory())
    .catch(() => false)
}
