# Benchmarks

## BrainEval 3.6.0

`cogmem brain-eval --input samples.json` is the end-to-end memory-brain gate. It fails on recall below 90%, precision below 80%, provenance below 95%, binding purity below 90%, temporal current-truth accuracy below 95%, or any false entity merge, invalid user-belief ownership, context pollution, source mismatch, stale/cross-project leakage, context-budget violation, or prospective activation without confirmation. Input samples can include domain checks for canonical topic paths, entity merge decisions, user evidence ownership, temporal versions, context pollution, and exact source event identity.

Release fixtures must include at least one check for every domain metric. Missing binding, entity, user-belief, temporal, context-pollution, or source-fidelity checks fail closed instead of receiving a synthetic perfect score.

Episode fixtures also measure `episodeGroupingAccuracy`, `episodeBoundaryAccuracy`, `episodeEvidenceCoverage`, `unassignedRawRate`, `dreamCandidateGrounding`, `dreamBypassRate`, and `hermesImportParity`. These checks fail closed when omitted. Release gates require at least 95% episode evidence coverage, exact Hermes live/import shape parity, and zero governance bypass.

Atlas fixtures enforce project isolation, node/hop/evidence bounds, exact evidence locators, weighted path reconstruction, composable facet resurrection, pure read behavior, explicit activation touch, and canonical-source immutability. Runtime reliability fixtures cover read-only CLI inspection during a long-lived SQLite connection and audited `needs_confirmation` review transitions.

Strategy-policy evaluation consumes precomputed `StrategyRolloutOutcome` records:

```bash
cogmem brain-eval --input strategy-outcomes.json --strategy-rollout --json
```

It does not call a model or generate online rollouts. `StrategyDiversitySelector` can apply farthest-point selection to supplied vectors for offline fixture diversity. `ContextPolicyScorer` gates on median score, worst-decile score, exact source fidelity, zero unsafe/stale/cross-project leakage, zero over-budget outcomes, strategy adherence, and p95 latency. The top-fraction score is reported for exploration only and never overrides a safety failure.

Core benchmarks must prove natural memory emergence, not only recall@k.

## Natural Emergence Group

The `memory_natural_emergence` benchmark group runs on the `memory_recall` eval suite and tracks:

- `critical_memory_recall_rate`
- `old_but_important_recall_rate`
- `stale_memory_leakage_rate`
- `superseded_fact_leakage_rate`
- `suspect_memory_leakage_rate`
- `cross_project_leakage_rate`
- `provenance_completeness_rate`
- `context_budget_efficiency`
- `pulse_activation_useful_expansion_rate`
- `inhibition_correctness_rate`
- `vector_bytes_per_raw_event`
- `compiled_neuron_per_turn_rate`
- `immediate_embedding_skip_rate`
- `dream_coverage_rate`
- `undreamed_raw_backlog_count`
- `cold_recall_rehydration_success_rate`

This group checks both activation and inhibition: the kernel should surface old but important memories while suppressing stale, superseded, suspect, and cross-project evidence.

Storage metrics are quality gates, not standalone wins. A run only passes if vector bytes drop while critical recall, old-but-important recall, provenance completeness, and leakage metrics stay within the accepted threshold.

## Baselines

Use external benchmark ideas only as baselines or measurements:

- fixed recent window baseline
- vector topK baseline
- full-context baseline
- token saving metric
- latency metric
- provenance completeness metric
- immediate-compile-every-turn storage baseline
- selective-compile storage baseline
- raw-then-dream coverage baseline

These baselines must not become the default agent-facing memory path. The default path remains structure-first universe navigation with pulse activation, temporal traversal, governance suppression, and bounded context.
