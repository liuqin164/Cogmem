# Memory Model

`@CognitiveOS/core` is an agent-native memory kernel. It stores agent experience, compiles durable memory at write time, recalls with structure-first pulse navigation, and keeps active context governed and bounded.

It is not a vector RAG store, a knowledge-base application, a wiki, an Obsidian replacement, or an agent runtime.

## Memory Tiers

- Raw Archive: append-only raw experience events such as user messages, assistant messages, tool observations, task events, imports, and corrections.
- Chronological Memory Ledger: the ordered event ledger used for audit, replay, source anchoring, and migration consistency.
- Raw Search Index: FTS/metadata search over raw ledger text for exact source discovery without requiring every event to keep a high-dimensional vector.
- Compiled Memory: write-time facts, beliefs, events, summaries, graph links, and governance state derived from raw evidence.
- Dream Backlog: observable consolidation coverage over raw events so `raw_then_dream` does not silently become unprocessed log accumulation.
- Dream Candidates: curator output such as user preference candidates, project memories, long-term goals, boundaries, failure lessons, diagnostic conclusions, session/topic summaries, corrections, causal/tool-observation links, temporal invalidation suggestions, and conflict candidates. These remain candidates with source refs, confidence, and governance status; an LLM helper must not directly rewrite verified memory.
- Active Core: a very small current operating context maintained by the host agent or adapter, not all history.
- Associative Graph: pulse-activated local graph, topic, entity, temporal, and cognitive adjacency candidates.
- Recall Pack / ContextPack: the limited governed context returned for the current agent task.
- Filtered Evidence: same-project candidates that were considered but suppressed by status, trust, scope, or budget.

Vector pruning is not memory pruning. Compaction may delete hot vector blobs, temporary embeddings, or stale indexes, but it must not delete raw ledger events, chronological order, sourceRefs, content hashes, or tool-call parent/child links unless the user explicitly requests a privacy deletion.

## Chronological Memory Ledger

The ledger answers chronological questions:

- Which event came first globally?
- Which event came next in a thread?
- Which user message triggered which assistant reply?
- Which tool result belongs to which tool call?
- Which raw event anchored a semantic memory?

The ledger uses optional, backward-compatible fields:

- `globalSeq`, `eventId`, `createdAt`, `ingestedAt`, `sourceId`, `contentHash`
- `threadId`, `sessionId`, `threadSeq`, `localDate`, `projectId`, `workspaceId`
- `turnId`, `turnSeq`, `eventOrdinal`, `role`, `sourceOffset`, `lineStart`, `lineEnd`, `charStart`, `charEnd`
- `parentEventId`, `prevEventId`, `nextEventId`, `causalityType`
- `rawEventType`, `orderingConfidence`

Use `MemoryKernel.getThreadEvents(threadId)` for replay, `MemoryKernel.getEventContext(eventId, { before, after })` for source drill-down, and `MemoryKernel.searchRawEvents(query, { projectId })` for raw keyword discovery when a raw event was not compiled into semantic memory.

Provider facades record raw lifecycle events without importing host runtimes:

- `recordRawEvent()` / `KernelAgentMemoryBackend.rememberTurn()` record user and assistant messages.
- `KernelAgentMemoryBackend.rememberTurnWithResult()` supports `ingestMode: "immediate_compile" | "selective_compile" | "raw_archive_only" | "raw_then_dream"`. `immediate_compile` preserves legacy behavior; the other modes preserve raw ledger evidence while limiting immediate high-dimensional vector writes.
- `recordToolCall()` / `KernelAgentMemoryBackend.ingestToolCall()` record assistant tool calls with `rawEventType: "tool_call"`.
- `recordToolResult()` / `KernelAgentMemoryBackend.ingestToolObservation()` record tool results with `rawEventType: "tool_result"` and `causalityType: "tool_result_for"`.
- `recordTaskEvent()` / `KernelAgentMemoryBackend.ingestTaskEvent()` record task events with source refs.

Tool observations are stored as external-tool evidence candidates. They are not promoted into verified facts merely because they were observed or later recalled.

## Dream Curator

`raw_then_dream` stores full raw evidence first and defers semantic compilation. `MemoryKernel.runDreamCurator({ projectId, limit })` processes undreamed raw events in `globalSeq` order and writes candidate records to the deep-write governance queue. It advances dream ledger coverage only after the batch is recorded, and it never deletes raw events.

The built-in curator is deterministic and local-first. It suppresses operational noise such as heartbeat polls, builds a window summary, extracts explicit user preference / constraint / goal candidates, records correction candidates, captures tool-result causal candidates when parent-child raw event links exist, and proposes semantic organization records. These organization records include `semantic_tags`, `indexing_decision`, `semantic_relation`, and `edge_adjustment` candidates. They let a host-owned curator loop classify dialogue windows into stable topic paths such as `memory/auditability`, decide whether a raw event deserves later embedding, connect user/assistant events, and suggest strengthened or weakened associations. Every candidate evidence item includes a raw `eventId`, role, chronological fields, and `sourceAnchor`.

