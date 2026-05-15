import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { assertInsideWorkspace } from "../external-directory"
import type { ToolDef } from "../schema"

const DEFAULT_CDXGEN_URL = "http://localhost:9090"
const DEFAULT_TIMEOUT = 300_000

export interface CreateSBOMGenerateToolInput {
  cdxgenUrl?: string
  timeout?: number
}

const InputSchema = z.object({
  repositoryPath: z
    .string()
    .min(1)
    .describe("Local repository path to generate an SBOM for. Relative paths resolve from the session cwd."),
})

type SBOMGenerateInput = z.infer<typeof InputSchema>

export function createSBOMGenerateTool(input: CreateSBOMGenerateToolInput = {}): ToolDef<SBOMGenerateInput> {
  return {
    id: "sbom_generate",
    description:
      "Generate a CycloneDX SBOM by calling the local cdxgen service. The model should pass only the local repository path.",
    inputSchema: InputSchema,
    execute: async (params, ctx) => {
      const target = params.repositoryPath.trim()
      const isRemoteRepository = isURL(target)
      const repositoryPath = isRemoteRepository ? target : resolveRepositoryPath(target, ctx.cwd)

      if (!isRemoteRepository) {
        await assertInsideWorkspace({
          filepath: repositoryPath,
          workspace: ctx.workspace,
          allowedExternalPaths: ctx.allowedExternalPaths,
          ctx,
          kind: "directory",
        })
      }

      const type = isRemoteRepository ? "universal" : await inferCdxgenType(repositoryPath)
      const cdxgenUrl = normalizeBaseUrl(input.cdxgenUrl ?? process.env.CDXGEN_URL ?? DEFAULT_CDXGEN_URL)
      const sbom = await requestSBOM({
        cdxgenUrl,
        repository: repositoryPath,
        type,
        timeout: input.timeout ?? Number(process.env.CDXGEN_TIMEOUT_MS ?? DEFAULT_TIMEOUT),
        isRemoteRepository,
        signal: ctx.abortSignal,
      })
      const summary = summarizeSBOM(sbom)
      const artifacts = await writeSBOMArtifacts({
        sbom,
        summary,
        repositoryPath,
        repositoryTarget: target,
        type,
        cdxgenUrl,
        workspace: ctx.workspace,
        isRemoteRepository,
      })

      return {
        title: `SBOM generated: ${displayTarget(repositoryPath)}`,
        output: JSON.stringify(
          {
            cdxgenUrl,
            repositoryPath,
            type,
            artifacts,
            summary,
            nextActions: [
              "Use the SBOM artifact path for dependency parsing or vulnerability lookup.",
              "Do not request the full SBOM in the conversation unless the user explicitly asks.",
            ],
          },
          null,
          2,
        ),
        metadata: {
          cdxgenUrl,
          repositoryPath,
          type,
          sbomPath: artifacts.sbomPath,
          summaryPath: artifacts.summaryPath,
          ...summary,
        },
      }
    },
  }
}

interface RequestSBOMInput {
  cdxgenUrl: string
  repository: string
  type: string
  timeout: number
  isRemoteRepository: boolean
  signal: AbortSignal
}

async function requestSBOM(input: RequestSBOMInput) {
  const url = new URL(`${input.cdxgenUrl}/sbom`)
  url.searchParams.set("type", input.type)
  url.searchParams.set(input.isRemoteRepository ? "url" : "path", input.repository)

  const timeoutController = new AbortController()
  const timeoutID = setTimeout(() => timeoutController.abort(), input.timeout)
  const signal = AbortSignal.any([input.signal, timeoutController.signal])

  try {
    const response = await fetch(url, { method: "GET", signal })
    const text = await response.text()
    const data = parseJSON(text)

    if (!response.ok) {
      throw new Error(`cdxgen request failed (${response.status} ${response.statusText}): ${formatErrorBody(data, text)}`)
    }

    return data
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`cdxgen request timed out after ${input.timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutID)
  }
}

async function inferCdxgenType(repositoryPath: string) {
  const names = await listRepositoryFiles(repositoryPath)
  const has = (...candidates: string[]) => candidates.some((candidate) => names.has(candidate.toLowerCase()))

  if (has("package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "bun.lock")) return "js"
  if (has("go.mod", "go.sum")) return "go"
  if (has("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts")) return "java"
  if (has("requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile", "Pipfile.lock")) return "python"
  if (has("composer.json", "composer.lock")) return "php"
  if (has("Cargo.toml", "Cargo.lock")) return "rust"
  if (has("Gemfile", "Gemfile.lock") || [...names].some((name) => name.endsWith(".gemspec"))) return "ruby"
  if ([...names].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) return "dotnet"
  if (has("conanfile.txt", "conanfile.py", "vcpkg.json", "CMakeLists.txt".toLowerCase())) return "cpp"

  return "universal"
}

async function listRepositoryFiles(repositoryPath: string) {
  let info
  try {
    info = await stat(repositoryPath)
  } catch {
    throw new Error(`Repository path does not exist: ${repositoryPath}`)
  }

  if (!info.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repositoryPath}`)
  }

  const names = await readdir(repositoryPath)
  return new Set(names.map((item) => item.trim().toLowerCase()).filter(Boolean))
}

