# Memory Model

`@CognitiveOS/core` is an agent-native memory kernel. It stores agent experience, compiles durable memory at write time, recalls with structure-first pulse navigation, and keeps active context governed and bounded.

It is not a vector RAG store, a knowledge-base application, a wiki, an Obsidian replacement, or an agent runtime.

## Memory Tiers

- Raw Archive: append-only raw experience events such as user messages, assistant messages, tool observations, task events, imports, and corrections.
- Chronological Memory Ledger: the ordered event ledger used for audit, replay, source anchoring, and migration consistency.
- Raw Search Index: FTS/metadata search over raw ledger text for exact source discovery without requiring every event to keep a high-dimensional vector.
- Compiled Memory: write-time facts, beliefs, events, summaries, graph links, and governance state derived from raw evidence.
- Dream Backlog: observable consolidation coverage over raw events so `raw_then_dream` does not silently become unprocessed log accumulation.
- Dream Candidates: optional background curator output such as user preference candidates, project constraints, diagnostic memories, topic summaries, and temporal invalidation suggestions. These remain candidates with source refs, confidence, and governance status; an LLM helper must not directly rewrite verified memory.
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

## Recall Ranking

chronological order is not recall ranking.

Chronological order is for replay and audit. Recall ranking is for selecting useful current context. Agent-facing recall still uses governed universe navigation: query compilation, pulse activation, temporal traversal, graph expansion, inhibition, and evidence budgeting.

Do not use vector topK to reconstruct conversation order. Do not use ledger replay to bypass governed recall. Do not inject an entire thread, day, or transcript into prompt context unless a forensic/audit tool explicitly requests replay.

Cold recall should reactivate evidence in layers: first governed compiled memory and summaries, then bounded raw FTS/metadata search, then optional on-demand reranking of a small raw window. `KernelAgentMemoryBackend.recall()` compiles long user questions into a bounded query plan before raw search, so filler text does not drown out cues such as `CogMem Memory Context`, `记忆`, and `黑盒`. Forensic follow-ups can pass `anchorEventId` or `anchorText` from the previous recall item to answer "what were my exact words" from the raw ledger instead of guessing from an imported summary. The backend uses raw ledger fallback only after governed universe navigation and BrainRecall fail to produce scoped evidence. Do not restore the old pattern of embedding every raw sentence just to make fuzzy search easier.

## SourceRefs

Semantic memories remain traceable through `sourceRefs`. A source ref may point to:

- a raw ledger event id
- a thread/session/turn position
- a source path
- line or character offsets
- parent/previous event links
- ordering confidence

Imported Markdown records preserve line order and block ordinal when available. Normalized JSON array, JSONL, CSV, and TSV transcript imports emit per-message source anchors before Markdown ingestion so `sourceRefs` can preserve original array index, row line, or block ordinal instead of only the normalized Markdown line. If a source lacks reliable ordering, adapters should set `orderingConfidence: "low"` rather than inventing certainty.

## External Mechanisms

Compatible mechanisms translated into the kernel model:

- Temporal fact invalidation: represented by current fact and belief validity fields such as `validFrom`, `validTo`, supersession links, status, and evidence refs.
- Memory tier names: used as documentation and API explanation only.
- Provider lifecycle: routed through `KernelAgentMemoryBackend` and narrow adapters, never through host runtime imports.
- Behavior memory: stored as candidate/provisional governed memory with source refs and confidence, not as automatically verified fact.
- Dreaming-style consolidation: acceptable only as a local-first curator that proposes categorized candidates and summaries from raw ledger windows. It may classify user preferences, project constraints, procedures, failures, diagnostic memories, topic summaries, and temporal supersession candidates, but CPU governance must decide promotion and every candidate must retain source refs.
- Benchmark ideas: expressed as natural-emergence metrics that test recall and inhibition together.

Rejected designs:

- default vector topK as the primary recall path
- LLM-controlled free memory mutation
- LLM dream output promoted straight to verified fact
- provider context directly injected into prompts
- Markdown projection as source of truth
- unbounded graph traversal
- fixed recent-six-turn context as the memory model
