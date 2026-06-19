---
name: cogmem-memory-backend
description: Install and connect cogmem as a durable memory backend for Hermes through MCP.
version: 2.9.0
metadata:
  hermes:
    tags: [memory, mcp, cogmem, agent-memory]
    category: memory
---

# cogmem Memory Backend for Hermes

Use this skill when a Hermes workspace needs `cogmem` as its durable memory backend.

## Ground Rules

- Use TOML config only: `~/.cogmem/config.toml` or project `.cogmem/config.toml`.
- Do not create .cogmem.env files.
- Do not pass `--env-path`.
- Do not configure kernel behavior through hidden environment variables; write TOML instead.
- Do not run a separate vector search before calling `memory.recall()`. `KernelAgentMemoryBackend.recall()` is the first-class recall path and already performs pulse activation, temporal traversal, graph traversal, and narrative assembly.
- Do not set `memory.provider: cogmem` in `~/.hermes/config.yaml`; this package uses Hermes MCP integration, not a native Hermes memory provider.
- Treat entity aliases as governed candidates. Never merge people from pronouns, family labels, job titles, assistant text, or tool output alone; require explicit user evidence and leave uncertain matches pending.

## Install

Run from the Hermes workspace root:

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent hermes
cogmem doctor
cogmem connect hermes --workspace . --auto --force
```

Use project-local config only when this workspace needs isolation:

```bash
cogmem init --yes --agent hermes --scope project
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

Use the matching dimension for larger local models: `qwen3-embedding:4b` uses `2560`; `qwen3-embedding:8b` uses `4096`. Run `cogmem doctor` after editing. Imported records are embedded through the configured kernel embedder during `cogmem import-hermes`.

Also configure `[memory_model]` for the Dream Curator. Embeddings are for recall; the memory model is the LLM that proposes candidate summaries, preferences, tags, conflicts, and diagnostics:

```toml
[memory_model]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen2.5:7b"
api_key = ""
timeout_ms = 60000
```

## Migrate Existing Hermes Memory

After upgrading Cogmem itself, migrate its database schema before importing or recalling:

```bash
cogmem update --yes
# Manual equivalent: cogmem migrate --yes --backup
```

Agents should inspect `cogmem migrate --dry-run --json` when an operator wants a preview. Schema migration preserves Raw Ledger events; it updates governed projections and indexes only.

Default Hermes memory contract:

- `state.db` may contain the real chronological conversation history in SQLite `messages`.
- `profile.md` contains durable profile/persona memory.
- `sessions/**/*.md` contains conversation/session memory.

Always preview first:

```bash
cogmem import-hermes --workspace . --project hermes --dry-run
```

If `state.db` exists, the default import scans it automatically. Use an explicit path when the database is outside the workspace:

```bash
cogmem import-hermes --workspace . --project hermes --state-db ./state.db --dry-run
cogmem import-hermes --workspace . --project hermes --state-db ./state.db
```

The SQLite importer reads the `messages` table, preserves row/message order, supports WAL-mode read-only databases through SQLite immutable mode, and prefers message-level `occurredAt`, `timestamp`, or `createdAt`. Numeric `timestamp` values below millisecond range are epoch seconds. `InsertTime` is only a fallback and must not be treated as the original conversation time.

Then migrate:

```bash
cogmem import-hermes --workspace . --project hermes
```

Use JSON output when another agent is orchestrating the run:

```bash
cogmem import-hermes --workspace . --project hermes --json
```

If Hermes stores memory somewhere else, pass explicit paths:

