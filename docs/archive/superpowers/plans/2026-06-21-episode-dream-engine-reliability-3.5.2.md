# Cogmem 3.5.2 Episode Dream Reliability Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`. Use TDD for every behavior change. Do not delegate shared-worktree edits.

**Goal:** Eliminate silent Episode/Dream drift and add a project-isolated, user-shaped topic ontology whose mutations are auditable, reversible, and repairable.

**Architecture:** Keep Raw Ledger as immutable evidence and `EpisodeAssembler` as the single write-routing boundary. Add migration-backed topic nodes, aliases, relations, operations, audit records, and cross-references; expose them through small registry/governance services. Hybrid classification and Dream may propose structure, but only validated user operations or governance activation may mutate active ontology or durable beliefs.

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, migration runner, Bun test.

---

## Confidence contract

“100% confidence” is not treated as a subjective statement. Release confidence is earned only when every report item has one of these dispositions:

1. `implemented`: code path plus a regression test that was observed failing before the fix.
2. `already_satisfied`: current code and an existing test prove the behavior.
3. `intentionally_bounded`: the public contract explicitly limits the behavior, documentation explains the boundary, and a test proves fail-closed behavior.

The release is blocked if any item is `unmapped`, any migration parity check fails, any new public API lacks tests/docs, or the final full test/build/pack commands fail. This produces factual coverage of known risks; it does not claim that unknown bugs are mathematically impossible.

## Non-negotiable invariants

- Raw events remain immutable evidence. Summaries, topic names, provider output, and diagnostics are never evidence substitutes.
- `projectId`, `sourceAgent`, `sessionId`, and thread boundaries are CPU-owned and cannot be overwritten by provider output.
- Every primary raw event has at most one episode owner. Cross-episode relevance uses `episode_cross_refs` only.
- User-explicit topic operations outrank model candidates. Model proposals start as `candidate` or `needs_review`.
- Topic merge/move/split operations are transactional, append an audit record, preserve before/after state, and can be reversed.
- Foreground OpenClaw ingestion stays CPU-only. Background import/repair paths may await hybrid review.
- Empty episodes cannot become normal sealed Dream inputs.
- Repair invalidates derived state before requeueing Dream.

## File map

Create:

- `src/ontology/MemoryOntology.ts`: stable ontology class allow-list.
- `src/topic/TopicTypes.ts`: nodes, relations, operations, audit types.
- `src/topic/TopicPathRegistry.ts`: project-scoped topic CRUD/query and candidate activation.
- `src/topic/TopicAliasRegistry.ts`: normalized alias resolution with collision reporting.
- `src/topic/TopicRelationGraph.ts`: evidence-backed relation edges.
- `src/topic/TopicGovernance.ts`: validated, transactional user/model/repair operations and rollback.
- `src/episode/CogmemBlockStripper.ts`: shared bounded control-block parser.
- `src/episode/CorrectionResolver.ts`: active-belief target lookup and orphan disposition.
- `src/migrations/0024_episode_ontology_reliability.ts`: topic, audit, cross-ref, ingest state, Dream failure columns.
- `__tests__/episode-ontology-reliability.unit.test.ts`: registry/governance/classifier/assembler regressions.
- `__tests__/episode-repair-import-reliability.unit.test.ts`: repair, import, scheduler, migration regressions.

Modify:

- `src/episode/TurnRelationClassifier.ts`: safe fallback, context-aware short answers, reviewer allow-list.
- `src/episode/EpisodeAssembler.ts`: async background path, current assistant context, topic signals, reopen/closure rules.
- `src/episode/EpisodeStore.ts`: migration-only production schema, audit/cross-ref/repair/ingest state APIs.
- `src/engine/DreamCuratorWorker.ts`: exact evidence, CPU project ownership, decision/correction/diagnostic safety.
- `src/dream/DreamScheduler.ts`: per-job effective modes and failure details.
- `src/factory.ts`: single ingress, repair surgery, ingest commit/failure lifecycle.
- `src/mcp/CoreMcpTools.ts`: import checkpoints, warnings, topic/repair/status APIs.
- `src/bin/episode.ts`: resumable bounded import and repair surgery commands.
- `src/benchmark/BrainEval.ts`: episode/topic/evidence/repair gates.
- public/internal exports, migration index, README/model/release/plugin/skill documentation.

