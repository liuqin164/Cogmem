# Coding Standards

Read during **review**, not implementation. Everything a guardrail can enforce lives in
the guardrail instead: `bun run typecheck`, `bun test __tests__`, `bun run ledger:check`,
`bun run ci:status`. What is left here is the judgement calls no check can substitute for.

## Vocabulary

A **new public name** — a command, an option, an exported function, a doc heading — uses
the glossary's term for the concept, never a word its `_Avoid_` list names. `GLOSSARY.md`
is the single source of truth for those words.

This is a reviewer's rule and not a script on purpose: a mechanical scan cannot separate a
new name that uses an avoided *synonym* from ordinary code that uses the same word
legitimately. Tried on 2026-10-29 — a scan of added lines flagged `productFacet` (avoided
word "facet" belongs to Dimension, but `ProductFacet` is its own concept) while missing
`runNightlyBatch` (a class method, and "nightly batch" is what Episode avoids). The one
case it caught reliably was renamed, and the check was deleted rather than kept as a gate
that gives false comfort.

## A command that runs once

A new command or kernel method that performs a batch of work — the shape of `cogmem dream
night` — must be **idempotent**: running it twice in a row does nothing the second time,
and a test runs it twice and asserts that (zero sealed, zero processed, zero projectate,
and no new documents). Work that cannot be made idempotent says so in its own output.

## Projections and their dirty flag

A path that changes state a projection is built from must leave the projection's status
honest: **dirty when a refresh is owed, clean only when the whole projection is current.**
A path covering part of a projection (the canonical layer but not frames, say) leaves the
flag as it found it and says in its docstring what it does not cover — and the caller that
owes the rest says so with a full refresh. The test asserts the flag after the path runs,
in both directions: a run that owes a refresh reports `refreshed: true` once, and the run
after it reports `false`.

Why this is written down: an incremental pass that left the flag clean made the *next*
night pay a corpus rebuild for work the previous one already knew about, and every test
was green.

## A fix, not a way to survive the failure

Every bug-fix change passes four gates. All four, or it is not a fix.

1. **It fixes incorrect behaviour that exists today.** Wrong output, lost data, a crash, a wrong
   status, a path that never matched, a flag that was never passed. Not a feature, not hardening
   ("more robust" when nothing misbehaves), not performance or cost tuning, not observability, not
   prompt tuning, not a correct re-fix of something already fixed. If you cannot name the incorrect
   behaviour a user hits today, you are building armour for a wound nobody has.
2. **It is not built out of failure-tolerance machinery.** The test for every conditional in the
   diff: does it correct the logic at the root cause, or does it notice a failure and arrange to
   survive it? Rejected in all of their costumes — guards (`try/catch` that logs and continues,
   never-throw wrappers, "best-effort by design", tolerate-N-failures-then-drop counters), circuit
   breakers and cooldown or quarantine state, fallbacks, retries, fail-open and fail-soft modes,
   self-healing, reapers and watchdogs, and truncation. A guard's defining property: after it fires,
   the failure still exists and is now quieter.
3. **It is not a second system.** No new background process, poller or scheduled sweep; no new lock,
   marker or state file on disk; no new lifecycle manager layered beside the existing path; no new
   environment-variable alternate mode that preserves the broken behaviour; no module whose line
   count dwarfs the logic error it addresses.
4. **Its size is proportional to the defect.** One wrong line is roughly one changed line plus a
   test. When a one-line defect arrives inside a 400-line diff, the other 399 lines are one of gate
   2's costumes — find which, and send it back.

Allowed, and better than allowed: **deleting** a retry, a fallback or a silent catch; converting
silent tolerance into a loud typed error at the boundary where it belongs; and plain correctness —
right sort order, right path expansion, right quoting, right flag, right spawn mechanism, right
order of operations, right column in the `WHERE`. An `if` is fine when it *is* the correct logic,
rather than a bouncer standing in front of incorrect logic. Honouring an explicitly requested
`limit` at the correct point in the pipeline is semantics, not truncation. Regression tests are part
of the fix, not a second system.

Boundary: these gates judge **bug-fix changes**. Documentation, ledger and release work are not in
their scope.

Why this is written down: #86, #94 and #96 share one root cause — `connect` resolves the current
installation's absolute path and bakes it into every host artifact, so an upgrade, a moved checkout
or a changed npm prefix breaks the integration. All three were answered *inside* that design: a
warning for #96, a resolved path or an error for #94, an added `--config` for #86 — and none of them
stopped the config from carrying a path that goes stale. That is gate 2's exact shape: the failure is
noticed and survived rather than removed. #114 removes the baked path.
