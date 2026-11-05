# Cogmem 3.4.0 Strategy Cortex v1 Design

## Decision

Cogmem should borrow StraTA's trajectory-level abstraction, but not its online RL training loop.
The reusable idea is to separate memory-policy selection from local recall execution. The 3.4.0
runtime therefore creates a deterministic, bounded strategy capsule before recall and uses that
capsule to constrain retrieval lanes, context-layer ordering, source requirements, and budget.

StraTA's hierarchical rollout, diverse strategy selection, and critical self-judgment belong in
offline BrainEval. They must not multiply latency or model calls in normal user turns.

## Evidence And Limits

The paper demonstrates that a compact strategy fixed across a long-horizon episode can improve
coherence and credit assignment. Its experiments are training-based agent benchmarks, not memory
retrieval benchmarks. The paper also states that a fixed strategy can become restrictive when the
environment changes. Cogmem therefore uses a stable-within-turn capsule with explicit deterministic
replan triggers instead of an immutable cross-turn plan.

## Runtime Flow

```text
current user query
  -> ContextIntent classifier
  -> StrategyCortex (CPU template selection)
  -> StrategyCapsule (no instruction authority, current-turn only)
  -> retrieval policy (allowed/preferred lanes and source requirement)
  -> KernelAgentMemoryBackend recall
  -> StrategyConditionedCandidateBuilder
  -> ContextCortex hard safety filters and budget
  -> COGMEM_STRATEGY_CONTEXT + COGMEM_RECALL_CONTEXT
  -> host reasoning model
  -> optional MemoryUseJudge outcome receipt
```

## Strategy Templates

- `no-memory`: greeting fast path.
- `continuity-only`: same-topic short follow-up; session state and turn bridge only.
- `source-first`: exact quote; raw source is required and summary-only output is insufficient.
- `temporal-first`: decision history and change-over-time questions.
- `user-belief-first`: user preference/boundary lookup; explicit user evidence required.
- `project-state`: current project state; current belief and temporal evidence before raw detail.
- `graph-source`: debugging/root-cause queries; graph anchors and raw evidence first.
- `balanced-memory`: general memory lookup with normal governed fallback.

The registry is canonical and CPU-owned. A model may propose a template identifier in a future
version, but it cannot create arbitrary layer names, suppression rules, or stable policies.

## Trust And Lifecycle Boundaries

- A strategy capsule is not a user instruction, system instruction, fact, belief, or evidence.
- User intent and host policy always outrank the capsule.
- The capsule cannot authorize tools, tasks, prospective actions, or durable writes.
- `COGMEM_STRATEGY_CONTEXT` is current-turn-only and is stripped before raw-ledger recording.
- Dream, binding, belief, and prospective pipelines reject all Cogmem context-control blocks as
  user-owned evidence.
- MemoryUseJudge and policy scoring write outcome telemetry only. Governance remains the sole path
  for changing durable memory.

## Replanning

The capsule is fixed while its assumptions remain true. A new capsule is required when any of these
conditions occurs:

- the classified intent changes;
- the project boundary changes;
- an exact-source requirement is unmet;
- selected evidence contains a conflict that changes the required lane;
- the context budget cannot satisfy a required layer.

Replanning is deterministic and capped at one retry per turn. Failure degrades to the existing safe
recall path and never blocks the host agent.

## Offline Evaluation

BrainEval accepts precomputed strategy rollouts. It never performs online model fan-out. Diversity
selection uses supplied vectors and farthest-point selection; template fingerprints provide a local
fallback without requiring embeddings. MemoryUseJudge applies deterministic safety checks and may
optionally accept an external model note as untrusted commentary, never as the score authority.

Release gates use median score, worst-decile score, source fidelity, unsafe leakage, stale leakage,
cross-project leakage, budget compliance, strategy adherence, and p95 latency. Top-fraction score is
reported as potential only and cannot make a failing strategy releasable.

## Known Risks And Mitigations

1. **Strategy prompt injection**: capsules contain only canonical enums and bounded metadata, not
   model-authored prose or raw user text.
2. **Bad fixed strategy**: explicit replan triggers plus one-turn lifetime.
3. **Classifier drift**: ContextCortex remains the single intent classifier used by StrategyCortex.
4. **False confidence from self-judgment**: deterministic violations and raw receipts are primary;
   model judgment is optional and non-authoritative.
5. **Top-score optimism**: release gates use median/worst-decile and zero-tolerance safety metrics.
6. **Runtime latency**: no online multi-strategy rollout, embedding diversity, or RL.
7. **Recall regression**: strategy policy is optional and falls back to 3.3 behavior when absent.
8. **Context pollution**: all strategy tags are stripped in host and bridge write paths and excluded
   by binding/compiler prompts.
9. **Schema retention**: outcome telemetry is project-scoped and removed by `forgetUser`.
10. **Unsupported layer promises**: a capsule may prioritize only layers that the caller actually
    supplies; missing required layers produce an explicit judge violation instead of fabricated data.

## Factual Confidence Gate

There is no honest pre-implementation 100% guarantee. This design reaches operational confidence
only after red/green tests cover every boundary above, a 3.3-to-3.4 migration succeeds, all existing
tests pass, package contents are audited, OpenClaw generated-plugin tests pass, and an independent
diff review reports no release blocker.
