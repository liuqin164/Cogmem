## Agent skills

### Issue tracker

Issues and specs live as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Local development facts

- **Tests need a writable temp dir.** Under the DSH sandbox `/tmp` is read-restricted, so
  `bun test __tests__` fails ~20 `mcp-http` cases with `SQLITE_CANTOPEN`, and
  `bun run verify:packed-migration` fails the same way. Run both as
  `TMPDIR="$PWD/.cogmem/tmp" …`; `.cogmem/` is gitignored, so this leaves no trace.
- **The active branch is `feat/cogmem-4.0-multi-bot`, not `main`.** 4.0.0 is unreleased; do not tag
  or publish without the owner's explicit go-ahead.
- **The resident MCP server does not hot-reload.** A long-running `cogmem mcp --transport http`
  keeps the `src/`/`dist/` it started with. Restart it after a build, and check
  `ss -ltnp | grep 7337` before assuming it is current.
- **In-flight work, if present, is recorded in `docs/overnight-progress.md`** — untracked and kept on
  disk by the owner's overnight loop, so a fresh clone will not have it. When it exists, read it
  first: it carries the round's real gate numbers, not the plan.
