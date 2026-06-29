# Cogmem 3.6.1 Operations Reference for OpenClaw

Read this file when installing, upgrading, importing, repairing, or operating Cogmem. `SKILL.md` contains the decision rules; this file is the command reference.

## Command selection

| Need | Use |
|---|---|
| Verify installation or config | `cogmem doctor` |
| Refresh only the generated OpenClaw plugin | `cogmem doctor --fix --agent openclaw --plugin-only` |
| Diagnose OpenClaw hook/plugin failures | `cogmem openclaw diagnose` |
| Upgrade an existing database | `cogmem migrate` |
| Repair empty project scope from old imports | `cogmem repair project-scope` |
| Import OpenClaw files | `cogmem import-openclaw` |
| Import generic message JSONL | `cogmem episode import` |
| Answer one direct memory question | `cogmem memory recall` or `cogmem_recall` |
| See what memory exists or reconstruct history | Atlas `graph-*` commands/tools |
| Quote exact source | `cogmem memory show` |
| Inspect or resolve uncertain candidates | `memory candidates` then `memory review` |
| Promote ordinary candidates | `memory govern` |
| Inspect/process sealed episodes | `episode status`, `dream status`, `dream tick` |
| Correct episode boundaries | `episode split/merge/move-event/reclassify/requeue-dream` |
| Back up or restore | `snapshot export/import` |
| Release safety check | `brain-eval` |

