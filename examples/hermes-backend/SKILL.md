---
name: cogmem-memory-backend
description: Install and connect CognitiveOS-core as a durable memory backend for Hermes through MCP.
version: 1.0.0
metadata:
  hermes:
    tags: [memory, mcp, cogmem, cognitiveos]
    category: memory
---

# CognitiveOS-core Memory Backend for Hermes

Use this skill when a Hermes workspace needs `@CognitiveOS/core` as its durable memory backend.

## Ground Rules

- Use TOML config only: `~/.cogmem/config.toml` or project `.cogmem/config.toml`.
- Do not create .agent-brain.env files.
- Do not pass `--env-path`.
- Do not configure kernel behavior through `AB_*`, `COGMEM_*`, or `AGENT_BRAIN_MODEL_*` environment variables.
- Do not run a separate vector search before calling `memory.recall()`. `KernelAgentMemoryBackend.recall()` is the first-class recall path and already performs pulse activation, temporal traversal, graph traversal, and narrative assembly.
- Do not set `memory.provider: cogmem` in `~/.hermes/config.yaml`; this package uses Hermes MCP integration, not a native Hermes memory provider.

## Install

Run from the Hermes workspace root:

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
./node_modules/.bin/cogmem-init --agent hermes
./node_modules/.bin/cogmem-doctor
```

Use project-local config only when this workspace needs isolation:

```bash
./node_modules/.bin/cogmem-init --agent hermes --scope project
```

The default install creates:

```text
~/.cogmem/config.toml
~/.cogmem/memory.db
~/.cogmem/snapshots/
```

To embed imported memories with a local quantized model, run Ollama locally and configure the kernel before importing:

```bash
ollama pull qwen3-embedding:0.6b
```

```toml
[core]
vector_dimension = 1024

[embedding]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen3-embedding:0.6b"
```

Use the matching dimension for larger local models: `qwen3-embedding:4b` uses `2560`; `qwen3-embedding:8b` uses `4096`. Run `./node_modules/.bin/cogmem-doctor` after editing. Imported records are embedded through the configured kernel embedder during `cogmem-import-hermes`.

## Migrate Existing Hermes Memory

Default Hermes memory contract:

- `profile.md` contains durable profile/persona memory.
- `sessions/**/*.md` contains conversation/session memory.

Always preview first:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run
```

Then migrate:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes
```

Use JSON output when another agent is orchestrating the run:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --json
```

If Hermes stores memory somewhere else, pass explicit paths:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

The importer is idempotent. Re-running it skips records already imported into the same memory database.

## Runtime Wiring

Use `KernelAgentMemoryBackend` for turn storage and recall:

```ts
import {
  KernelAgentMemoryBackend,
  createMemoryKernelFromConfig,
} from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);

await memory.rememberTurn({
  agentId: 'hermes',
  projectId: 'hermes',
  sessionId,
  userText,
  assistantText,
});

const recall = memory.recall({
  agentId: 'hermes',
  projectId: 'hermes',
  query: userText,
});

const preparedContext = {
  mode: recall.recallMode,
  narrative: recall.narrative,
  pulseTrace: recall.pulseTrace,
  temporalLabels: recall.temporalTraversal?.labels,
  memories: recall.items,
};
```

Use `recall.narrative` as the compact prompt context and `recall.items` as cited memory evidence. If `recall.recallMode === 'universe_navigation'`, the memory kernel has already prepared related context through the pulse/temporal/narrative path.

## Hermes Provider Notes

Hermes external memory providers are activated through `memory.provider` in `~/.hermes/config.yaml` and participate in lifecycle calls such as initialization, prompt context, prefetch, turn sync, session-end extraction, and built-in memory write mirroring.

Do not edit `~/.hermes/config.yaml` to point `memory.provider` at `cogmem` until a Hermes native provider plugin exists on disk. The supported bridge in this package is MCP.

`cogmem-connect hermes` installs this file into `~/.hermes/skills/cogmem-memory/SKILL.md`, which is Hermes's primary skill directory.

Add this MCP server to `~/.hermes/config.yaml` after installing the core package in the Hermes workspace:

```yaml
mcp_servers:
  cogmem:
    command: "/absolute/path/to/hermes-workspace/node_modules/.bin/cogmem-mcp"
    args: []
    enabled: true
    tools:
      include:
        - cogmem_remember_turn
        - cogmem_recall
        - cogmem_explain_recall
```

Then reload MCP inside Hermes:

```text
/reload-mcp
```

When authoring a future native Hermes provider, map Hermes behavior to core like this:

- Provider initialization should call `createMemoryKernelFromConfig()`.
- Prompt context and prefetch should call `memory.recall()` and inject `recall.narrative`.
- Turn sync should call `memory.rememberTurn()` after each response.
- Built-in memory writes should be mirrored through `memory.rememberTurn()` or direct kernel ingest with `agentId: 'hermes'`.
- Search tools should return `recall.narrative` plus cited `recall.items`, not a raw vector nearest-neighbor dump.

After native provider wiring exists, a minimal host config shape is:

```yaml
memory:
  provider: cogmem
```

If using a future MCP bridge instead, add it under `mcp_servers` in `~/.hermes/config.yaml` and expose only the recall/write tools needed by the agent.
