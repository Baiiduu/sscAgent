import { runHarnessLoop, type HarnessLoopInput, type HarnessLoopResult } from "./loop"
import { createHarnessRunState, type HarnessRunState } from "./run-state"
import { runAgentTurn } from "./turn"
import type { HarnessResult, HarnessRunInput } from "./schema"

export interface AgentHarness {
  status(): ReturnType<HarnessRunState["status"]>
  cancel(): void
  run(input: HarnessRunInput): Promise<HarnessResult>
  runSession(input: HarnessLoopInput): Promise<HarnessLoopResult>
}

export function createAgentHarness(): AgentHarness {
  const state = createHarnessRunState()
  return {
    status: state.status,
    cancel: state.cancel,
    run: (input) =>
      state.runExclusive((signal) =>
        runAgentTurn({
          ...input,
          abortSignal: input.abortSignal ?? signal,
        }),
      ),
    runSession: (input) =>
      state.runExclusive((signal) =>
        runHarnessLoop({
          ...input,
          abortSignal: input.abortSignal ?? signal,
        }),
      ),
  }
}
