# cogmem

Agent-native memory kernel for a single AI agent.

`cogmem` is a local-first memory backend for agents and agent frameworks. It stores raw experience, preserves provenance, curates long-term memory candidates, governs what becomes active memory, and recalls bounded context with source anchors.

It is not a knowledge-base app, a note-taking app, a vector RAG wrapper, an Obsidian replacement, an agent runtime, or a task scheduler.

## Status

Current version: `2.5.0`

Distribution: GitHub Releases. The package is installed from release tarballs, not npm publishing.

```bash
curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
```

The installer:

1. Ensures Bun is available.
2. Installs the latest `cogmem` release asset into `~/.cogmem/pkg`.
3. Links the `cogmem` CLI into `~/.bun/bin`.
4. Starts the interactive setup wizard from `/dev/tty`, so `curl | bash` installs still receive real keyboard input.

If no interactive terminal is available, the installer writes a conservative non-interactive config and tells you to rerun `cogmem init`.

To skip the wizard:

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
```

## What cogmem Is For

Use cogmem when an agent needs durable memory across sessions:

- Conversations with the user.
- Explicit user preferences, goals, constraints, and boundaries.
- Task events, tool observations, diagnostic conclusions, failures, and corrections.
- Imported memory files from OpenClaw, Hermes, transcripts, Markdown, JSON, CSV, or TSV.
- Governed recall that can explain why something was remembered and where the evidence came from.

The intended integration surface is:

- `KernelAgentMemoryBackend` for agent/framework code.
- `cogmem` CLI for setup, import, recall, audit, curation, and repair.
- MCP tools for hosts such as Hermes.
- A host plugin wrapper for OpenClaw automatic recall and turn recording.

## What cogmem Is Not

cogmem intentionally does not provide:

- Agent task execution.
- Shell, deploy, or tool runtime.
- App store, skill runtime, approval queue, or channel gateway.
- Telegram, Discord, browser, or web UI integrations.
- Multi-agent shared team memory.
- A human PKM/wiki/Obsidian replacement.
- A default “embed every sentence forever” vector store.

The current release is designed as the memory backend for one agent brain. Multiple agents can each have their own cogmem database and project scope, but this version does not implement conflict-safe shared memory for an agent team.

## Architecture

cogmem separates memory into layers:

```text
Raw Ledger
  Complete chronological event archive: messages, tool calls, tool results, task events.

Metadata / FTS Index
  Lightweight keyword, source, time, project, and thread indexing for exact lookup.

Compiled Memory
  Governed summaries, preferences, constraints, goals, lessons, diagnostics, and topic memories.

Dream Curator
  Background curation worker that reads raw ledger windows and proposes candidates only.

CPU Governance
  Rule-based promotion, suppression, supersession, and confirmation policy.

Active Recall
  Bounded context pack assembled with pulse activation, temporal routing, source anchors, and inhibition.
