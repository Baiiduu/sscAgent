export interface TextDiff {
  patch: string
  additions: number
  deletions: number
}

export function createTextDiff(filepath: string, before: string, after: string): TextDiff {
  if (before === after) {
    return {
      patch: "No changes.",
      additions: 0,
      deletions: 0,
    }
  }

  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const patch = [`--- ${filepath}`, `+++ ${filepath}`]
  let additions = 0
  let deletions = 0

  for (const line of beforeLines) {
    patch.push(`- ${line}`)
    deletions++
  }

  for (const line of afterLines) {
    patch.push(`+ ${line}`)
    additions++
  }

  return {
    patch: patch.join("\n"),
    additions,
    deletions,
  }
}

