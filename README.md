# cogmem

Agent-native memory kernel for a single AI agent.

`cogmem` is a local-first memory backend for agents and agent frameworks. It stores raw experience, preserves provenance, curates long-term memory candidates, governs what becomes active memory, and recalls bounded context with source anchors.

Cogmem is a lightweight, local-first memory kernel for personal AI agents.
It lets agents recall and inject relevant source-anchored memory without manually reading memory files.

It is not a knowledge-base app, a note-taking app, a vector RAG wrapper, an Obsidian replacement, an agent runtime, or a task scheduler.

## Status

Current version: `3.4.0`

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

Memory Binding
  CPU-canonicalized raw-event bindings to stable entity/topic paths, claim-key clusters, and activation-aware graph edges for source-anchored organization before fact promotion.

Memory Governance Plan
  Evidence-backed, idempotent semantic operations validated by CPU policy and committed with their audit records in one SQLite transaction.

Compiled Memory
  Governed summaries, preferences, constraints, goals, lessons, diagnostics, and topic memories.

Dream Curator
  Background curation worker that reads raw ledger windows and proposes candidates only.

CPU Governance
  Rule-based promotion, suppression, supersession, and confirmation policy.

Active Recall
  Bounded context pack assembled with binding graph anchors, pulse activation, temporal routing, source anchors, and inhibition.

Strategy Cortex
  CPU-owned current-turn policy that selects retrieval lanes, layer order, source requirements, and memory budget before recall.
```

Strategy Cortex borrows StraTA's separation between a compact global strategy and local execution, while deliberately excluding its online reinforcement-learning loop. Cogmem uses deterministic templates online and reserves diverse strategy comparison and critical memory-use judgment for offline BrainEval. See [StraTA](https://arxiv.org/abs/2605.06642).

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
bun add "cogmem@github:liuqin164/cogmem#3.4.0"
bunx cogmem init
```

Validate configuration:

```bash
cogmem doctor
```

Upgrade from GitHub Releases and migrate an existing database:

```bash
cogmem update --yes
```

`cogmem update --yes` resolves the latest GitHub Release asset, installs it, then runs the newly installed `cogmem migrate --yes --backup`. To inspect changes without writing:

```bash
cogmem update --dry-run --json
cogmem migrate --dry-run --json
```