## Task 1: Freeze the report into executable regression gates

- [x] Add tests for report items 1-11 and run:
  `bun test __tests__/episode-ontology-reliability.unit.test.ts`
  Expected: failures proving hybrid routing, reviewer override, fallback, short-answer, reopen, closure, reseal, and empty-seal gaps.
- [x] Add tests for report items 12-18 and run the same test file.
  Expected: failures proving provider evidence/project ownership, assistant-only decision, proposal search, correction binding, summary evidence, and scheduler diagnostics gaps.
- [x] Add tests for report items 19-41 in `episode-repair-import-reliability.unit.test.ts`.
  Expected: failures proving import checkpoint, identity warning, ingest state, repair, migration, cross-reference, status, block hygiene, and relation-boundary gaps.

## Task 2: Add the user-shaped ontology data plane

- [x] Add migration 0024 with project-scoped tables and constraints:

```sql
topic_nodes(topic_id PRIMARY KEY, project_id, topic_path, canonical_name,
  parent_topic_id, ontology_class, status, created_by, confidence,
  evidence_event_ids_json, evidence_episode_ids_json, last_used_at,
  merge_candidates_json, created_at, updated_at,
  UNIQUE(project_id, topic_path));
topic_aliases(alias_id PRIMARY KEY, project_id, normalized_alias, alias,
  topic_id, status, created_by, confidence, evidence_event_ids_json,
  created_at, updated_at, UNIQUE(project_id, normalized_alias, topic_id));
topic_relations(relation_id PRIMARY KEY, project_id, source_topic_id,
  relation, target_topic_id, status, created_by, confidence,
  evidence_event_ids_json, evidence_episode_ids_json, created_at, updated_at);
topic_operations(operation_id PRIMARY KEY, project_id, operation_type,
  actor, target_topic_id, payload_json, before_json, after_json,
  inverse_operation_json, status, evidence_event_ids_json, created_at, reverted_at);
episode_cross_refs(cross_ref_id PRIMARY KEY, project_id, episode_id,
  referenced_episode_id, event_id, relation, created_by, confidence, created_at);
```

- [x] Implement stable ontology class and topic operation allow-lists. Reject unknown values and cross-project IDs.
- [x] Implement alias normalization without domain regexes. Alias collisions return `needs_review`; they never silently merge.
- [x] Implement create/rename/alias/move/merge/split/reassign/relation add/remove and rollback in one DB transaction per operation.
- [x] Run registry/governance tests until green; then run migration parity tests against a migrated empty database.

## Task 3: Make episode classification context-aware and fail-safe

- [x] Replace fixed domain regex routing with conversation-control markers plus supplied topic/entity/project similarity signals.
- [x] Default unmatched user turns to `ambiguous_shift` with `needsLlmReview=true`; continue only on explicit continuation or confirmed topic/entity/project overlap.
- [x] Distinguish proposal acceptance/rejection from factual answers and corrections.
- [x] Validate reviewer overrides for `relation`, `confidence`, `candidateTypes`, `closureCandidate`, `topicPath`, `episodeType`, `importance`, `switchKind`, `importanceSignals`, and bounded `rationale`.
- [x] Add `appendTurnAsync`/`appendEventAsync` using `classifyTurnRelationHybrid`. Keep synchronous foreground methods CPU-only.
- [x] Pass the current turn's assistant text and topic registry context. Background import and repair call async paths.
- [x] Run targeted classifier/assembler tests to green.

## Task 4: Close episode sealing, hygiene, and scope holes