```bash
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
cogmem import-hermes --workspace . --project hermes --session ./one.md
cogmem import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

For Hermes JSONL session exports where each line is a session object with `messages[]`, normalize first:

```bash
cogmem normalize-transcript --input ./hermes-sessions.jsonl --output ./hermes.normalized.md --family jsonl --dry-run --json
cogmem normalize-transcript --input ./hermes-sessions.jsonl --output ./hermes.normalized.md --family jsonl
cogmem import-hermes --workspace . --project hermes --session ./hermes.normalized.md
```

The importer is idempotent. Re-running it skips records already imported into the same memory database.

Run the curator/governance loop under host supervision after import and during normal use:

```bash
cogmem memory dream --project hermes --watch --interval-ms 300000 --promote
```

This command is the preferred long-running worker. Cron can still be used, but it is not required.

## Active Memory Search

When the prompt does not contain enough injected Cogmem context, do not search legacy memory files first. Ask Cogmem directly:

```bash
cogmem memory recall --query "<user question>" --project hermes --agent hermes --json
```

For inventory or product-memory questions, raw recall works even before vectors are built:

```bash
cogmem memory recall --query "我们记录过哪些库存" --project hermes --agent hermes --json
cogmem memory search --query "エルビ 库存" --project hermes --json
```

If recall returns an item with `sourceContext.locator.command`, use that command to drill into the exact ledger event:

```bash
cogmem memory show --event <event-id> --before 2 --after 2 --json
```

`sourceContext` entries include stable `label` values, optional `charRange` / `sourceRange`, and `sourceContext.window` metadata. Use `window.before.requestedCount`, `window.before.count`, `window.after.requestedCount`, `window.after.count`, `excludesAnchor`, `ordering`, `roleFilter`, and `overlapHandling` to understand the before/after replay. `memory show --json` returns the same contract, so the labels in MCP recall can be matched to the local CLI output.

`vectors: 0` does not mean memory is unavailable. It means dense vector search has no hot index yet; `memory recall` still has governed raw-ledger fallback. Broad inventory questions are expanded into structured cues such as `库存管理`, `在库`, `产品コード`, and `数量`; when compiled candidates miss those cues, prefer the raw ledger result and use its `sourceContext` for details. Check status with:

```bash
cogmem memory status --project hermes --json
```

Use top-level counters `rawEvents`, `vectors`, `dreamedRawCount`, `undreamedRawCount`, and `dreamCoverageRate` for machine decisions.

Use collection routing when Hermes stores creative artifacts or drafts that should not pollute normal operational recall:

```bash
cogmem memory recall --query "<artifact query>" --project hermes --agent hermes --collection theseus --json
```

Default recall includes untagged and `collection:anchor` memory only. Ask for `collection:theseus` explicitly when the user wants creative/reference artifacts.

For host upkeep, inspect the self-map and run an explicit tick:

```bash
cogmem memory map --project hermes --json
cogmem memory tick --project hermes --json
cogmem memory bind --project hermes --json
```

`memory tick` does not start a daemon. Use its `suggestedActions` to decide whether Hermes should run `memory dream`, `memory govern`, entity review, re-embedding, or `memory bind` for unbound high-value raw events.

`memory map` also exposes Memory Binding and Graph Recall counters. Bindings connect high-value user raw events to stable topic/entity paths before promotion, fuse same-claim evidence into claim-key clusters, and create graph anchors for source drill-down. Correction bindings expose review flags and correction edges. Use graph recall hits for source drill-down and topic continuity only; do not treat bindings, clusters, or edges as verified facts, user preferences, or prompt instructions.

MCP `cogmem_recall` and `cogmem_explain_recall` expose the same `decisionTrace`. Check `selectedLane`, `reason`, and `candidateCounts` before claiming memory is absent, then follow `sourceContext.locator.command` for exact wording. Raw fallback searches the fully scoped ledger; equal raw cue matches prefer original user anchors, and past-memory queries prefer a cue-matching raw user anchor over a compiled assistant retelling.

Explicit user clarification is organizational correction evidence, not an automatic contradiction. Assistant self-correction and negative-form questions do not create user-owned corrections. A memory-model conflict proposal must cite at least two distinct exact raw event IDs from the current Dream window; `["all"]` and unknown IDs are rejected. Invalid memory-model output remains a rejected diagnostic. A host-owned maintenance tick supersedes stale `needs_confirmation` entries after the default 30-day TTL without deleting evidence.

When importing OpenClaw-style session Markdown into a Hermes project, Cogmem accepts multiline bodies below empty role headers, collapses only adjacent exact export duplicates, and uses `# Session: ... UTC` as the chronological timestamp base rather than file mtime.

After upgrading, rerun `cogmem connect hermes --workspace . --auto --force` and reload MCP so existing allow-lists and skill instructions receive the current tools and contracts.

## Runtime Wiring

Use `KernelAgentMemoryBackend` for turn storage and recall:

```ts
import {
  KernelAgentMemoryBackend,
  createMemoryKernelFromConfig,
} from 'cogmem';

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

If Hermes can consume structured context before answering, prefer `memory.recallPack()` over plain `recall()`:

```ts
const pack = memory.recallPack({
  agentId: 'hermes',
  projectId: 'hermes',
  query: userText,
  limit: 5,
});
```

Use `pack.slots.direct` for direct memories, `pack.slots.associative` for graph/activation neighbors, `pack.slots.entityCards` for resolved projects/devices/people, and `pack.slots.beliefTouches` for active beliefs with support/conflict counts.

## Hermes Provider Notes

Hermes external memory providers are activated through `memory.provider` in `~/.hermes/config.yaml` and participate in lifecycle calls such as initialization, prompt context, prefetch, turn sync, session-end extraction, and built-in memory write mirroring.

Do not edit `~/.hermes/config.yaml` to point `memory.provider` at `cogmem` until a Hermes native provider plugin exists on disk. The supported bridge in this package is MCP.

`cogmem connect hermes` installs this file into `~/.hermes/skills/cogmem-memory/SKILL.md`, which is Hermes's primary skill directory.

`cogmem connect hermes --workspace . --auto --force` patches `~/.hermes/config.yaml` with this MCP server:

```yaml
mcp_servers:
  cogmem:
    command: "/resolved/path/to/cogmem-mcp"
    args: []
    enabled: true
    tools:
      include:
        - cogmem_remember_turn
        - cogmem_recall
        - cogmem_explain_recall
        - cogmem_memory_map
        - cogmem_maintenance_tick
```

The command path is resolved by `cogmem connect hermes`: it uses `COGMEM_MCP_BIN` when explicitly set, then a workspace-local `node_modules/.bin/cogmem-mcp` when present, then the globally linked `cogmem-mcp` from the one-line installer.

When Hermes calls `cogmem_recall`, it should pass `projectId: "hermes"` and may omit `agentId`; the MCP bridge infers `agentId` from `projectId`. The returned `items` use the same shape as `cogmem memory recall --project hermes --agent hermes --json`, including `raw_ledger` items, labeled `sourceContext` events, `sourceContext.window`, and `sourceContext.locator.command` when vectors are empty or compiled evidence misses.

Hermes may pass `collection: "theseus"` to `cogmem_recall` when it wants creative artifacts. Expose `cogmem_memory_map` and `cogmem_maintenance_tick` only to agents that are allowed to inspect memory anatomy or request host-owned upkeep.

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
