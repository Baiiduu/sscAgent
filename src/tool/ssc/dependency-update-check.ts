import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const DEFAULT_TIMEOUT = 10_000

export interface CreateDependencyUpdateCheckToolInput {
  timeout?: number
}

const CandidateDependencySchema = z.object({
  purl: z.string().min(1).describe("Package URL selected by the agent, including the current version when available."),
})

const InputSchema = z.object({
  repositoryPath: z
    .string()
    .optional()
    .describe("Local repository path used only to derive the default artifact directory name."),
  artifactDir: z
    .string()
    .optional()
    .describe("Directory for the full dependency update check artifact. Relative paths resolve from the session cwd."),
  dependencies: z
    .array(CandidateDependencySchema)
    .min(1)
    .max(20)
    .describe("At most 20 important PURLs selected by the agent."),
})

type DependencyUpdateCheckInput = z.infer<typeof InputSchema>
type CandidateDependency = z.infer<typeof CandidateDependencySchema>

export function createDependencyUpdateCheckTool(
  input: CreateDependencyUpdateCheckToolInput = {},
): ToolDef<DependencyUpdateCheckInput> {
  return {
    id: "dependency_update_check",
    description:
      "Check latest available versions for up to 20 important PURLs selected by the agent. Pass only PURLs; selection rationale belongs in the agent response, not tool arguments.",
    inputSchema: InputSchema,
    execute: async (params, ctx) => {
      const artifactDir = resolveArtifactDir(params, ctx.cwd, ctx.workspace)

      await assertInsideWorkspace({
        filepath: artifactDir,
        workspace: ctx.workspace,
        allowedExternalPaths: ctx.allowedExternalPaths,
        ctx,
        kind: "directory",
      })

      const timeout = input.timeout ?? Number(process.env.DEPENDENCY_UPDATE_TIMEOUT_MS ?? DEFAULT_TIMEOUT)
      const results = await Promise.all(params.dependencies.map((dependency) => checkDependency(dependency, timeout, ctx.abortSignal)))
      const artifactPath = path.join(artifactDir, "dependency-update-check.json")
      const summary = summarizeResults(results)

      await mkdir(artifactDir, { recursive: true })
      await writeJSON(artifactPath, {
        generatedAt: new Date().toISOString(),
        repositoryPath: params.repositoryPath,
        checkedCount: params.dependencies.length,
        summary,
        results,
      })

      return {
        title: `Dependency update check: ${summary.checkedCount} PURLs`,
        output: JSON.stringify(
          {
            artifactPath,
            summary,
            topUpdates: results
              .filter((item) => item.updateAvailable)
              .slice(0, 20)
              .map((item) => ({
                purl: item.purl,
                currentVersion: item.currentVersion,
                latestVersion: item.latestVersion,
                source: item.source,
              })),
            unresolved: results
              .filter((item) => item.lookupStatus !== "found")
              .map((item) => ({
                purl: item.purl,
                lookupStatus: item.lookupStatus,
                status: item.status,
                error: item.error,
              })),
          },
          null,
          2,
        ),
        metadata: {
          artifactPath,
          checkedCount: summary.checkedCount,
          updateAvailableCount: summary.updateAvailableCount,
          unresolvedCount: summary.unresolvedCount,
        },
      }
    },
  }
}

