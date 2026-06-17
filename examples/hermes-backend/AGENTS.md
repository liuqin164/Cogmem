# Hermes Agent Memory Backend Runbook

You are configuring Hermes to use `cogmem` as its durable memory backend.

For a portable one-file skill, read `SKILL.md` or install it into the workspace with:

```bash
cogmem connect hermes --workspace .
```

This writes `~/.hermes/skills/cogmem-memory/SKILL.md`, which Hermes discovers as a local skill.

## Install

Run from the Hermes workspace root:

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent hermes
cogmem doctor --fix --agent hermes --workspace .
cogmem connect hermes --workspace . --auto
cogmem connect hermes --workspace .
```

The default install creates:

```text
~/.cogmem/config.toml
~/.cogmem/memory.db
~/.cogmem/snapshots/
```

Use `~/.cogmem/config.toml` or a project `.cogmem/config.toml` as the stable configuration source. Do not create `.cogmem.env` files or pass `--env-path` for normal installs. Environment variables are only for explicit process-level overrides documented by the CLI, not for hidden workspace configuration.

Use `cogmem init --yes --agent hermes --scope project` only when this workspace needs its own `.cogmem/` directory.

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

## Migrate Existing Hermes Memory

Default Hermes memory contract:

- `state.db` may contain the real chronological conversation history in SQLite `messages`.
- `profile.md` contains durable profile/persona memory.
- `sessions/**/*.md` contains conversation/session memory.

Preview first:

```bash
cogmem import-hermes --workspace . --project hermes --dry-run
```

If `state.db` exists, default import scans it automatically. If the database is elsewhere:

```bash
cogmem import-hermes --workspace . --project hermes --state-db ./state.db --dry-run
cogmem import-hermes --workspace . --project hermes --state-db ./state.db
```

The SQLite importer prefers message-level `occurredAt`, `timestamp`, or `createdAt`; numeric `timestamp` values below millisecond range are epoch seconds. It can read WAL-mode `state.db` through SQLite immutable mode. `InsertTime` is only a fallback. Do not use `InsertTime` as proof of the original conversation date when better message timestamps exist.

Then migrate:

```bash
cogmem import-hermes --workspace . --project hermes
```

Use `--json` when another agent needs structured output:

```bash
cogmem import-hermes --workspace . --project hermes --json
```

If Hermes stores memory somewhere else, pass explicit paths:

```bash
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
cogmem import-hermes --workspace . --project hermes --session ./one.md
cogmem import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

For Hermes JSONL session exports where each line has a `messages[]` array:

```bash
cogmem normalize-transcript --input ./hermes-sessions.jsonl --output ./hermes.normalized.md --family jsonl --dry-run --json
cogmem normalize-transcript --input ./hermes-sessions.jsonl --output ./hermes.normalized.md --family jsonl
cogmem import-hermes --workspace . --project hermes --session ./hermes.normalized.md
```

After import, run curation and CPU governance as a supervised worker:

```bash
cogmem memory dream --project hermes --watch --interval-ms 300000 --promote
```

## Active Memory Search

If the current prompt does not include enough Cogmem memory context, query Cogmem directly before searching legacy files:

```bash
cogmem memory recall --query "<user question>" --project hermes --agent hermes --json
```

For inventory or product questions, use recall first and raw search as a forensic fallback:

```bash
cogmem memory recall --query "我们记录过哪些库存" --project hermes --agent hermes --json
cogmem memory search --query "エルビ 库存" --project hermes --json
cogmem memory show --event <event-id> --before 2 --after 2 --json
```

`vectors: 0` does not mean Cogmem has no memory. It means the dense vector index has no hot vectors yet. `memory recall` still falls back to governed raw ledger search and returns `sourceContext` locators. Broad inventory questions are expanded into structured cues such as `库存管理`, `在库`, `产品コード`, and `数量`; if compiled-memory candidates miss those cues, raw ledger evidence is preferred.

`sourceContext` and `memory show --json` now share the same replay contract: each event has a `label`, optional `charRange` / `sourceRange`, and `sourceContext.window` / `window` metadata with requested counts, actual counts, `excludesAnchor`, `ordering`, `roleFilter`, and `overlapHandling`. Use those fields before quoting exact wording or explaining what happened before/after a recalled point.

Check status with:

```bash
cogmem memory status --project hermes --json
```

For automation, read the top-level fields `rawEvents`, `vectors`, `dreamedRawCount`, `undreamedRawCount`, and `dreamCoverageRate`.

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
  sessionId: 'current',
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

Recall behavior:

- `recall.recallMode === 'universe_navigation'` means core already ran pulse activation, temporal branch search, graph traversal, and narrative assembly.
- Use `recall.narrative` as the compact context summary for the next model prompt.
- Use `recall.items` as cited memory evidence.
- Use `recall.temporalTraversal?.labels` when the user refers to a day, session, or adjacent work period.
- Do not run a separate vector search before calling `memory.recall()`. The backend is the first-class memory retrieval path.

The migration command is idempotent. Re-running it skips records already imported into the same memory database.

Hermes integration is currently a skill plus MCP bridge. It does not replace a native Hermes memory provider and it does not patch Hermes runtime internals. `cogmem connect hermes --workspace . --auto` writes or updates the `mcp_servers.cogmem` entry in the Hermes config. Restart or reload Hermes after patching MCP config.

For active memory search through MCP, call `cogmem_recall` with `projectId: "hermes"` and `query`. `agentId` is optional for project-scoped Hermes calls; the MCP bridge infers it from `projectId`. The tool returns the same `items` shape as `cogmem memory recall`, including `raw_ledger` fallback and `sourceContext` locators when vectors are empty.

Use `cogmem memory map --project hermes --json` or MCP `cogmem_memory_map` to inspect Memory Binding v0 counters. Bindings attach high-value user raw events to stable topic/entity paths for organization and drill-down only; they are not verified facts, user preferences, or instructions. Re-run `cogmem connect hermes --workspace . --auto` after upgrades to patch existing MCP allow-lists with new Cogmem tools.
