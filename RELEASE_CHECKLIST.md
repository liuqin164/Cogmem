# cogmem 4.0.0 Release Checklist

This release is distributed through the npm registry. GitHub remains the source and review mirror.

## Required Metadata

- `package.json` name is `cogmem`.
- `package.json` version is `4.0.0`.
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
- `cogmem mcp`
- `cogmem openclaw diagnose`
- `cogmem-compact`
- `cogmem memory`
- `cogmem repair`
- `cogmem explain-recall`
- `cogmem-mcp` compatibility bin for existing host configs
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

MCP `tools/list` includes strategy, episode append/import/status/audit-boundaries/split-plan/seal/repair, topic list/operate/rollback, candidate review, conditional Dream tick/status, prospective tools, all seven read-only Memory Atlas queries, and explicit `cogmem_graph_touch`. Atlas queries declare read-only/idempotent semantics and never change activation; only touch records selected-node use. Episode append/import never run Dream. Episode audit-boundaries and split-plan are read-only and never repair, split, Dream, Atlas, bind, or update activation. MCP Dream tick requires `maintenanceMode: true` to process work; otherwise it is recommendation-only.

## Required Documentation

- README explains the vision, architecture, limits, and one-line install command.
- README and skills document npm as the default install path: workspace-local `npm install cogmem@latest --save` for OpenClaw/Hermes projects, global npm only when the operator wants one shared CLI, and the one-line installer as compatibility.
- README and skills state that `cogmem init` is an interactive operator wizard and must not be scripted by an unattended agent; agents should use resolved `cogmem` commands, `cogmem doctor`, and `cogmem connect <agent>`.
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
- README and skills give the full post-import maintenance sequence: status, episode status, Dream status, bounded Dream tick, candidate listing, govern candidate, needs-confirmation listing, explicit review, and recall verification.
- README and skills explain that 3.6.4+ skips empty imported episode boundaries and legacy empty Dream jobs instead of letting them abort `dream tick`.
- README and skills explain the 3.7.4 agent operations protocol and MemoryFrame/Atlas V2 migration path: `memory plan` for next actions, default grouped `memory candidates --json`, `memory list --since/--until/--order`, historical-discussion recall intent, Atlas canonical cards, `matchedFacets`, `relatedButNotSelected`, `relaxationTrace`, Atlas evidence `sourceLocator`, cursor-based `memory bind`, and read-only episode boundary audit/split planning.
- README, `MEMORY_ATLAS.md`, and installed skills explain the multi-dimensional Atlas model: a canonical episode/raw event exists once, facet nodes connect through typed edges, query results intersect facets, and display/injection dedupes by `canonicalId`.
- `connect openclaw|hermes --json` documents structured `nextSteps`; `nextCommands` must contain only agent-safe, non-interactive commands and must not include `cogmem init`, `cogmem-init`, gateway restart, or Hermes reload.
- README and skills document `cogmem mcp` as the preferred MCP server command for new configs while preserving `cogmem-mcp` as a compatibility bin.
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
bun run verify:packed-migration
npm publish --dry-run --access public
```

The pack dry-run must include built public API files, CLI files, examples, docs, and `install.sh`. It must not include local databases or machine-specific files.

`npm publish --dry-run` runs `prepublishOnly` first, so it repeats typecheck, the full test suite, the build, the pack listing, and `verify:packed-migration` (about four minutes). To inspect only the packing path, add `--ignore-scripts`.

`build` compiles into `dist.next` and renames it over `dist` only after `tsc` exits 0. `dist` is tracked in git, so deleting it before compiling turned any interrupted build into 1314 deleted files; a killed `npm publish --dry-run` did exactly that mid-release.

## Upgrade Rehearsal

Run this against a copy of a released 3.7.3 database before tagging. It is the only check that exercises the upgrade path instead of a fresh install, and it catches a release that cannot open the database it just upgraded.

```bash
gunzip -c __tests__/fixtures/migrations/main-3.7.3-schema31.sqlite.gz > /tmp/schema31.db
cogmem migrate --db /tmp/schema31.db --yes --backup --json
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"checklist","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | cogmem mcp --db /tmp/schema31.db --profile core
```

The first command must exit 0 with `"pending": ["0032"]`, `"applied": ["0032"]`, `"currentVersion": "0032"`, and a `backupPath`. Afterwards the database holds 18 receipts (0015-0032): 0015-0031 keep their rows with a NULL checksum, 0032 carries `a49bc906…c5f1`, and `PRAGMA integrity_check` returns `ok`.

The second command is the one that matters. Starting the kernel again on the upgraded file must answer `initialize` with `serverInfo` 4.0.0 and `tools/list` with 8 tools under `core`. A release that validates every historical receipt fails here with `migration_checksum_unknown:0015`, after `migrate` has already reported success. Running `cogmem migrate` a second time also exercises the digest check, but it reports `"applied": []` and writes another backup even when nothing is pending, so prefer the kernel start for this step.

Measured on 4.0.0: `migrate` exit 0 with `applied ["0032"]` and a 1,458,512 B backup; second start exit 0 with `serverInfo` `cogmem-core` 4.0.0 and `tools/list` 8; 18 receipts, integrity `ok`.

After verification, create a GitHub Release from the matching version tag, for example `v4.0.0`. The release workflow publishes through npm Trusted Publishing when the release is published. It must not publish on tag push alone.

Emergency manual fallback:

```bash
bun run verify:packed-migration
npm publish --provenance --access public
```
