# OpenClaw Backend

Use cogmem as OpenClaw's durable memory backend.

Entity resolution is evidence-backed and reversible. Person aliases require explicit user evidence; OpenClaw must not auto-merge pronouns, relationship labels, role names, assistant claims, or tool observations.

Belief Graph writes keep ownership and evidence roles. OpenClaw may record assistant/tool project observations, but only explicit user events can establish user-owned preferences, goals, boundaries, decisions, or facts.

## Install

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent openclaw --scope project
cogmem doctor --fix --agent openclaw --workspace .
cogmem connect openclaw --workspace .
cogmem connect openclaw --workspace . --auto --force
```

## Local Quantized Embeddings

Imports use the configured kernel embedder. To import existing OpenClaw memory through a local quantized model, configure the kernel before running the import command:

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

Embeddings are not the Dream Worker. If you use `raw_then_dream`, configure an optional local or cloud memory model separately:

```toml
[memory_model]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen2.5:7b"
api_key = ""
timeout_ms = 60000
```

Then run:

```bash
cogmem episode status --project openclaw --json
cogmem dream tick --project openclaw --mode auto --json
cogmem memory govern --project openclaw --json
cogmem memory candidates --project openclaw --status candidate --json
```

For a supervised long-running worker instead of cron:

```bash
cogmem dream tick --project openclaw --mode auto --max-episodes 10 --json
```

The OpenClaw hook writes Raw Ledger evidence and updates a source/thread-scoped episode, then returns without running Dream. Live classification stays CPU-only and uses previous assistant context to separate proposal acceptance, question/fact answers, rejection, and correction. Unknown turns become ambiguous review boundaries unless user-defined aliases, topic/entity/project overlap, or explicit continuation supports continuity. Background imports may use the advisory hybrid reviewer; it cannot mutate durable memory.

Cogmem 3.5.2 added a project-scoped user-shaped topic ontology. Explicit user naming and organization requests may become audited active topic operations; model-proposed nodes, aliases, and relations remain candidates. For bad episode boundaries, use the split/merge/move/reclassify repair commands instead of editing SQLite; repair recalculates receipts, invalidates old candidates, preserves cross-references, and requeues sealed work.

The Dream Worker processes sealed episodes and proposes candidate memories only. Micro, normal, and deep modes change curator scope as well as batch size. Episode semantic summaries help routing but are not evidence: candidates must cite raw event IDs from the episode. CPU governance is a separate step. Use `cogmem memory govern` to evaluate evidence-backed candidates. Dream does not rewrite verified facts or promote tool/LLM output into active memory.

For host-owned inspection and upkeep:

```bash
cogmem memory map --project openclaw --json
cogmem memory tick --project openclaw --json
cogmem memory bind --project openclaw --json
```

Cogmem 3.6.0 adds Memory Atlas content navigation. The auto plugin calls the shared Atlas core directly, so OpenClaw does not need MCP for broad inventory/history questions. Atlas combines the query's actual project, time, topic, entity/target, memory-kind, and keyword conditions like table filters; no fixed entity-time-action tuple is required.

```bash
cogmem memory graph-explore --project openclaw --query "去年与 Hermes 有关的决定" --json
cogmem memory graph-node --project openclaw --id <node-id> --include-evidence --json
cogmem memory graph-path --project openclaw --from <node-id> --to <node-id> --json
```

Use Atlas to locate a bounded source-backed slice, then use `memory show` for exact evidence. Node activation controls default visibility and decays during explicit maintenance; exact scoped facets can still revive cold memory without promoting or rewriting it.

`memory tick` returns activation decay results and `suggestedActions`; it does not start a hidden daemon. If it reports `bind_raw_events`, run `memory bind` to attach imported or adapter-written raw user events to Memory Binding.

`memory map` includes Memory Binding and Graph Recall counters. Bindings attach valuable user raw events to stable topic/entity paths, fuse same-claim evidence into claim-key clusters, and create graph anchors for raw-ledger drill-down; they are not verified long-term facts. Correction bindings expose review flags and correction edges instead of turning the active cluster into a fact.

Recall JSON includes `decisionTrace`; the automatic prompt wrapper renders its compact form as `recallDecision=`. Check the selected lane, reason, and candidate counts before saying memory is absent, then use `sourceLocator` for exact wording. Raw fallback searches the fully scoped ledger and prefers original user anchors over later assistant retellings on equal cue matches.

Dream treats explicit user clarification as organizational correction evidence, not an automatic contradiction. Assistant self-correction and negative-form questions do not create user-owned corrections. Invalid provider output is a rejected diagnostic, and `memory tick` supersedes stale `needs_confirmation` entries after the default 30-day TTL without deleting evidence.

## Migrate

Upgrade and migrate the Cogmem database itself before importing host memory:

```bash
cogmem update --yes
cogmem migrate --yes --backup --json
```

Preview:

```bash
cogmem import-openclaw --workspace . --project openclaw --dry-run
```

Import:

```bash
cogmem import-openclaw --workspace . --project openclaw
```

Single source files and batches can be imported explicitly:

```bash
cogmem import-openclaw --workspace . --project openclaw --session ./one.md
cogmem import-openclaw --workspace . --project openclaw --session ./one.md --session ./two.md
cogmem import-openclaw --workspace . --project openclaw --memory ./one.md
cogmem import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md
```

The import command is idempotent. Re-running it against the same database skips records already processed by the cursor store.
Imported records are embedded through the configured kernel embedder during import.
Real non-JSON imports print source-level and embedding+ingest progress to stderr. Use `--json --progress` to keep JSON on stdout while streaming progress to stderr, or `--no-progress` for quiet automation.

## Runtime

```ts
import {
  KernelAgentMemoryBackend,
  OpenClawWorkspaceProfile,
  createMemoryKernelFromConfig,
} from 'cogmem';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);
const profile = new OpenClawWorkspaceProfile(process.cwd());

