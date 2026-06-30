# cogmem 3.6.3 Release Checklist

This release is distributed through the npm registry. GitHub remains the source and review mirror.

## Required Metadata

- `package.json` name is `cogmem`.
- `package.json` version is `3.6.3`.
- `package.json` has `publishConfig.access = public`.
- Public export `.` points to `dist/public.js` and `dist/public.d.ts`.
- Internal subpath `./internal` exists only as an explicit advanced subpath.
- `install.sh` is tracked and installs `cogmem@latest` from npm by default.
- Local databases, SQLite sidecars, `.DS_Store`, and `dist/.tsbuildinfo` are not tracked.

## Required Binaries

- `cogmem`
- `cogmem init`
- `cogmem doctor`
- `cogmem connect`
- `cogmem update`
- `cogmem openclaw diagnose`
- `cogmem-compact`
- `cogmem memory`
- `cogmem repair`
- `cogmem explain-recall`
- `cogmem-mcp`
- `cogmem import-openclaw`
- `cogmem import-hermes`
- `cogmem normalize-transcript`
- `cogmem snapshot`
- `cogmem re-embed`
- `cogmem migrate-vectors`
- `cogmem migrate`
- `cogmem prospective`
- `cogmem strategy`
- `cogmem brain-eval`
- `cogmem episode`
- `cogmem dream`

MCP `tools/list` includes strategy, episode append/import/status/seal/repair, topic list/operate/rollback, candidate review, conditional Dream tick/status, prospective tools, all seven read-only Memory Atlas queries, and explicit `cogmem_graph_touch`. Atlas queries declare read-only/idempotent semantics and never change activation; only touch records selected-node use. Episode append/import never run Dream. MCP Dream tick requires `maintenanceMode: true` to process work; otherwise it is recommendation-only.

## Required Documentation

- README explains the vision, architecture, limits, and one-line install command.
- README says this is a single-agent memory kernel, not an agent team shared brain.
- README distinguishes embedding models from Dream Curator memory-model LLMs.
- README and integration docs explain labeled `sourceContext`, strict before/after window metadata, `charRange` / `sourceRange`, and OpenClaw `sourceWindow` / `sourceTruncation` injection.
- README and skills explain collection routing, `cogmem memory map`, and `cogmem memory tick` as host-owned inspection and maintenance surfaces.
- README and skills explain `decisionTrace` / `recallDecision`, source-first raw fallback, correction semantics, audited review actions, and review-queue aging.
- README and skills explain `cogmem update --yes`, npm install resolution, automatic backed-up migration, automatic OpenClaw plugin-only refresh when configured, migration dry-run, backups, and that Raw Ledger evidence is never rewritten by schema migration.
- README and skills explain that entity aliases are evidence-backed, project-scoped, reversible, and stricter for person entities.
- README and skills explain Belief Graph ownership, user-evidence requirements, reinforcement, conflict review, and supersession history.
- README and skills explain Temporal Memory validity windows, historical lookup, correction reasons, and current-state stale suppression.
- README and skills explain Context Cortex intent suppression, 25% default/30% maximum budget, source drill-down, and activation receipts.
- README and skills explain that Prospective Memory is confirmed-only state with no task execution capability, and how to use BrainEval as a release gate.
- README and skills explain Strategy Cortex templates, no-instruction-authority lifecycle, one-retry replanning, strategy-conditioned retrieval, offline-only rollout comparison, and read-only MemoryUseJudge telemetry.
- README and skills explain Raw Ledger-first episode assembly, soft/hard sealing, explicit conditional Dream ticks, raw-event evidence grounding, repair/retry, and hookless Hermes MCP/import usage.
- README and skills explain CPU foreground versus hybrid background classification, contextual short replies, registry-aware topic boundaries, safe reopen, semantic-summary non-evidence status, per-job Dream modes/failures, stable import identity, and schema migration 24.
- README and skills explain user-shaped topic operations, user-explicit versus model-candidate authority, alias collision review, operation rollback, and project isolation.
- README, `MEMORY_ATLAS.md`, and skills distinguish the system anatomy map from the content Atlas; explain graph overview/search/explore/node/neighbors/path/timeline, generic multi-facet cold-memory resurrection, activation visibility, source drill-down, and project isolation.
- README documents `cogmem.cli.v1`: object payloads are top-level, array payloads use `items`, and queue counters expose top-level compatibility aliases.
- README documents the one-line schema-24/schema-26/pre-release schema-25 to schema-27 migration with backup, and migration tests prove source counts are preserved, Atlas projection is dirty after upgrade, and reruns are idempotent.
- README and OpenClaw skill document plugin-only repair, plugin/audit diagnose, stale graph reads, and conservative empty-project project-scope repair for 3.5.2 -> 3.6.x upgrades.
- README and skills explain episode surgery, closure recomputation, stale-candidate invalidation, cross-reference/audit preservation, and sealed-only Dream requeue.
- README and Hermes skill explain per-message import checkpoints, stable `externalMessageId` requirements across split batches, source-agent validation, CLI range/error controls, and hookless recall freshness warnings.
- OpenClaw installation includes `SKILL.md` plus the complete `references/operations.md` command handbook covering migration, import, review, Atlas, repair, backup, and maintenance.
- Hermes installation includes the same complete handbook, MCP wiring, `connect hermes --auto`, and `/reload-mcp`.
- OpenClaw skill explains the direct plugin Atlas route without MCP; Hermes skill explains graph-first MCP tool selection and exact evidence drill-down.
- BrainEval fixtures cover Atlas scope isolation, traversal bounds, evidence locators, path reconstruction, faceted resurrection, and canonical-source immutability.
- Concurrency fixtures prove read-only inspection while another connection is open; Atlas fixtures prove pure reads, explicit touch, dirty-only rebuild, error state, retention, weighted path, and exact facet composition.
- SECURITY documents local-first storage, explicit external providers, snapshots as sensitive, and governed recall.

## Verification

Run from the repository root:

```bash
bun run typecheck
bun run build
bun test
npm pack --dry-run --json
npm publish --dry-run --access public
```

The pack dry-run must include built public API files, CLI files, examples, docs, and `install.sh`. It must not include local databases or machine-specific files.

After verification, create a GitHub Release from the matching version tag, for example `v3.6.3`. The release workflow publishes through npm Trusted Publishing when the release is published. It must not publish on tag push alone.

Emergency manual fallback:

```bash
npm publish --provenance --access public
```
