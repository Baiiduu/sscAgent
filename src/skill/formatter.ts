import type { LoadedSkill, SkillInfo } from "./schema"

export function formatSkillList(skills: SkillInfo[]) {
  if (skills.length === 0) return "No skills available."
  return formatAvailableSkills(skills, { verbose: false })
}

export function formatLoadedSkill(skill: LoadedSkill) {
  const base = dirname(skill.path)
  return [
    `<skill_content name="${escapeAttribute(skill.name)}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${escapeText(base)}`,
    "Relative paths in this skill, such as scripts/, references/, or assets/, are relative to this base directory.",
    "</skill_content>",
  ].join("\n")
}

export function formatAvailableSkills(skills: SkillInfo[], input: { verbose?: boolean } = {}) {
  if (skills.length === 0) return "No skills are currently available."
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))

  if (input.verbose) {
    return [
      "<available_skills>",
      ...sorted.flatMap((skill) => [
        "  <skill>",
        `    <name>${escapeText(skill.name)}</name>`,
        `    <description>${escapeText(skill.description ?? "")}</description>`,
        `    <location>${escapeText(skill.path)}</location>`,
        "  </skill>",
      ]),
      "</available_skills>",
    ].join("\n")
  }

  return ["## Available Skills", ...sorted.map((skill) => `- **${skill.name}**: ${skill.description ?? skill.path}`)].join(
    "\n",
  )
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function dirname(filepath: string) {
  const normalized = filepath.replaceAll("\\", "/")
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "." : normalized.slice(0, index)
}
