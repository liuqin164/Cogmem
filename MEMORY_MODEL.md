# Memory Model

`cogmem` is an agent-native memory kernel. It stores agent experience, compiles durable memory at write time, recalls with structure-first pulse navigation, and keeps active context governed and bounded.

It is not a vector RAG store, a knowledge-base application, a wiki, an Obsidian replacement, or an agent runtime.

## Memory Tiers

- Raw Archive: append-only raw experience events such as user messages, assistant messages, tool observations, task events, imports, and corrections.
- Chronological Memory Ledger: the ordered event ledger used for audit, replay, source anchoring, and migration consistency.
- Raw Search Index: FTS/metadata search over raw ledger text for exact source discovery without requiring every event to keep a high-dimensional vector.
- Memory Binding Graph: deterministic raw-event bindings to stable entity/topic paths, claim-key clusters, and graph edges. This layer organizes source anchors and supports Graph Recall, but it is not a verified fact or belief store.
- Entity Governance: canonical entity identity, aliases, evidence-backed merge candidates, redirects, and reversible resolution logs. Person merges require explicit user evidence and stricter confidence; pronouns and generic relationship or role labels are never sufficient proof by themselves.
- Belief Graph: evidence-backed current cognition with ownership, source roles, confidence, versions, conflicts, and supersession links. User-owned beliefs require explicit user evidence; assistant/tool-only evidence is limited to project observations and cannot establish user preferences, goals, or boundaries.
- Temporal Memory: validity-window queries plus project, entity, milestone, decision, correction, and belief-version timelines. Historical lookup selects the version valid at the requested time; current lookup suppresses superseded versions unless history is explicitly requested.
- Context Cortex: intent classification, hard safety suppression, layer activation, source drill-down policy, and bounded context packing. It defaults to 25% of available context with a 30% hard ceiling and emits an activation receipt that explains every selected or suppressed candidate.
- Memory Governance Plan: candidate semantic operations with raw evidence IDs, ownership, source role, expected version, and idempotency key. CPU validation rejects missing evidence, cross-project references, and assistant/tool-only user-owned memory before a single SQLite transaction commits both projections and audit records.
- Compiled Memory: write-time facts, beliefs, events, summaries, graph links, and governance state derived from raw evidence.
- Dream Backlog: observable consolidation coverage over raw events so `raw_then_dream` does not silently become unprocessed log accumulation.
- Dream Candidates: curator output such as user preference candidates, project memories, long-term goals, boundaries, failure lessons, diagnostic conclusions, session/topic summaries, corrections, causal/tool-observation links, temporal invalidation suggestions, and conflict candidates. These remain candidates with source refs, confidence, and governance status; an LLM helper must not directly rewrite verified memory.
- Active Core: a very small current operating context maintained by the host agent or adapter, not all history.
- Collection Routing: `collection:<name>` tags split operational anchor memory from specialized lanes such as `collection:theseus` creative artifacts.
- Associative Graph: pulse-activated local graph, topic, entity, temporal, and cognitive adjacency candidates.
- Activation Store: persistent, decaying hot-memory traces touched by recall packs and inspected by host-owned maintenance ticks.
- Recall Pack / ContextPack: the limited governed context returned for the current agent task. `KernelAgentMemoryBackend.recallPack()` adds direct memory, associative neighbors, entity cards, belief touches, and a charge vector.
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

The built-in curator is deterministic and local-first. It suppresses operational noise such as heartbeat polls, builds a window summary, extracts explicit user preference / constraint / goal candidates, records explicit user clarifications as organizational `correction` candidates, captures tool-result causal candidates when parent-child raw event links exist, and proposes semantic organization records. Assistant self-correction is conversational context, not a user-owned correction or contradiction. Negative-form questions such as `是不是...` do not create correction records. These organization records include `semantic_tags`, `indexing_decision`, `semantic_relation`, and `edge_adjustment` candidates. They let a host-owned curator loop classify dialogue windows into stable topic paths such as `memory/auditability`, decide whether a raw event deserves later embedding, connect user/assistant events, and suggest strengthened or weakened associations. Every candidate evidence item includes a raw `eventId`, role, chronological fields, and `sourceAnchor`.

When `[memory_model]` is configured with an OpenAI-compatible chat endpoint, the same worker can call the configured memory model after deterministic extraction. This supports both local Ollama (`base_url = "http://localhost:11434/v1"`) and cloud OpenAI-compatible APIs. The model may propose user preferences, project memories, long-term goals, prohibitions/boundaries, failure lessons, diagnostic conclusions, session summaries, topic summaries, temporal fact updates, conflicts, semantic tags, indexing decisions, semantic relations, and edge adjustments. LLM output is normalized into candidate records only. A conflict candidate must cite at least two distinct exact raw event IDs from the current Dream window; `evidenceEventIds: ["all"]`, missing IDs, or hallucinated IDs are rejected. Invalid or non-JSON provider output is recorded as a rejected, non-fatal diagnostic and does not enter the human confirmation queue; a later successful provider run supersedes that diagnostic. CPU governance still owns status changes such as `candidate`, `needs_confirmation`, `promoted`, `superseded`, and `rejected`. Repeated recall may raise activation weight, but it must not by itself raise truth confidence.

