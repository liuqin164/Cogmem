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
