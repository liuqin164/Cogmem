# Cogmem 3.6.0 Memory Atlas Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`. Use TDD for every behavior change. Do not delegate shared-worktree edits.

**Goal:** Give agents a bounded, source-anchored map of what Cogmem remembers, while standardizing CLI JSON, preserving existing recall semantics, and providing a one-command 3.5.2 database upgrade.

**Architecture:** Keep Raw Ledger, episodes, beliefs, topics, and memory bindings as canonical sources. Add a rebuildable Memory Atlas projection and query service over those sources, deterministic action frames for user-requested operations, and adapter surfaces for CLI, MCP, and the OpenClaw direct plugin. Atlas summaries remain navigation hints; every durable claim drills down to immutable raw evidence.

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, FTS5, migration runner, MCP SDK, Bun test.

---

## Confidence contract

Factual release confidence requires all of the following:

1. Every user requirement is mapped to a code change, test, documentation section, or explicit scope boundary.
2. Each behavior change is introduced by a failing regression test and then made green.
3. A real schema-24 fixture upgrades to schema 25 with one command, preserves source rows, creates a queryable Atlas, and is idempotent.
4. Project isolation, bounded traversal, evidence provenance, cold-memory resurrection, and no-vector operation pass targeted tests.
5. CLI, MCP, OpenClaw, public API, examples, plugin instructions, generated declarations, and package contents agree.
6. Full tests, typecheck, build, package dry-run, diff hygiene, and remote-branch verification pass.

This establishes 100% coverage of the known scope and observed release gates. It does not claim that unknown future defects are mathematically impossible.

## Non-negotiable invariants

- Raw events remain immutable evidence; Atlas documents and summaries are never a source of truth.
- Every Atlas query is project-scoped and bounded.
- Provider or model output cannot override project, source, session, thread, evidence, or action-frame ownership.
- Exact entity + time + action constraints may resurrect cold memories; activation only changes default visibility.
- Graph queries never mutate canonical memory. Access receipts and activation are separate, non-evidentiary state.
- Existing `memory_map.v1` remains the system anatomy map. `memory_atlas.v1` is the content-navigation map.
- Recall remains available and unchanged for direct factual queries.
- OpenClaw uses the direct kernel bridge; MCP is an adapter, not a core dependency.
- No web UI, hidden daemon, second canonical graph, or mandatory LLM/vector dependency is introduced.

## Task 1: Standardize the CLI JSON contract

**Files:**

- Create: `src/bin/CliJson.ts`
- Modify: `src/bin/cogmem.ts`, every JSON-capable file under `src/bin/`
- Test: `__tests__/cli-json-contract.unit.test.ts`
- Docs: `README.md`, `RELEASE_CHECKLIST.md`, `CHANGELOG.md`

1. Add failing tests that reproduce nested queue counters and enumerate every documented `--json` command.
2. Define `cogmem.cli.v1`: unwrapped command payload, plus stable `schemaVersion` and `command` metadata.
3. For queue-bearing commands expose top-level `candidate`, `promoted`, `needs_confirmation`, and `beliefs`; retain legacy nested objects during 3.6.x.
4. Route all JSON output through one formatter; reject non-finite numbers and accidental `undefined` fields deterministically.
5. Update help and docs with examples and compatibility rules.
6. Run `bun test __tests__/cli-json-contract.unit.test.ts`.

## Task 2: Add schema-25 Atlas storage and one-command migration

**Files:**

- Create: `src/migrations/0025_memory_atlas.ts`
- Create: `src/atlas/MemoryAtlasTypes.ts`
- Create: `src/store/MemoryAtlasStore.ts`
- Modify: `src/migrations/index.ts`, `src/internal.ts`
- Test: `__tests__/memory-atlas-migration.unit.test.ts`

1. Build a schema-24 fixture containing projects, raw events, topics, entities, clusters, bindings, edges, episodes, and beliefs.
2. Add failing upgrade, preservation, idempotence, and rollback-safety tests.
3. Create rebuildable tables:
   `memory_atlas_documents`, `memory_atlas_fts`, `memory_action_frames`,
   `memory_action_frame_evidence`, `memory_atlas_access`,
   `memory_atlas_activation`, and `memory_atlas_projection_state`.
4. Add foreign-key/project indexes and FTS synchronization triggers. Projection rows must point to canonical source IDs.
5. Backfill documents and action-frame candidates deterministically during migration; mark projection state so maintenance can resume safely.
6. Verify `cogmem migrate --yes --backup --json` upgrades 24 to 25, creates a WAL-aware backup, preserves counts/checksums, and is safe to rerun.
7. Run migration and schema parity tests.

## Task 3: Build deterministic Atlas indexing and action frames