For a manual migration, run `cogmem migrate --yes --backup`. The migration runner adopts the existing `_meta.schema_version`, applies only later idempotent migrations, preserves Raw Ledger rows, and creates a timestamped, transaction-consistent standalone database backup before changing an on-disk database. The backup includes committed SQLite WAL pages instead of copying only the main database file.

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
cogmem memory bind --project my-agent --json
```

`memory tick` decays activation and returns suggested host actions. It reports high-value raw user events that have not been attached to Memory Binding yet, non-fatal binding failures that did not block raw ledger writes, and `needs_confirmation` candidates older than the default 30-day review TTL. Expired review items are marked `superseded` with `needs_confirmation_ttl_expired`; their evidence is not deleted. It does not start a hidden daemon; cron, systemd, MCP hosts, or agent adapters decide when to call it.

`memory bind` backfills Memory Binding for raw user events written outside the agent turn path, including imported OpenClaw/Hermes history and adapter-written raw events. Use `--since <globalSeq>` to resume from a known ledger sequence.

`memory map` includes Memory Binding and Graph Recall counters. Bindings attach valuable user raw events to stable topic/entity paths before any fact promotion, fuse same-claim evidence into claim-key clusters, and create graph anchors for source drill-down. Correction events create explicit correction edges and review flags instead of poisoning the active cluster. Treat bindings, clusters, and graph edges as organization hints, not as verified long-term facts.

Entity identity is owned by `EntityStore`; Memory Binding only writes those canonical entity IDs into its compatibility projection. `EntityGovernanceService` creates evidence-backed merge candidates, requires same-project/same-type entities, and makes every applied merge reversible. Person aliases require explicit user evidence and a higher confidence threshold. Do not auto-merge pronouns, family labels, role names, or assistant/tool-only guesses.

`BeliefGovernanceService` turns repeated evidence into versioned current beliefs without losing the source chain. User-owned preferences, goals, boundaries, and decisions require explicit user events. Assistant and tool evidence may create project observations, but cannot establish user facts. Matching evidence reinforces one node; user corrections supersede the prior version; unsupported contradictions remain `possible_conflict` while the current belief stays active.

`TemporalMemoryService` answers which belief version was valid at a requested time and maintains bounded project/entity timelines for milestones, decisions, corrections, and belief versions. Current answers must not silently mix superseded state with active state. Historical answers should include the relevant validity window, correction reason, and raw evidence anchors when available.

`ContextCortex` decides whether memory should surface, which layers are eligible, and how much context they may consume. It hard-filters cross-project, superseded, current-session echo, unsupported user-belief, and unnecessary sensitive candidates before ranking. The default memory budget is 25% of available context with a 30% hard ceiling. Every plan emits an activation receipt containing selected and suppressed IDs with reasons.

`StrategyCortex` runs before recall for non-trivial memory queries. It selects one CPU-owned template such as `source-first`, `temporal-first`, `user-belief-first`, `project-state`, `graph-source`, or `balanced-memory`, then constrains which graph/compiled/raw lanes may run and how Context Cortex orders the resulting layers. A capsule is fixed only for the current turn. Intent/project changes, an unmet exact-source requirement, evidence conflict, or an unsatisfied required-layer budget may trigger at most one deterministic replan. The capsule has `instructionAuthority: "none"`: it cannot override the user, host policy, tool authorization, or memory governance.

Inspect this policy and its read-only outcome telemetry with:

```bash
cogmem strategy plan --project hermes --query "我当时的原话是什么？" --json
cogmem strategy outcomes --project hermes --json
```

OpenClaw plugin 0.3.0 skips Cogmem entirely for greetings, uses only session state/turn bridge for short continuations, and applies Strategy Cortex before full recall. It records a read-only context outcome after the turn for offline evaluation; the judge cannot mutate belief, entity, temporal, or prospective memory.

`ProspectiveMemoryService` stores future intentions, commitments, reminders, open loops, and plans as candidates only. A candidate is not actionable until an explicit user event confirms it. Rejected candidates stay suppressed unless genuinely new evidence creates a new version. The service and `cogmem prospective` CLI manage state only; they expose no task or tool execution capability.

```bash
cogmem prospective create --project hermes --type reminder --key release:check-ci --title "Check CI" --evidence <request-event-id> --due <epoch-ms>
cogmem prospective confirm --project hermes --id <candidate-id> --evidence <distinct-user-confirmation-event-id>
cogmem prospective due --project hermes
```

Every mutation requires the candidate project. Confirmation evidence must be a distinct Raw Ledger user event in that project. A due result is memory state, not permission to run a tool.

Run `cogmem brain-eval --input samples.json` to measure recall, precision, provenance coverage, context-budget compliance, stale/cross-project leakage, and unconfirmed prospective activation. The command exits non-zero when a safety threshold fails.

Compare precomputed memory-policy rollouts offline with:

```bash
cogmem brain-eval --input strategy-outcomes.json --strategy-rollout --json
```

This mode never generates online rollouts. It reports median and worst-decile quality, source fidelity, strategy adherence, unsafe/stale/cross-project leakage, budget compliance, and p95 latency. Top-fraction score is diagnostic potential only and cannot override a failed safety gate.

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

The automatic wrapper keeps OpenClaw's native prompt untouched. Cogmem only prepends its own bounded memory layer:

- `<COGMEM_SESSION_STATE>` is compact current-session working state stored under `.cogmem/session_state/openclaw/`.
- `<COGMEM_TURN_BRIDGE>` is a short-lived receipt of which memory anchors supported the prior answer, stored under `.cogmem/session_bridges/openclaw/`.
- `<COGMEM_STRATEGY_CONTEXT>` is the current-turn, no-authority memory-use policy. It is not evidence or an instruction and is stripped before recording.
- `<COGMEM_RECALL_CONTEXT>` is full recall evidence for the current turn only. It is stripped before turn recording and must not be persisted or re-ingested as new memory.

By default, `selective_compile` uses user text as the durable compile signal, excludes current-session compiled memory during recall, injects at most three memory items, and omits full source-window text unless the plugin config enables it.

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

With `--auto`, it adds or updates a `cogmem` MCP server entry in:

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

`cogmem_recall` uses the same agent-facing recall path as `cogmem memory recall` and returns its `strategyCapsule`. `cogmem_strategy_plan` exposes that deterministic, read-only memory policy without performing recall. If `agentId` is omitted, MCP infers it from `projectId`, so project-only Hermes calls can still reach raw ledger fallback and return `items[].sourceContext` when vectors are empty. Re-running `cogmem connect hermes --auto` after an upgrade also patches existing `tools.include` allow-lists with newly supported Cogmem MCP tools.

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

The MCP `cogmem_recall` tool returns the same agent-facing item shape and fallback behavior. Agents may call it with `query`, `projectId`, and optionally `agentId` and `collection`; when `agentId` is omitted, MCP uses `projectId` as the agent id before falling back to `openclaw`. `cogmem_strategy_plan` is the read-only strategy inspection path, while `cogmem_explain_recall` remains the audit path for `filteredEvidence` and governance reasons. Recall and explain surfaces expose `decisionTrace`, and OpenClaw renders its bounded form as `recallDecision`. Inspect `selectedLane`, `reason`, and candidate counts before claiming that memory is absent; then use `sourceLocator` for exact wording.

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

- `decisionTrace` with the selected recall lane, stable reason, per-lane candidate counts, and selected count
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

`memory show --json` uses the same source context contract. Its `before` and `after` arrays strictly exclude the anchor event, remain chronological, and are de-duplicated. The `window` object reports `requestedCount`, `count`, `excludesAnchor`, `roleFilter`, `ordering`, `overlapEventIds`, and `overlapHandling`. OpenClaw automatic prompt injection renders this metadata inside `<COGMEM_RECALL_CONTEXT>` as `sourceWindow` and `sourceTruncation`; full `sourceBefore` / `sourceAfter` text is omitted by default and should be requested through `sourceLocator` before quoting exact wording.

Raw-ledger fallback is not limited to the latest fixed event window. When Chinese FTS cannot match a cue directly, Cogmem runs a project/workspace/thread/time-scoped ledger text fallback and prefers an original user event over an assistant retelling when both match equally. Imported OpenClaw Markdown also accepts empty `user:` / `assistant:` headers whose body follows on later lines and collapses only adjacent exact duplicate exports.

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
name or URL contains `cogmem`; when no package asset is attached, it uses that
release's immutable tag. If GitHub does not return release metadata, the update
stops instead of installing mutable `main`; use `--from` only when you intentionally want another ref.

For OpenClaw after an update:

```bash
cd ~/.openclaw/workspace
cogmem doctor --fix --agent openclaw --workspace .
```

For Hermes after an update:

```bash
cogmem connect hermes --workspace /path/to/hermes/workspace --auto --force
```

This also updates existing Hermes `cogmem-mcp` blocks with missing `cogmem_strategy_plan`, `cogmem_memory_map`, `cogmem_maintenance_tick`, and `cogmem_prospective` entries.

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