function summarizeSBOM(sbom: any) {
  const components = Array.isArray(sbom?.components) ? sbom.components : []
  const dependencies = Array.isArray(sbom?.dependencies) ? sbom.dependencies : []
  const directRefs = directDependencyRefs(sbom)

  return {
    bomFormat: sbom?.bomFormat,
    specVersion: sbom?.specVersion,
    serialNumber: sbom?.serialNumber,
    componentCount: components.length,
    dependencyEdgeCount: dependencies.reduce((sum: number, item: any) => sum + (item?.dependsOn?.length ?? 0), 0),
    directDependencyCount: directRefs.length,
    directDependencies: directRefs.slice(0, 100),
  }
}

function directDependencyRefs(sbom: any): string[] {
  const rootRef = sbom?.metadata?.component?.["bom-ref"]
  if (!rootRef || !Array.isArray(sbom?.dependencies)) return []
  const root = sbom.dependencies.find((item: any) => item?.ref === rootRef)
  return Array.isArray(root?.dependsOn) ? root.dependsOn : []
}

interface WriteSBOMArtifactsInput {
  sbom: unknown
  summary: ReturnType<typeof summarizeSBOM>
  repositoryPath: string
  repositoryTarget: string
  type: string
  cdxgenUrl: string
  workspace: string
  isRemoteRepository: boolean
}

async function writeSBOMArtifacts(input: WriteSBOMArtifactsInput) {
  const repoName = artifactRepositoryName(input.repositoryTarget, input.repositoryPath, input.isRemoteRepository)
  const artifactDir = path.resolve(input.workspace, "artifacts", repoName)
  const sbomPath = path.join(artifactDir, "sbom.cdx.json")
  const summaryPath = path.join(artifactDir, "sbom-summary.json")

  await mkdir(artifactDir, { recursive: true })
  await writeJSON(sbomPath, input.sbom)
  await writeJSON(summaryPath, {
    generatedAt: new Date().toISOString(),
    repositoryPath: input.repositoryPath,
    type: input.type,
    cdxgenUrl: input.cdxgenUrl,
    sbomPath,
    summary: input.summary,
  })

  return {
    artifactDir,
    sbomPath,
    summaryPath,
  }
}

async function writeJSON(filepath: string, data: unknown) {
  await writeFile(filepath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

function artifactRepositoryName(repositoryTarget: string, repositoryPath: string, isRemoteRepository: boolean) {
  if (isRemoteRepository) {
    try {
      const url = new URL(repositoryTarget)
      const pathname = url.pathname.replace(/\/+$/, "")
      const name = path.basename(pathname).replace(/\.git$/i, "")
      return sanitizeArtifactName(name || url.hostname)
    } catch {
      return "remote-repository"
    }
  }

  return sanitizeArtifactName(path.basename(path.resolve(repositoryPath)) || "repository")
}

function sanitizeArtifactName(name: string) {
  const sanitized = name
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^\.+$/, "")
  return sanitized || "repository"
}

function resolveRepositoryPath(repositoryPath: string, cwd: string) {
  return path.isAbsolute(repositoryPath) ? path.resolve(repositoryPath) : path.resolve(cwd, repositoryPath)
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "")
}

function isURL(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "git:" || url.protocol === "ssh:"
  } catch {
    return false
  }
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

function displayTarget(target: string) {
  return target.length <= 80 ? target : `...${target.slice(-77)}`
}
