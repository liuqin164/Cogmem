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
- README and skills explain `cogmem update --yes`, npm install resolution, automatic OpenClaw plugin-only refresh when configured, and that 4.0 refuses a pre-4.0 database instead of upgrading it, without changing or backing up the file.
- README and skills explain that entity aliases are evidence-backed, project-scoped, reversible, and stricter for person entities.
- README and skills explain Belief Graph ownership, user-evidence requirements, reinforcement, conflict review, and supersession history.
- README and skills explain Temporal Memory validity windows, historical lookup, correction reasons, and current-state stale suppression.
- README and skills explain Context Cortex intent suppression, 25% default/30% maximum budget, source drill-down, and activation receipts.
- README and skills explain that Prospective Memory is confirmed-only state with no task execution capability, and how to use BrainEval as a release gate.
- README and skills explain Strategy Cortex templates, no-instruction-authority lifecycle, one-retry replanning, strategy-conditioned retrieval, offline-only rollout comparison, and read-only MemoryUseJudge telemetry.
- README and skills explain Raw Ledger-first episode assembly, soft/hard sealing, explicit conditional Dream ticks, raw-event evidence grounding, repair/retry, and hookless Hermes MCP/import usage.
- README and skills give the full post-import maintenance sequence: status, episode status, Dream status, bounded Dream tick, candidate listing, govern candidate, needs-confirmation listing, explicit review, and recall verification.
- README and skills explain that 3.6.4+ skips empty imported episode boundaries and legacy empty Dream jobs instead of letting them abort `dream tick`.
- README and skills explain the 3.7.4 agent operations protocol and MemoryFrame/Atlas V2 projection path: `memory plan` for next actions, default grouped `memory candidates --json`, `memory list --since/--until/--order`, historical-discussion recall intent, Atlas canonical cards, `matchedFacets`, `relatedButNotSelected`, `relaxationTrace`, Atlas evidence `sourceLocator`, cursor-based `memory bind`, and read-only episode boundary audit/split planning.
- README, `MEMORY_ATLAS.md`, and installed skills explain the multi-dimensional Atlas model: a canonical episode/raw event exists once, facet nodes connect through typed edges, query results intersect facets, and display/injection dedupes by `canonicalId`.
- `connect openclaw|hermes --json` documents structured `nextSteps`; `nextCommands` must contain only agent-safe, non-interactive commands and must not include `cogmem init`, `cogmem-init`, gateway restart, or Hermes reload.
- README and skills document `cogmem mcp` as the preferred MCP server command for new configs while preserving `cogmem-mcp` as a compatibility bin.
- README and skills explain CPU foreground versus hybrid background classification, contextual short replies, registry-aware topic boundaries, safe reopen, semantic-summary non-evidence status, per-job Dream modes/failures, and stable import identity.
- README and skills explain user-shaped topic operations, user-explicit versus model-candidate authority, alias collision review, operation rollback, and project isolation.
- README, `MEMORY_ATLAS.md`, and skills distinguish the system anatomy map from the content Atlas; explain graph overview/search/explore/node/neighbors/path/timeline, generic multi-facet cold-memory resurrection, activation visibility, source drill-down, and project isolation.
- README documents `cogmem.cli.v1`: object payloads are top-level, array payloads use `items`, and queue counters expose top-level compatibility aliases.
- README documents that 4.0 creates a fresh final schema on a new database and refuses a pre-4.0 database without modifying, backing up, or partially rewriting it.
- README and OpenClaw skill document plugin-only repair, plugin/audit diagnose, stale graph reads, and conservative empty-project project-scope repair for rows imported under an empty project scope.
- README and skills explain episode surgery, closure recomputation, stale-candidate invalidation, cross-reference/audit preservation, and sealed-only Dream requeue.
- README and Hermes skill explain per-message import checkpoints, stable `externalMessageId` requirements across split batches, source-agent validation, CLI range/error controls, and hookless recall freshness warnings.
- OpenClaw installation includes `SKILL.md` plus the complete `references/operations.md` command handbook covering install, update, import, review, Atlas, repair, backup, and maintenance.
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

Gates added in this release, all inside `bun test`:

- `mcp-instructions-profile` — each profile's `instructions` only name tools that profile exposes, and `core` keeps the recall-before-answering contract.
- `identity-docs` — the documented identity trust boundary matches the shipped rule.
- `drilldown-project-isolation` — a project-bound `memory show` cannot read another project's event.
- `memory-atlas-cold-resurrection` — decay never makes a memory unreachable (ADR 0001).
- `belief-history-cli` — a superseded belief reports the version that replaced it.

The pack dry-run must include built public API files, CLI files, examples, docs, and `install.sh`. It must not include local databases or machine-specific files.

`npm publish --dry-run` runs `prepublishOnly` first, so it repeats typecheck, the full test suite, the build, and the pack listing. To inspect only the packing path, add `--ignore-scripts`.

`build` compiles into `dist.next` and renames it over `dist` only after `tsc` exits 0. `dist` is tracked in git, so deleting it before compiling turned any interrupted build into 1314 deleted files; a killed `npm publish --dry-run` did exactly that mid-release.

## Old-Database Refusal Rehearsal

4.0 has no upgrade path, so the release rehearsal is the refusal itself. Build a database shaped like a Cogmem 3.x file, then confirm 4.0 refuses it and leaves it byte-for-byte unchanged.

```bash
bun -e '
import { Database } from "bun:sqlite";
const db = new Database("/tmp/schema31.db");
db.exec(`
  CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL);
`);
db.prepare("INSERT INTO _meta (key, value) VALUES (?, ?)").run("schema_version", "31");
for (let version = 15; version <= 31; version += 1) {
  db.prepare("INSERT INTO _schema_migrations (version, description, applied_at) VALUES (?, ?, ?)")
    .run(String(version).padStart(4, "0"), "legacy", "2026-01-01T00:00:00.000Z");
}
db.close();
'
sha256sum /tmp/schema31.db > /tmp/schema31.before.sha256
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"checklist","version":"1"}}}' \
  | cogmem mcp --db /tmp/schema31.db --profile core
sha256sum -c /tmp/schema31.before.sha256
```

The kernel start must fail with a non-zero exit and a message beginning `no_upgrade_path:`, saying that this is a Cogmem 3.x database, that 4.0 does not upgrade an old database, and that the file has not been changed. `sha256sum -c` must then report `OK`: no backup is written beside the file and no partial rewrite is left behind.

A fresh database is the supported path and must still start:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"checklist","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | cogmem mcp --db /tmp/fresh-4.0.db --profile core
```

The fresh file must answer `initialize` with `serverInfo` 4.0.0 and `tools/list` with the tools the `core` profile exposes. There is nothing left to rehearse on the old file beyond the refusal.

After verification, create a GitHub Release from the matching version tag, for example `v4.0.0`. The release workflow publishes through npm Trusted Publishing when the release is published. It must not publish on tag push alone.

Emergency manual fallback:

```bash
npm publish --provenance --access public
```
