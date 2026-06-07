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

## Agent Query Plans

`KernelAgentMemoryBackend.recall()` returns a `queryPlan` alongside agent-ready items. The plan records the original query, inferred/explicit intent, primary search text, and bounded search cues used for recall. This makes long questions auditable: an adapter can show that a sentence about "CogMem Memory Context 和记忆黑盒" was reduced to stable cues such as `CogMem Memory Context 记忆 黑盒` instead of being treated as one brittle raw string.

Forensic follow-ups can pass `anchorEventId` or `anchorText` from a previous recall item. The backend then prefers the anchored raw event for questions such as "what exactly did I say" instead of letting a vague query drift to unrelated imported summaries. Imported summaries and compiled memories still set `canAnswerExactQuote=false`; only raw source events with anchors can support exact wording.

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
- `cogmem memory show --event <eventId> --before 2 --after 2`

Ledger replay can show raw evidence. It must not replace governed recall, pulse activation, inhibition, or ContextPack budgeting.
