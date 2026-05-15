import type { HarnessStatus } from "./schema"

export class HarnessBusyError extends Error {
  constructor() {
    super("Harness is already running")
    this.name = "HarnessBusyError"
  }
}

export interface HarnessRunState {
  status(): HarnessStatus
  assertIdle(): void
  cancel(): void
  runExclusive<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>
}

export function createHarnessRunState(): HarnessRunState {
  let controller: AbortController | undefined

  return {
    status: () => (controller ? "busy" : "idle"),
    assertIdle: () => {
      if (controller) throw new HarnessBusyError()
    },
    cancel: () => {
      controller?.abort()
      controller = undefined
    },
    runExclusive: async (work) => {
      if (controller) throw new HarnessBusyError()
      controller = new AbortController()
      try {
        return await work(controller.signal)
      } finally {
        controller = undefined
      }
    },
  }
}

