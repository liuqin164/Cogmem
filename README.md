# @CognitiveOS/core

Durable, local-first memory for agent frameworks.

`@CognitiveOS/core` is the standalone memory kernel. It does not import or require CognitiveOS. Use it when an agent such as OpenClaw, Hermes, LangGraph, or a custom runtime needs long-term memory with recall, provenance, snapshots, optional PII redaction, and optional encryption.

## Install

`@CognitiveOS/core` 2.0.0-rc.1 is a GitHub-only open-source release. It is not published to npm; install it from the GitHub repository or tag used for the core package.

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#v2.0.0-rc.1"
bun add "$COGMEM_CORE_REPO"
```

Core uses Bun because the default storage path uses `bun:sqlite`.

## Configure

For new users, start with the interactive wizard:

```bash
./node_modules/.bin/cogmem-init
./node_modules/.bin/cogmem-doctor
```

For automation or CI smoke tests:

```bash
./node_modules/.bin/cogmem-init --yes --agent none --dry-run
```

The wizard creates a stable Cogmem home directory. By default this is `~/.cogmem`; project-local installs can use `cogmem-init --scope project`.

```text
~/.cogmem/
  config.toml
  memory.db
  embeddings/
  snapshots/
  logs/
```

The main configuration lives at `~/.cogmem/config.toml`:

```toml
[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 384

[governance]
pii_redact_email = true
pii_redact_phone = true
pii_redact_ssn = true
encryption = false
```

Set `core.vector_dimension` to match the embedding model output. For example, `qwen3-embedding:8b` uses 4096 dimensions. High dimensions are supported, but `cogmem-doctor` warns at 2048+ dimensions because 4096-dimensional Float32 vectors use about 1.53 GiB for 100,000 memories before SQLite/index overhead.

TOML is the only configuration entrypoint. Environment variables are not read as global kernel configuration; they are only interpolated when explicitly referenced inside `config.toml`, for example `api_key = "${ANTHROPIC_API_KEY}"`.

## SDK Quickstart

```ts
import { createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();

await kernel.ingest({
  content: 'The build must run with Bun because storage uses bun:sqlite.',
  projectId: 'demo-agent',
});

const recall = kernel.recall('what runtime does the build use?', {
  projectId: 'demo-agent',
  limit: 5,
});

console.log(recall.rawEvidence.map((item) => item.content));
```

## Agent Backend Facade

External agents should prefer `KernelAgentMemoryBackend` over low-level graph APIs.

```ts
import { KernelAgentMemoryBackend, createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);

await memory.rememberTurn({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  sessionId: 'session-1',
  userText: 'Use sqlite-vec for the public release.',
  assistantText: 'Stored.',
});

const result = memory.recall({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  query: 'which vector backend should the release use?',
});

console.log(result.recallMode); // "universe_navigation" unless the old recall path was needed
console.log(result.narrative?.headline);
console.log(result.pulseTrace);
console.log(result.temporalTraversal?.labels);
console.log(result.items);
```

`KernelAgentMemoryBackend.recall()` routes through universe navigation first. That means core activates related entities, temporal branches, and graph neighbors, assembles a narrative summary, and returns context that is already prepared for the agent. `MemoryKernel.recall()` remains available as the lower-level BrainRecall path; the backend uses it only as a fallback when universe navigation yields no scoped evidence.

## Memory Model

Core separates raw chronological evidence from ranked recall. The Chronological Memory Ledger records ordered raw events for replay and audit; governed recall ranks memories by relevance, importance, confidence, recency, scope, pulse activation, and inhibition.

Use `MemoryKernel.getThreadEvents(threadId)` to replay raw events in ledger order and `MemoryKernel.getEventContext(eventId, { before, after })` to inspect surrounding source context. Use `KernelAgentMemoryBackend.recall()` for current agent context. Do not use replay as a prompt dump.

Semantic memories can point back to raw events through `sourceRefs`; `explainRecallWithKernel()` includes `sourceAnchor` when provenance is available. See `MEMORY_MODEL.md` and `RECALL_EXPLAINABILITY.md`.

External agents can record lifecycle events through the narrow facade without importing host runtime concepts:

```ts
await memory.ingestToolCall({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  sessionId: 'session-1',
  threadId: 'thread-1',
  assistantEventId,
  toolCallId: 'call-1',
  toolName: 'read_file',
  input: { path: 'migration.ts' },
});

await memory.ingestToolObservation({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  sessionId: 'session-1',
  threadId: 'thread-1',
  toolCallEventId,
  toolCallId: 'call-1',
  toolName: 'read_file',
  output: 'migration.ts contains an idempotent ALTER TABLE.',
});
```

`ingestToolObservation()` stores a raw `tool_result` ledger event and an `external_tool` semantic evidence candidate with `sourceRefs`. It does not promote tool output into a verified fact.

## Governed Recall And Explainability

Agent-facing recall is governed by default. `KernelAgentMemoryBackend.recall()`, `MemoryKernel.navigateMemory()`, and `BrainRecall` exclude non-recallable evidence from active context before returning `rawEvidence` or backend `items`.

- `rawEvidence` contains evidence allowed to enter active agent context.
- `filteredEvidence` is available from `MemoryKernel.navigateMemory()` and `explainRecallWithKernel()` for forensic recall/explain flows. It records same-project candidates that were not included.
- `reason` stays backward compatible. For governance filtering it remains `status_suppressed`; for budget filtering it is `over_context_limit`.
- `governanceReason` is an optional refinement for `status_suppressed`, such as `archived`, `suspect_llm_inference`, `suspect_external_tool_observation`, or `suspect_unverified_claim`.

Raw user utterances may be recalled as provenance evidence when they are explicitly tagged as raw user evidence (`sourceType: 'user_input'`, `reliability:raw_utterance`, `role:user`, and `record:raw_utterance` or `record:conversation_message`). This does not promote the utterance into a durable fact; it only allows the original user statement to be inspected as evidence. Suspect LLM inference, suspect tool observation, and unverified suspect claims stay out of active context.

Use `cogmem-explain-recall --json` or the `cogmem_explain_recall` MCP tool to inspect `filteredEvidence`, `governanceReason`, activation paths, and narrative recall reasons. Explain output is project-scoped; filtered evidence from other projects is not exposed in a scoped explain result.

Core is an agent memory kernel, not a knowledge-base application, wiki front end, Obsidian replacement, UI dashboard, or agent framework. Markdown imports and exports are projections/adapters; the source of truth is the kernel store and public API.

## Import Existing Agent Memory

Use the import tools when an external agent already has memory files and needs to migrate them into the kernel store. Always run `--dry-run` first. Import is project-scoped and idempotent; re-running against the same database skips records already processed by the cursor store.

Imported records are embedded through the configured kernel embedder. To import through a local quantized embedding model, configure the kernel before running the importer. For example, with Ollama:

JSON/JSONL/CSV/TSV transcript exports should be normalized before batch ingestion. The normalizer emits per-message source anchors so imported `sourceRefs` preserve original array order, CSV row line, or block ordinal when available.

Normalize a JSON array transcript:

```bash
./node_modules/.bin/cogmem-normalize-transcript \
  --input ./memory.json \
  --output ./memory.normalized.md \
  --family json-array \
  --dry-run --json

./node_modules/.bin/cogmem-normalize-transcript \
  --input ./memory.json \
  --output ./memory.normalized.md \
  --family json-array
```

Normalize CSV or TSV transcript exports:

```bash
./node_modules/.bin/cogmem-normalize-transcript \
  --input ./memory.csv \
  --output ./memory.normalized.md \
  --family csv \
  --dry-run --json

./node_modules/.bin/cogmem-normalize-transcript \
  --input ./memory.tsv \
  --output ./memory.normalized.md \
  --family tsv
```

Supported `--family` values are `json-array`, `jsonl`, `csv`, `tsv`, `app-private-mixed-event`, and `jsonl-mixed-event-log`. If omitted, `.json`, `.jsonl`, `.csv`, and `.tsv` are inferred from the input extension.

The output is normalized conversation Markdown. Each normalized message includes an `agent-brain-source-ref` comment when the original source offset, JSON array index, CSV row line, or ordering confidence is available. `cogmem-normalize-transcript` does not open a memory database, run recall, change pulse activation, or install runtime features; it only prepares source-preserving Markdown for later import.

```bash
ollama pull qwen3-embedding:0.6b
```

```toml
[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 1024

[embedding]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen3-embedding:0.6b"
```

Set `core.vector_dimension` to the embedding model output dimension. `qwen3-embedding:0.6b` uses 1024 dimensions, `qwen3-embedding:4b` uses 2560 dimensions, and `qwen3-embedding:8b` uses 4096 dimensions.

OpenClaw default workspace import:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

The importer prints source-level and record-level progress to stderr during real non-JSON imports, including the embedding+ingest stage. JSON output stays on stdout; pass `--json --progress` to keep machine-readable stdout while streaming progress to stderr. Use `--no-progress` for quiet automation.

OpenClaw explicit single-file or batch import:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./one.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./one.md --session ./two.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./one.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md
```

Hermes default workspace import:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes
```

Hermes explicit path import:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

Pass `--json` when automation needs machine-readable counts for scanned sources, parsed records, ingested records, skipped records, and source-level results. The importers migrate memory evidence only; they do not install host runtime features, task schedulers, channels, dashboards, or application code.

## OpenClaw

Core includes a first-party OpenClaw workspace profile. It recognizes `USER.md`, `SOUL.md`, `PERSONA.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`, `memory/YYYY-MM-DD-<slug>.md`, and session export folders.

To install the agent-facing skill file into an OpenClaw workspace:

```bash
./node_modules/.bin/cogmem-connect openclaw --workspace .
```

This writes `<workspace>/skills/cogmem-memory/SKILL.md`, OpenClaw's workspace skill location. The skill tells an agent how to install, validate, dry-run migration, migrate, and wire `KernelAgentMemoryBackend` without changing OpenClaw host config automatically.

`cogmem-connect` does not edit `~/.openclaw/openclaw.json`. Current OpenClaw memory config is OpenClaw-owned (`memory.backend` supports backends such as `"builtin"` and `"qmd"`). Do not add unknown host config fields for CognitiveOS-core; install a real OpenClaw plugin wrapper with a valid manifest/schema before changing host runtime wiring.

Run the command after configuration to migrate existing OpenClaw memory into the kernel:

```bash
./node_modules/.bin/cogmem-init --agent openclaw --scope project
./node_modules/.bin/cogmem-doctor
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

This installs and validates the kernel store and the agent-facing workspace skill. It does not by itself replace OpenClaw's native `memory.backend` or make every future OpenClaw turn automatically call `KernelAgentMemoryBackend`; automatic per-turn read/write requires an OpenClaw runtime/plugin/MCP wiring layer that explicitly invokes the public kernel API.

```ts
import { OpenClawWorkspaceProfile, createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const profile = new OpenClawWorkspaceProfile(process.cwd());

for (const source of profile.buildInstalledBatchSources({ projectId: 'openclaw' })) {
  // Use MarkdownSourceLoader plus the exported source adapters to ingest source records.
  console.log(source);
}
```

See `examples/openclaw-backend/README.md` and `examples/openclaw-backend/SKILL.md`.

## Hermes

Core includes a conservative Hermes profile for filesystem-based memory exports:

- `profile.md` as durable profile/persona memory
- `sessions/**/*.md` as conversation/session memory

To install the agent-facing skill file into a Hermes workspace:

```bash
./node_modules/.bin/cogmem-connect hermes --workspace .
```

This writes `~/.hermes/skills/cogmem-memory/SKILL.md`, Hermes's primary skill location. The skill tells an agent how to install, validate, dry-run migration, migrate, wire `KernelAgentMemoryBackend`, and add the optional `cogmem-mcp` server without changing `~/.hermes/config.yaml` automatically.

Run the command after configuration to migrate existing Hermes memory into the kernel:

```bash
./node_modules/.bin/cogmem-init --agent hermes
./node_modules/.bin/cogmem-doctor
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes
```

If a Hermes install uses different paths, pass `profilePath` and `sessionDir` explicitly.

```ts
import { HermesWorkspaceProfile } from '@CognitiveOS/core';

const profile = new HermesWorkspaceProfile(process.cwd());
const sources = profile.buildSourceDefinitions({
  projectId: 'hermes',
  profilePath: 'profile.md',
  sessionDir: 'sessions',
});

console.log(sources);
```

See `examples/hermes-backend/README.md` and `examples/hermes-backend/SKILL.md`.

## CLI

```bash
cogmem-init              # interactive setup
cogmem-doctor            # validates config.toml and opens the kernel
cogmem-connect           # install OpenClaw/Hermes agent-facing SKILL.md files
cogmem-explain-recall    # explain pulse/temporal/narrative recall decisions
cogmem-mcp               # stdio MCP server exposing cogmem memory tools
cogmem-import-openclaw   # migrate OpenClaw workspace memory into core
cogmem-import-hermes     # migrate Hermes profile/session memory into core
cogmem-normalize-transcript # normalize JSON/JSONL/CSV/TSV transcript exports to source-ref Markdown
cogmem-snapshot          # export/import snapshot helper
cogmem-re-embed          # re-embedding helper
cogmem-migrate-vectors   # vector backend migration helper; uses config vector_dimension unless --dimension is passed
```

Benchmark groups are documented in `BENCHMARKS.md`; `memory_natural_emergence` tracks recall, inhibition, leakage, provenance, budget, and pulse expansion metrics.

## Public API Policy

The package entrypoint exports explicit stable and beta symbols only. Internal implementation stores and compilers are not exported from `@CognitiveOS/core`.

Stable integration APIs include `MemoryKernel`, `createMemoryKernelFromConfig()`, `KernelAgentMemoryBackend`, `OpenClawWorkspaceProfile`, and `HermesWorkspaceProfile`. Advanced recall orchestration symbols such as `UniverseNavigator`, `PulseRetrievalEngine`, `TemporalBranchSearch`, `NarrativeRecallAssembler`, `explainRecallWithKernel`, and the `listCogmemMcpTools` / `callCogmemMcpTool` helpers are exported as beta APIs for agents that need direct inspection, custom routing, or MCP hosting.

## Development

```bash
bun run --filter '@CognitiveOS/core' type
bun run --filter '@CognitiveOS/core' build
bun run --filter '@CognitiveOS/core' test
```

Release dry-run for the GitHub-only package:

```bash
cd packages/core
npm pack --dry-run --json
```

If the local npm cache is not writable, use a temporary cache instead:

```bash
npm_config_cache="$(mktemp -d)" npm pack --dry-run --json
```

Do not run `npm publish`; this package is released through GitHub source distribution only.
