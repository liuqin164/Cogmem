# ADR-0012: The Night promotes soft seals immediately; every other caller waits out the grace period

Status: accepted (4.0, unreleased)

## Context

An episode is sealed in two steps. `memory tick` marks a conversation that has gone quiet
as a **soft** seal, and a later promotion turns it into a **hard** seal — the state Dream
reads. The delay exists so a conversation that resumes a minute later is not cut in two.

The promotion has a grace period: `DreamScheduler.tick` promotes soft seals older than
`softSealGraceMs`, five minutes by default (`src/dream/DreamScheduler.ts:60`).

`runNight` composes the same pieces in a different order, and calls
`finalizeMatureSoftSeals({ sealedBefore: now })` with **no** grace
(`src/factory.ts:1884`). That is a deliberate exception, and until now it lived only in a
comment above the call. Anyone reading the scheduler would conclude the grace period is a
hard rule and treat the Night as a bug.

## Decision

**The Night promotes soft seals in the same run, with no grace period. Every other caller
keeps it.**

The reason is what the grace period is for. It protects a conversation that might still be
resuming: five minutes is enough to notice that a turn arrived. A Night runs once a day and
only touches episodes that were already idle past the boundary policy's idle gap — the gap
the soft seal was based on. Waiting another five minutes cannot protect a conversation that
has been quiet for half an hour; it can only delay it.

Without the exception the batch runs a night behind, forever: tonight's tick seals the
conversation, and tonight's Dream is not allowed to read it yet, so every conversation is
dreamed on the *next* night's run.

## Consequences

- A conversation that ends during a Night's run is sealed and dreamed in that run.
- `dream tick` — the explicit, frequent command — still waits out the grace period, so the
  interactive path keeps its protection.
- The two callers differ in one argument, not in code paths: `runNight` calls
  `finalizeMatureSoftSeals` with `sealedBefore: now`, the scheduler with
  `sealedBefore: now - graceMs`. A reader who changes one must look at the other.
- `__tests__/nightly-run.unit.test.ts` pins the outcome: two conversations seeded, one Night,
  `sealedEpisodes: 2` and `dream.processedEpisodeCount: 2`.

## Rejected alternatives

- **Give the Night the same five-minute grace.** Every conversation is dreamed a night late,
  and the batch's whole point — yesterday's conversation in today's graph — stops holding.
- **Lower `softSealGraceMs` to zero everywhere.** Removes the protection from the one caller
  that needs it, to fix a caller that does not.
- **Leave it in the comment.** The comment is accurate and nobody reads it from the
  scheduler, which is where the question comes up. #106 asked for this to be lifted into a
  spec; this ADR is that.
