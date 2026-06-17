# OpenClaw Backend

Use cogmem as OpenClaw's durable memory backend.

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
cogmem memory dream --project openclaw --promote --json
cogmem memory govern --project openclaw --json
cogmem memory candidates --project openclaw --status candidate --json
```

For a supervised long-running worker instead of cron:

```bash
cogmem memory dream --project openclaw --watch --interval-ms 300000 --promote --json
```

The Dream Worker proposes candidate memories only. CPU governance is a separate step. Use `--promote` or `cogmem memory govern` to turn evidence-backed summaries/preferences into provisional memory and to accept semantic tags, indexing decisions, event relations, and edge adjustments as organization metadata. It does not rewrite verified facts or promote tool/LLM output into active memory.

For host-owned inspection and upkeep:

```bash
cogmem memory map --project openclaw --json
cogmem memory tick --project openclaw --json
```

`memory tick` returns activation decay results and `suggestedActions`; it does not start a hidden daemon.

`memory map` includes Memory Binding v0 counters. Bindings attach valuable user raw events to stable topic/entity paths for organization and raw-ledger drill-down; they are not verified long-term facts.

## Migrate

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

Do not copy these blocks into long-term memory, dream candidates, or user preferences. If details are needed, re-run recall or inspect `sourceLocator`.

If the package is updated later, repair the OpenClaw wiring with:

```bash
cogmem doctor --fix --agent openclaw --workspace .
```

Current OpenClaw memory config is OpenClaw-owned (`memory.backend` supports backends such as `"builtin"` and `"qmd"`). Do not add unknown host config fields for cogmem and do not write `plugins.slots.memory`.
