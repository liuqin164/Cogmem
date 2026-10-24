# Cogmem 3.5.1 Episode Dream Engine Hardening

## Decision

Cogmem 3.5.1 is a hardening release for the existing Episode Dream Engine. It keeps the 3.5.0 architecture unchanged:

```text
Raw Ledger -> Episode Assembler -> sealed episode -> Dream Scheduler
           -> episode-grounded candidates -> CPU Governance
```

The release fixes incorrect relation semantics, aggressive episode boundaries, uncontrolled Dream retries, unstable import identities, weak episode audit state, and unsafe MCP maintenance ergonomics. It does not add a new memory layer.

## Review Of The Proposed Fix List

The report correctly identifies the main 3.5.0 risks, but three suggestions need narrower implementation:

1. A hybrid classifier must not call an LLM in OpenClaw `agent_end` or MCP append. The foreground path stays CPU-only. Low-confidence and high-value decisions carry an advisory-review flag that the background Dream path may use.
2. A low-confidence batch is represented by the existing `soft_sealed` lifecycle plus an explicit review flag. Adding a fourth episode lifecycle state would duplicate the seal model.
3. Full split/merge/move repair, project-fair concurrent scheduling, and cross-episode rewriting require new transaction and governance protocols. They are deferred instead of being presented as patch-level safety.

## Classification Contract

The classifier receives current and previous user/assistant text, active episode metadata, and recent relations. Its deterministic result includes relation, confidence, signals, candidate types, closure candidate, switch kind, episode type, importance, and `needsLlmReview`.

New assistant-side relations are explicit:

- `assistant_response`
- `assistant_proposal`
- `assistant_summary`
- `assistant_question`
- `assistant_clarification`
- `tool_result_context`

Topic movement is split into:

- `hard_topic_switch`: high-confidence cross-domain change, hard-seal.
- `subtopic_shift`: same project or domain, stay in the episode.
- `ambiguous_shift`: soft-seal and create a soft-linked episode.

LLM output is advisory only. It cannot write episode rows, candidates, beliefs, entities, temporal state, prospective memory, or governance decisions.

## Episode Audit Model

An episode keeps its lifecycle and Dream lifecycle separately:

- `status`: `open | soft_sealed | sealed`
- `dreamStatus`: `none | queued | processing | processed | failed`

It also records multiple candidate tags, explainable importance signals, a normalized closure reason, an optional linked episode, and an `EpisodeSemanticSummary` generated from raw events at seal time.

The semantic summary is a navigation hint only. Every Dream candidate must have a non-empty evidence set that is a subset of the episode's raw event IDs. Summary fields and nearby audit-only events can never satisfy evidence validation.

## Dream Mode And Retry Contract

Dream mode changes curator behavior, not only batch size:

- `micro`: one episode, at most 20 candidates, no unrelated backlog context.
- `normal`: a small batch, at most 100 candidates per episode, light duplicate/conflict hints.
- `deep`: bounded larger per-episode consistency work over all supplied raw events, at most 500 candidates per episode. It does not scan unrelated episodes in this patch release.

Failures are classified as retryable or terminal. Retryable failures receive exponential `retryAfter`; they are not reclaimed before that time. Terminal validation/evidence failures never auto-retry. Manual retry preserves attempt history.

## Import And MCP Contract

Generated import identity uses source agent, source session, role, timestamp, and normalized text hash. Line position is not part of the normal identity. Identical timestamp/text duplicates use a deterministic occurrence suffix.

CLI JSONL import is streamed and checkpointed. MCP remains bounded to 200 messages and 16,000 characters per message. Batch sealing uses confidence and topic stability; uncertain batches soft-seal for review unless explicitly forced.

`cogmem_dream_tick` requires `maintenanceMode: true` to mutate. Without it, the tool returns a recommendation-only dry run. `episode_status` explains whether recent raw evidence exists, semantic memory may lag, and which maintenance action is appropriate.

## Governance Invariants

1. Raw events remain authoritative and are written before interpretation.
2. Foreground ingestion never waits for LLM classification or Dream.
3. Episode summaries, strategy state, activation receipts, and other `COGMEM_*` blocks are not evidence.
4. Candidate evidence must be a non-empty subset of the source episode raw event IDs.
5. Assistant proposals need a later, distinct user acceptance before they can support user-owned memory.
6. Orphan corrections remain review-only; they cannot become active beliefs without a target.
7. Prospective candidates continue through `ProspectiveMemoryService`; Episode Dream cannot create a second durable path.
8. Repair and reprocessing never delete promoted memory. Corrections and supersession still go through governance.

## Deferred Work

The following work is intentionally outside 3.5.1:

- arbitrary split/merge/move of already-governed episodes;
- concurrent Dream workers;
- global round-robin fairness across projects;
- cross-episode deep consistency scans;
- automatic LLM relation rewriting in the live hook path;
- direct temporal, belief, or prospective promotion from Episode Dream.

These require a separate design with cross-store transactions and promoted-memory invalidation rules.

## Confidence Gate

There is no honest mathematical 100% confidence claim for a persistence and LLM-boundary change. Practical release confidence requires all focused regressions, the complete test suite, typecheck, build, package dry run, migration smoke, and adversarial review to pass with no unresolved P0/P1 findings. After those gates, there is no known structural blocker in the scoped 3.5.1 design.