const sources = profile.buildInstalledBatchSources({ projectId: 'openclaw' });
console.log(sources);

await memory.rememberTurn({
  agentId: 'openclaw',
  projectId: 'openclaw',
  sessionId: 'current',
  userText: 'Remember that public release uses sqlite-vec.',
  assistantText: 'Stored.',
});

const recalled = memory.recall({
  agentId: 'openclaw',
  projectId: 'openclaw',
  query: 'which vector backend should release use?',
});

console.log(recalled.items);
```

The profile imports memory sources only. It ignores operational files such as `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, and `BOOTSTRAP.md` by default.

When `recalled.items[]` contains `sourceContext`, the agent can answer where the original raw event lives and inspect surrounding context. Events include stable `label` values, optional `charRange` / `sourceRange`, and `sourceContext.window` metadata describing requested counts, actual counts, anchor exclusion, ordering, role filter, and overlap handling. If the user asks for exact wording or a full thread, use the provided `sourceContext.locator.command`, for example:

```bash
cogmem memory show --event <eventId> --before 2 --after 2
```

Do not quote `compiled_memory` or `imported_summary` items as user wording when `canAnswerExactQuote=false`.

If automatic `<COGMEM_RECALL_CONTEXT>` injection is absent or too thin, the agent should actively query the kernel before saying it does not remember:

```bash
cogmem memory recall --query "<user question>" --project openclaw --agent openclaw --json
```

Use `--intent previous_session_summary` for "上个会话我们聊了什么" and `--intent forensic_quote` for "我当时的原话是什么". Only fall back to legacy `memory/` Markdown files after `cogmem memory recall` or `cogmem memory search` fails to find useful evidence.

Use `--collection theseus` only for creative artifacts or drafts:

```bash
cogmem memory recall --query "<artifact query>" --project openclaw --agent openclaw --collection theseus --json
```

Default recall includes untagged and `collection:anchor` memory only.

After upgrading an existing OpenClaw workspace that imported old memory before raw ledger anchors were available, run:

```bash
cogmem import-openclaw --workspace . --project openclaw --config .cogmem/config.toml --reindex-raw --json
```

This backfills searchable raw anchors for old imported memories without duplicating compiled memory or vectors.

For agent-facing instructions, install or read `SKILL.md`. `cogmem connect openclaw --workspace .` copies it to `<workspace>/skills/cogmem-memory/SKILL.md`.

To make future OpenClaw turns automatically recall and record memory, run:

```bash
cogmem connect openclaw --workspace . --auto --force
```

`--auto` installs `<workspace>/extensions/cogmem-auto-memory/`, patches OpenClaw `plugins.load.paths`, and enables a local plugin wrapper with `before_prompt_build` and `agent_end` hooks. The wrapper calls `KernelAgentMemoryBackend` through the public `cogmem` API via a Bun bridge; core still does not import OpenClaw.

The wrapper does not rewrite OpenClaw's native prompt, tool instructions, skills, or conversation order. It only prepends Cogmem-owned blocks:

- `<COGMEM_RECALL_CONTEXT>`: volatile current-turn recall evidence. It is stripped before queued remember jobs are written.
- `<COGMEM_TURN_BRIDGE>`: compact memory-use receipt for same-topic follow-ups, stored under `.cogmem/session_bridges/openclaw/`.
- `<COGMEM_SESSION_STATE>`: short current-session working state, stored under `.cogmem/session_state/openclaw/`.
- `<COGMEM_STRATEGY_CONTEXT>`: CPU-owned current-turn memory policy with no instruction authority. It is stripped before recording and never becomes evidence.

Do not copy these blocks into long-term memory, dream candidates, or user preferences. If details are needed, re-run recall or inspect `sourceLocator`.

If the package is updated later, repair the OpenClaw wiring with:

```bash
cogmem doctor --fix --agent openclaw --workspace .
```

Current OpenClaw memory config is OpenClaw-owned (`memory.backend` supports backends such as `"builtin"` and `"qmd"`). Do not add unknown host config fields for cogmem and do not write `plugins.slots.memory`.
