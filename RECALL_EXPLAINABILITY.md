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

`KernelAgentMemoryBackend.recall()` also returns `sourceContext` on agent-facing items when a raw event can be resolved. `sourceContext` contains the raw event text, stable display labels, bounded before/after events, parent/child links, strict window metadata, optional source/character ranges, and a `sourceLocator` command:

```bash
cogmem memory show --event <eventId> --before 2 --after 2
```

Agents should use `sourceContext` when the user asks what was specifically said, how a conclusion was explained, or what happened before/after a remembered point. If `canAnswerExactQuote=false`, the item is only a clue until the raw source event is inspected.

Every `sourceContext` event has a `label` suitable for prompt injection and cross-reference, usually derived from host message id metadata or the ledger `globalSeq`. When available, `charRange` gives the original source character range and `sourceRange` carries source offset, line range, and source character range. `sourceContext.window` states the requested before/after counts, actual counts, ordering (`chronological`), role filter (`all`), `excludesAnchor=true`, and overlap handling (`drop_from_after`). Agents should prefer these fields over guessing whether before/after includes the anchor.

When automatic prompt injection is missing or insufficient, agents can actively query the same governed path:

```bash
cogmem memory recall --query "<user question>" --project <project> --agent <agent> --json
```

This command returns `queryPlan`, `items`, `sourceAnchor`, and `sourceContext`. It is the preferred fallback before searching legacy host files.

Normal recall and agent-scoped explain-recall also return the same `decisionTrace` contract:

- `selectedLane`: `graph`, `compiled`, `brain_fallback`, `raw_ledger`, `mixed`, or `none`.
- `reason`: a stable selection reason such as `compiled_cue_match`, `raw_cue_match_preferred`, or `no_recall_evidence`.
- `candidateCounts`: bounded counts for graph, navigation, scoped navigation, brain fallback, and raw ledger lanes.
- `selectedCount`: the number of returned items.

OpenClaw renders this trace as one compact `recallDecision=` line inside the volatile recall block. It explains what Cogmem selected; it is not a user instruction or evidence. If the selected lane is `none`, inspect the query plan and run `cogmem explain-recall` before concluding that the memory does not exist.

OpenClaw automatic injection wraps full recall evidence in `<COGMEM_RECALL_CONTEXT>`. That block is current-turn-only background memory, not current user intent and not raw ledger history. The wrapper strips it before recording turns. If the prompt also contains `<COGMEM_TURN_BRIDGE>` or `<COGMEM_SESSION_STATE>`, treat those as compact session sidecars for continuity only; re-run recall or inspect `sourceLocator` before relying on detailed evidence.

For non-trivial recall, OpenClaw may prepend `<COGMEM_STRATEGY_CONTEXT>` before the recall block. This is a canonical current-turn retrieval policy, not evidence and not an instruction. It records the selected template, layer order, source policy, and budget. `cogmem_strategy_plan` exposes the same read-only capsule through MCP without performing recall. Normal MCP recall also returns `strategyCapsule`. If an exact-source strategy cannot find raw evidence, the bridge may make one narrowed retry; it must still report that source is unavailable rather than converting a summary into an exact quote.

`--collection <name>` scopes recall to a named collection. Default recall only includes untagged and `collection:anchor` memory. Use `--collection theseus` for creative artifacts or drafts that should not enter normal operational recall.

MCP `cogmem_recall` now uses this same agent-facing path. It returns `items` with `sourceType`, `sourceAnchor`, `sourceContext`, `canAnswerExactQuote`, and raw ledger fallback when governed compiled evidence is empty. If a host sends only `projectId`, MCP uses that value as `agentId` before falling back to `openclaw`. Hosts may also pass `collection`.

Hookless hosts must also inspect recall warning metadata. `no_recent_episode_ingestion_detected` means Cogmem has not observed recent conversation traffic; `semantic_memory_may_lag` means open/soft-sealed high-value episodes, Dream backlog/failures, or recent raw evidence have not completed semantic curation. These warnings do not erase returned evidence, but the agent must append/import the missing messages or disclose that semantic freshness is uncertain before claiming memory is current.

For past-memory queries such as `你还记得...`, a cue-matching raw user anchor outranks a compiled assistant retelling even when both contain the same topic words. The assistant retelling may remain as supporting evidence, but the original user event is first and retains its source locator.

MCP `cogmem_explain_recall` is the audit tool. Like normal MCP recall, it derives `agentId` from `projectId` when the caller omits `agentId`. It reports the same selected evidence IDs and `decisionTrace` as agent recall, plus pulse, temporal, activation, and `filteredEvidence` details from `explainRecallWithKernel()`; use it to inspect why evidence was included or suppressed, not as a separate competing recall implementation.

