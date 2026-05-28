import { z } from "zod"

export const FindingKindSchema = z.enum(["dependency", "source", "configuration", "secret", "other"])
export type FindingKind = z.infer<typeof FindingKindSchema>

export const FindingSeveritySchema = z.enum(["critical", "high", "medium", "low", "unknown"])
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>

export const FindingEventTypeSchema = z.enum([
  "opened",
  "dependency_match",
  "vulnerability_lookup",
  "source_evidence",
  "reachability_analysis",
  "triage_note",
  "poc_generated",
  "poc_evaluated",
  "fix_generated",
  "fix_validated",
  "blocked",
])
export type FindingEventType = z.infer<typeof FindingEventTypeSchema>

export const FindingEventSourceSchema = z.enum(["agent", "tool", "human", "system"])
export type FindingEventSource = z.infer<typeof FindingEventSourceSchema>

export const FindingConclusionSchema = z.enum([
  "verified_impact",
  "likely_impact",
  "needs_evidence",
  "not_affected",
  "blocked",
  "fixed",
])
export type FindingConclusion = z.infer<typeof FindingConclusionSchema>

export const FindingConfidenceSchema = z.enum(["high", "medium", "low"])
export type FindingConfidence = z.infer<typeof FindingConfidenceSchema>

export const FindingSchema = z.object({
  id: z.string().min(1),
  sessionID: z.string().min(1),
  runID: z.string().min(1).optional(),
  stableKey: z.string().min(1),
  title: z.string().min(1),
  kind: FindingKindSchema,
  severity: FindingSeveritySchema.optional(),
  primaryIdentifier: z.string().min(1).optional(),
  packageName: z.string().min(1).optional(),
  purl: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type Finding = z.infer<typeof FindingSchema>

export const FindingEventSchema = z.object({
  id: z.string().min(1),
  findingID: z.string().min(1),
  sessionID: z.string().min(1),
  runID: z.string().min(1).optional(),
  type: FindingEventTypeSchema,
  source: FindingEventSourceSchema,
  summary: z.string().min(1),
  data: z.unknown().optional(),
  artifactPath: z.string().min(1).optional(),
  createdAt: z.number().int(),
})
export type FindingEvent = z.infer<typeof FindingEventSchema>

export const FindingProjectionSchema = z.object({
  conclusion: FindingConclusionSchema,
  confidence: FindingConfidenceSchema,
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
})
export type FindingProjection = z.infer<typeof FindingProjectionSchema>

export const FindingListItemSchema = FindingSchema.extend({
  eventCount: z.number().int().nonnegative(),
  projection: FindingProjectionSchema,
})
export type FindingListItem = z.infer<typeof FindingListItemSchema>

export const FindingDetailSchema = z.object({
  finding: FindingSchema,
  events: z.array(FindingEventSchema),
  projection: FindingProjectionSchema,
})
export type FindingDetail = z.infer<typeof FindingDetailSchema>

export const FindingCaptureInputSchema = z.object({
  action: z.enum(["open", "append_event"]),
  stableKey: z.string().min(1),

  title: z.string().min(1).optional(),
  kind: FindingKindSchema.optional(),
  severity: FindingSeveritySchema.optional(),
  primaryIdentifier: z.string().min(1).optional(),
  packageName: z.string().min(1).optional(),
  purl: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),

  type: FindingEventTypeSchema.exclude(["opened"]).optional(),
  source: FindingEventSourceSchema.optional(),
  summary: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  artifactPath: z.string().min(1).optional(),
})
export type FindingCaptureRawInput = z.infer<typeof FindingCaptureInputSchema>
export type FindingCaptureInput =
  | {
      action: "open"
      stableKey: string
      title: string
      kind: FindingKind
      severity?: FindingSeverity
      primaryIdentifier?: string
      packageName?: string
      purl?: string
      filePath?: string
    }
  | {
      action: "append_event"
      stableKey: string
      type: Exclude<FindingEventType, "opened">
      source?: FindingEventSource
      summary: string
      data?: Record<string, unknown>
      artifactPath?: string
    }