## Install and connect

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent openclaw --scope project
cogmem doctor
cogmem connect openclaw --workspace . --auto --force --json
```

Restart the OpenClaw Gateway after plugin or config changes. `connect --auto` installs the direct OpenClaw hook bridge; OpenClaw does not need MCP for automatic recall, recording, or Atlas navigation.

## Upgrade and migrate

Preview first, then create a backup and apply every pending migration:

```bash
cogmem migrate --dry-run --json
cogmem migrate --yes --backup --json
cogmem doctor --fix --agent openclaw --workspace . --plugin-only --json
openclaw gateway restart
cogmem openclaw diagnose --workspace . --json
```

The second command upgrades 3.5.2 schema 24, an existing 3.6.0 schema-26 database, or a pre-release schema-25 test database to the 3.6.1 schema-27 state in one run. It preserves Raw Ledger evidence. Keep the returned `backupPath` until verification passes.

After upgrading the package/database, refresh OpenClaw's generated plugin files. `doctor --plugin-only` avoids opening the Cogmem kernel, so it can repair stale `extensions/cogmem-auto-memory/index.js` and `bridge.mjs` even when an old drainer has SQLite busy. Use `connect --auto --force` when intentionally reinstalling the full integration and patching OpenClaw config:

```bash
cogmem connect openclaw --workspace . --auto --force --json
```

Use `cogmem openclaw diagnose --workspace . --json` when automatic memory blocks are missing. Check:

- `plugin.current=false`: generated files are stale; run plugin-only fix and restart gateway.
- no `audit.lastBeforePromptBuild`: plugin is not loaded or the hook did not fire.
- `audit.lastBeforePromptBuild.action=error`: bridge or DB failure; inspect `reason`, `bridgeCommand`, and `dbLocked`.
- `action=inject` but no visible block: inspect `returnedInjectionShape`. Plugin 0.6.2 returns `prependContext`, `context`, and `promptPrefix`; if OpenClaw still ignores all three, the host hook contract changed and the OpenClaw plugin API must be checked before blaming recall.

Plugin 0.6.2 queue behavior:

- `agent_end` only appends durable JSONL jobs, then starts at most one drainer through queue/spawn locks.
- `drain-remember-queue` acquires the queue lock before opening Cogmem or SQLite. A second drainer exits without opening the DB.
- Stale `.cogmem/queue/openclaw-remember.jsonl.lock` and `.spawn.lock` directories older than `rememberDrainTimeoutMs` are recovered automatically and carry `owner.json` metadata for diagnosis.
- `rememberDrainBatchSize` defaults to `20`, so a busy workspace drains bounded batches and releases DB handles quickly. Lower it temporarily if OpenClaw shares a slow SQLite disk.
- Failed jobs retry up to `rememberMaxAttempts`; exhausted jobs move to `.dead.jsonl`.

If the queue is not draining, diagnose before deleting files:

```bash
cogmem openclaw diagnose --workspace . --json
ls -la .cogmem/queue/
cat .cogmem/queue/openclaw-remember.jsonl.lock/owner.json 2>/dev/null || true
cat .cogmem/queue/openclaw-remember.jsonl.spawn.lock/owner.json 2>/dev/null || true
```

If upgraded records exist under empty project scope, repair only after preview:

```bash
cogmem repair project-scope --from "" --to openclaw --dry-run --json
cogmem repair project-scope --from "" --to openclaw --apply --json
```

The repair refuses an empty-to-OpenClaw merge when another non-OpenClaw project is present.

## Import

Preview OpenClaw discovery, then import idempotently:

```bash
cogmem import-openclaw --workspace . --project openclaw --dry-run --json
cogmem import-openclaw --workspace . --project openclaw --json
```

Pass explicit sources when discovery is not enough:

```bash
cogmem import-openclaw --workspace . --project openclaw --memory ./MEMORY.md --session ./session.md --json
cogmem import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md --session ./one.jsonl --session ./two.jsonl --json
```

For large generic JSONL, use checkpoints and bounded error handling:

```bash
cogmem episode import --project openclaw --session import-2026 --source-agent openclaw --format jsonl --file ./history.jsonl --chunk-size 500 --checkpoint-file ./history.checkpoint.json --skip-errors --max-errors 20 --json
cogmem episode import --project openclaw --session import-2026 --source-agent openclaw --format jsonl --file ./history.jsonl --resume --checkpoint-file ./history.checkpoint.json --json
```

Use `--start-line`, `--end-line`, or `--max-lines` to split controlled runs. Preserve stable external message IDs across retries.

## Read-only inspection and JSON

```bash
cogmem memory status --project openclaw --json
cogmem memory candidates --project openclaw --status needs_confirmation --json
cogmem episode status --project openclaw --json
cogmem dream status --project openclaw --json
```

All documented JSON commands emit `schemaVersion: "cogmem.cli.v1"`. Object payload fields are top-level; arrays use `items`. Queue counters `candidate`, `promoted`, `needs_confirmation`, and `beliefs` are top-level. `memory status` explains whether recall remains available when `vectors` is zero.

`memory status` and `memory candidates` use a lightweight read-only SQLite connection. They should remain usable while the OpenClaw plugin has a long-lived connection.

## Recall and source drill-down

Use recall for a direct factual question:

```bash
cogmem memory recall --query "<question>" --project openclaw --agent openclaw --json
cogmem explain-recall --query "<question>" --project openclaw --agent openclaw --json
```

Follow returned evidence, never a summary alone:

```bash
cogmem memory show --event <event-id> --before 2 --after 2 --json
```

## Memory Atlas

Atlas combines whichever facets the question supplies, like table filters. Supported constraints include project, time range, topic, entity/target, memory kind, action, and ordinary text cues. Do not require a fixed entity + time + action tuple.

```bash
cogmem memory graph --project openclaw --json
cogmem memory graph-search --project openclaw --query "Hermes" --json
cogmem memory graph-explore --project openclaw --query "2025 年 Hermes 的决策" --now 1782057600000 --evidence-limit 2 --json
cogmem memory graph-node --project openclaw --id <node-id> --include-evidence --evidence-limit 4 --json
cogmem memory graph-neighbors --project openclaw --id <node-id> --hops 2 --json
cogmem memory graph-path --project openclaw --from <node-id> --to <node-id> --json
cogmem memory graph-timeline --project openclaw --query "去年与 Hermes 有关的修复" --now 1782057600000 --evidence-limit 4 --json
```

Graph commands default to stale-safe diagnostics. If refresh hits `SQLITE_BUSY`, JSON includes `atlasFresh: false` and `refreshError` while returning the existing projection. Use:

```bash
cogmem memory graph-explore --project openclaw --query "OpenClaw 去年做过什么" --no-refresh --json
cogmem memory graph-explore --project openclaw --query "OpenClaw 去年做过什么" --refresh --json
```

Use `--no-refresh` during lock incidents and `--refresh` when the operator wants rebuild-or-fail behavior.

Graph reads are pure: overview/search/explore do not brighten what they display. In MCP, call `cogmem_graph_touch` only after the agent actually selects or uses nodes. Activation changes visibility, never evidence or truth. Exact scoped facets may revive cold nodes.

Every evidence result distinguishes `evidenceTotal` from `evidenceReturned` and includes an event ID plus a `memory show` drill-down command.

## Candidate governance and review

Ordinary candidates:

```bash
cogmem memory candidates --project openclaw --status candidate --json
cogmem memory govern --project openclaw --limit 100 --json
```

`govern` promotes only `candidate`. With `--status needs_confirmation`, it lists the queue and directs the operator to review.

Review uncertain candidates with an audited actor and reason:

```bash
cogmem memory candidates --project openclaw --status needs_confirmation --json
cogmem memory review --project openclaw --id <candidate-id> --action approve --actor <operator> --reason "confirmed by user" --confirmation-event <distinct-user-event-id> --json
cogmem memory review --project openclaw --id <candidate-id> --action reject --actor <operator> --reason "unsupported claim" --json
cogmem memory review --project openclaw --id <candidate-id> --action defer --actor <operator> --reason "wait for evidence" --review-after <epoch-ms> --json
cogmem memory review --project openclaw --id <candidate-id> --action supersede --actor <operator> --reason "replaced" --replacement <candidate-id> --json
cogmem memory review --project openclaw --id <correction-id> --action relink --actor <operator> --reason "bind correction target" --target-belief <belief-id> --confirmation-event <distinct-user-event-id> --json
```

Approve/relink require distinct same-project user evidence. Correction relink also requires an active same-project belief. Never patch candidate or belief rows directly.
Defer keeps the candidate in `needs_confirmation` and records `reviewAfter` plus a status reason for the next operator pass.

## Episode and Dream maintenance

```bash
cogmem episode list --project openclaw --json
cogmem episode get --episode <episode-id> --json
cogmem episode seal --episode <episode-id> --mode manual --reason "operator closure" --json
cogmem dream status --project openclaw --json
cogmem dream tick --project openclaw --mode auto --max-episodes 20 --json
cogmem dream retry --project openclaw --json
cogmem memory tick --project openclaw --json
```

Dream and governance are maintenance commands. Do not overlap cron jobs. Schedule the next run after the previous process exits, and size the interval from returned `durationMs` and backlog.

Repair through audited surgery:

```bash
cogmem episode repair --project openclaw --limit 100 --json
cogmem episode split --project openclaw --episode <episode-id> --events <event-id,event-id> --json
cogmem episode merge --project openclaw --source-episode <id> --target-episode <id> --json
cogmem episode move-event --project openclaw --event <event-id> --target-episode <id> --json
cogmem episode reclassify --project openclaw --episode <id> --episode-type decision --topic-path cogmem/runtime --importance 0.9 --json
cogmem episode requeue-dream --project openclaw --episode <id> --mode deep --json
```

## Backup, storage, and evaluation

```bash
cogmem snapshot export --out ./cogmem.snapshot
cogmem snapshot import --snap ./cogmem.snapshot --dry-run
cogmem compact --dry-run --json
cogmem compact --apply --json
cogmem re-embed status --json
cogmem brain-eval --input ./samples.json --json
cogmem strategy plan --query "<question>" --project openclaw --json
cogmem strategy outcomes --project openclaw --limit 100 --json
```

Snapshot before destructive maintenance. `prospective` only manages candidate state and never executes work:

```bash
cogmem prospective list --project openclaw --json
cogmem prospective due --project openclaw --json
cogmem prospective confirm --project openclaw --id <candidate-id> --evidence <user-event-id> --json
```

## MCP and direct-plugin choice

- OpenClaw automatic hooks use the direct bridge installed by `connect --auto`.
- Use MCP tools when an agent host supports MCP and needs explicit graph/review operations.
- Broad inventory/history: `cogmem_graph_explore`.
- Known node: `cogmem_graph_search`, then `cogmem_graph_node`.
- Relations: `cogmem_graph_neighbors` or `cogmem_graph_path`.
- Ordered history: `cogmem_graph_timeline`.
- Direct fact: `cogmem_recall`.
- Candidate review: `cogmem_candidate_review`.
- Record selected Atlas nodes: `cogmem_graph_touch`.

If exact evidence cannot be reached, do not claim the Atlas summary is the source of truth.