- [x] Reopen soft seals only for continuation, clarification, correction, return, or confirmed overlap. Explicitly reject hard/ambiguous/new/switch/noise relations.
- [x] Set `reasonCode: explicit_user_closure` on explicit closure.
- [x] Return an existing receipt only for ordinary idempotent calls. `manual`, `repair`, `force`, or `recompute` writes a new audit receipt.
- [x] Reject hard/batch/manual sealing of empty episodes; soft empty seal is review-only and never queues Dream.
- [x] Add `CogmemBlockStripper` with case-insensitive, nested, unclosed, and bounded malformed-block handling. Reuse it in assembler and Dream.
- [x] Restrict event text to `text`, `content`, `output`, `title`, or `summary`; never stringify an entire payload.
- [x] Before claiming legacy scope, verify linked raw events match source/session/thread. Otherwise create a linked new episode.
- [x] Run closure, hygiene, and scope tests to green.

## Task 5: Fail closed in Dream curation and correction handling

- [x] In episode mode, reject missing, `all`, partially invalid, or cross-project evidence IDs. Legacy summary mode may explicitly opt into `all`.
- [x] Always set candidate project from scheduler options/raw events. Record a warning when provider output disagrees.
- [x] Assistant-only decision episodes produce `needs_confirmation` and cannot enter the normal temporal promotion path.
- [x] Find the nearest valid assistant proposal within the same episode/session/thread and stop across an intervening user rejection/correction.
- [x] Resolve correction targets by project, claim key, topic, entity, and bounded semantic query. Orphans remain `needs_review`.
- [x] Mark mixed session summaries `session_hint_only`, `not_user_owned`, and `not_durable_belief`.
- [x] Provider diagnostics reference a system diagnostic source, not user raw evidence.
- [x] Require same session, same thread when present, adequate ordering confidence, and no topic-switch barrier for deterministic event relations.
- [x] Keep rule summaries as fallback. Optional LLM semantic summaries are `hint_only_not_evidence` and raw IDs remain mandatory.
- [x] Run Dream evidence/correction tests to green.

## Task 6: Make Dream scheduling diagnosable per episode

- [x] Compute `effectiveMode` per job. Explicit modes override all jobs; `auto` uses each `modeHint`.
- [x] Return `selectedModes` counts and `failedEpisodes[{episodeId,error,failureCategory,retryAfter}]`.
- [x] Persist failed episode IDs and failure details on Dream runs.
- [x] Recommend/enqueue deep mode for large backlog, old backlog, configured daily maintenance, manual deep request, or upgrade repair.
- [x] Derive `dreamRecommended` from latest closure receipt, review state, and episode Dream state.
- [x] Return `recommendedActions[]`; semantic lag includes open high-value, maturing soft seals, pending/retry/processing, failures, and undreamed recent raw data.
- [x] Run scheduler/status tests to green.

## Task 7: Make all ingress resumable and assembler-owned

- [x] Route `remember_turn`, episode append/import, source imports, and OpenClaw writes through the assembler after raw persistence.
- [x] Add ingest-key states `reserved|committed|failed`, timestamps/error, and state transitions around raw writes.
- [x] Validate `payload.metadata.sourceAgent === input.sourceAgent` during idempotent identity checks.
- [x] MCP import validates the whole batch before writes, returns per-message results, and on runtime failure returns processed count/index/message plus safe resume information.
- [x] Missing MCP `externalMessageId` emits `auto_identity_not_safe_across_split_batches`; never claim cross-request idempotence.
- [x] CLI import supports `--start-line`, `--end-line`, `--max-lines`, `--skip-errors`, and `--max-errors`; failure checkpoints contain failed line, error, resume line, and last processed line.
- [x] Recall returns `no_recent_episode_ingestion_detected`, `semantic_memory_may_lag`, and a suggested append/import tool when hookless ingestion is stale.
- [x] Run MCP/CLI/import tests to green.

## Task 8: Add repair surgery and schema parity

- [x] Implement split, merge, move-event, reclassify, requeue-dream, invalidate-dream-run, and stale-candidate marking.
- [x] Each repair validates project ownership, snapshots before state, mutates transactionally, recomputes receipts, invalidates old derived state, requeues Dream, and writes an audit operation.
- [x] Repair discovers source agent from `event.payload.metadata.sourceAgent`, never `sourceId`.
- [x] Preserve unique primary ownership and use `episode_cross_refs` for secondary relevance.
- [x] Production construction relies on migrations. Direct schema bootstrap is test-only and is checked byte-for-byte by a schema parity test.
- [x] Run repair and parity tests to green.

