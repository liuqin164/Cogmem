# OpenClaw Memory Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Cogmem 2.7.1 so OpenClaw history remains source-faithful, ordinary correction loops do not poison governance, stale review items age safely, and recall selection is inspectable.

**Architecture:** Fix corruption at the Markdown parser boundary, classify corrections as organizational evidence, move provider failures out of the review queue, age review records through the explicit maintenance surface, and attach a bounded decision trace to the existing agent recall contract. Keep Raw Ledger and CPU governance authoritative.

**Tech Stack:** TypeScript, Bun, SQLite, MCP SDK, generated OpenClaw plugin bridge.

---

### Task 1: Source-Faithful OpenClaw Import

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/conversation/ConversationMarkdownAdapter.ts`
- Test: `__tests__/agent-import-cli.unit.test.ts`

- [ ] Add fixture tests that parse `assistant:` with its body on following lines and collapse only adjacent exact duplicate role messages.
- [ ] Run `bun test __tests__/agent-import-cli.unit.test.ts` and confirm role-boundary and duplicate-count failures.
- [ ] Allow an empty parsed role body and add adjacent duplicate collapse with `conversation_adjacent_duplicate_collapsed` diagnostics.
- [ ] Re-run the focused test and confirm clean user/assistant records with repeated non-adjacent `在吗` preserved.

### Task 2: Correction and Provider Governance

**Files:**
- Modify: `src/engine/DreamCuratorWorker.ts`
- Modify: `src/engine/DeepWritePromotionPolicy.ts`
- Modify: `src/factory.ts`
- Test: `__tests__/dream-ledger.unit.test.ts`

- [ ] Add tests proving user clarification yields `correction`, no `contradictions`, and no `needs_confirmation` residue.
- [ ] Add a test proving invalid provider JSON records `dream_curator_provider_invalid_output` as a non-fatal event and does not enter the review queue.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Treat `correction` as an organizational candidate, validate provider conflicts as paired-claim review candidates, and inject `PipelineMetrics` into the curator.
- [ ] Store provider warnings as rejected audit records and supersede them after provider recovery.
- [ ] Re-run the focused tests.

### Task 3: Auditable Review Queue Aging

**Files:**
- Modify: `src/store/DeepWriteCandidateStore.ts`
- Modify: `src/factory.ts`
- Modify: `src/bin/memory.ts`
- Test: `__tests__/dream-ledger.unit.test.ts`
- Test: `__tests__/agent-nerve-system.unit.test.ts`

- [ ] Add failing tests for fresh versus expired `needs_confirmation` candidates under an explicit maintenance tick.
- [ ] Add `status_reason` and `updated_at` compatibility columns plus `expireNeedsConfirmation()`.
- [ ] Extend maintenance charge/execution receipts with expired-review counts while preserving all candidate rows.
- [ ] Re-run focused tests and verify no automatic background cleanup occurs.

### Task 4: Agent Recall Decision Trace

**Files:**
- Modify: `src/agent/AgentMemoryBackend.ts`
- Modify: `src/recall/RecallExplanation.ts`
- Modify: `src/mcp/CoreMcpTools.ts`
- Modify: `src/host/openclaw/AutoMemoryPluginInstaller.ts`
- Test: `__tests__/agent-import-cli.unit.test.ts`
- Test: `__tests__/recall-explanation.unit.test.ts`
- Test: `__tests__/openclaw-context-hygiene.unit.test.ts`

- [ ] Add failing tests for stable selected-lane/reason/count fields and actual recall/explain evidence parity.
- [ ] Add `AgentRecallDecisionTrace` and populate it on every recall return path.
- [ ] Route agent-scoped explanation through `KernelAgentMemoryBackend.recall()` and preserve governance-filter audit data.
- [ ] Render one bounded `recallDecision` line in volatile OpenClaw context and include the trace in audit/MCP/CLI JSON.
- [ ] Re-run focused tests.

### Task 5: Release Documentation and Metadata

**Files:**
- Modify: `package.json`
- Modify: `src/factory.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/snapshot/SnapshotExporter.ts`
- Modify: `README.md`
- Modify: `MEMORY_MODEL.md`
- Modify: `RECALL_EXPLAINABILITY.md`
- Modify: `CHANGELOG.md`
- Modify: `examples/openclaw-backend/AGENTS.md`
- Modify: `examples/openclaw-backend/README.md`
- Modify: `examples/openclaw-backend/SKILL.md`
- Modify: `examples/hermes-backend/AGENTS.md`
- Modify: `examples/hermes-backend/README.md`
- Modify: `examples/hermes-backend/SKILL.md`
- Test: `__tests__/release-metadata.unit.test.ts`

- [ ] Set core/package/MCP/skill version to `2.7.1` and schema version to `14` if candidate columns are added.
- [ ] Document correction semantics, queue TTL, provider diagnostics, decision trace, and agent drill-down workflow.
- [ ] Update plugin and skill instructions so agents inspect `recallDecision` before claiming memory absence and use `sourceLocator` for exact wording.
- [ ] Run release metadata and installer tests.

### Task 6: Verification and Publish

**Files:**
- Verify all changed source, generated `dist`, tests, and docs.

- [ ] Run the two supplied files through import, Dream, governance, recall, and explain-recall.
- [ ] Run `bun test __tests__`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run build`.
- [ ] Run `npm pack --dry-run` after build completes.
- [ ] Review `git diff --check`, version references, and repository status.
- [ ] Commit the verified release and push the current Cogmem branch.
