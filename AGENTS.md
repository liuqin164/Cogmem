## Agent skills

### Issue tracker

Issues and specs live as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Memory pipeline

What the tiers are, how Dream reads a conversation, and what the Atlas projects:
`MEMORY_MODEL.md` and `MEMORY_ATLAS.md`. This round's measurements and the
per-commit record: `docs/engineering/4.0-issue-loop.md`. Review rules no guardrail
can enforce: `CODING_STANDARDS.md`.

## Local development facts

- **`dist/` is not tracked (#53).** A source checkout must run `bun run build` before anything that
  reads build output (the OpenClaw plugin installer falls back to `dist/public.js`, and `prepublishOnly`
  now builds *before* the test suite). `git ls-files dist` is 0 by design; `npm pack` still ships it.
- **Tests need a writable temp dir.** Under the DSH sandbox, writes outside the workspace are
  refused, so the SQLite operations that need a temporary file — the `VACUUM` in the snapshot export
  and in `forgetUser` — fail with `SQLITE_CANTOPEN`. Run the suite as
  `TMPDIR="$PWD/.cogmem/tmp" bun test __tests__`; `.cogmem/` is gitignored, so this leaves no trace.
  Do not attribute ~20 `mcp-http` failures to this: that count was checked and did not reproduce
  (`mcp-http.unit.test.ts` runs 23/0 with an emptied TMPDIR).
- **The active branch is `feat/cogmem-4.0-multi-bot`, not `main`.** 4.0.0 is unreleased; do not tag
  or publish without the owner's explicit go-ahead. A tag is not a free label here: the owner's
  release flow creates the GitHub Release through the tag, and `release: published` runs
  `.github/workflows/publish.yml`, which publishes to npm. 4.0 must be settled before that happens.
- **README Quick Start installs from npm, not from this checkout.** `install.sh` resolves
  `cogmem@latest`, and npm's `latest` is the last *released* version. So no merge of this branch
  makes those three lines run 4.0 — only publishing does. Any doc claim that "Quick Start works
  once this lands on `main`" is wrong; issue #44 is blocked on the release, not on the merge.
- **The resident MCP server does not hot-reload.** A long-running `cogmem mcp --transport http`
  keeps the `src/`/`dist/` it started with. Restart it after a build, and check
  `ss -ltnp | grep 7337` before assuming it is current.
- **Check the disk before starting a round.** The suite's temporary directories live under
  `.cogmem/tmp`, and before #70 they accumulated to 25 GB in one night and filled a 96 GB disk,
  which surfaced as an `ENOSPC` from `npm pack` that looked like a broken build. `bun test`
  now sweeps its own `cogmem-run-*` directories through `__tests__/helpers/preload.ts`, and new
  tests should use `makeTempDir()` from `__tests__/helpers/tmp.ts` instead of `mkdtempSync`.
  If `df -h .` reports under 2 GB free, remove the temporary root before running anything else
  and record it in the ledger.
- **In-flight work, if present, is recorded in `docs/overnight-progress.md`** — untracked and kept on
  disk by the owner's overnight loop, so a fresh clone will not have it. When it exists, read it
  first: it carries the round's real gate numbers, not the plan.

## End of round

**CI has already run.** `.github/workflows/ci.yml` runs `prepublishOnly` (typecheck →
build → test → pack) on every push to `feat/**`, so read it instead of reporting it
as unrun: `bun run ci:status`. It exits non-zero when a gating check failed and
labels the external Cloudflare build, which is not this repo's CI.

Post the round's measured result where GitHub shows it — a comment on the open PR for the
branch, or on the issue that drove the round when there is no PR. The local progress file stays
a scratchpad; it is never the only record, because it does not exist in a fresh clone.

The comment carries, at minimum:

- the head commit and the test counts actually observed (`pass` / `fail` / files), with the
  `TMPDIR` or `HOME` the run used when that changes the outcome;
- `typecheck`, `bun test __tests__`, `build`, and `npm pack --dry-run` results;
- what failed and what is still blocked, named plainly — an unfinished item listed as unfinished.

A round that changes behaviour also states the user-visible effect in one line, so a reader does
not have to reconstruct it from the diff. A round that adds a module, tool or bin names what it
removed or merged to pay for it — the budget in `## Complexity budget` is checked, not aspirational.

**One commit, one thing.** A commit that fixes six findings is six commits. Whoever bisects, blames
or reverts gets one reason per change, and `git revert` can undo one without dragging the others
with it. Bundling is what made the two-axis review of `309f305..HEAD` report a sequencing problem
instead of a code one.

## Complexity budget (4.x, #52)

Two rules, both cheap enough to actually hold. Everything else about size stays a judgement
call; these two are not.

- **The `core` MCP profile stays at eight tools or fewer.** `core` is what a host gets by
  default, so it is the one surface every user pays for. Growing it past eight is a decision
  about what leaves first, and `__tests__/complexity-budget.unit.test.ts` fails until that
  happens.
- **Every minor release's notes list what was removed or merged, not only what was added.**
  Subtraction nobody writes down does not happen.

Consolidating the 22 bins (one dispatcher plus 21 separate `cogmem-*` entry points) under one
entry point is a breaking change with its own migration for users' scripts, so it is tracked
separately (#111) rather than bundled here.
