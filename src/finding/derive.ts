import type {
  Finding,
  FindingConfidence,
  FindingConclusion,
  FindingDetail,
  FindingEvent,
  FindingListItem,
  FindingProjection,
} from "./schema"

export function deriveFindingProjection(events: FindingEvent[]): FindingProjection {
  const sorted = [...events].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

  const fixValidated = latestEvent(sorted, "fix_validated")
  if (fixValidated && eventStatus(fixValidated) === "passed") {
    return projection("fixed", "high", ["修复验证事件显示该 finding 已通过验证。"], [])
  }

  const pocEvaluated = latestEvent(sorted, "poc_evaluated")
  if (pocEvaluated) {
    const status = eventStatus(pocEvaluated)
    if (status === "verified") {
      return projection(
        "verified_impact",
        "high",
        ["PoC 验证事件返回 verified，说明该问题已经通过项目入口或指定 oracle 验证。"],
        ["尚未看到修复验证事件。"],
      )
    }
    if (status === "inconclusive" || status === "unsafe_blocked" || status === "invalid") {
      return projection(
        "blocked",
        "medium",
        [`PoC 验证事件返回 ${status}，当前证据不足以确认实际影响。`],
        ["需要补充可安全执行且 oracle 明确的 PoC 验证。"],
      )
    }
    if (status === "not_triggered") {
      return projection(
        "needs_evidence",
        "medium",
        ["PoC 已执行但未命中 oracle，不能直接证明实际影响。"],
        ["需要检查 PoC 入口、环境准备或 oracle 是否正确。"],
      )
    }
  }

  const notAffected = latestMatchingEvent(sorted, (event) => {
    if (event.type !== "triage_note" && event.type !== "reachability_analysis") return false
    const status = eventStatus(event)
    return status === "not_affected" || status === "false_positive"
  })
  if (notAffected) {
    return projection(
      "not_affected",
      "medium",
      ["Triage 或可达性分析事件标记该 finding 当前不影响项目。"],
      ["如上游漏洞描述、依赖路径或入口条件变化，需要重新评估。"],
    )
  }

  const reachable = latestMatchingEvent(sorted, (event) => {
    if (event.type !== "reachability_analysis") return false
    return eventFlag(event, "reachable") === true || eventStatus(event) === "affected"
  })
  if (reachable) {
    return projection(
      "likely_impact",
      "medium",
      ["可达性分析事件表明该 finding 可能影响当前项目。"],
      ["缺少 poc_evaluated verified 事件。"],
    )
  }

  const blocked = latestEvent(sorted, "blocked")
  if (blocked) {
    return projection("blocked", "low", ["存在阻塞事件，当前无法继续确认该 finding。"], ["需要解决阻塞原因后继续分析。"])
  }

  if (hasAny(sorted, ["dependency_match", "vulnerability_lookup", "source_evidence"])) {
    return projection(
      "needs_evidence",
      "low",
      ["已经记录候选漏洞证据，但尚未看到可达性或 PoC 验证事件。"],
      ["需要补充 reachability_analysis 或 poc_evaluated 事件。"],
    )
  }

  return projection("needs_evidence", "low", ["finding 已创建，但尚未记录足够证据。"], ["需要补充漏洞来源和影响证据。"])
}

export function toFindingListItem(finding: Finding, events: FindingEvent[]): FindingListItem {
  return {
    ...finding,
    eventCount: events.length,
    projection: deriveFindingProjection(events),
  }
}

export function toFindingDetail(finding: Finding, events: FindingEvent[]): FindingDetail {
  return {
    finding,
    events: [...events].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    projection: deriveFindingProjection(events),
  }
}

function projection(
  conclusion: FindingConclusion,
  confidence: FindingConfidence,
  reasons: string[],
  gaps: string[],
): FindingProjection {
  return {
    conclusion,
    confidence,
    reasons,
    gaps,
  }
}

function latestEvent(events: FindingEvent[], type: FindingEvent["type"]) {
  return [...events].reverse().find((event) => event.type === type)
}

function latestMatchingEvent(events: FindingEvent[], predicate: (event: FindingEvent) => boolean) {
  return [...events].reverse().find(predicate)
}

function hasAny(events: FindingEvent[], types: FindingEvent["type"][]) {
  return events.some((event) => types.includes(event.type))
}

function eventStatus(event: FindingEvent) {
  const data = asRecord(event.data)
  const value = data?.status ?? data?.result ?? data?.conclusion
  return typeof value === "string" ? value : undefined
}

function eventFlag(event: FindingEvent, key: string) {
  const data = asRecord(event.data)
  return typeof data?.[key] === "boolean" ? data[key] : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