When `[memory_model]` is configured with an OpenAI-compatible chat endpoint, the same worker can call the configured memory model after deterministic extraction. This supports both local Ollama (`base_url = "http://localhost:11434/v1"`) and cloud OpenAI-compatible APIs. The model may propose user preferences, project memories, long-term goals, prohibitions/boundaries, failure lessons, diagnostic conclusions, session summaries, topic summaries, temporal fact updates, conflicts, semantic tags, indexing decisions, semantic relations, and edge adjustments. LLM output is normalized into candidate records only. CPU governance still owns status changes such as `candidate`, `needs_confirmation`, `promoted`, `superseded`, and `rejected`. Repeated recall may raise activation weight, but it must not by itself raise truth confidence.

Dream candidates are not active long-term facts by default. They enter the queue with status `candidate` or `shadow`, below the normal automatic-promotion threshold, and can be inspected with:

```bash
cogmem memory dream --project <project> --json
cogmem memory candidates --project <project> --status candidate --json
```

Promotion is a separate CPU-governed step handled by the deep-write promotion policy. Missing evidence, inference-only content, low confidence, assistant/tool-only observations, or unsupported causal links remain `needs_confirmation` or stay candidates. This preserves the rule that dreaming can organize memory but cannot silently turn model guesses or tool output into verified truth.

The worker can be run manually or by a host-owned schedule. Core provides schedule helpers for `manual`, `interval`, `daily`, and `continuous` workflows, but it does not start hidden timers or a daemon. Cron, systemd, OpenClaw, Hermes, or another adapter decides when to call `cogmem memory dream` or `MemoryKernel.runDreamCurator()`.

## Recall Ranking

chronological order is not recall ranking.

Chronological order is for replay and audit. Recall ranking is for selecting useful current context. Agent-facing recall still uses governed universe navigation: query compilation, pulse activation, temporal traversal, graph expansion, inhibition, and evidence budgeting.

Do not use vector topK to reconstruct conversation order. Do not use ledger replay to bypass governed recall. Do not inject an entire thread, day, or transcript into prompt context unless a forensic/audit tool explicitly requests replay.

Cold recall should reactivate evidence in layers: first governed compiled memory and summaries, then bounded raw FTS/metadata search, then optional on-demand reranking of a small raw window. `KernelAgentMemoryBackend.recall()` compiles long user questions into a bounded query plan before raw search, so filler text does not drown out cues such as `CogMem Memory Context`, `记忆`, and `黑盒`. The plan also carries `semanticCuePhrases` and `temporalHints`; for example, a later query about `记忆黑盒` can search raw evidence that originally used `对话存档位置属于黑盒`. If prompt injection is absent or too thin, agents should call `cogmem memory recall --query "<question>" --project <project> --agent <agent> --json` before claiming they do not remember. Forensic follow-ups can pass `anchorEventId` or `anchorText` from the previous recall item to answer "what were my exact words" from the raw ledger instead of guessing from an imported summary. The backend uses raw ledger fallback only after governed universe navigation and BrainRecall fail to produce scoped evidence. Do not restore the old pattern of embedding every raw sentence just to make fuzzy search easier.

## SourceRefs

Semantic memories remain traceable through `sourceRefs`. A source ref may point to:

- a raw ledger event id
- a thread/session/turn position
- a source path
- line or character offsets
- parent/previous event links
- ordering confidence

Imported Markdown records preserve line order and block ordinal when available. OpenClaw/Hermes importers also create raw ledger anchor events for imported records before compiled ingest, so old memory files can be searched and shown through `cogmem memory search/show/recall`. Normalized JSON array, JSONL, CSV, and TSV transcript imports emit per-message source anchors before Markdown ingestion so `sourceRefs` can preserve original array index, row line, or block ordinal instead of only the normalized Markdown line. If a source lacks reliable ordering, adapters should set `orderingConfidence: "low"` rather than inventing certainty.

Agent-facing recall items include `sourceAnchor` and, when available, `sourceContext`. `sourceContext` carries the raw event, bounded before/after events, parent/child links, and a local `cogmem memory show --event <eventId> --before 2 --after 2` locator. If `canAnswerExactQuote=false`, the item can still guide the agent to raw evidence, but it must not be quoted as user wording until the raw event is inspected.

## External Mechanisms

Compatible mechanisms translated into the kernel model:

- Temporal fact invalidation: represented by current fact and belief validity fields such as `validFrom`, `validTo`, supersession links, status, and evidence refs.
- Memory tier names: used as documentation and API explanation only.
- Provider lifecycle: routed through `KernelAgentMemoryBackend` and narrow adapters, never through host runtime imports.
- Behavior memory: stored as candidate/provisional governed memory with source refs and confidence, not as automatically verified fact.
- Dreaming-style consolidation: implemented as a candidate-only curator that proposes categorized candidates and summaries from raw ledger windows. It may use deterministic rules only, or an explicitly configured OpenAI-compatible memory model, to classify user preferences, project constraints, procedures, failures, diagnostic memories, topic summaries, corrections, semantic tags, indexing decisions, event relations, edge-adjustment proposals, causal tool observations, and temporal supersession/conflict candidates. CPU governance must decide promotion and every candidate must retain source refs.
- Benchmark ideas: expressed as natural-emergence metrics that test recall and inhibition together.

Rejected designs:

- default vector topK as the primary recall path
- LLM-controlled free memory mutation
- LLM dream output promoted straight to verified fact
- provider context directly injected into prompts
- Markdown projection as source of truth
- unbounded graph traversal
- fixed recent-six-turn context as the memory model