**Files:**

- Create: `src/atlas/MemoryAtlasIndexer.ts`
- Create: `src/atlas/ActionFrameExtractor.ts`
- Create: `src/atlas/MemoryAtlasQueryCompiler.ts`
- Test: `__tests__/memory-atlas-indexer.unit.test.ts`

1. Add failing fixtures for topic/entity/cluster/episode/belief projection and raw-user action extraction.
2. Project canonical records into uniform nodes: project, topic, entity, cluster, episode, belief, action, and time. Raw events remain evidence-only by default.
3. Extract bounded action frames only from source-anchored user evidence: request, operation, configuration, repair, install, connect, update, compare, decision, and plan.
4. Link action frames to entity, project, topic, episode, time bucket, and evidence IDs without model-generated ownership.
5. Make incremental indexing restartable and idempotent; allow a full rebuild because the projection is disposable.
6. Parse natural-language time constraints including explicit years and relative ranges against an injected clock.
7. Run indexer/compiler tests without vectors or an LLM.

## Task 4: Implement bounded Memory Atlas queries

**Files:**

- Create: `src/atlas/MemoryAtlasService.ts`
- Create: `src/atlas/index.ts`
- Modify: `src/factory.ts`, `src/public.ts`, `src/internal.ts`
- Test: `__tests__/memory-atlas.unit.test.ts`

1. Add failing tests for `overview`, `search`, `explore`, `node`, `neighbors`, `path`, and `timeline`.
2. Use live canonical adapters plus the projection; do not copy canonical edge truth.
3. Enforce defaults/hard bounds: 8/30 nodes, 1/2 hops, 2/10 evidence items, 6 path hops, 2,000 visited nodes.
4. Rank by lexical constraint match, confidence, support, activation, recency, project, entity, time, action, and conflict state.
5. Implement temporal resurrection: exact entity/time/action constraints bypass visibility floors but never project scope or evidence validation.
6. Return bounded nodes/edges, provenance, warnings, and typed `nextActions`; every evidence result includes `eventId` and an exact `cogmem memory show` command.
7. Hide raw excerpts unless `includeEvidence=true`; sanitize control blocks and oversized content.
8. Record only non-evidentiary access receipts and activation changes; assert canonical source tables are unchanged.
9. Run targeted tests including zero-data, missing-vector, cold-memory, cross-project, malformed-input, and traversal-budget cases.

## Task 5: Integrate deterministic Atlas maintenance

**Files:**

- Modify: `src/factory.ts`, `src/store/MemoryAtlasStore.ts`
- Test: `__tests__/memory-atlas-maintenance.unit.test.ts`

1. Add failing tests for incremental refresh, activation bump, decay, stale projection repair, and interrupted rebuild recovery.
2. Refresh newly created/changed source nodes after ingest/Dream/governance completion.
3. Extend `runMaintenanceTick()` with deterministic Atlas projection repair and activation decay.
4. Keep Dream optional and low-frequency; it may improve summaries/relations but cannot manufacture evidence.
5. Return maintenance diagnostics and recommended actions without starting a hidden scheduler.

## Task 6: Expose CLI graph navigation

**Files:**

- Modify: `src/bin/memory.ts`, `src/bin/cogmem.ts`
- Test: `__tests__/memory-atlas-cli.unit.test.ts`

1. Add failing CLI tests for graph overview/search/explore/node/neighbors/path/timeline.
2. Implement:
   `memory graph`, `graph-search`, `graph-explore`, `graph-node`,
   `graph-neighbors`, `graph-path`, and `graph-timeline`.
3. Require/resolve project scope, validate node/hop/limit/time inputs, and use `cogmem.cli.v1` JSON.
4. Ensure human output is concise and exposes exact drilldown commands.
5. Verify the Hermes last-year action fixture returns an episode/action chain rather than an unbounded entity dump.

## Task 7: Expose MCP tools and agent guidance

**Files:**

- Modify: `src/mcp/CoreMcpTools.ts`, `src/mcp/server.ts`
- Test: `__tests__/mcp-tools.unit.test.ts`, `__tests__/memory-atlas-mcp.unit.test.ts`

1. Add failing schema/handler tests for `cogmem_graph_overview`, `search`, `explore`, `node`, `neighbors`, `path`, and `timeline`.
2. Reuse the core service and identical bounds; MCP handlers contain no independent graph logic.
3. Add concise server instructions by intent:
   broad inventory/history uses explore; known node uses search/node; relationships use neighbors/path/timeline; direct fact uses recall; raw source uses evidence IDs.
4. Return structured errors for missing projects, unknown nodes, invalid limits, and unavailable projections.
5. Assert no graph MCP tool mutates canonical memory.

