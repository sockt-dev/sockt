# @sockt/types

Shared TypeScript types, Zod schemas, and store/client interfaces for Sockt. Every other `@sockt/*` package depends on this one — it's the root of the dependency graph and defines every contract crossed between packages (task shapes, LLM messages, memory entries, store interfaces) so packages never need to import each other's internals.

## Install

```bash
bun add @sockt/types
```

## What's in here

### Enums (runtime values + type)

`TaskStatus`, `MemoryCategory`, `LlmProvider`, `MessageRole`, `RoutingStrategy`, `Platform`, `HitlTier`, `ApprovalStatus`, `CadvpEventType`, `AgentRole` — each exported both as a value object and a `*_VALUES` const array for iteration/validation.

### Core types

`Task`, `TaskCreate`, `TaskPatch`, `AgentConfig`, `LlmConfig`, `LlmMessage`, `LlmRequest`, `LlmResponse`, `ToolDefinition`, `ToolCall`, `MemoryEntry`, `RetrievalQuery`, `RetrievalResult`, `CadvpEvent`, `CadvpStats`, `ApprovalRequest`, `ApprovalDecision`, `InboundMessage`, `OutboundMessage`, `Attachment`, `SandboxConfig`, `SandboxInstance`, `ExecResult`, and more.

### Zod schemas

Every schema-derived type above ships a matching `*Schema` export (`TaskSchema`, `LlmRequestSchema`, `CadvpEventSchema`, etc.) for runtime validation at system boundaries — API routes, task creation, tool call parsing.

### Store & client interfaces

`TaskStore`, `MemoryStore`, `LlmClient`, `Sandbox`, `HitlGate`, `ChannelGateway`, `OrchClient`, `TelemetryEmitter`, `ModelSelector`, `CadvpMonitor` — abstract contracts implemented by `@sockt/fsm`, `@sockt/memory`, `@sockt/runtime`, and others. Depend on these interfaces, not on a concrete package, when writing code that should work against any backing implementation.

### Errors

`SocktError` (base) plus `TaskStoreError`, `MemoryError`, `LlmError`, `SandboxError`, `HitlError` — all carry a structured `context` object alongside the message.

## Usage

```typescript
import { TaskSchema, type Task, type TaskStore, SocktError } from "@sockt/types";

function validateTask(input: unknown): Task {
  return TaskSchema.parse(input);
}

class InMemoryTaskStore implements TaskStore {
  // ...
}
```

## Peer dependencies

Requires `zod >= 4`.

## Docs

Full architecture: [docs/ARCHITECTURE.md](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md) in the monorepo root.

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
