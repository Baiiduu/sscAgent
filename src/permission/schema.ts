export type PermissionAction = "allow" | "deny" | "ask"

export interface PermissionRule {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = PermissionRule[]

export interface PermissionRequest {
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}

export type PermissionReply = "once" | "always" | "reject"

export class PermissionDeniedError extends Error {
  constructor(
    readonly request: PermissionRequest,
    readonly rule: PermissionRule,
  ) {
    super(`Permission denied: ${request.permission}`)
    this.name = "PermissionDeniedError"
  }
}

export class PermissionRejectedError extends Error {
  constructor(readonly request: PermissionRequest) {
    super(`Permission rejected: ${request.permission}`)
    this.name = "PermissionRejectedError"
  }
}

export class PermissionAskRequiredError extends Error {
  constructor(readonly request: PermissionRequest) {
    super(`Permission requires approval: ${request.permission}`)
    this.name = "PermissionAskRequiredError"
  }
}