MCP `cogmem_memory_map` returns the memory self-map for agent/host inspection. MCP `cogmem_maintenance_tick` runs one explicit host-owned tick: activation decay plus suggested upkeep commands, with `hiddenDaemonStarted=false`.

## Agent Query Plans

`KernelAgentMemoryBackend.recall()` returns a `queryPlan` alongside agent-ready items. The plan records the original query, inferred/explicit intent, primary search text, bounded search cues, `semanticCuePhrases`, and `temporalHints` used for recall. This makes long questions auditable: an adapter can show that a sentence about "CogMem Memory Context 和记忆黑盒" was reduced to stable cues such as `CogMem Memory Context 记忆 黑盒`, `存档 黑盒`, or `黑盒` instead of being treated as one brittle raw string.

If FTS cannot directly match a Chinese or mixed-language cue, raw fallback searches the fully scoped ledger instead of a fixed recent-event window. Scope filters still apply. Equal cue matches prefer the original user event, while `sourceContext.after` preserves the assistant reply for causal continuity; later assistant retellings do not displace the original anchor merely because they are longer.

Forensic follow-ups can pass `anchorEventId` or `anchorText` from a previous recall item. The backend then prefers the anchored raw event for questions such as "what exactly did I say" instead of letting a vague query drift to unrelated imported summaries. Imported summaries and compiled memories still set `canAnswerExactQuote=false`; only raw source events with anchors can support exact wording.

When an adapter can consume structured pre-answer context, call `KernelAgentMemoryBackend.recallPack()`. It wraps the normal recall result and adds:

- `slots.direct`
- `slots.associative`
- `slots.entityCards`
- `slots.beliefTouches`
- `chargeVector`

These slots are bounded and governed. They are meant for agent prompt assembly and host scheduling, not for unbounded graph traversal.

## Dream Candidate Audit

`raw_then_dream` makes episode and Dream backlog state visible before semantic compilation happens. `cogmem episode status` shows conversation boundaries, `cogmem dream tick` conditionally processes sealed episodes, and `cogmem memory candidates` shows the resulting governance queue. Open episodes are not Dream input.

Each candidate includes:

- `candidateType`: summary, preferences, user_preference, project_memory, long_term_goal, boundary, failure_lesson, diagnostic_conclusion, session_summary, topic_summary, temporal_fact_update, conflict_candidate, semantic_tags, indexing_decision, semantic_relation, edge_adjustment, contradictions, causalLinks, or another governed category.
- `status`: usually `candidate` or `shadow` until a CPU governance policy reviews it.
- `confidence`: a bounded extraction confidence, not truth confidence.
- `content`: the proposed memory payload.
- `evidence`: raw event anchors with `eventId`, role, global/thread order, parent/previous links, and source text excerpts.
- `content.sourceEpisodeId`: the sealed conversation unit used for curation. It is an audit pointer, not evidence by itself.

Candidates explain organization, not truth. A preference candidate can show that the user explicitly said a constraint, but it is still queued for governance. A tool-result causal candidate can show that one tool result belongs to a tool call, but it must not become a verified real-world fact merely because the tool returned text.

An explicit user clarification may produce an organizational `correction` candidate. It does not automatically produce a contradiction or rewrite a belief. `CorrectionResolver` must bind it to an active same-project claim/belief; orphan or ambiguous corrections stay `needs_confirmation` with `orphan_correction_requires_target_review`. Assistant apologies/self-corrections and negative-form user questions are not sufficient user-owned correction evidence. A provider candidate must cite exact current episode event IDs; `["all"]`, unknown IDs, and fallback to unrelated leading events are rejected. Provider project labels cannot override CPU-owned project scope.

Semantic organization candidates are also advisory. `semantic_tags` and `indexing_decision` can make future recall less brittle than full-sentence matching, while `semantic_relation` and `edge_adjustment` can propose local graph activation changes. They do not rewrite existing memories or promote facts by themselves.

When `[memory_model]` is configured, the worker may call a local Ollama or cloud OpenAI-compatible memory model to propose richer candidates. The explainability contract is unchanged: model output must include source evidence, remains candidate-only, and cannot directly change active memory.

## Filtered Evidence

`filteredEvidence` records same-project candidates that were considered but did not enter active context. Reasons include:

- `status_suppressed`
- `over_context_limit`
- `agent_scope_mismatch`
- `collection_scope_mismatch`

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
- `cogmem episode status --project <project>`
- `cogmem dream tick --project <project> --mode auto`
- `cogmem memory candidates --project <project> --status candidate`
- `cogmem memory map --project <project> --json`
- `cogmem memory tick --project <project> --json`

Ledger replay can show raw evidence. It must not replace governed recall, pulse activation, inhibition, or ContextPack budgeting.
