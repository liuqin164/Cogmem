# Recall Explainability

Agent-facing recall is governed by default. `KernelAgentMemoryBackend.recall()` and `MemoryKernel.navigateMemory()` return active evidence only after scope, status, trust, and budget filtering.

## Included Evidence

`explainRecallWithKernel()` reports why evidence entered the recall result:

- `activationPath`: the recall path, such as pulse, temporal traversal, or fallback.
- `whyMatched`: agent scope, provenance, pulse fusion, temporal branch, and governance reasons.
- `sourceAnchor`: the drill-down anchor for the semantic memory source event.

`sourceAnchor` contains:

- `eventId`: the memory event that recorded the semantic ingest.
- `sourceEventType`: usually `INGESTED`.
- `sourceRefs`: raw event, source path, thread, line, turn, and ordinal anchors when available.
- `context`: surrounding ledger context for the source event.

For agent lifecycle events, source refs may point to `message`, `tool_call`, `tool_result`, or `task_event` raw ledger entries. For normalized JSON/CSV imports, source refs preserve original source offset and row/line anchors when available, even though ingestion flows through Markdown projection.

`KernelAgentMemoryBackend.recall()` also returns `sourceContext` on agent-facing items when a raw event can be resolved. `sourceContext` contains the raw event text, bounded before/after events, parent/child links, and a `sourceLocator` command:

```bash
cogmem memory show --event <eventId> --before 2 --after 2
```

Agents should use `sourceContext` when the user asks what was specifically said, how a conclusion was explained, or what happened before/after a remembered point. If `canAnswerExactQuote=false`, the item is only a clue until the raw source event is inspected.

When automatic prompt injection is missing or insufficient, agents can actively query the same governed path:

```bash
cogmem memory recall --query "<user question>" --project <project> --agent <agent> --json
```

This command returns `queryPlan`, `items`, `sourceAnchor`, and `sourceContext`. It is the preferred fallback before searching legacy host files.

MCP `cogmem_recall` now uses this same agent-facing path. It returns `items` with `sourceType`, `sourceAnchor`, `sourceContext`, `canAnswerExactQuote`, and raw ledger fallback when governed compiled evidence is empty. If a host sends only `projectId`, MCP uses that value as `agentId` before falling back to `openclaw`.

MCP `cogmem_explain_recall` is the audit tool. It reports pulse, temporal, activation, and `filteredEvidence` details from `explainRecallWithKernel()`; use it to inspect why evidence was included or suppressed, not as the raw-ledger recovery path for normal agent answers.

## Agent Query Plans

`KernelAgentMemoryBackend.recall()` returns a `queryPlan` alongside agent-ready items. The plan records the original query, inferred/explicit intent, primary search text, bounded search cues, `semanticCuePhrases`, and `temporalHints` used for recall. This makes long questions auditable: an adapter can show that a sentence about "CogMem Memory Context 和记忆黑盒" was reduced to stable cues such as `CogMem Memory Context 记忆 黑盒`, `存档 黑盒`, or `黑盒` instead of being treated as one brittle raw string.

Forensic follow-ups can pass `anchorEventId` or `anchorText` from a previous recall item. The backend then prefers the anchored raw event for questions such as "what exactly did I say" instead of letting a vague query drift to unrelated imported summaries. Imported summaries and compiled memories still set `canAnswerExactQuote=false`; only raw source events with anchors can support exact wording.

## Dream Candidate Audit

`raw_then_dream` makes dream backlog visible before semantic compilation happens. `cogmem memory dream` runs the Memory Curator / Dream Worker over undreamed raw events and `cogmem memory candidates` shows the resulting governance queue.

Each candidate includes:

- `candidateType`: summary, preferences, user_preference, project_memory, long_term_goal, boundary, failure_lesson, diagnostic_conclusion, session_summary, topic_summary, temporal_fact_update, conflict_candidate, semantic_tags, indexing_decision, semantic_relation, edge_adjustment, contradictions, causalLinks, or another governed category.
- `status`: usually `candidate` or `shadow` until a CPU governance policy reviews it.
- `confidence`: a bounded extraction confidence, not truth confidence.
- `content`: the proposed memory payload.
- `evidence`: raw event anchors with `eventId`, role, global/thread order, parent/previous links, and source text excerpts.

Candidates explain organization, not truth. A preference candidate can show that the user explicitly said a constraint, but it is still queued for governance. A tool-result causal candidate can show that one tool result belongs to a tool call, but it must not become a verified real-world fact merely because the tool returned text.

Semantic organization candidates are also advisory. `semantic_tags` and `indexing_decision` can make future recall less brittle than full-sentence matching, while `semantic_relation` and `edge_adjustment` can propose local graph activation changes. They do not rewrite existing memories or promote facts by themselves.

When `[memory_model]` is configured, the worker may call a local Ollama or cloud OpenAI-compatible memory model to propose richer candidates. The explainability contract is unchanged: model output must include source evidence, remains candidate-only, and cannot directly change active memory.

## Filtered Evidence

`filteredEvidence` records same-project candidates that were considered but did not enter active context. Reasons include:

- `status_suppressed`
- `over_context_limit`
- `agent_scope_mismatch`

When available, filtered evidence also carries `sourceAnchor` so forensic tools can explain where a suppressed candidate came from. Scoped explain results must stay same-project; cross-project filtered evidence must not be exposed.

## Ledger Vs Recall

Use chronological ledger APIs when the question is about original order:

- `getThreadEvents(threadId)`
- `getEventContext(eventId, { before, after })`

Use governed recall when the agent needs current task context:

- `KernelAgentMemoryBackend.recall()`
- `MemoryKernel.navigateMemory()`
- `explainRecallWithKernel()`

Use the local audit CLI when the user needs to inspect memory directly:

- `cogmem memory status`
- `cogmem memory list`
- `cogmem memory search --query <text>`
- `cogmem memory recall --query <text> --agent <agent>`
- `cogmem memory show --event <eventId> --before 2 --after 2`
- `cogmem memory dream --project <project>`
- `cogmem memory candidates --project <project> --status candidate`

Ledger replay can show raw evidence. It must not replace governed recall, pulse activation, inhibition, or ContextPack budgeting.
