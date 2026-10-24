## Agent skills

### Issue tracker

Issues and specs live as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Local development facts

- **Tests need a writable temp dir.** Under the DSH sandbox `/tmp` is read-restricted, so
  `bun test __tests__` fails ~20 `mcp-http` cases with `SQLITE_CANTOPEN`. Run it as
  `TMPDIR="$PWD/.cogmem/tmp" bun test __tests__`; `.cogmem/` is gitignored, so this leaves no trace.
- **The active branch is `feat/cogmem-4.0-multi-bot`, not `main`.** 4.0.0 is unreleased; do not tag
  or publish without the owner's explicit go-ahead.
- **The resident MCP server does not hot-reload.** A long-running `cogmem mcp --transport http`
  keeps the `src/`/`dist/` it started with. Restart it after a build, and check
  `ss -ltnp | grep 7337` before assuming it is current.
- **In-flight work, if present, is recorded in `docs/overnight-progress.md`** — untracked and kept on
  disk by the owner's overnight loop, so a fresh clone will not have it. When it exists, read it
  first: it carries the round's real gate numbers, not the plan.

## End of round

Post the round's measured result where GitHub shows it — a comment on the open PR for the
branch, or on the issue that drove the round when there is no PR. The local progress file stays
a scratchpad; it is never the only record, because it does not exist in a fresh clone.

The comment carries, at minimum:

- the head commit and the test counts actually observed (`pass` / `fail` / files), with the
  `TMPDIR` or `HOME` the run used when that changes the outcome;
- `typecheck`, `bun test __tests__`, `build`, and `npm pack --dry-run` results;
- what failed and what is still blocked, named plainly — an unfinished item listed as unfinished.

A round that changes behaviour also states the user-visible effect in one line, so a reader does
not have to reconstruct it from the diff.
