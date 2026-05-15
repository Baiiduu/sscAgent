# Agent Harness

A reusable TypeScript agent harness extracted from OpenCode-style architecture.

It provides:

- provider/runtime adapters for OpenAI, Anthropic, and OpenAI-compatible models
- agent profiles and prompt assembly
- streaming LLM turns with AI SDK `streamText`
- tool registry and permission-aware tool execution
- session/message/part modeling
- SQLite session persistence
- Git-based workspace snapshots
- session workspace management
- context estimation and automatic compaction

## Structure

```text
src/
  agent/        agent profiles and builtin agents
  context/      token estimation and compaction
  harness/      session loop, messages, runner, run state
  llm-runtime/  model invocation and tool binding
  permission/   permission rules and runtime
  provider/     provider registry and SDK loading
  runtime/      default runtime wiring
  snapshot/     Git snapshot service
  storage/      SQLite session store
  tool/         builtin tools and tool executor
  workspace/    session workspace creation
```

## Basic Usage

```ts
import { builtinAgents } from "./src/agent"
import { createAgentHarness, createUserMessage } from "./src/harness"
import { createPermissionRuntime } from "./src/permission"
import { createProviderRuntime, createEnvironment } from "./src/provider"
import { createAgentRuntime } from "./src/runtime"
import { createAITools, createBuiltinToolRegistry } from "./src/tool"

const runtime = createAgentRuntime()
const { session } = await runtime.createSession({
  title: "New session",
})

await runtime.store.appendMessage(session.id, createUserMessage("Hello"))

const registry = createBuiltinToolRegistry()
const provider = createProviderRuntime({
  env: createEnvironment(Bun.env),
  providers: {},
  defaultModel: {
    providerID: "openai",
    modelID: "gpt-4.1",
  },
})

await createAgentHarness().runSession({
  sessionID: session.id,
  store: runtime.store,
  provider,
  model: provider.getModel("openai", "gpt-4.1"),
  agent: builtinAgents().build,
  tools: createAITools({ registry }),
  createToolExecutor: runtime.createToolExecutor({
    registry,
    permission: createPermissionRuntime(),
    ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
  }),
})
```

## Notes

This repository contains only the generic harness. Project-specific tools, domain workflows, and application adapters should live in application-level packages and register tools explicitly.
