# Cogmem 3.7.2 Operations Reference for Hermes

Read this file when installing, upgrading, importing, repairing, or operating Cogmem. `SKILL.md` contains the decision rules; this file records the operational commands.

## Command selection

| Need | Use |
|---|---|
| Verify installation or config | `cogmem doctor` |
| Update package and refresh host wiring | `cogmem update --yes` |
| Import Hermes state/profile/sessions | `cogmem import-hermes` |
| Import generic message JSONL | `cogmem episode import` |
| Decide the next safe agent operation | `cogmem memory plan` |
| Answer one direct memory question | `cogmem_recall` or `cogmem memory recall` |
| See what memory exists or reconstruct history | Atlas `cogmem_graph_*` tools |
| Quote exact source | `cogmem memory show` |
| Audit ledger sequence ranges | `cogmem memory list --since/--until/--order` |
| Resolve uncertain candidates | `cogmem_candidate_review` or `memory review` |
| Promote ordinary candidates | `memory govern` |
| Correct episode boundaries | `cogmem_episode_repair` or episode repair CLI |
| Back up/restore | `snapshot export/import` |

## Install, connect, and reload

Recommended workspace-local npm install:

```bash
npm install cogmem@latest --save
COGMEM="./node_modules/.bin/cogmem"
"$COGMEM" doctor
"$COGMEM" connect hermes --workspace . --auto --force --json
```

Use this resolver in agent-run scripts:

```bash
if [ -x ./node_modules/.bin/cogmem ]; then
  COGMEM="./node_modules/.bin/cogmem"
elif command -v cogmem >/dev/null 2>&1; then
  COGMEM="cogmem"
else
  npm install cogmem@latest --save
  COGMEM="./node_modules/.bin/cogmem"
fi
```

Use `npm install -g cogmem@latest` only when the operator wants a global CLI. The one-line installer is still supported with `COGMEM_SKIP_INIT=1`, but do not run `cogmem init` unattended. `cogmem init` is an interactive wizard; run it only with an operator present:

```bash
"$COGMEM" init --agent hermes --scope project
```

Then run `/reload-mcp` inside Hermes. `connect --auto` installs this skill bundle and updates the Hermes MCP allow-list; it does not claim a native `memory.provider` integration. New configs start the bridge as `cogmem mcp`; `cogmem-mcp` remains a compatibility bin for older host configs.

## Update and database policy

For normal package updates, use one command:

```bash
cogmem update --yes
```

`cogmem update --yes` installs `cogmem@latest` from npm, then runs post-install work through the newly installed CLI. For npm global installs it uses `npm install -g cogmem@latest`; for the one-line installer it updates `~/.cogmem/pkg`; for a workspace dependency it updates that workspace. It refreshes the Hermes MCP wiring when the integration is configured and reports that the Hermes MCP server or agent host must be reloaded. It runs no migration step.

Preview the package and wiring plan without writing:

```bash
cogmem update --dry-run --json
```

Cogmem 4.0 does not migrate or upgrade a pre-4.0 database. Opening a Cogmem 3.x database is refused with an error code beginning `no_upgrade_path:`, and the file is left exactly as it was — no backup, no partial rewrite. Keep that file for Cogmem 3.x, or point 4.0 at a new database path (a new `db_path` in the config, or `--db` for one command) and move history across from the 3.x install. Creating a new database is the supported path.

Re-check the install and refresh the host wiring after an update:

```bash
cogmem doctor
cogmem connect hermes --workspace . --auto --force --json
```

Reload MCP after reconnecting.

## Import Hermes memory

Preview, then import idempotently:

```bash
# Importing defaults to this workspace's own scope: the project the installed
# integration writes to and reads. Read it from: cogmem connect hermes --auto --json
# (field: integrationProject). Pass --project only to import somewhere else — a
# literal --project hermes writes into a scope the MCP server is not bound to.
cogmem import-hermes --workspace . --dry-run --json
cogmem import-hermes --workspace . --json
```

Explicit source examples:

```bash
cogmem import-hermes --workspace . --state-db ./state.db --dry-run --json
cogmem import-hermes --workspace . --state-db ./state.db --json
cogmem import-hermes --workspace . --profile ./memory/profile.md --sessions ./memory/sessions --json
cogmem import-hermes --workspace . --session ./one.md --session ./two.md --json
```

Normalize JSONL exports with `messages[]` before import:

```bash
cogmem normalize-transcript --input ./hermes.jsonl --output ./hermes.normalized.md --family jsonl --dry-run --json
cogmem normalize-transcript --input ./hermes.jsonl --output ./hermes.normalized.md --family jsonl
cogmem import-hermes --workspace . --session ./hermes.normalized.md --json
```

For large generic histories, use the streaming importer:

```bash
cogmem episode import --project 'hermes-<workspace-hash>' --session import-2026 --source-agent hermes --format jsonl --file ./history.jsonl --chunk-size 500 --checkpoint-file ./history.checkpoint.json --skip-errors --max-errors 20 --json
cogmem episode import --project 'hermes-<workspace-hash>' --session import-2026 --source-agent hermes --format jsonl --file ./history.jsonl --resume --checkpoint-file ./history.checkpoint.json --json
```

Use stable `externalMessageId` values for MCP append/import. If an MCP batch warns `auto_identity_not_safe_across_split_batches`, assign IDs before splitting or retrying.

After import, verify semantic maintenance in this exact order:

```bash
cogmem memory plan --project 'hermes-<workspace-hash>' --json
cogmem memory status --project 'hermes-<workspace-hash>' --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --json
cogmem episode status --project 'hermes-<workspace-hash>' --json
cogmem dream status --project 'hermes-<workspace-hash>' --json
cogmem dream tick --project 'hermes-<workspace-hash>' --mode auto --max-episodes 20 --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --status candidate --json
cogmem memory govern --project 'hermes-<workspace-hash>' --limit 100 --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --status needs_confirmation --json
cogmem memory review --project 'hermes-<workspace-hash>' --id <candidate-id> --action approve --actor <operator> --reason "confirmed by user" --confirmation-event <distinct-user-event-id> --json
cogmem memory recall --query "<verification question>" --project 'hermes-<workspace-hash>' --agent hermes --json
```

`memory plan` is the first agent-safe health and next-action command. It reports queue state, blocking and non-blocking actions, Dream backlog hints, vector fallback state, and safe commands. Only run `dream_tick` when it appears in `nextActions`; if `nonBlocking` contains `raw_dream_ledger_lag` with `resolvableByDreamTick:false`, inspect raw sources or episode/import boundaries instead of retrying `dream tick`. Default `memory candidates --json` groups ordinary candidates, `needs_confirmation`, and deferred review entries; use `--status` only for one explicit queue. `needs_confirmation` is not a Dream backlog. `memory govern` does not approve it. Use `memory review` with explicit evidence. Cogmem skips import batch sealing for empty episode boundaries and marks legacy empty Dream jobs as skipped so one bad imported episode cannot block the queue. If `episode status` reports `episode_empty_*`, inspect the episode and repair boundaries with the audited episode repair commands.

## Inspect, recall, and drill down

```bash
cogmem memory plan --project 'hermes-<workspace-hash>' --json
cogmem memory status --project 'hermes-<workspace-hash>' --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --status needs_confirmation --json
cogmem episode status --project 'hermes-<workspace-hash>' --json
cogmem dream status --project 'hermes-<workspace-hash>' --json
cogmem memory recall --query "<question>" --project 'hermes-<workspace-hash>' --agent hermes --json
cogmem memory recall --query "<past discussion question>" --intent historical_discussion --project 'hermes-<workspace-hash>' --agent hermes --json
cogmem explain-recall --query "<question>" --project 'hermes-<workspace-hash>' --agent hermes --json
cogmem memory show --event <event-id> --before 2 --after 2 --json
cogmem memory list --project 'hermes-<workspace-hash>' --since <globalSeq> --order asc --json
```

JSON uses `cogmem.cli.v1`: object fields are top-level, arrays use `items`, and queue counters remain top-level. `vectors: 0` is not a recall failure; inspect `vectorState`.