## Task 9: Teach agents and operators the new contracts

- [x] Add BrainEval gates for topic mutation isolation, audit/rollback, invalid evidence rejection, repair invalidation, import resume, and hookless lag warnings.
- [x] Update `README.md`, `MEMORY_MODEL.md`, `RECALL_EXPLAINABILITY.md`, `RELEASE_CHECKLIST.md`, and `CHANGELOG.md` for 3.5.2.
- [x] Update OpenClaw and Hermes `README.md`, `AGENTS.md`, and `SKILL.md` with foreground/background classification, external identity, topic operations, repair flow, and recall warnings.
- [x] Export only the supported ontology/topic APIs from public entrypoints; keep repair internals under `internal` where appropriate.

## Task 10: Release verification and GitHub handoff

- [x] Run targeted tests after each red-green cycle.
- [x] Run `bun test __tests__` and require zero failures.
- [x] Run `bun run typecheck` and `bun run build`.
- [x] Run `npm pack --dry-run` only after build/tests complete; verify new migrations, exports, examples, and declarations are included.
- [x] Review `git diff --check`, migration order, generated `dist`, and report-to-test traceability.
- [x] Commit in logical units, push `codex/episode-dream-engine-reliability-3.5.2`, and verify local HEAD equals remote HEAD.

## Report traceability

| Report items | Plan task | Proof gate |
|---|---:|---|
| 1-4 | 3 | hybrid/override/context/fallback tests |
| 5-6 | 3 | short-answer context tests |
| 7-11 | 3-4 | switch/reopen/closure/reseal/empty tests |
| 12-17 | 5 | exact evidence, ownership, decision, proposal, correction, summary tests |
| 18-20 | 6 | failure detail and per-job/deep mode tests |
| 21-28 | 7 | MCP/CLI/identity/ingest/recall/single-ingress tests |
| 29-30 | 8 | repair surgery/source-agent tests |
| 31-33 | 8 | schema parity/legacy claim/cross-ref tests |
| 34-37 | 6 | actions/lag/recommendation/run diagnostics tests |
| 38-42 | 4-5 | block parser/payload/diagnostic/summary/relation tests |
| New ontology/topic operations | 2 | isolation/audit/rollback/collision tests |
| Agent usability/docs/evals | 9 | docs assertions and BrainEval gates |

## Explicitly not in scope

- A general-purpose wiki, knowledge-base UI, or multi-user collaboration layer.
- Automatic activation of model-proposed topics without governance.
- Replacing the existing neuron topic namespace or immutable Raw Ledger.
- A hidden daemon. Deep Dream remains explicit host-owned maintenance.
- Domain-specific topic regex expansion.

## Final confidence audit and bounded decisions

All 42 report items and the ontology extension are mapped above and covered by
targeted regression tests, existing invariant tests, or an explicit fail-closed
contract. The following choices are intentionally bounded rather than silently
overclaimed:

- MCP callers without `externalMessageId` receive
  `auto_identity_not_safe_across_split_batches`; 3.5.2 does not claim durable
  cross-request idempotence for generated identities.
- Semantic summaries remain hints. A provider may propose a high-value episode
  summary, but it cannot replace raw event evidence or promote a durable belief
  without valid raw evidence IDs.
- `recommendedActions` is canonical. The legacy scalar `recommendedAction` is
  retained as the first action for compatibility during the 3.5.x line.
- Independent `codex review --uncommitted` was attempted twice but was blocked
  by the external Codex account usage limit. This is recorded as an unavailable
  secondary signal, not represented as a passing review.

Final observed release evidence:

- `bun test __tests__`: 1159 pass, 0 fail, 3802 assertions, 129 files.
- `bun run typecheck`: exit 0.
- `bun run build`: exit 0; tracked `dist/` regenerated.
- `npm_config_cache=/tmp/cogmem-npm-cache npm pack --dry-run --json`: exit 0,
  `cogmem@3.5.2`, 758 package entries.
- `git diff --check`: exit 0.

This establishes factual 100% coverage of the known report scope. It does not
claim that unknown future defects are mathematically impossible.
