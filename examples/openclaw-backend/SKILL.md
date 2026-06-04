---
name: cogmem-memory-backend
description: Install and connect CognitiveOS-core as a durable memory backend for OpenClaw.
version: 1.0.0
metadata:
  openclaw:
    tags: [memory, cogmem, cognitiveos]
---

# CognitiveOS-core Memory Backend for OpenClaw

Use this skill when an OpenClaw workspace needs `@CognitiveOS/core` as its durable memory backend.

## Ground Rules

- Use TOML config only: `~/.cogmem/config.toml` or project `.cogmem/config.toml`.
- Do not create .agent-brain.env files.
- Do not pass `--env-path`.
- Do not configure kernel behavior through `AB_*`, `COGMEM_*`, or `AGENT_BRAIN_MODEL_*` environment variables.
- Do not import `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, or `BOOTSTRAP.md`; they are operational instructions, not durable user memory.
- Do not run a separate vector search before calling `memory.recall()`. `KernelAgentMemoryBackend.recall()` is the first-class recall path and already performs pulse activation, temporal traversal, graph traversal, and narrative assembly.

## Install

Run from the OpenClaw workspace root:

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
./node_modules/.bin/cogmem-init --agent openclaw --scope project
./node_modules/.bin/cogmem-doctor
```

This creates project-local kernel config and storage under `.cogmem/`, which is the recommended OpenClaw workspace setup.

```bash
./node_modules/.bin/cogmem-init --agent openclaw --scope project
```

The install creates:

```text
.cogmem/config.toml
.cogmem/memory.db
.cogmem/snapshots/
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

Use the matching dimension for larger local models: `qwen3-embedding:4b` uses `2560`; `qwen3-embedding:8b` uses `4096`. Run `./node_modules/.bin/cogmem-doctor` after editing. Imported records are embedded through the configured kernel embedder during `cogmem-import-openclaw`.

## Migrate Existing OpenClaw Memory

Always preview first:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
```

Then migrate:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

Use JSON output when another agent is orchestrating the run:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --json
```

The importer is idempotent. Re-running it skips records already imported into the same memory database.
Real non-JSON imports print source-level and embedding+ingest progress to stderr. Use `--json --progress` to keep JSON on stdout while streaming progress to stderr, or `--no-progress` when a wrapper needs quiet stderr.

Imported sources:

- `USER.md` as user profile memory.
- `SOUL.md`, `PERSONA.md`, and `IDENTITY.md` as persona/profile memory.
- `MEMORY.md` as imported summary/index memory.
- `memory/YYYY-MM-DD.md` and `memory/YYYY-MM-DD-<slug>.md` as daily episodic memory.
- `sessions/*.md`, `session-logs/*.md`, `session_logs/*.md`, `conversations/*.md`, `exports/sessions/*.md`, and `exports/conversations/*.md` as session memory.

Useful scoped imports:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --date 2026-05-07
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./custom-session.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./custom-memory.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./one.md --session ./two.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md
```

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
  agentId: 'openclaw',
  projectId: 'openclaw',
  sessionId,
  userText,
  assistantText,
});

const recall = memory.recall({
  agentId: 'openclaw',
  projectId: 'openclaw',
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

## OpenClaw Host Integration Notes

`cogmem-connect openclaw` installs this file into `<workspace>/skills/cogmem-memory/SKILL.md`, which is OpenClaw's workspace skill location. That makes the procedure discoverable without changing OpenClaw host config or pretending that a native memory plugin has already been installed.

Current OpenClaw memory config is OpenClaw-owned. Its documented backend selector is `memory.backend` with values such as `"builtin"` and `"qmd"`, and the built-in memory surface exposes tools such as `memory_search` and `memory_get`. Do not write `plugins.slots.memory` or other unknown OpenClaw config fields for CognitiveOS-core; OpenClaw uses strict config validation and unknown fields can prevent the Gateway from starting.

Installing this workspace skill makes the memory kernel visible to OpenClaw agents as an operating procedure. It does not automatically replace OpenClaw's native memory runtime or guarantee every future turn reads/writes `KernelAgentMemoryBackend`; automatic per-turn recall and recording require explicit host wiring through an OpenClaw plugin, MCP server, or adapter that calls the public kernel API.

When authoring a real OpenClaw plugin wrapper, package it with a valid OpenClaw plugin manifest/schema first, then map OpenClaw tool behavior to core like this:

- `memory_search` should call `memory.recall()` and return `recall.narrative` plus cited `recall.items`.
- `memory_get` should read from the cited evidence returned by core or from the original workspace file when a citation includes a file path.
- Prompt injection should use `recall.narrative`, not a raw vector nearest-neighbor dump.
- Turn capture should call `memory.rememberTurn()` after the agent response.

After runtime wiring changes, run:

```bash
openclaw config schema
openclaw doctor
openclaw plugins inspect <plugin-id> --runtime --json
openclaw gateway restart
```

## MCP Bridge Option

If the OpenClaw environment exposes an MCP client, use the core MCP bridge instead of writing a native plugin first:

```bash
./node_modules/.bin/cogmem-mcp
```

Expose these tools to the agent:

- `cogmem_remember_turn`
- `cogmem_recall`
- `cogmem_explain_recall`
