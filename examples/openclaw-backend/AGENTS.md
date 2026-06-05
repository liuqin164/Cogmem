# OpenClaw Agent Memory Backend Runbook

You are configuring OpenClaw to use `@CognitiveOS/core` as its durable memory backend.

For a portable one-file skill, read `SKILL.md` or install it into the workspace with:

```bash
./node_modules/.bin/cogmem-connect openclaw --workspace .
```

This writes `<workspace>/skills/cogmem-memory/SKILL.md`, which OpenClaw discovers as a workspace skill.

## Install

Run from the OpenClaw workspace root:

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
./node_modules/.bin/cogmem-init --agent openclaw --scope project
./node_modules/.bin/cogmem-doctor
./node_modules/.bin/cogmem-connect openclaw --workspace . --auto --force
```

The OpenClaw workspace install creates:

```text
.cogmem/config.toml
.cogmem/memory.db
.cogmem/snapshots/
```

Use `~/.cogmem/config.toml` or a project `.cogmem/config.toml` as the only configuration source. Do not create `.agent-brain.env` files, do not pass `--env-path`, and do not configure kernel behavior through `AB_*`, `COGMEM_*`, or `AGENT_BRAIN_MODEL_*` environment variables.

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

Preview first:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
```

Then migrate:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

Use `--json` when another agent needs structured output:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --json
```

Real non-JSON imports print source-level and embedding+ingest progress to stderr. Use `--json --progress` to keep JSON on stdout while streaming progress to stderr, or `--no-progress` when a wrapper needs quiet stderr.

Import scope:

- Import `USER.md` as user profile memory.
- Import `SOUL.md`, `PERSONA.md`, and `IDENTITY.md` as persona/profile memory.
- Import `MEMORY.md` as imported summary/index memory.
- Import `memory/YYYY-MM-DD.md` and `memory/YYYY-MM-DD-<slug>.md` as daily episodic memory.
- Import `sessions/*.md`, `session-logs/*.md`, `session_logs/*.md`, `conversations/*.md`, `exports/sessions/*.md`, and `exports/conversations/*.md` as session memory.
- Do not import AGENTS.md, TOOLS.md, HEARTBEAT.md, or BOOTSTRAP.md. They are operational instructions, not durable user memory.

Useful options:

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
  sessionId: 'current',
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

Recall behavior:

- `recall.recallMode === 'universe_navigation'` means core already ran pulse activation, temporal branch search, graph traversal, and narrative assembly.
- Use `recall.narrative` as the compact context summary for the next model prompt.
- Use `recall.items` as cited memory evidence.
- Use `recall.temporalTraversal?.labels` when the user refers to a day, session, or adjacent work period.
- Do not run a separate vector search before calling `memory.recall()`. The backend is the first-class memory retrieval path.

Installing the workspace skill makes the kernel procedure discoverable to OpenClaw agents. Installing the local auto wrapper makes future turns call the memory kernel automatically:

```bash
./node_modules/.bin/cogmem-connect openclaw --workspace . --auto --force
```

This writes `<workspace>/extensions/cogmem-auto-memory/`, patches OpenClaw `plugins.load.paths`, and enables `before_prompt_build` and `agent_end` hooks. The wrapper calls `KernelAgentMemoryBackend` through `@CognitiveOS/core` public API via a Bun bridge; core does not import OpenClaw.

After updating the package or editing OpenClaw config, repair wiring with:

```bash
./node_modules/.bin/cogmem-doctor --fix --agent openclaw --workspace .
```

The migration command is idempotent. Re-running it skips records already imported into the same memory database.