Dream candidates are not active long-term facts by default. They enter the queue with status `candidate` or `shadow`, below the normal automatic-promotion threshold, and can be inspected with:

```bash
cogmem memory dream --project <project> --json
cogmem memory candidates --project <project> --status candidate --json
```

Promotion is a separate CPU-governed step handled by the deep-write promotion policy. Missing evidence, inference-only content, low confidence, assistant/tool-only observations, or unsupported causal links remain `needs_confirmation` or stay candidates. This preserves the rule that dreaming can organize memory but cannot silently turn model guesses or tool output into verified truth.

`needs_confirmation` is an audit queue, not permanent memory. An explicit host-owned maintenance tick marks items older than the default 30-day TTL `superseded` with reason `needs_confirmation_ttl_expired`. The candidate and evidence rows remain available for audit; core never starts a hidden cleanup daemon.

The worker can be run manually or by a host-owned schedule. Core provides schedule helpers for `manual`, `interval`, `daily`, and `continuous` workflows, but it does not start hidden timers or a daemon. Cron, systemd, OpenClaw, Hermes, or another adapter decides when to call `cogmem memory dream`, `cogmem memory tick`, `MemoryKernel.runDreamCurator()`, or `MemoryKernel.runMaintenanceTick()`.

`MemoryKernel.runMaintenanceTick()` is the lightweight Charge/heartbeat equivalent. It decays activation, reports dream backlog pressure, candidate queue pressure, entity alias conflicts, stale vectors, unbound high-value raw events, non-fatal binding failures, and suggested commands. It is explicit and host-owned; it must not be treated as a daemon hidden inside the core.

## Recall Ranking

chronological order is not recall ranking.

Chronological order is for replay and audit. Recall ranking is for selecting useful current context. Agent-facing recall still uses governed universe navigation: query compilation, pulse activation, temporal traversal, graph expansion, inhibition, and evidence budgeting.

Do not use vector topK to reconstruct conversation order. Do not use ledger replay to bypass governed recall. Do not inject an entire thread, day, or transcript into prompt context unless a forensic/audit tool explicitly requests replay.

Cold recall should reactivate evidence in layers: first governed compiled memory and summaries, then bounded raw FTS/metadata search, then optional on-demand reranking of a small raw window. `KernelAgentMemoryBackend.recall()` compiles long user questions into a bounded query plan before raw search, so filler text does not drown out cues such as `CogMem Memory Context`, `记忆`, and `黑盒`. The plan also carries `semanticCuePhrases` and `temporalHints`; for example, a later query about `记忆黑盒` can search raw evidence that originally used `对话存档位置属于黑盒`. If prompt injection is absent or too thin, agents should call `cogmem memory recall --query "<question>" --project <project> --agent <agent> --json` before claiming they do not remember. Forensic follow-ups can pass `anchorEventId` or `anchorText` from the previous recall item to answer "what were my exact words" from the raw ledger instead of guessing from an imported summary. The backend uses raw ledger fallback only after governed universe navigation and BrainRecall fail to produce scoped evidence. Do not restore the old pattern of embedding every raw sentence just to make fuzzy search easier.

Graph Recall v1 runs before the vector/FTS fallback path inside `KernelAgentMemoryBackend.recall()`. It classifies the query into stable binding topics, follows fused clusters and graph edges to raw ledger `eventId` anchors, and returns normal raw-ledger recall items with `sourceContext` and `canAnswerExactQuote=true`. Graph Recall v1.1 uses CPU-owned `BindingClassifier` decisions, project aliases, topic keyword maps, claim keys, and query-overlap reranking; an LLM may suggest candidates in later layers, but it must not directly decide `stablePath`. Correction events create `CORRECTS` / `CONTRADICTS` edges and `reviewFlags` instead of turning a whole active cluster into a conflict. It still obeys agent, project, collection, operational-noise, and `excludeSessionId` filters. A graph recall item means "this raw event belongs to the same organized topic"; it does not mean the cluster summary is a verified user fact.

For pre-answer agent context, prefer `KernelAgentMemoryBackend.recallPack()` when the host can consume structured slots. The pack preserves normal governed recall results while adding:

- `slots.direct`: bounded agent-facing recall items.
- `slots.associative`: graph/activation neighbors related to direct items.
- `slots.entityCards`: resolved entity aliases, attributes, and mention timelines.
- `slots.beliefTouches`: active beliefs with support/conflict history counts.
- `chargeVector`: slot counts and activation signal for host scheduling.

