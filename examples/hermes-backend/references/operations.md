# Cogmem 3.6.2 Operations Reference for Hermes

Read this file when installing, upgrading, importing, repairing, or operating Cogmem. `SKILL.md` contains the decision rules; this file records the operational commands.

## Command selection

| Need | Use |
|---|---|
| Verify installation or config | `cogmem doctor` |
| Upgrade package and migrate DB | `cogmem update --yes` |
| Upgrade an existing database | `cogmem migrate` |
| Import Hermes state/profile/sessions | `cogmem import-hermes` |
| Import generic message JSONL | `cogmem episode import` |
| Answer one direct memory question | `cogmem_recall` or `cogmem memory recall` |
| See what memory exists or reconstruct history | Atlas `cogmem_graph_*` tools |
| Quote exact source | `cogmem memory show` |
| Resolve uncertain candidates | `cogmem_candidate_review` or `memory review` |
| Promote ordinary candidates | `memory govern` |
| Correct episode boundaries | `cogmem_episode_repair` or episode repair CLI |
| Back up/restore | `snapshot export/import` |

## Install, connect, and reload

```bash
COGMEM_SKIP_INIT=1 curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash
cogmem init --yes --agent hermes
cogmem doctor
cogmem connect hermes --workspace . --auto --force --json
```

Then run `/reload-mcp` inside Hermes. `connect --auto` installs this skill bundle and updates the Hermes MCP allow-list; it does not claim a native `memory.provider` integration.

## Upgrade and migrate

For normal upgrades, use one command:

```bash
cogmem update --yes
```

`cogmem update --yes` installs `cogmem@latest` from npm, then runs post-install work through the newly installed local CLI. With a valid config it runs `cogmem migrate --yes --backup --config <config>` and reports that the Hermes MCP server or agent host must be reloaded.

Preview the package and migration plan without writing:

```bash
cogmem update --dry-run --json
```

```bash
cogmem migrate --dry-run --json
cogmem migrate --yes --backup --json
cogmem doctor
cogmem connect hermes --workspace . --auto --force --json
```

The backed-up command upgrades 3.5.2 schema 24, an existing 3.6.0 schema-26 database, or a pre-release schema-25 test database to the 3.6.2 schema-27 state in one run and preserves Raw Ledger evidence. Reload MCP after reconnecting.

## Import Hermes memory

Preview, then import idempotently:

```bash
cogmem import-hermes --workspace . --project hermes --dry-run --json
cogmem import-hermes --workspace . --project hermes --json
```

Explicit source examples:

```bash
cogmem import-hermes --workspace . --project hermes --state-db ./state.db --dry-run --json
cogmem import-hermes --workspace . --project hermes --state-db ./state.db --json
cogmem import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions --json
cogmem import-hermes --workspace . --project hermes --session ./one.md --session ./two.md --json
```

Normalize JSONL exports with `messages[]` before import:

```bash
cogmem normalize-transcript --input ./hermes.jsonl --output ./hermes.normalized.md --family jsonl --dry-run --json
cogmem normalize-transcript --input ./hermes.jsonl --output ./hermes.normalized.md --family jsonl
cogmem import-hermes --workspace . --project hermes --session ./hermes.normalized.md --json
```

For large generic histories, use the streaming importer:

```bash
cogmem episode import --project hermes --session import-2026 --source-agent hermes --format jsonl --file ./history.jsonl --chunk-size 500 --checkpoint-file ./history.checkpoint.json --skip-errors --max-errors 20 --json
cogmem episode import --project hermes --session import-2026 --source-agent hermes --format jsonl --file ./history.jsonl --resume --checkpoint-file ./history.checkpoint.json --json
```

Use stable `externalMessageId` values for MCP append/import. If an MCP batch warns `auto_identity_not_safe_across_split_batches`, assign IDs before splitting or retrying.

## Inspect, recall, and drill down

```bash
cogmem memory status --project hermes --json
cogmem memory candidates --project hermes --status needs_confirmation --json
cogmem episode status --project hermes --json
cogmem dream status --project hermes --json
cogmem memory recall --query "<question>" --project hermes --agent hermes --json
cogmem explain-recall --query "<question>" --project hermes --agent hermes --json
cogmem memory show --event <event-id> --before 2 --after 2 --json
```

JSON uses `cogmem.cli.v1`: object fields are top-level, arrays use `items`, and queue counters remain top-level. `vectors: 0` is not a recall failure; inspect `vectorState`.

Read-only status/candidates use a lightweight SQLite path and should not require stopping the MCP server.

## Memory Atlas as composable filters

Atlas uses any available project, time, topic, entity/target, memory-kind, action, and text facets together. It does not require an entity + time + operation tuple.