Use `historical_discussion` for “did we discuss this before?”, “几个月前是不是聊过…”, “记忆黑盒”, and missing MCP memory cases. Use `action_history` for “what did I ask you to do to <entity>?”, “启动 <tool>”, or “对 <entity> 做过什么操作”; the entity is the project/tool/person/service named in memory, not necessarily Hermes. Raw list rows include `sourceLocator`; run the locator before quoting exact words or saying the event cannot be found. Read-only plan/status/candidates use a lightweight SQLite path and should not require stopping the MCP server.

## Memory Atlas as composable filters

Atlas uses any available project, day/month/year, topic, issue, entity/target, session/thread, memory-kind, action-kind, and text facets together. Unicode letter/number entity cues are supported, but Atlas does not automatically prove aliases or merge identities. It does not require an entity + time + operation tuple. A canonical episode appears once even if it is reached through several facets.

```bash
cogmem memory graph --project 'hermes-<workspace-hash>' --json
cogmem memory graph-search --project 'hermes-<workspace-hash>' --query "<实体或工具名>" --json
cogmem memory graph-explore --project 'hermes-<workspace-hash>' --query "2025 年 <实体或工具名> 的决策" --now 1782057600000 --evidence-limit 2 --json
cogmem memory graph-explore --project 'hermes-<workspace-hash>' --query "6月6号关于记忆黑盒聊过什么" --json
cogmem memory graph-explore --project 'hermes-<workspace-hash>' --query "记忆黑盒后来有没有继续讨论" --json
cogmem memory graph-node --project 'hermes-<workspace-hash>' --id <node-id> --include-evidence --evidence-limit 4 --json
cogmem memory graph-neighbors --project 'hermes-<workspace-hash>' --id <node-id> --hops 2 --json
cogmem memory graph-path --project 'hermes-<workspace-hash>' --from <node-id> --to <node-id> --json
cogmem memory graph-timeline --project 'hermes-<workspace-hash>' --query "去年与 <实体或工具名> 有关的修复" --now 1782057600000 --evidence-limit 4 --json
cogmem memory graph-timeline --project 'hermes-<workspace-hash>' --query "对 <实体或工具名> 做过什么操作" --include-evidence --json
```

Use MCP by question shape:

- Broad inventory/history: `cogmem_graph_explore`.
- Known concept: `cogmem_graph_search`, then `cogmem_graph_node`.
- Nearby/connecting relations: `cogmem_graph_neighbors` or `cogmem_graph_path`.
- Ordered reconstruction: `cogmem_graph_timeline`.
- Direct fact: `cogmem_recall`.
- Exact source: follow `evidenceEventIds` with `memory show`.

Graph reads are pure and declared read-only/idempotent. Call `cogmem_graph_touch` only after using selected nodes. Overview display alone must not change future ranking. Search/explore may return `cards[]` for canonical episodes. Use `cards[].displayTitle` for UI/readability, `oneLineSummary` as a hint, `matchedFacets` and `matchedPaths` to explain why it matched, and `canonicalId` to dedupe. `relatedButNotSelected` is context only; do not substitute it as the answer. If `relaxationTrace` exists, say the match was relaxed; supported relaxations are day → month → year and issue → parent topic. `evidenceTotal` is all known evidence; `evidenceReturned` is the bounded payload. Search/explore evidence includes `sourceLocator.command` and `sourceLocator.contextCommand`; use those locators before treating an Atlas summary as evidence.

## Candidate governance and review

```bash
cogmem memory candidates --project 'hermes-<workspace-hash>' --status candidate --json
cogmem memory govern --project 'hermes-<workspace-hash>' --limit 100 --json
cogmem memory candidates --project 'hermes-<workspace-hash>' --status needs_confirmation --json
```

`govern` promotes only `candidate`. With `--status needs_confirmation`, it lists the queue; use an audited review to close each item:

```bash
cogmem memory review --project 'hermes-<workspace-hash>' --id <candidate-id> --action approve --actor <operator> --reason "confirmed by user" --confirmation-event <distinct-user-event-id> --json
cogmem memory review --project 'hermes-<workspace-hash>' --id <candidate-id> --action reject --actor <operator> --reason "unsupported claim" --json
cogmem memory review --project 'hermes-<workspace-hash>' --id <candidate-id> --action defer --actor <operator> --reason "wait for evidence" --review-after <epoch-ms> --json
cogmem memory review --project 'hermes-<workspace-hash>' --id <candidate-id> --action supersede --actor <operator> --reason "replaced" --replacement <replacement-candidate-id> --json
cogmem memory review --project 'hermes-<workspace-hash>' --id <correction-id> --action relink --actor <operator> --reason "bind correction target" --target-belief <belief-id> --confirmation-event <distinct-user-event-id> --json
```

Hermes may use `cogmem_candidate_review` with the same fields. Approval/relink require distinct same-project user evidence; relink also requires an active same-project belief. Relink is a binding, not a validation: it rewrites the correction's `correctedClaimKey`, `correctedBeliefCandidateIds`, and `targetBeliefId` to the named belief, marks the resolution `manual_relink`, and keeps any previous target as `relinkedFromBeliefId`. Defer keeps the candidate in `needs_confirmation` and records `reviewAfter` plus a status reason. Supersede requires a replacement candidate, because "superseded" without one names no successor; to retire a candidate with no successor use `reject`. Each action consumes only its own inputs: confirmationEventId for approve and relink, targetBeliefId for relink, replacementCandidateId for supersede, reviewAfter for defer, and nothing for reject. Omitting the input an action requires fails (`confirmation_event_required`, `review_after_must_be_in_the_future`, `replacement_candidate_required`), and passing one it does not consume (for example `--target-belief` with `approve`) is rejected with `review_input_not_applicable:<field>` rather than written into the audit row, because that row is evidence of what happened.

## Episode, Dream, and repair

```bash
cogmem episode list --project 'hermes-<workspace-hash>' --json
cogmem episode get --episode <episode-id> --json
cogmem episode seal --episode <episode-id> --mode manual --reason "operator closure" --json
cogmem dream status --project 'hermes-<workspace-hash>' --json
cogmem dream tick --project 'hermes-<workspace-hash>' --mode auto --max-episodes 20 --json
cogmem dream retry --project 'hermes-<workspace-hash>' --json
cogmem memory tick --project 'hermes-<workspace-hash>' --json
```

Do not overlap maintenance jobs. Wait for completion, inspect `durationMs`, backlog, and failure details, then schedule the next run.

```bash
cogmem episode repair --project 'hermes-<workspace-hash>' --limit 100 --json
cogmem episode split --project 'hermes-<workspace-hash>' --episode <episode-id> --events <event-id,event-id> --json
cogmem episode merge --project 'hermes-<workspace-hash>' --source-episode <id> --target-episode <id> --json
cogmem episode move-event --project 'hermes-<workspace-hash>' --event <event-id> --target-episode <id> --json
cogmem episode reclassify --project 'hermes-<workspace-hash>' --episode <id> --episode-type decision --topic-path cogmem/runtime --importance 0.9 --json
cogmem episode requeue-dream --project 'hermes-<workspace-hash>' --episode <id> --mode deep --json
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
cogmem strategy plan --query "<question>" --project 'hermes-<workspace-hash>' --json
cogmem strategy outcomes --project 'hermes-<workspace-hash>' --limit 100 --json
cogmem prospective list --project 'hermes-<workspace-hash>' --json
cogmem prospective due --project 'hermes-<workspace-hash>' --json
cogmem prospective confirm --project 'hermes-<workspace-hash>' --id <candidate-id> --evidence <user-event-id> --json
```

Prospective candidates and strategy plans never authorize action. Snapshot before destructive maintenance.

## Ingestion warnings

- `no_recent_episode_ingestion_detected`: append/import recent Hermes messages before claiming memory is current.
- `semantic_memory_may_lag`: inspect open/soft-sealed episodes, Dream backlog, and terminal failures.
- MCP episode import is bounded; use CLI checkpoints for large history.
- Raw append/import never runs Dream. Background maintenance must call Dream explicitly.
