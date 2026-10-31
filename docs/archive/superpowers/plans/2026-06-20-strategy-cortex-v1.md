# Cogmem 3.4.0 Strategy Cortex v1 Implementation Plan

## Goal

Add a safe strategy-before-recall layer inspired by StraTA, plus offline strategy evaluation and
read-only memory-use judgment, without adding online RL or multi-rollout latency.

## Tasks

1. Add failing tests for canonical strategy selection, retrieval-lane policy, current-turn formatting,
   deterministic replanning, and context-block stripping.
2. Implement `StrategyCapsule`, `StrategyTemplateRegistry`, `StrategyCortex`, and
   `StrategyConditionedCandidateBuilder`.
3. Extend `AgentRecallQuery` with an optional retrieval policy and make graph/compiled/raw lane
   acquisition and ordering honor it while preserving the 3.3 default path.
4. Integrate the capsule with `ContextCortex` receipts and OpenClaw's generated bridge/plugin.
5. Add `MemoryUseJudge`, project-scoped outcome storage, and migration 0021. Ensure `forgetUser`
   removes outcome rows.
6. Extend BrainEval with offline strategy-rollout comparison, diverse selection, policy scoring, and
   zero-tolerance safety gates. Add `--strategy-rollout` CLI input support.
7. Add a read-only `cogmem_strategy_plan` MCP tool so agents can inspect the selected memory policy
   without executing recall or mutating memory.
8. Update model boundary prompts, README, memory/explainability/benchmark docs, changelog, release
   checklist, OpenClaw/Hermes AGENTS/SKILL/README, version 3.4.0, schema 21, and MCP metadata.
9. Run targeted tests, full tests, typecheck, build, migration smoke, CLI/MCP smoke, pack audit, and
   independent diff review; repair every confirmed issue before commit.
10. Commit and push `codex/strategy-cortex-3.4.0`.

## Out Of Scope

- online RL or GRPO;
- online multi-strategy rollouts;
- automatic model-authored strategy templates;
- direct memory mutation by the judge or scorer;
- cross-turn strategy persistence or autonomous policy weight updates.