```bash
cogmem memory graph --project hermes --json
cogmem memory graph-search --project hermes --query "Hermes" --json
cogmem memory graph-explore --project hermes --query "2025 年 Hermes 的决策" --now 1782057600000 --evidence-limit 2 --json
cogmem memory graph-node --project hermes --id <node-id> --include-evidence --evidence-limit 4 --json
cogmem memory graph-neighbors --project hermes --id <node-id> --hops 2 --json
cogmem memory graph-path --project hermes --from <node-id> --to <node-id> --json
cogmem memory graph-timeline --project hermes --query "去年与 Hermes 有关的修复" --now 1782057600000 --evidence-limit 4 --json
```

Use MCP by question shape:

- Broad inventory/history: `cogmem_graph_explore`.
- Known concept: `cogmem_graph_search`, then `cogmem_graph_node`.
- Nearby/connecting relations: `cogmem_graph_neighbors` or `cogmem_graph_path`.
- Ordered reconstruction: `cogmem_graph_timeline`.
- Direct fact: `cogmem_recall`.
- Exact source: follow `evidenceEventIds` with `memory show`.

Graph reads are pure and declared read-only/idempotent. Call `cogmem_graph_touch` only after using selected nodes. Overview display alone must not change future ranking. `evidenceTotal` is all known evidence; `evidenceReturned` is the bounded payload.

## Candidate governance and review

```bash
cogmem memory candidates --project hermes --status candidate --json
cogmem memory govern --project hermes --limit 100 --json
cogmem memory candidates --project hermes --status needs_confirmation --json
```

`govern` promotes only `candidate`. With `--status needs_confirmation`, it lists the queue; use an audited review to close each item:

```bash
cogmem memory review --project hermes --id <candidate-id> --action approve --actor <operator> --reason "confirmed by user" --confirmation-event <distinct-user-event-id> --json
cogmem memory review --project hermes --id <candidate-id> --action reject --actor <operator> --reason "unsupported claim" --json
cogmem memory review --project hermes --id <candidate-id> --action defer --actor <operator> --reason "wait for evidence" --review-after <epoch-ms> --json
cogmem memory review --project hermes --id <candidate-id> --action supersede --actor <operator> --reason "replaced" --replacement <candidate-id> --json
cogmem memory review --project hermes --id <correction-id> --action relink --actor <operator> --reason "bind correction target" --target-belief <belief-id> --confirmation-event <distinct-user-event-id> --json
```

Hermes may use `cogmem_candidate_review` with the same fields. Approval/relink require distinct same-project user evidence; relink also requires an active same-project belief. Defer keeps the candidate in `needs_confirmation` and records `reviewAfter` plus a status reason.

## Episode, Dream, and repair

```bash
cogmem episode list --project hermes --json
cogmem episode get --episode <episode-id> --json
cogmem episode seal --episode <episode-id> --mode manual --reason "operator closure" --json
cogmem dream status --project hermes --json
cogmem dream tick --project hermes --mode auto --max-episodes 20 --json
cogmem dream retry --project hermes --json
cogmem memory tick --project hermes --json
```

Do not overlap maintenance jobs. Wait for completion, inspect `durationMs`, backlog, and failure details, then schedule the next run.

```bash
cogmem episode repair --project hermes --limit 100 --json
cogmem episode split --project hermes --episode <episode-id> --events <event-id,event-id> --json
cogmem episode merge --project hermes --source-episode <id> --target-episode <id> --json
cogmem episode move-event --project hermes --event <event-id> --target-episode <id> --json
cogmem episode reclassify --project hermes --episode <id> --episode-type decision --topic-path cogmem/runtime --importance 0.9 --json
cogmem episode requeue-dream --project hermes --episode <id> --mode deep --json
```

Use `cogmem_episode_repair` from Hermes when available. Never edit SQLite rows directly.

## Backup, storage, prospective state, and evaluation

```bash
cogmem snapshot export --out ./cogmem.snapshot
cogmem snapshot import --snap ./cogmem.snapshot --dry-run
cogmem compact --dry-run --json
cogmem compact --apply --json
cogmem re-embed status --json
cogmem brain-eval --input ./samples.json --json
cogmem strategy plan --query "<question>" --project hermes --json
cogmem strategy outcomes --project hermes --limit 100 --json
cogmem prospective list --project hermes --json
cogmem prospective due --project hermes --json
cogmem prospective confirm --project hermes --id <candidate-id> --evidence <user-event-id> --json
```

Prospective candidates and strategy plans never authorize action. Snapshot before destructive maintenance.

## Ingestion warnings

- `no_recent_episode_ingestion_detected`: append/import recent Hermes messages before claiming memory is current.
- `semantic_memory_may_lag`: inspect open/soft-sealed episodes, Dream backlog, and terminal failures.
- MCP episode import is bounded; use CLI checkpoints for large history.
- Raw append/import never runs Dream. Background maintenance must call Dream explicitly.