## Task 8: Add OpenClaw direct Atlas integration

**Files:**

- Modify: `src/host/openclaw/AutoMemoryPluginInstaller.ts`
- Modify: `examples/openclaw-backend/README.md`, `AGENTS.md`, `SKILL.md`
- Test: `__tests__/openclaw-context-hygiene.unit.test.ts`, `__tests__/memory-atlas-openclaw.unit.test.ts`

1. Add failing tests for broad inventory/history detection, direct bridge calls, bounded injection, and block stripping.
2. Extend the generated bridge with direct `graphExplore`, `graphNode`, `graphPath`, and `graphTimeline` operations.
3. In `before_prompt_build`, use bounded Atlas context for broad historical/inventory questions and normal recall for direct facts.
4. Inject `<COGMEM_MEMORY_ATLAS>` separately from recall context and remove it before persistence.
5. Keep OpenClaw independent of MCP and preserve CPU-only foreground behavior.

## Task 9: Teach Hermes, agents, and operators how to use Atlas

**Files:**

- Modify: `examples/hermes-backend/README.md`, `AGENTS.md`, `SKILL.md`
- Modify: `README.md`, `MEMORY_MODEL.md`, `RECALL_EXPLAINABILITY.md`
- Create: `MEMORY_ATLAS.md`
- Modify: `src/benchmark/BrainEval.ts` and relevant eval fixtures

1. Document the system-map/content-map distinction, tool-selection rules, activation/cold-memory behavior, source drilldown, and one-line migration.
2. Add examples for “what do I remember?”, graph exploration, node drilldown, path queries, and “what did I ask you to do to Hermes last year?”.
3. Tell Hermes/MCP agents to use Atlas before recall for broad inventory/history, while using recall for specific facts.
4. Add BrainEval gates for scope isolation, path reconstruction, evidence anchoring, bounded output, temporal resurrection, and source-table immutability.
5. Document JSON field stability and retained 3.6.x compatibility aliases.

## Task 10: Release 3.6.0 and regenerate package artifacts

**Files:**

- Modify: `package.json`, `CHANGELOG.md`, `RELEASE_CHECKLIST.md`
- Regenerate: `dist/**`

1. Set package version 3.6.0, schema version 25, and OpenClaw integration version 0.6.0.
2. Run focused tests after every red-green cycle.
3. Run `bun test __tests__`, `bun run typecheck`, and `bun run build`.
4. Run a clean 3.5.2-to-3.6.0 migration smoke using the built CLI and verify backup, checksum preservation, Atlas queries, and rerun idempotence.
5. Run `npm_config_cache=/tmp/cogmem-npm-cache npm pack --dry-run --json` and inspect included migrations, docs, examples, declarations, and built commands.
6. Run `git diff --check`, search for stale 3.5.2 help/version strings, and verify no `.codegraph/` or `node_modules` state is staged.
7. Perform an adversarial review for SQL safety, traversal denial-of-service, FTS injection, project leakage, summary-as-evidence, and plugin context leakage; repair every finding and rerun gates.
8. Commit logical changes, push `codex/memory-atlas-3.6.0`, and verify local HEAD equals the remote branch HEAD.

## Requirement traceability

| Requirement | Tasks | Proof |
|---|---:|---|
| Flat, documented CLI JSON | 1, 6 | contract matrix + queue counter regression |
| Agent sees what memory exists | 3, 4 | overview/search/explore fixtures |
| Topic/entity/cluster/event relationships | 3, 4 | node/neighbor edge assertions |
| Precise raw drilldown | 4, 6, 7 | evidence ID + command assertions |
| Hot/warm/cold visibility | 4, 5 | activation/decay/resurrection tests |
| Hermes + last year + action path | 3, 4, 6 | temporal action-chain fixture |
| Existing rules plus graph placement | 3, 5 | deterministic incremental index tests |
| MCP access | 7 | tool schema/handler tests |
| OpenClaw without MCP | 8 | direct bridge integration tests |
| Docs/plugin/skills teach usage | 8, 9 | documentation and package assertions |
| One-line 3.5.2 migration | 2, 10 | schema-24 fixture + built CLI smoke |
| No new hidden truth/daemon/UI | 2-5 | source immutability + explicit scope docs |

## Final risk-closure loop

Before release, repeat this loop until no uncovered known risk remains:

1. Compare the spec, this plan, implementation diff, migration, tests, public APIs, MCP schemas, plugin bridge, and docs.
2. Classify every mismatch as implementation gap, test gap, documentation gap, compatibility gap, or intentional boundary.
3. Add a failing test or explicit documented boundary before changing code.
4. Rerun targeted gates, then the full release gates.
5. Stop only when the mismatch list is empty and every command exits zero.

