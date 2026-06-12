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

Each `recall.items[]` entry can include:

- `sourceType`: `compiled_memory`, `raw_ledger`, `raw_ledger_session`, or `imported_summary`.
- `canAnswerExactQuote`: only `true` means the item can support exact wording.
- `sourceAnchor`: the raw event/session/thread anchor.
- `sourceContext`: bounded raw event context with before/after events.
- `sourceContext.locator.command`: a local command such as `cogmem memory show --event <eventId> --before 2 --after 2`.

If the user asks for "原话", "具体内容", "完整脉络", "为什么当时这么判断", or "前后发生了什么", use `sourceContext` first. If more context is needed, run the locator command. Do not answer exact quotes from `compiled_memory` or `imported_summary` alone.

## Active Memory Search

If CogMem Retrieved Memory is absent, thin, or does not answer the user's question, do not answer "I do not remember" until you actively query CogMem. Use the kernel first, not the old `memory/` Markdown files:

```bash
./node_modules/.bin/cogmem memory recall --query "<user question>" --project openclaw --agent openclaw --json
```

Useful intents:

```bash
./node_modules/.bin/cogmem memory recall --query "上个会话我们聊了什么" --intent previous_session_summary --project openclaw --agent openclaw --session "$OPENCLAW_SESSION_ID" --exclude-session "$OPENCLAW_SESSION_ID" --json
./node_modules/.bin/cogmem memory recall --query "我关于记忆黑盒问题的原话是什么" --intent forensic_quote --project openclaw --agent openclaw --json
```

Use `items[].sourceContext` to understand what the user asked, how the agent answered, and nearby context. If the item has `sourceContext.locator.command`, run that command for a fuller local replay:

```bash
./node_modules/.bin/cogmem memory show --event <eventId> --before 2 --after 2 --json
```

Only fall back to searching OpenClaw's legacy `memory/` files when `cogmem memory recall` and `cogmem memory search` return no useful evidence or when the user explicitly asks to inspect the legacy files.

## OpenClaw Host Integration Notes

`cogmem-connect openclaw` installs this file into `<workspace>/skills/cogmem-memory/SKILL.md`, which is OpenClaw's workspace skill location. That makes the procedure discoverable without changing OpenClaw host config.

Current OpenClaw memory config is OpenClaw-owned. Its documented backend selector is `memory.backend` with values such as `"builtin"` and `"qmd"`, and the built-in memory surface exposes tools such as `memory_search` and `memory_get`. Do not write `plugins.slots.memory` or other unknown OpenClaw config fields for CognitiveOS-core; OpenClaw uses strict config validation and unknown fields can prevent the Gateway from starting.

To make every future OpenClaw turn automatically use the memory kernel, install the local plugin wrapper:

```bash
./node_modules/.bin/cogmem-connect openclaw --workspace . --auto --force
```

`--auto` writes `<workspace>/extensions/cogmem-auto-memory/`, patches `plugins.load.paths`, and enables `hooks.allowPromptInjection=true` and `hooks.allowConversationAccess=true` for the wrapper. The wrapper registers `before_prompt_build` for governed recall and `agent_end` for turn recording, then calls `KernelAgentMemoryBackend` through `@CognitiveOS/core` public API via a Bun bridge. Core does not import OpenClaw.

Queued remember is the default. `agent_end` appends a durable JSONL job under `.cogmem/queue/openclaw-remember.jsonl` and spawns a background drain process, so Telegram or gateway responses are not blocked by embeddings, SQLite writes, or slow local models. If a drain fails, the job is retried and then moved to a dead-letter file instead of being silently discarded.

For high-dimensional embedding models, prefer `ingestMode = "selective_compile"` or `ingestMode = "raw_then_dream"`. `raw_then_dream` keeps all raw events in the chronological ledger and lets the Memory Curator / Dream Worker generate candidate memories later.

To enable local Ollama or cloud OpenAI-compatible curation, configure `[memory_model]` in `.cogmem/config.toml`; do not use hidden environment variables:

```toml
[memory_model]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen2.5:7b"
api_key = ""
timeout_ms = 60000
```

Run curation manually or from a host-owned schedule:

```bash
./node_modules/.bin/cogmem memory dream --project openclaw --json
./node_modules/.bin/cogmem memory candidates --project openclaw --status candidate --json
```

The Dream Worker only proposes candidates such as user preferences, project memories, long-term goals, boundaries, failure lessons, diagnostic conclusions, session/topic summaries, temporal fact updates, and conflicts. CPU governance decides whether they remain provisional, need confirmation, become promoted, or are superseded/archived.
It also proposes semantic tags, indexing decisions, event relations, and edge-adjustment candidates so future recall can route by stable cues such as `memory/auditability`, `concept:memory_black_box`, and `need:source_drilldown` instead of matching only the user's full sentence. These are still governance candidates; do not treat them as verified facts until promoted by core governance.

After package updates or config drift, repair the host wiring:

```bash
./node_modules/.bin/cogmem-doctor --fix --agent openclaw --workspace .
```

The wrapper maps OpenClaw behavior to core like this:

- `memory_search` should call `memory.recall()` and return `recall.narrative` plus cited `recall.items`.
- `memory_get` should read from the cited evidence returned by core or from the original workspace file when a citation includes a file path.
- Prompt injection should use `recall.narrative`, not a raw vector nearest-neighbor dump.
- Turn capture should enqueue `memory.rememberTurnWithResult()` after the agent response. If OpenClaw exposes tool calls, tool results, or task events in the hook payload, the wrapper records them as ledger events with parent/child causality; if a result has no matching call, it is stored as a partial-causality task event instead of inventing a chain.

## Debug Recall

Normal prompt injection stays compact. When a user asks where a memory came from, why it was recalled, or why another candidate was filtered, run:

```bash
./node_modules/.bin/cogmem-explain-recall --query "<user question>" --project openclaw --agent openclaw --json
```

Inspect `sourceAnchor`, `activationPath`, `whyMatched`, `filteredEvidence`, and `governanceReason`. `sourceAnchor` points back to raw ledger events or imported source files. `filteredEvidence` is for audit/debug and must not be injected wholesale into normal prompts.

When normal prompt injection contains `# CogMem Retrieved Memory`, treat it as historical memory selected by the kernel, not as the current conversation and not as a complete transcript. If the injected item includes `sourceContext`, it is allowed to explain what was asked, how it was answered, and nearby context. If it only includes an imported summary and `canAnswerExactQuote=false`, say that only a summary is available unless you can inspect raw source evidence.

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
