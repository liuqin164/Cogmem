# Hermes Backend

Use cogmem as a Hermes-compatible durable memory backend through MCP and imports.

Entity resolution is evidence-backed and reversible. Person aliases require explicit user evidence; Hermes must not auto-merge pronouns, relationship labels, role names, assistant claims, or tool observations.

Belief Graph writes keep ownership and evidence roles. Hermes may record assistant/tool project observations, but only explicit user events can establish user-owned preferences, goals, boundaries, decisions, or facts.

## Default Contract

- `profile.md` contains durable profile/persona memory.
- `sessions/**/*.md` contains conversation/session memory.

## Install

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent hermes
cogmem doctor --fix --agent hermes --workspace .
cogmem connect hermes --workspace . --auto
cogmem connect hermes --workspace .
```

Hermes integration is currently a skill plus MCP bridge. It does not replace a native Hermes memory provider and it does not patch Hermes runtime internals.

## Local Quantized Embeddings

Imports use the configured kernel embedder. To import existing Hermes memory through a local quantized model, configure the kernel before running the import command:

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

Use the matching vector dimension for the selected model. `qwen3-embedding:4b` uses 2560 dimensions and `qwen3-embedding:8b` uses 4096 dimensions.

## Migrate

Upgrade and migrate the Cogmem database itself before importing host memory:

```bash
cogmem update --yes
cogmem migrate --yes --backup --json
```

Preview:

```bash
cogmem import-hermes --workspace . --project hermes --dry-run
```

Import:

```bash
cogmem import-hermes --workspace . --project hermes
```

If Hermes stores memory somewhere else:

```bash
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
```

Single session files and batches can be imported explicitly:

```bash
cogmem import-hermes --workspace . --project hermes --session ./one.md
cogmem import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

The import command is idempotent. Re-running it against the same database skips records already processed by the cursor store. Imported raw records enter the same Episode Assembler used by live turns and are sealed at the explicit import batch boundary.
Imported records are embedded through the configured kernel embedder during import.

MCP recall JSON includes `decisionTrace`. Check its selected lane, reason, and candidate counts before concluding that a memory is absent, and use `sourceContext.locator.command` for exact wording. Raw text fallback searches the fully scoped ledger and prefers original user anchors over later assistant retellings when cue scores tie.

Dream stores explicit user clarification as organizational correction evidence rather than an automatic contradiction. Assistant self-correction and negative-form questions do not create user-owned corrections. Invalid provider output is rejected diagnostic state; maintenance supersedes stale `needs_confirmation` entries after the default 30-day TTL without deleting evidence.

After upgrades, rerun `cogmem connect hermes --workspace . --auto --force` and reload MCP.

Cogmem 3.6.0 exposes Memory Atlas through seven canonical-memory-safe MCP tools: overview, search, explore, node, neighbors, path, and timeline. They record non-destructive access/activation telemetry, so MCP does not label them strictly read-only or idempotent. Use explore for broad memory inventory/history, search and node for a known concept, path/neighbors for relations, timeline for ordered reconstruction, and normal recall for a direct fact. Query facets combine the user's actual project, time, topic, entity/target, memory-kind, and keyword conditions like table filters, so cold memory can be revived without requiring an entity-time-action tuple. Always follow returned event IDs to raw evidence before quoting exact wording.

## Runtime

```ts
import {
  HermesWorkspaceProfile,
  KernelAgentMemoryBackend,
  createMemoryKernelFromConfig,
} from 'cogmem';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);
const profile = new HermesWorkspaceProfile(process.cwd());

const sources = profile.buildSourceDefinitions({
  projectId: 'hermes',
  profilePath: 'profile.md',
  sessionDir: 'sessions',
});
console.log(sources);

await memory.rememberTurn({
  agentId: 'hermes',
  projectId: 'hermes',
  sessionId: 'current',
  userText: 'Remember the release gate command.',
  assistantText: 'Stored.',
});

const recalled = memory.recall({
  agentId: 'hermes',
  projectId: 'hermes',
  query: 'what is the release gate?',
});

console.log(recalled.items);
```

If a Hermes workspace uses different paths, pass explicit `profilePath` and `sessionDir` values instead of changing core.

For agent-facing instructions, install or read `SKILL.md`. `cogmem connect hermes --workspace .` copies it to `~/.hermes/skills/cogmem-memory/SKILL.md`.

`cogmem connect hermes --workspace . --auto` patches the Hermes MCP config with a `cogmem` server command. Re-running it after an upgrade updates existing allow-lists with strategy, topic, episode repair, conditional Dream, memory-map, maintenance, and prospective tools. Cogmem cannot observe Hermes conversations unless Hermes calls append/import. Episode append/import never run Dream; MCP Dream tick mutates only with `maintenanceMode: true`, never executes tools, and durable semantic changes still require governance. After running it, restart or reload Hermes so the MCP server list is re-read.

Use MCP append/import only for bounded traffic. Supply `externalMessageId` for every message that may cross request boundaries; if a batch returns `auto_identity_not_safe_across_split_batches`, assign IDs before splitting or retrying it. MCP reports per-message progress/failure checkpoints. Large JSONL histories belong on `cogmem episode import` with checkpoint/resume plus `--start-line`, `--end-line`, `--max-lines`, `--skip-errors`, and `--max-errors`.

Recall warnings are operational signals: `no_recent_episode_ingestion_detected` means the hookless host has not supplied recent conversation evidence, while `semantic_memory_may_lag` means open/soft-sealed high-value work or Dream backlog/failures remain. Ingest or repair before claiming current semantic memory. Use `cogmem_topic_list` / `cogmem_topic_operate` for audited user-shaped topic structure and `cogmem_episode_repair` for synchronized boundary surgery.

The MCP `cogmem_recall` tool uses the same backend as `cogmem memory recall`. A Hermes MCP call with only `projectId: "hermes"` still infers `agentId: "hermes"` and can return `raw_ledger` items with labeled `sourceContext` events, `sourceContext.window`, and locator commands when vectors are empty. Pass `collection: "theseus"` only when Hermes wants creative artifacts instead of normal operational memory.

Useful host-owned inspection commands:

```bash
cogmem memory map --project hermes --json
cogmem memory tick --project hermes --json
cogmem memory bind --project hermes --json
cogmem episode status --project hermes --json
cogmem dream tick --project hermes --mode auto --json
```

`memory map` includes Memory Binding and Graph Recall counters. Bindings attach valuable user raw events to stable topic/entity paths, fuse same-claim evidence into claim-key clusters, and create graph anchors for raw-ledger drill-down; they are not verified long-term facts. If `memory tick` suggests `bind_raw_events`, run `memory bind` to backfill imported Hermes raw user events into the binding graph.