Collection routing is enforced in compiled and raw fallback paths. Default recall includes untagged and `collection:anchor` memory. Specialized collections such as `collection:theseus` must be requested explicitly with `collection: "theseus"` or `--collection theseus`.

`MemoryKernel.buildMemoryMap()` and `cogmem memory map` expose a static self-map: anatomy, data lanes, hard bounds, counters, and commands. The memory binding counters include bindings, topics, entities, clusters, and edges. Imported or adapter-written raw events can be attached with `cogmem memory bind --project <id> --json`; maintenance tick will suggest this command when high-value raw user events are still unbound. Binding, governance, entity-resolution, Belief Graph, Temporal Memory, and Context Cortex receipt tables are governed by core schema version 19. Use `cogmem migrate --dry-run --json` before an upgrade and `cogmem migrate --yes --backup` to apply pending migrations without rewriting Raw Ledger evidence. Agents should use the map to understand how to operate the memory kernel, not as a replacement for governed recall.

Graph edge confidence, stability, and activation are separate. Recall and maintenance may decay activation, but they must not decay provenance confidence or the stability of `SUPPORTS`, `CORRECTS`, `CONTRADICTS`, and `SUPERSEDES` evidence. `BrainGraphView` is a bounded read-only traversal surface; it cannot mutate canonical memory.

## SourceRefs

Semantic memories remain traceable through `sourceRefs`. A source ref may point to:

- a raw ledger event id
- a thread/session/turn position
- a source path
- line or character offsets
- parent/previous event links
- ordering confidence

Imported Markdown records preserve line order and block ordinal when available. OpenClaw/Hermes importers also create raw ledger anchor events for imported records before compiled ingest, so old memory files can be searched and shown through `cogmem memory search/show/recall`. Normalized JSON array, JSONL, CSV, and TSV transcript imports emit per-message source anchors before Markdown ingestion so `sourceRefs` can preserve original array index, row line, or block ordinal instead of only the normalized Markdown line. If a source lacks reliable ordering, adapters should set `orderingConfidence: "low"` rather than inventing certainty.

Agent-facing recall items include `sourceAnchor` and, when available, `sourceContext`. `sourceContext` carries the raw event, bounded before/after events, parent/child links, strict window metadata, per-event labels, optional source/character ranges, and a local `cogmem memory show --event <eventId> --before 2 --after 2` locator. The before/after windows are chronological, exclude the anchor, and are de-duplicated with `overlapHandling: "drop_from_after"`. If `canAnswerExactQuote=false`, the item can still guide the agent to raw evidence, but it must not be quoted as user wording until the raw event is inspected.

## Host Context Hygiene

Host prompt injection is not a core memory tier. The OpenClaw wrapper uses three bounded, Cogmem-owned blocks without rewriting OpenClaw native context:

- `<COGMEM_RECALL_CONTEXT>`: volatile current-turn recall evidence. It is stripped before raw ledger recording and must not be re-ingested.
- `<COGMEM_TURN_BRIDGE>`: compact memory-use receipt for same-topic follow-ups. It is session sidecar state, not recalled evidence and not a dream/governance candidate.
- `<COGMEM_SESSION_STATE>`: short current-session working state. It is useful for continuity but is not a user preference, belief, or durable compiled memory.

Long-term compilation in `selective_compile` is driven by user text only. Assistant conclusions, tool results, task events, bridge text, session state, and recalled memory are evidence or sidecar state, not durable user-owned signals by default.

## External Mechanisms

Compatible mechanisms translated into the kernel model:

- Temporal fact invalidation: represented by current fact and belief validity fields such as `validFrom`, `validTo`, supersession links, status, and evidence refs.
- Memory tier names: used as documentation and API explanation only.
- Provider lifecycle: routed through `KernelAgentMemoryBackend` and narrow adapters, never through host runtime imports.
- Behavior memory: stored as candidate/provisional governed memory with source refs and confidence, not as automatically verified fact.
- Dreaming-style consolidation: implemented as a candidate-only curator that proposes categorized candidates and summaries from raw ledger windows. It may use deterministic rules only, or an explicitly configured OpenAI-compatible memory model, to classify user preferences, project constraints, procedures, failures, diagnostic memories, topic summaries, corrections, semantic tags, indexing decisions, event relations, edge-adjustment proposals, causal tool observations, and temporal supersession/conflict candidates. CPU governance must decide promotion and every candidate must retain source refs.
- Memory map and maintenance tick: exposed as host-facing inspection/upkeep APIs, never as autonomous self-modification. They may suggest dream, governance, entity-resolution, re-embedding, or hotspot inspection commands, but the host decides whether to run them.
- Benchmark ideas: expressed as natural-emergence metrics that test recall and inhibition together.

Rejected designs:

- default vector topK as the primary recall path
- LLM-controlled free memory mutation
- LLM dream output promoted straight to verified fact
- provider context directly injected into prompts
- Markdown projection as source of truth
- unbounded graph traversal
- fixed recent-six-turn context as the memory model
