# Time-awareness contract (v1)

Time is a thing the agent perceives and intends, not a thing the operator's timer does to it
(F2 of #156). The kernel contributes three faces, and this document is their contract:

1. **the context block** — computed from the ledger and handed to the shell at wake or turn start,
2. **wake intentions** — the agent's own "wake me at T because R, about X", stored in the ledger,
3. **schedule evaluation** — whether a coarse window is open, and when the base timer should next
   wake, so the timer sleeps instead of polling.

The code is `src/temporal/TimeAwareness.ts`, `WakeIntentionService.ts` and `WakeScheduler.ts`. They
are held to this document by `__tests__/time-awareness.contract.test.ts`, which reads the frozen
tables below and fails when code and contract disagree. Version:
`TIME_AWARENESS_CONTRACT_VERSION = 1` (`src/temporal/TimeAwareness.ts`).

## Clock discipline

Nothing in this face holds a timer or sleeps. Every entry point takes `now` as a parameter, and the
one default (`now = Date.now()`) exists for callers whose own clock *is* the wall clock. A test
drives days of behaviour by moving that integer, and a shell that ticks on its own clock gets the
same answers.

## The context block

`MemoryKernel.temporalContext({ projectId, now?, … })`, reached from a host as
`KernelAgentMemoryBackend.temporalContext`. The agent does not query it; the shell computes it at
wake or turn start and injects it into the turn.

### Fields (frozen)

| Field | Meaning |
|---|---|
| `now` | The instant the block was computed for, as handed in. |
| `timeZone` | The project timezone the local fields render in. |
| `localDate` | `YYYY-MM-DD` at `now` in `timeZone`. |
| `localTime` | `HH:MM` at `now` in `timeZone`. |
| `weekday` | ISO weekday, 1 = Monday … 7 = Sunday. |
| `hourOfDay` | Local hour, 0–23. |
| `dayPhase` | One of the frozen day phases below. |
| `weekPhase` | `weekday` or `weekend`, read off `weekday`. |
| `lastInteractionAt` | The most recent conversational turn at or before `now`, either side. `null` if none. |
| `sinceLastInteractionMs` | `now - lastInteractionAt`. `null` with no turn. |
| `silenceMs` | `now -` the most recent **user** turn: how long the owner has been quiet. `null` if none. |
| `density` | The ledger-density signal over the density window, below. |
| `rhythm` | The coarse owner-rhythm signal, below. |
| `nearestAnchor` | The anchor nearest in time, below. `null` if there is none. |

`sinceLastInteractionMs` and `silenceMs` are deliberately two numbers. They differ exactly when the
agent has spoken into the owner's silence — a resident companion's own unprompted turn moves the
first and not the second — and collapsing them would hide the case the ticket exists to show.

### Interaction rows

The block reads `RAW_EVENT_RECORDED` rows — conversation turns — and no other ledger row. Structural
writes (a compile, a topology row, an intention row) are the machine's activity, not the owner's, so
they do not move the density or rhythm signals; counting them would call a busy Dream night a busy
day for the person.

### Density signal

| Field | Meaning |
|---|---|
| `windowMs` | The lookback window, default `DEFAULT_DENSITY_WINDOW_MS` (24 h). |
| `interactionCount` | Interaction rows inside the window. |
| `spanMs` | First-to-last interaction inside the window; `0` with fewer than two. |
| `label` | One of the frozen density labels below. |

### Day phases (frozen)

| Phase | Local hours |
|---|---|
| `night` | 00:00–05:59 |
| `morning` | 06:00–11:59 |
| `afternoon` | 12:00–17:59 |
| `evening` | 18:00–23:59 |

### Density labels (frozen)

| Label | Interaction rows in the window |
|---|---|
| `blank` | 0 |
| `quiet` | 1–2 |
| `steady` | 3–9 |
| `busy` | 10 or more |

The labels are the ticket's "busy day versus blank three days" made decidable: a day of turns reads
`busy`; three days with nothing reads `blank`, and `spanMs` says whether the day's turns were
clustered or spread.

### Rhythm signal

| Field | Meaning |
|---|---|
| `sampleDays` | The lookback, default `DEFAULT_RHYTHM_SAMPLE_DAYS` (14). |
| `activeHours` | Local hours whose interaction count over the sample reached the threshold, ascending. |
| `phase` | One of the frozen rhythm phases below, for `hourOfDay`. |

### Rhythm phases (frozen)

| Phase | Means |
|---|---|
| `active` | `hourOfDay` is in `activeHours`; this is an hour the owner is usually around. |
| `quiet` | `hourOfDay` is not in `activeHours`. |

This is a **signal only**. It is part of the context block so F6's emergence layer and F8's occasion
layer can read it; this round produces none of their decisions and gates nothing on it.

### Anchor kinds (frozen)

| Kind | Producer today |
|---|---|
| `wake-intention` | A pending wake intention's `at`, below. |
| `prospective-memory` | A **confirmed or deferred** prospective memory's `dueAt`, or `deferredUntil` when deferred. A pending candidate is not yet the owner's, so it is neither an anchor nor a reason to wake. |

`nearestAnchor` is the anchor with the smallest `|at - now|`, ties broken by the earlier `at`, then
by kind and label. It carries `distanceMs` (absolute) beside `at`, so direction is read off the two
instants. **An anniversary has no producer**: nothing in the ledger carries one today, and rather
than fake a third kind the block offers the two it can compute.

## Wake intentions

A first-class record, not a config value and not a scratch table. The whole lifecycle is immutable
`memory_events` rows: a `SET` row opens one, a `CANCELLED` row closes it, and **the absence of a
`FIRED` row is what "not yet fired" means**. Once-only therefore survives a restart with no marker
column and no second table, and the audit is the ledger itself.

### Ledger event types (frozen)

| Type | Written when | Payload |
|---|---|---|
| `WAKE_INTENTION_SET` | An intention is registered. | `intentionId`, `projectId`, `agentId`, `at`, `reason`, `sourceRefs`, `registeredAt` |
| `WAKE_INTENTION_CANCELLED` | A pending intention is cancelled. | `intentionId`, `cancelledAt`, optional `reason` |
| `WAKE_INTENTION_FIRED` | The tick reaches the intention's instant. | `intentionId`, `dueAt`, `firedAt`, `missedByMs` |

Each intention owns one ledger stream (`wake-intention:<intentionId>`), so its transitions are
ordered without a new table. Every row carries `metadata.sourceAgent`, which is the field both the
scope rule (#143) and the event stream's agent filter already read.

### Record shape

| Field | Meaning |
|---|---|
| `intentionId` | `wake-…`, or the caller's own id. |
| `projectId` | The project boundary; transitions are refused across it. |
| `agentId` | The agent that set it. |
| `at` | The instant to wake at. |
| `reason` | Why. Required and non-empty. |
| `sourceRefs` | What it is about. Required: at least one reference. |
| `registeredAt` | When the SET row was written. |
| `status` | One of the frozen statuses below. |
| `firedAt` | When the FIRED row was written. |
| `cancelledAt` | When the CANCELLED row was written. |
| `missedByMs` | `firedAt - at`, `0` when on time. |

### Wake intention statuses (frozen)

| Status | Means |
|---|---|
| `pending` | Set, not fired, not cancelled. |
| `fired` | The tick reached it. Terminal. |
| `cancelled` | Cancelled before firing. Terminal. |

### API

| Call | Does |
|---|---|
| `register({ projectId, agentId, at, reason, sourceRefs, now })` | Appends the SET row; throws if the id already exists. |
| `cancel(intentionId, { projectId, now, reason? })` | Appends the CANCELLED row. Cancelling twice is a no-op; a fired intention cannot be cancelled. |
| `list({ projectId, agentId?, statuses? })` | Current state of each intention, folded from its rows. |
| `audit({ projectId, intentionId?, agentId? })` | Every transition row, oldest first. |
| `claimDue({ projectId, agentId?, now, limit? })` | Fires every pending intention with `at <= now`, once each, and returns them. |

### Once, and caught up once

`claimDue` fires an intention exactly once: the same call twice at the same `now` fires nothing the
second time, and so does a call after a restart. An intention whose instant passed while the process
was down is not dropped — the next tick fires it once, with `missedByMs > 0` recording how late it
was. That is the whole compensation rule: **once, and only once**.

## Schedule evaluation

`evaluateDreamWindow({ now, timeZone, window })`, reached on the kernel as
`MemoryKernel.dreamWindowAt({ now?, window, timeZone? })` (which defaults the timezone to the
project's). It answers:

| Field | Meaning |
|---|---|
| `open` | Whether `now` is inside the window. |
| `windowStartAt` / `windowEndAt` | The window containing `now`, or the most recent one that closed. |
| `nextOpenAt` | The next instant the window opens. |

`startHour > endHour` wraps past midnight. `startHour === endHour` means open all day, not a
zero-length window. A DST switch does not move the boundary: the instant is resolved through the
timezone, not by adding fixed hours.

**The kernel provides the evaluation and never runs a Dream on a timer.** `runWakeTick` reports
`dreamWindow` when the caller passes a window, and a base timer calls `runDreamTick` only while
`open` is true. The window itself is the shell's config — the kernel does not read it, so moving the
shell's rhythm settings into the kernel is not this round's change.

## The `prospective-due` producer

F1 froze the type and named F2 its owner (`docs/events.md`). `MemoryKernel.runWakeTick`, reached as
`KernelAgentMemoryBackend.runWakeTick`, is the producer. One event per due thing, with a `kind`
discriminator in the payload:

| `payload.kind` | Emitted when | Payload |
|---|---|---|
| `wake-intention` | A pending intention reached its instant. | `intentionId`, `agentId`, `dueAt`, `firedAt`, `missedByMs`, `reason` |
| `prospective-memory` | A confirmed/deferred prospective memory came due. | `candidateId`, `candidateType`, `status`, `dueAt` |

The event stream is what a shell subscribes to; the tick emits and never speaks, and it never writes
a turn.

### Announced once, across restarts (#213)

An announcement is claimed before the event leaves, the same way a wake intention's `FIRED` row is.
The claim is a `prospective_memory_transitions` row with `action = 'notified'` and `to_status` equal
to the current business status — the business state machine is untouched (a `notified` row is not a
status), and the append-only audit says when the shell was told. `listDue` and the `nextWakeAt` read
`excludeNotified: true`, so a restart re-announces nothing.

The marker belongs to **one due instant**: it is stale once `COALESCE(deferred_until, due_at)` moves
past the marker's timestamp. Deferring a memory after it was announced therefore makes it due again,
and its new instant is announced once more. No schema migration: the transition table already had
the row shape.

`list({ ..., excludeNotified: true })` is the read for "is there still a reason to wake"; the
context block's `nearestAnchor` deliberately does **not** exclude it, because an announced memory is
still a due commitment the agent should perceive.

## The next wake instant

`nextWakeAt({ projectId, agentId?, now })` answers the earliest pending instant at or after `now`:
the soonest pending wake intention or prospective due, or `now` if one is already overdue. With
nothing pending it answers `null`. This is the anti-heartbeat: a base timer that gets `null` sleeps,
where a fixed interval wakes on a schedule nobody asked for.

## Scope ceiling

The wake tick is in-process and synchronous, like the F1 stream it emits on. Two processes holding
the same database can both tick; each would read the same pending rows and race their FIRED
appends. The intended holder is the one resident process that already holds the kernel and serves
the shell, and the ledger append is the only arbiter — this face does not add a lock. Prospective
memories carry the same once-only gate as wake intentions: the `notified` transition row is the
ledger's marker, so a restart re-announces nothing (fixed for #213; the cross-process race remains
the same as FIRED's, and the ledger append is still the only arbiter).

## The shell's rhythm seam

The resident shell (F13, `Cogmem-spike`) already owns its rhythm config: `dream.windowStartHour`,
`dream.windowEndHour`, `timeZone`, and a recorded-but-unwired quiet window. This round does **not**
move any of it into the kernel. The seam is one call:

- the shell keeps `windowStartHour`/`windowEndHour` in its own config;
- it passes them to `evaluateDreamWindow` (or reads `runWakeTick(...).dreamWindow`);
- it calls `runDreamTick` only while the window is open, so "zero Dream runs outside the window" is
  the shell's loop reading the kernel's evaluation, not a kernel-side timer;
- it uses `nextWakeAt` for the interval between ticks, so the timer stops polling.
