# Cogmem Brain 2.8.0-3.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Cogmem 2.7.1 into a governed agent memory brain with canonical binding, entity governance, evidence-backed beliefs, temporal versions, bounded context activation, and safe prospective memory.

**Architecture:** Raw Ledger remains authoritative. LLMs and deterministic extractors may only propose candidates; CPU validators convert accepted candidates into versioned `MemoryGovernancePlan` operations executed in one SQLite transaction and projected into binding, entity, belief, temporal, and activation views. Existing stores are converged through shared database handles and a read-only `BrainGraphView`; no additional canonical graph is introduced.

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, Bun test, MCP SDK, existing Cogmem CLI/configuration and OpenClaw/Hermes adapters.

---

### Task 1: 2.8.0 governance and schema foundation

**Files:**
- Create: `src/governance/MemoryGovernancePlan.ts`
- Create: `src/governance/MemoryGovernanceValidator.ts`
- Create: `src/governance/MemoryGovernanceExecutor.ts`
- Create: `src/store/MemoryGovernanceStore.ts`
- Create: `src/migrations/0015_memory_governance.ts`
- Test: `__tests__/memory-governance.unit.test.ts`

- [ ] **Step 1: Write failing tests for evidence, ownership, idempotency, stale versions, and rollback**

```ts
test('rejects durable operations without raw event evidence', () => {
  expect(validator.validate(planWithoutEvidence).valid).toBe(false);
});

test('does not allow assistant-only evidence to create a user-owned belief', () => {
  expect(validator.validate(assistantOwnedUserBelief).issues).toContainEqual(
    expect.objectContaining({ code: 'user_ownership_requires_user_evidence' }),
  );
});

test('executes a plan once and rolls back every operation on failure', () => {
  executor.execute(validPlan);
  expect(executor.execute(validPlan).status).toBe('already_applied');
  expect(() => executor.execute(failingPlan)).toThrow();
  expect(store.listAppliedOperations(failingPlan.planId)).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `bun test __tests__/memory-governance.unit.test.ts`

Expected: imports or assertions fail because the governance modules do not exist.

- [ ] **Step 3: Implement semantic operations and strict validation**

```ts
export type MemoryGovernanceOperationType =
  | 'BIND_EVENT' | 'RECLASSIFY_TOPIC' | 'MERGE_CLUSTER' | 'SPLIT_CLUSTER'
  | 'LINK_ENTITY_ALIAS' | 'MERGE_ENTITY'
  | 'CREATE_BELIEF' | 'REINFORCE_BELIEF' | 'SUPERSEDE_BELIEF' | 'REJECT_BELIEF'
  | 'CREATE_TIME_ANCHOR' | 'EXPIRE_TIME_ANCHOR'
  | 'CREATE_PROSPECTIVE_MEMORY' | 'RESOLVE_PROSPECTIVE_MEMORY';

