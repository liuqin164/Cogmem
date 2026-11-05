# 8. The two operations that compact the database keep their temporary space in memory

## Context

`VACUUM` needs temporary space: SQLite rebuilds the database file and holds the
rebuild somewhere before swapping it in. `SnapshotExporter`'s forgotten-row
removal needs it twice, once for a `TEMP TABLE` and once for the `VACUUM`.

By default that space is a file, in a directory SQLite resolves from
`SQLITE_TMPDIR`, then `TMPDIR`, then `/var/tmp` — **before any application code
runs**, so it cannot be corrected afterwards in-process. On a machine where that
directory is not writable (a container with a read-only `/tmp`, a hardened host, a
sandbox), the operation fails with `unable to open database file`, which names the
database. The database is fine. That misattribution cost two separate
investigations real time in #61 and #64.

## Decision

These two operations set `PRAGMA temp_store = MEMORY` before the work that needs
temporary space, so they do not depend on a writable temporary directory at all:

- `SnapshotExporter.removeForgottenRows` sets it on the secondary connection it
  opens, which is discarded with the call, so nothing else inherits it.
- `forgetUser` sets it on the kernel's own connection for the duration of the
  `VACUUM` and restores the previous value afterwards, because that connection
  serves everything else and an in-memory temp store is the wrong default for
  large sorts.

The error-naming helper added earlier stays: it is still the right answer for any
*other* temporary-space failure, and it is the reason the next person will not
have to rediscover what `unable to open database file` means here.

## Consequences

- Forgetting a user and exporting a snapshot work on a read-only temporary
  filesystem. Verified against #64's own reproduction
  (`env -u TMPDIR -u SQLITE_TMPDIR bun test __tests__/snapshot.integration.test.ts`):
  0 pass / 5 fail before, 5 pass / 0 fail after, and the `forgetUser` suite goes
  from failing to 12 pass / 0 fail under the same conditions.
- **The trade is real and worth stating: temporary space now comes from RAM rather
  than disk, and for a `VACUUM` that is roughly the size of the rebuilt database.**
  A very large database could be pushed into swap or killed by the OOM killer where
  it previously used disk. Cogmem's databases are memory graphs, not bulk stores,
  and the operations are operator actions rather than per-request paths, so the
  trade is accepted here — but it is a trade, not a free win.

## Alternatives considered

- **Check the temporary directory at startup and refuse to run.** Rejected: it
  would stop every deployment whose temporary directory is only needed by these two
  operations, which is most of them. It also cannot be fully correct, because the
  directory is resolved before user code runs and can change underneath a long
  process.
- **Try disk first and retry in memory when the failure is recognised.** Rejected:
  in the snapshot path the failure can land in the middle of a transaction that
  already created a temporary table, so the retry has to reason about half-finished
  state. The added paths are worth more than the RAM saved on databases that would
  have fitted either way.
- **Rewrite the operations to avoid a rebuild** (`VACUUM INTO` into a new file, or
  a different compaction strategy). This remains open on #64 and is the better
  answer for very large databases; it is a redesign of both operations rather than
  a change to where their temporary data lives, so it is not this decision.
- **Pin a writable temporary directory in the test suite.** Not a fix for users;
  and an in-process assignment is too late, because SQLite has already resolved and
  cached the directory. Recorded on #64 so the next person does not retry it.

## Amendment: a third path, and why the fallback is conditional

A third operation in the same class surfaced after this decision: an ordinary **event
append**. A run of 520 appends on a machine whose temporary directory cannot be written
failed with `unable to open database file` — the same message, blaming the database, from
a path this ADR had not considered. It is not a compaction; it is the write path.

Rather than a third per-operation fix, the kernel's connection now asks one question at
setup: **is the temporary directory this process would use actually writable?** If it is,
nothing changes — a large sort belongs on disk, and this is what keeps the earlier
decision from becoming a blanket policy. If it is not, the connection keeps its temporary
space in memory, because the alternative on that machine is failing with a message that
misattributes the cause.

**This is not the startup check this ADR rejected.** That alternative refused to run; this
one adapts, and it cannot stop a deployment or change one whose temporary directory works.
The probe writes and removes one file in the directory SQLite would choose, in the same
order SQLite chooses it (`SQLITE_TMPDIR`, `TMPDIR`, `/var/tmp`, `/tmp`), which is also how
the error-naming helper decides whether a failure is really about the temporary directory.

`__tests__/temp-space-fallback.unit.test.ts` pins both branches — a usable directory
leaves the connection untouched, an unusable one sets `temp_store = MEMORY` — and drives
520 appends in a child whose `TMPDIR` is a regular file, which is unusable for every user.