async function checkDependency(dependency: CandidateDependency, timeout: number, abortSignal: AbortSignal) {
  const parsed = parsePurl(dependency.purl)

  if (!parsed.valid) {
    return resultFor(dependency, parsed, {
      latestVersion: undefined,
      lookupStatus: "not_found",
      status: "invalid_purl",
      source: "purl-parser",
    })
  }

  try {
    const latestVersion = await lookupLatestVersion(parsed, timeout, abortSignal)
    const updateAvailable = Boolean(
      latestVersion && parsed.version && compareVersions(latestVersion, parsed.version) > 0,
    )

    return resultFor(dependency, parsed, {
      latestVersion,
      updateAvailable,
      lookupStatus: latestVersion ? "found" : "not_found",
      status: latestVersion ? (updateAvailable ? "update_available" : "up_to_date") : "latest_not_found",
      source: sourceFor(parsed.ecosystem),
    })
  } catch (error) {
    return resultFor(dependency, parsed, {
      latestVersion: undefined,
      lookupStatus: "error",
      status: "lookup_error",
      source: sourceFor(parsed.ecosystem),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

interface ResultOptions {
  latestVersion?: string
  updateAvailable?: boolean
  lookupStatus: "found" | "not_found" | "error"
  status: string
  source?: string
  error?: string
}

function resultFor(dependency: CandidateDependency, parsed: ParsedPurl, options: ResultOptions) {
  return {
    purl: dependency.purl,
    packageName: parsed.packageName,
    ecosystem: parsed.ecosystem,
    currentVersion: parsed.version,
    latestVersion: options.latestVersion,
    updateAvailable: options.updateAvailable ?? false,
    lookupStatus: options.lookupStatus,
    status: options.status,
    source: options.source,
    error: options.error,
  }
}

type DependencyUpdateResult = ReturnType<typeof resultFor>

function summarizeResults(results: DependencyUpdateResult[]) {
  return {
    checkedCount: results.length,
    foundCount: results.filter((item) => item.lookupStatus === "found").length,
    unresolvedCount: results.filter((item) => item.lookupStatus !== "found").length,
    updateAvailableCount: results.filter((item) => item.updateAvailable).length,
  }
}

async function lookupLatestVersion(parsed: ParsedPurl, timeout: number, abortSignal: AbortSignal) {
  if (parsed.ecosystem === "npm") return lookupNpmLatest(parsed.packageName, timeout, abortSignal)
  if (parsed.ecosystem === "pypi") return lookupPypiLatest(parsed.packageName, timeout, abortSignal)
  if (parsed.ecosystem === "maven") return lookupMavenLatest(parsed.packageName, timeout, abortSignal)
  return undefined
}

async function lookupNpmLatest(packageName: string | undefined, timeout: number, abortSignal: AbortSignal) {
  if (!packageName) return undefined
  const url = `https://registry.npmmirror.com/${encodeURIComponent(packageName).replace(/%2F/g, "/")}`
  const data = await requestJSON(url, timeout, abortSignal)
  return isRecord(data) && isRecord(data["dist-tags"]) ? stringValue(data["dist-tags"].latest) : undefined
}

async function lookupPypiLatest(packageName: string | undefined, timeout: number, abortSignal: AbortSignal) {
  if (!packageName) return undefined
  const url = `https://pypi.tuna.tsinghua.edu.cn/pypi/${encodeURIComponent(packageName)}/json`
  const data = await requestJSON(url, timeout, abortSignal)
  return isRecord(data) && isRecord(data.info) ? stringValue(data.info.version) : undefined
}

async function lookupMavenLatest(packageName: string | undefined, timeout: number, abortSignal: AbortSignal) {
  if (!packageName) return undefined
  const [groupID, artifactID] = packageName.split("/")
  if (!groupID || !artifactID) return undefined

  const url = new URL("https://search.maven.org/solrsearch/select")
  url.searchParams.set("q", `g:${groupID} AND a:${artifactID}`)
  url.searchParams.set("rows", "1")
  url.searchParams.set("wt", "json")

  const data = await requestJSON(url.toString(), timeout, abortSignal)
  const docs = isRecord(data) && isRecord(data.response) && Array.isArray(data.response.docs) ? data.response.docs : []
  const first = docs.find(isRecord)
  return first ? stringValue(first.latestVersion) : undefined
}

async function requestJSON(url: string, timeout: number, abortSignal: AbortSignal) {
  const timeoutController = new AbortController()
  const timeoutID = setTimeout(() => timeoutController.abort(), timeout)
  const signal = AbortSignal.any([abortSignal, timeoutController.signal])

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "DependencyChecker/1.0",
      },
      signal,
    })
    const text = await response.text()
    const data = parseJSON(text)

    if (!response.ok) {
      throw new Error(`Request failed (${response.status} ${response.statusText}): ${formatErrorBody(data, text)}`)
    }

    return data
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`Request timed out after ${timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutID)
  }
}

function resolveArtifactDir(params: DependencyUpdateCheckInput, cwd: string, workspace: string) {
  if (params.artifactDir) {
    return path.isAbsolute(params.artifactDir) ? path.resolve(params.artifactDir) : path.resolve(cwd, params.artifactDir)
  }

  const repoName = params.repositoryPath ? sanitizeArtifactName(path.basename(path.resolve(cwd, params.repositoryPath))) : "repository"
  return path.resolve(workspace, "artifacts", repoName)
}

async function writeJSON(filepath: string, data: unknown) {
  await writeFile(filepath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

interface ParsedPurl {
  valid: boolean
  ecosystem?: string
  packageName?: string
  version?: string
}

function parsePurl(purl: string): ParsedPurl {
  const withoutScheme = purl.startsWith("pkg:") ? purl.slice(4) : purl
  const [withoutQualifiers] = withoutScheme.split("?", 1)
  const slashIndex = withoutQualifiers.indexOf("/")
  if (slashIndex <= 0) return { valid: false }

  const ecosystem = withoutQualifiers.slice(0, slashIndex)
  const rest = withoutQualifiers.slice(slashIndex + 1)
  const atIndex = rest.lastIndexOf("@")
  const packageName = atIndex >= 0 ? rest.slice(0, atIndex) : rest
  const version = atIndex >= 0 ? rest.slice(atIndex + 1) : undefined

  return {
    valid: Boolean(ecosystem && packageName),
    ecosystem,
    packageName,
    version,
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index++) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }

  return 0
}

function versionParts(version: string) {
  const matches = version.match(/\d+/g)
  return matches?.map((item) => Number(item)) ?? [0]
}

function parseJSON(text: string) {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatErrorBody(data: unknown, fallback: string) {
  if (typeof data === "object" && data && "error" in data) return String(data.error)
  if (typeof data === "string") return data
  return fallback
}

function sourceFor(ecosystem: string | undefined) {
  if (ecosystem === "npm") return "https://registry.npmmirror.com"
  if (ecosystem === "pypi") return "https://pypi.tuna.tsinghua.edu.cn"
  if (ecosystem === "maven") return "https://search.maven.org"
  return "unsupported"
}

function sanitizeArtifactName(name: string) {
  const sanitized = name
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^\.+$/, "")
  return sanitized || "repository"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}