```

The core rule is:

> Raw evidence is preserved. Active memory is selective.

Every derived memory should point back to raw ledger evidence. If a memory cannot support an exact quote, the recall result marks it accordingly.

## Model Requirements

cogmem can run in `rule_only` mode, but production-quality semantic recall needs at least an embedding model. Dream curation needs a chat model.

Recommended local setup with Ollama:

```bash
ollama pull qwen3-embedding:0.6b
ollama pull qwen2.5:7b
```

Example `.cogmem/config.toml`:

```toml
[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 1024

[embedding]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen3-embedding:0.6b"
timeout_ms = 30000

[memory_model]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen2.5:7b"
api_key = ""
timeout_ms = 60000
```

Vector dimensions must match the embedding model:

- `qwen3-embedding:0.6b`: `1024`
- `qwen3-embedding:4b`: `2560`
- `qwen3-embedding:8b`: `4096`

High-dimensional vectors grow quickly. Prefer `raw_then_dream` or `selective_compile` for long-running agents.

## Quick Start

Install globally:

```bash
curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
```

Or install into an existing Bun workspace:

```bash
bun add "cogmem@github:liuqin164/cogmem#2.5.0"
bunx cogmem init
```

Validate configuration:

```bash
cogmem doctor
```

Run the Dream Curator once and promote safe candidates through CPU governance:

```bash
cogmem memory dream --project my-agent --promote --json
```

Run it as a foreground worker supervised by your host:

```bash
cogmem memory dream --project my-agent --watch --interval-ms 300000 --promote --json
```

Inspect queue state:

```bash
cogmem memory status --project my-agent --json
cogmem memory candidates --project my-agent --status candidate --json
cogmem memory govern --project my-agent --json
```

Inspect the memory anatomy and run one explicit host-owned upkeep tick:

```bash
cogmem memory map --project my-agent --json
cogmem memory tick --project my-agent --json
```

`memory tick` decays activation and returns suggested host actions. It does not start a hidden daemon; cron, systemd, MCP hosts, or agent adapters decide when to call it.

## Import Existing Agent Memory

Configure the embedding provider before importing. Imported records are embedded through the configured kernel embedder, so the configured `vector_dimension` must match the selected embedding model.

For local quantized embeddings with Ollama:

```bash
ollama pull qwen3-embedding:0.6b
```

```toml
[embedding]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen3-embedding:0.6b"
```

Always preview an import with `--dry-run` first.

OpenClaw:

```bash
cogmem import-openclaw --workspace . --project openclaw --dry-run
cogmem import-openclaw --workspace . --project openclaw
cogmem import-openclaw --workspace . --project openclaw --session ./one.md
cogmem import-openclaw --workspace . --project openclaw --session ./one.md --session ./two.md
cogmem import-openclaw --workspace . --project openclaw --memory ./one.md
cogmem import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md
```

Hermes:

```bash
cogmem import-hermes --workspace . --project hermes --dry-run
cogmem import-hermes --workspace . --project hermes
cogmem import-hermes --workspace . --project hermes --state-db ./state.db --dry-run
cogmem import-hermes --workspace . --project hermes --state-db ./state.db
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
cogmem import-hermes --workspace . --project hermes --session ./one.md
cogmem import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

Hermes `state.db` is scanned automatically when it exists at the workspace root. The importer reads the SQLite `messages` table, preserves message order, supports WAL-mode read-only databases through SQLite immutable mode, and prefers message-level `occurredAt` / `timestamp` / `createdAt` fields. Numeric `timestamp` values are treated as epoch seconds when they are below millisecond range. `InsertTime` is only a fallback when the original message time is absent.

Imports are idempotent. Re-running the same import skips records already processed by the cursor store. Use `--json --progress` when a host agent needs machine-readable output while still receiving progress on stderr.

Normalize JSON, JSONL, CSV, or TSV transcripts before import when the source format needs explicit ordering anchors:

```bash
cogmem normalize-transcript --input ./export.json --output ./normalized.md --family json-array --dry-run --json
cogmem normalize-transcript --input ./hermes-sessions.jsonl --output ./normalized.md --family jsonl --dry-run --json
cogmem normalize-transcript --input ./export.csv --output ./normalized.md --family csv --dry-run --json
cogmem-normalize-transcript --input ./export.json --output ./normalized.md --family json-array --dry-run --json
```

Normalization writes Markdown with `cogmem-source-ref` markers for raw offset, line, and ordering confidence. JSONL supports both one-message-per-line exports and Hermes session exports where each line is an object with `messages[]`. A dry run validates and summarizes the transcript only; it does not open a memory database.

## OpenClaw

OpenClaw is the most complete host integration in this release.

From the OpenClaw workspace:

```bash
cd ~/.openclaw/workspace
cogmem init --agent openclaw --scope project
cogmem doctor
cogmem connect openclaw --workspace . --auto --force
```

Import existing OpenClaw memory:

```bash
cogmem import-openclaw --workspace . --project openclaw --dry-run
cogmem import-openclaw --workspace . --project openclaw
```

If you imported old memory before raw ledger anchors existed:

```bash
cogmem import-openclaw --workspace . --project openclaw --config .cogmem/config.toml --reindex-raw --json
```

`cogmem connect openclaw --auto` installs a local OpenClaw plugin wrapper under:

```text
<workspace>/extensions/cogmem-auto-memory/
```

The wrapper registers:

- `before_prompt_build`: governed recall and prompt context injection.
- `agent_end`: queued turn recording so slow embedding/database writes do not block responses.

After updates or config drift:

```bash
cogmem doctor --fix --agent openclaw --workspace .
```

## Hermes

Hermes integration is MCP-based in this release. cogmem does not claim to be a native Hermes memory provider.

Install the skill and patch Hermes MCP config:

```bash
cogmem init --agent hermes
cogmem connect hermes --workspace /path/to/hermes/workspace --auto --force
```

This installs the agent-facing skill at:

```text
~/.hermes/skills/cogmem-memory/SKILL.md
```

With `--auto`, it adds a `cogmem` MCP server entry to:

```text
~/.hermes/config.yaml
```

Then reload MCP inside Hermes:

```text
/reload-mcp
```

Hermes can call the MCP recall tool directly:

```json
{ "query": "MoneyPrinterTurbo", "projectId": "hermes" }
```

`cogmem_recall` uses the same agent-facing recall path as `cogmem memory recall`. If `agentId` is omitted, MCP infers it from `projectId`, so project-only Hermes calls can still reach raw ledger fallback and return `items[].sourceContext` when vectors are empty.

Import existing Hermes memory:

```bash
cogmem import-hermes --workspace /path/to/hermes/workspace --project hermes --dry-run
cogmem import-hermes --workspace /path/to/hermes/workspace --project hermes
```

If Hermes stores conversations in SQLite:

```bash
cogmem import-hermes --workspace /path/to/hermes/workspace --project hermes --state-db /path/to/hermes/workspace/state.db --dry-run
cogmem import-hermes --workspace /path/to/hermes/workspace --project hermes --state-db /path/to/hermes/workspace/state.db
```

If Hermes stores memory in non-default paths, pass explicit files:

```bash
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
cogmem import-hermes --workspace . --project hermes --session ./sessions/one.md
```

## Agent-Facing Recall

Agents should not search legacy Markdown files first. They should ask cogmem:

```bash
cogmem memory recall --query "what did we discuss about memory black boxes?" --project openclaw --agent openclaw --json
```

Hermes recall should use the Hermes project and agent identifiers:

```bash
cogmem memory recall --query "我们记录过哪些库存" --project hermes --agent hermes --json
cogmem memory search --query "エルビ 库存" --project hermes --json
cogmem memory show --event <event-id> --before 2 --after 2 --json
```

`memory recall` can still return source-anchored raw ledger evidence when `vectors` is `0`. In that state, recall falls back to governed raw FTS and returns `sourceContext` locators instead of claiming vector search succeeded. Broad inventory questions such as `我们记录过哪些库存` are expanded into structured ledger cues such as `库存管理`, `在库`, `产品コード`, and `数量`; if compiled-memory candidates do not contain those cues, raw ledger evidence is preferred.

Use collection routing for non-operational artifacts:

```bash
cogmem memory recall --query "MoneyPrinterTurbo storyboard" --project openclaw --agent openclaw --collection theseus --json
```

Default recall includes untagged and `collection:anchor` memory only. `collection:theseus` is for creative artifacts and must be requested explicitly so drafts do not pollute the normal agent memory path.

The MCP `cogmem_recall` tool returns the same agent-facing item shape and fallback behavior. Agents may call it with `query`, `projectId`, and optionally `agentId` and `collection`; when `agentId` is omitted, MCP uses `projectId` as the agent id before falling back to `openclaw`. `cogmem_explain_recall` remains the audit path for `filteredEvidence` and governance reasons.

`cogmem memory status --json` exposes stable top-level counters:

```text
rawEvents, vectors, dreamedRawCount, undreamedRawCount, dreamCoverageRate
```

Useful intents:

```bash
cogmem memory recall --query "上个会话我们聊了什么" --intent previous_session_summary --project openclaw --agent openclaw --json
cogmem memory recall --query "我当时关于记忆黑盒的原话是什么" --intent forensic_quote --project openclaw --agent openclaw --json
```

Recall results include:

- `sourceType`
- `sourceAnchor`
- `sourceContext`
- `sourceContext.event.label` and per-event `label` values for matching injected context to `memory show`
- `sourceContext.window` with requested counts, actual counts, chronological ordering, role filter, anchor exclusion, and overlap handling
- `sourceContext.event.charRange` / `sourceRange` when the importer or recorder preserved source positions
- `canAnswerExactQuote`
- `whyMatched`
- `governanceReason`

If `canAnswerExactQuote=false`, the agent must not present the item as the user's original wording. It should use `sourceContext` or run the locator command:

```bash
cogmem memory show --event <eventId> --before 2 --after 2 --json
```

`memory show --json` uses the same source context contract. Its `before` and `after` arrays strictly exclude the anchor event, remain chronological, and are de-duplicated. The `window` object reports `requestedCount`, `count`, `excludesAnchor`, `roleFilter`, `ordering`, `overlapEventIds`, and `overlapHandling`. OpenClaw automatic prompt injection renders the same metadata as `sourceWindow`, labels each `sourceBefore` / `sourceAfter` event with `#...`, and adds `sourceTruncation` details when an injected source line is shortened.

## TypeScript API

```ts
import {
  KernelAgentMemoryBackend,
  createMemoryKernelFromConfig,
} from 'cogmem';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);

await memory.rememberTurn({
  agentId: 'openclaw',
  projectId: 'openclaw',
  sessionId: 'session-1',
  userText: 'Remember that this project is local-first.',
  assistantText: 'Stored.',
  ingestMode: 'raw_then_dream',
});

const recalled = memory.recall({
  agentId: 'openclaw',
  projectId: 'openclaw',
  query: 'what did I say about local-first memory?',
});

console.log(recalled.narrative);
console.log(recalled.items);

const pack = memory.recallPack({
  agentId: 'openclaw',
  projectId: 'openclaw',
  query: 'what should I remember before answering?',
});

console.log(pack.slots.direct);
console.log(pack.slots.associative);
console.log(pack.slots.entityCards);
console.log(pack.slots.beliefTouches);

const map = kernel.buildMemoryMap({ projectId: 'openclaw' });
const tick = kernel.runMaintenanceTick({ projectId: 'openclaw' });
```

## Updating

```bash
cogmem update --yes
```

`cogmem update` installs the latest release asset from:

```text
https://github.com/liuqin164/cogmem/releases/latest
```

The updater resolves that release dynamically. It prefers a `.tgz` asset whose
name or URL contains `cogmem`, falls back to the latest release tag when no
package asset is attached, and only then falls back to `github:liuqin164/cogmem#main`.

For OpenClaw after an update:

```bash
cd ~/.openclaw/workspace
cogmem doctor --fix --agent openclaw --workspace .
```

For Hermes after an update:

```bash
cogmem connect hermes --workspace /path/to/hermes/workspace --auto --force
```

## CLI

```text
cogmem init
cogmem doctor
cogmem connect openclaw|hermes
cogmem update
cogmem memory recall|search|show|dream|govern|candidates|status|map|tick
cogmem import-openclaw
cogmem import-hermes
cogmem normalize-transcript
cogmem snapshot export|import
cogmem compact
cogmem re-embed
cogmem migrate-vectors
cogmem mcp
```

## Release Checks

```bash
bun run typecheck
bun run build
bun test
npm pack --dry-run --json
```

The package is release-asset distributed. Do not run `npm publish` for this release channel.

## Security and Privacy

- Local-first by default.
- No hosted storage required.
- External embedding or memory-model providers must be explicit in TOML.
- PII redaction can run before writing.
- Optional AES-256-GCM encryption is available for sensitive fields.
- Snapshots and exports can contain sensitive memory. Treat them as private artifacts.
- Project boundaries are enforced in recall and explain paths.

## Design Boundary

cogmem can be used by OpenClaw, Hermes, LangGraph, custom agents, or a future agent OS. It must not depend on those hosts.

The source of truth is the kernel store and chronological event ledger, not Markdown files. Markdown, Obsidian vaults, and wiki pages can be imported or exported as projections, but they are not the primary memory system.