export interface MemoryGovernanceOperation {
  operationId: string;
  type: MemoryGovernanceOperationType;
  projectId?: string;
  evidenceEventIds: string[];
  sourceRole: 'user' | 'assistant' | 'tool' | 'system';
  ownership: 'user' | 'project' | 'system';
  expectedVersion?: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Execute validated operations and audit rows in one SQLite transaction**

The executor must call `db.transaction(() => { ... })()` and write both operation state and audit records inside that transaction. It must never resolve mutation targets by fuzzy title.

- [ ] **Step 5: Run focused and full tests**

Run: `bun test __tests__/memory-governance.unit.test.ts && bun run typecheck`

### Task 2: 2.8.0 stable binding and read-only brain graph

**Files:**
- Create: `src/binding/TopicPathRegistry.ts`
- Create: `src/binding/ClaimKeyGenerator.ts`
- Create: `src/binding/BindingDecisionEngine.ts`
- Create: `src/graph/BrainGraphView.ts`
- Modify: `src/binding/BindingClassifier.ts`
- Modify: `src/binding/MemoryBindingService.ts`
- Modify: `src/binding/MemoryBindingTypes.ts`
- Modify: `src/store/MemoryBindingStore.ts`
- Test: `__tests__/memory-binding-v15.unit.test.ts`

- [ ] Write RED tests proving stable multilingual paths, distinct claims, canonical entity IDs, activation-only edge decay, and read-only graph traversal.
- [ ] Implement registry-driven canonical paths; models may suggest a candidate label but CPU code owns the accepted path.
- [ ] Split edge state into `confidence`, `stability`, and `activation`; provenance relations never lose confidence through activation decay.
- [ ] Implement bounded one/two-hop `BrainGraphView` queries returning evidence IDs and suppression reasons.
- [ ] Run focused tests, existing binding tests, typecheck, and build.

### Task 3: Upgrade and migration commands

**Files:**
- Create: `src/migrations/SchemaMigrationRunner.ts`
- Create: `src/bin/migrate.ts`
- Modify: `src/bin/update.ts`
- Modify: `src/bin/cogmem.ts`
- Modify: `package.json`
- Test: `__tests__/schema-migration.unit.test.ts`
- Test: `__tests__/update-release.unit.test.ts`

- [ ] Write RED tests for dry-run, backup-before-write, idempotent migration, old-schema replay, and update follow-up migration.
- [ ] Implement `cogmem migrate [--db|--config] [--dry-run] [--backup] [--json]`.
- [ ] Make `cogmem update --yes` install the release selected through GitHub Releases, then run the newly installed `cogmem migrate --backup` command.
- [ ] Never rewrite Raw Ledger rows; migrations may add projections, indexes, versions, or backfill canonical references.
- [ ] Run CLI tests and migration replay fixtures.

### Task 4: Release 2.8.0

**Files:** `README.md`, `MEMORY_MODEL.md`, `CHANGELOG.md`, `RELEASE_CHECKLIST.md`, `examples/*-backend/{README,AGENTS,SKILL}.md`, `package.json`, `src/factory.ts`

- [ ] Document governance operations, migration, graph inspection, failure recovery, and agent usage.
- [ ] Set package/core version to `2.8.0` and schema version to `15`.
- [ ] Run `bun test __tests__`, `bun run typecheck`, `bun run build`, and `npm pack --dry-run --json` serially.
- [ ] Commit and push `codex/brain-2.8.0`.

### Task 5: 2.9.0 entity governance v2

**Files:**
- Create: `src/entity/EntityGovernanceService.ts`
- Create: `src/migrations/0016_entity_governance.ts`
- Modify: `src/store/EntityStore.ts`
- Modify: `src/binding/MemoryBindingService.ts`
- Test: `__tests__/entity-governance-v2.unit.test.ts`

- [ ] RED-test multilingual aliases, ambiguous people, pending merge candidates, reversible merges, project isolation, and person privacy.
- [ ] Reuse `EntityStore` as the sole canonical owner; binding rows reference its IDs and legacy `memory_entities` becomes a compatibility projection.
- [ ] Require explicit evidence and high thresholds for person merges; medium confidence remains pending and low confidence remains a mention.
- [ ] Add entity merge audit and timeline entries without deleting source entities or aliases.
- [ ] Set version `2.9.0`, schema `16`; update docs, verify, commit, and push `codex/brain-2.9.0`.

### Task 6: 3.0.0 belief governance v2

**Files:**
- Create: `src/belief/BeliefGovernanceService.ts`
- Create: `src/migrations/0017_belief_governance.ts`
- Modify: `src/belief/BeliefStore.ts`
- Modify: `src/governance/MemoryGovernanceExecutor.ts`
- Test: `__tests__/belief-governance-v2.unit.test.ts`

- [ ] RED-test evidence-backed creation, reinforcement, conflict, correction, supersede, source ownership, and current/history queries.
- [ ] Remove the unchecked belief boundary and enforce typed evidence links and version numbers.
- [ ] Assistant/tool evidence may create project observations but never user preferences, goals, or boundaries without explicit user evidence.
- [ ] Set version `3.0.0`, schema `17`; update docs, verify, commit, and push `codex/brain-3.0.0`.

### Task 7: 3.1.0 temporal versioning v1

**Files:**
- Create: `src/temporal/TemporalMemoryService.ts`
- Create: `src/migrations/0018_temporal_versioning.ts`
- Modify: `src/store/TopologyStore.ts`
- Modify: `src/belief/BeliefStore.ts`
- Test: `__tests__/temporal-memory-v1.unit.test.ts`

- [ ] RED-test current truth, historical truth, correction time, decision reason, valid intervals, and project milestones.
- [ ] Reuse existing belief validity and topology data; add a unified version chain and typed time anchors rather than parallel truth tables.
- [ ] Preserve exact evidence and source locators for every version transition.
- [ ] Set version `3.1.0`, schema `18`; update docs, verify, commit, and push `codex/brain-3.1.0`.

### Task 8: 3.2.0 context cortex v1

**Files:**
- Create: `src/context/ContextActivationPlanner.ts`
- Create: `src/context/ContextPackAssembler.ts`
- Create: `src/migrations/0019_context_cortex.ts`
- Modify: `src/agent/AgentMemoryBackend.ts`
- Modify: `src/agent/RecallContextFormatter.ts`
- Test: `__tests__/context-cortex-v1.unit.test.ts`

- [ ] RED-test greeting suppression, same-topic continuation, new-topic isolation, source drill-down, conflict surfacing, privacy suppression, and hard token budgets.
- [ ] Compose existing intent, activation, bridge, session-state, graph, belief, and source components into one explainable activation plan.
- [ ] Use `immediate`, `working`, `background`, and `source` bands; suppression is an audit receipt, never injected content.
- [ ] Cap Cogmem at 25% of available context; source drill-down replaces lower bands rather than adding beyond the cap.
- [ ] Set version `3.2.0`, schema `19`; update plugin/skill docs, verify, commit, and push `codex/brain-3.2.0`.

### Task 9: 3.3.0 prospective memory v1

**Files:**
- Create: `src/prospective/ProspectiveMemoryStore.ts`
- Create: `src/prospective/ProspectiveMemoryService.ts`
- Create: `src/migrations/0020_prospective_memory.ts`
- Modify: `src/governance/MemoryGovernanceExecutor.ts`
- Modify: `src/mcp/CoreMcpTools.ts`
- Test: `__tests__/prospective-memory-v1.unit.test.ts`

- [ ] RED-test candidate creation, explicit confirmation, defer, reject, expiry, privacy, project isolation, and non-execution.
- [ ] Store future intentions as candidates only; Cogmem core must expose no external-action executor.
- [ ] Rejected/deferred candidates must not repeatedly surface unless new user evidence changes their version.
- [ ] Set version `3.3.0`, schema `20`; update all docs and host skills, verify, commit, and push `codex/brain-3.3.0`.

### Task 10: BrainEval and final adversarial verification

**Files:**
- Create: `src/benchmark/BrainEval.ts`
- Create: `__tests__/brain-eval.integration.test.ts`
- Modify: `BENCHMARKS.md`

- [ ] Add binding purity, entity false-merge, belief ownership, temporal current-truth, context pollution, source fidelity, and prospective false-positive metrics.
- [ ] Replay anonymized multilingual fixtures, vectors=0 mode, old schema migration, concurrent maintenance, current-session exclusion, and `forgetUser` erasure.
- [ ] Run full tests, typecheck, build, package dry-run, CLI smoke, MCP tool listing, and migration replay from 2.7.1.
- [ ] Inspect the complete diff and run an adversarial review; fix every confirmed issue and repeat verification until no known release-blocking defect remains.

## Self-review

- Coverage: all requested versions, GitHub-release update, database migration, documentation, plugin/skill guidance, branch-per-version publishing, and final confidence loop are represented.
- Placeholder scan: no deferred implementation markers are used; each version has explicit behavior and acceptance gates.
- Type consistency: governance operations, canonical entity ownership, versioned beliefs, time anchors, context bands, and prospective candidates use one cumulative model across releases.
