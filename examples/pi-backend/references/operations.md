# cogmem operations for pi

The full command matrix for running cogmem alongside pi. Read
[../SKILL.md](../SKILL.md) first for the pull contract and the identity rule.

## Command selection

| Need | Command |
| --- | --- |
| Is the install healthy? | `cogmem doctor --json` |
| Everything the agent just did | `cogmem memory status --project <id> --json` |
| What should happen next | `cogmem memory plan --project <id> --json` |
| A factual question about the past | `cogmem memory recall --project <id> --query "…" --json` |
| Why recall chose that | add `--explain` |
| Which servers pi sees | `pi mcp list` |

## Install, connect, and reload

```bash
cogmem init --yes --json --no-probe          # write the TOML config
cogmem connect pi --workspace <ws> --auto --json
pi mcp list                                  # the server should read as connected with 6 tools
```

`connect pi --auto` installs the skill into `~/.agents/skills/cogmem-memory/` — the Agent
Skills location pi scans — and writes `mcpServers.cogmem` into `~/.pi/agent/mcp.json`,
leaving every other server alone. `--pi-config <file>` names a different file, and
`--dry-run` prints what would change without writing.

To wire it by hand:

```bash
pi mcp add cogmem -- /absolute/path/to/cogmem mcp --config <ws>/.cogmem/config.toml --project pi-abc12345
```

The `command` must be absolute or resolvable by the process pi spawns. pi will not start a
server whose command it cannot find, and `pi mcp list` can still show the entry, so the
failure is quiet: check that the tools actually appear before assuming it works.

pi reads `~/.pi/agent/mcp.json`, or a project-local `.pi/mcp.json`. A project file wins for
that project, which is a separate memory scope — do not point two projects at one another's
config and expect isolation between them.

## Update and database policy

```bash
cogmem update --dry-run --json
cogmem doctor --json
```

4.0 refuses a database written by an older release rather than migrating it silently. Read the
refusal and follow it; do not point a new binary at an old database to see what happens.

## Inspect, recall, and drill down

```bash
cogmem memory status  --project <id> --json
cogmem memory recall  --project <id> --query "what did we decide about the release?" --json
cogmem memory recall  --project <id> --query "…" --agent <label> --json   # narrows, never widens
cogmem memory search  --project <id> --query "…" --json
cogmem memory events  --project <id> --json
```

`--agent` **narrows** a read to turns recorded under that label. It cannot widen a read beyond
the connection's own scope, and the bound server infers identity from `--project` regardless.

## Memory Atlas as composable filters

```bash
cogmem atlas overview --project <id> --json
cogmem atlas search   --project <id> --query "…" --json
cogmem atlas explore  --project <id> --node <id> --json
cogmem atlas path     --project <id> --from <id> --to <id> --json
cogmem atlas node     --project <id> --id <node> --json
```

Atlas output is a map, not evidence. Summaries and edges are navigation hints; the evidence is
the raw event the node points at. Never quote an Atlas summary as if it were the source.

## Candidate governance and review

```bash
cogmem memory candidates --project <id> --json
cogmem memory review --project <id> --id <candidate> --approve --evidence <userEventId> --json
cogmem memory review --project <id> --id <candidate> --reject --json
cogmem memory review --project <id> --id <candidate> --supersede --json
```

A review needs the raw event it is based on. Candidate state changes only; it never executes the
action it describes.

## Episode, Dream, and repair

```bash
cogmem episode list    --project <id> --json
cogmem episode status  --project <id> --json
cogmem episode seal    --project <id> --id <episode> --json
cogmem episode repair  --project <id> --json
cogmem memory dream    --project <id> --max-runs 1 --json
```

Sealing an empty episode is an error, not an empty seal. Dream promotes durable memory; it is a
host-owned step, so an agent asks for it rather than running it unattended.

## Backup, storage, prospective state, and evaluation

```bash
cogmem snapshot export --project <id> --json
cogmem snapshot import <file> --json
cogmem memory compact --dry-run --json
cogmem prospective list --project <id> --json
cogmem brain-eval --json
```

`--dry-run` first for anything that writes. Export before a destructive operation, and check
that the export landed before running it.

## Ingestion warnings

- A turn is in memory only after a tool call returns `ok: true`.
- `sourceContext.window` and locator output are how you quote exactly; the compiled text is a
  retelling and may differ from what was said.
- If a recall returns nothing, read the decision trace before telling the user the memory does
  not exist: an empty result with a reason is a different answer from an empty result without
  one.
