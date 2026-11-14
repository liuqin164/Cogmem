# Health, degradation, and whole-brain backup contract (v1)

A resident companion that cannot say "I am unwell" rots silently. This face makes the kernel's own
condition readable, names what it does when a part is unavailable, and keeps a nightly copy of the
whole brain that a machine can restore. The principle is frozen with the tables: **better to admit
sickness than to pretend normal with bad memory.**

The code is `src/health/` (`HealthService`) and `src/snapshot/` (`BrainBackup`, `BrainBundle`),
reached as `MemoryKernel.health` and `MemoryKernel.backup`. The observatory's health page is
`GET /observatory/health`. The document is held by `__tests__/health-backup.contract.test.ts`, which
reads the frozen tables below and fails when code and contract disagree. Version:
`HEALTH_CONTRACT_VERSION = 1`.

## What this face does not do

- **No network probe.** `model_route` is a configuration-level answer plus the last Dream run's own
  processor evidence. A live provider call would be slow, side-effecting and a second model path;
  the honest boundary is "configured, and the last Dream did not report the processor unavailable".
- **No new table.** Health state lives in the existing `_meta` key/value table, transitions are rows
  in the existing `governance_audit_log`, and a snapshot's manifest is a JSON file beside it. No
  column, no migration.
- **No new observatory write.** The health page is a read of persisted state. The soul editor remains
  the observatory's only write exception.
- **No second snapshot format.** The nightly snapshot is the existing `cogmem snapshot` DB copy
  (`.snap`) plus a manifest; the bundle shares that copy, checksum and count verification. The
  `cogmem snapshot export|import` face is unchanged.
- **No F18 rule change.** The health notice is an ordinary candidate routed through the frozen
  delivery rules. This face consumes the highest tier; it does not add one.

## Version (frozen)

| Field | Value |
|---|---|
| `contractVersion` | `1` |
| `snapshotRetention` | `7` |
| `dreamFailureNights` | `3` |
| `snapshotFormat` | `cogmem.brain-snapshot` |
| `bundleFormat` | `cogmem.brain-bundle` |
| `healthEventType` | `health-changed` |
| `healthAuditAction` | `health_changed` |
| `healthAnomalyWindowMs` | `604800000` |

## Self-checks (frozen)

Each check answers `ok` or `degraded` and carries a detail object. A degraded check names exactly one
degradation mode.

| Check | Means | `ok` | `degraded` |
|---|---|---|---|
| `model_route` | The memory and reasoning roles can reach a model. | Both providers are not `rule_only`, and the latest Dream run did not report `semantic_processor_unavailable` or `semantic_processor_failed`. | `model_unavailable` |
| `dream_streak` | Dream has not failed for `dreamFailureNights` consecutive nights. | The streak is below 3. | `dream_failing` |
| `db_writable` | The database accepts a write transaction. | `BEGIN IMMEDIATE` succeeds on a second connection and is rolled back. | `db_read_only` |
| `kernel_integrity` | The database is structurally sound. | `PRAGMA quick_check` answers `ok` and `_meta`, `memory_events`, `memory_episodes` and `soul_versions` exist. | `kernel_integrity_failed` |

`db_writable` is the one check that decides the mode: `read_only` when it is degraded, `normal`
otherwise. A read-only database makes `check` skip the transition write instead of failing.

## Degradation behavior (frozen)

| Mode | When | Behavior | Surface |
|---|---|---|---|
| `model_unavailable` | `model_route` is degraded. | The companion says the memory model is unavailable and queues the turn; it does not fabricate an answer. Recall stays lexical and says so through `semanticIndexEnabled()`. | `health.check`, `doctor`, `/observatory/health` |
| `dream_failing` | `dream_streak` reaches `dreamFailureNights`. | One health notice per failed streak, sent through F18's highest tier; the returned decision carries its trace. | `health.notice`, `health-changed` |
| `db_read_only` | `db_writable` is degraded. | Read-only companion mode: writes are refused with `health_read_only`; recall and the observatory read path keep working; the state is explicit in `health.mode`. | `health.check`, `health.assertWritable`, `doctor` |
| `kernel_integrity_failed` | `kernel_integrity` is degraded. | The companion reports the corpus as unreadable rather than answering from a damaged index; the next step is a restore from a verified snapshot. | `health.check`, `doctor` |

## Health state and events (frozen)

The last report is persisted as one JSON value under `_meta` key `health_state`. A transition is a
row in `governance_audit_log` with action `health_changed`, and an in-process event of type
`health-changed`. A check that finds the same status as the previous report writes neither.

| Field | Means |
|---|---|
| `version` | `1`. |
| `checkedAt` | Wall-clock ms of the check. |
| `mode` | `normal` or `read_only`. |
| `status` | `ok` when every check is ok, else `degraded`. |
| `checks` | One entry per frozen check id, in the frozen order. |
| `degradations` | The degraded modes, in check order. |

The event payload is ids and status only: `{ checkId, status, mode }`. The ledger's text stays in the
ledger; the health event is not a second read path.

The previous report is treated as `ok` when none exists, so the first check that finds a degraded
part records the transition that matters.

## Dream streak (frozen)

A night is the UTC calendar day of `episode_dream_runs.created_at`.

| Night | Rule |
|---|---|
| `succeeded` | At least one run that day has status `succeeded`. |
| `failed` | No run that day succeeded, and at least one has status `partial`. |
| `idle` | Every run that day has status `skipped`. |

The streak is the number of consecutive `failed` nights ending at the latest night that has any run.
A `succeeded` or `idle` night ends the streak. No runs at all is a streak of 0.

## Health notice (frozen)

At `dreamFailureNights` consecutive failed nights, `health.notice` returns one candidate and its F18
decision. The streak key is `<latest failed night>:<streak>`; a second call for the same key answers
`already_notified` and routes nothing.

| Candidate field | Value |
|---|---|
| `candidateId` | `health:dream-streak:<night>:<streak>` |
| `source` | `wake-intention` |
| `sensitivity` | `daily` |
| `freshness` | `observedAt = now`, `ageMs = 0`, `expiresAt = now + 86400000`, `expired = false` |
| `confidence` | `1` |

The router input is the caller's `userState` and channel, occasion `private`, feedback level `0` and
`stopped: false`. Because the source is a due `wake-intention`, F18 derives urgency `high`: with
`in-conversation` and an online, normally interruptible channel the decision is `deliver` /
`proactive` / `urgent_in_conversation`; with `idle` it is `accumulate` / `next-contact` (queued);
with `night-dnd` and a normally interruptible channel it is `deliver` / `proactive` /
`night_highest_urgency`. The trace is the decision's own `decisionTrace`.

## Nightly snapshot (frozen)

| Field | Value |
|---|---|
| `trigger` | `MemoryKernel.runNight`, after the Dream pass and the atlas reconcile. |
| `contents` | The whole database, every table including `soul_versions`, plus the JSON manifest. |
| `location` | `<paths.snapshots_dir>/brain-<ISO>.snap` and `brain-<ISO>.json`. |
| `retention` | The newest `7` snapshots are kept; older `.snap` and `.json` pairs are deleted. |
| `verification` | Every snapshot is checked for `checksum`, `opens` and `counts` before it is reported. |
| `query` | `cogmem backup list --json`, `cogmem doctor --json`, `GET /observatory/health`. |
| `failure` | A snapshot that cannot be written fails the Night. The Dream rows are already committed and a re-run is idempotent. |

The snapshot reuses `SnapshotExporter`: `VACUUM INTO`, forgotten rows removed, sha256 over the DB
bytes. The manifest is written after the export and rewritten with the verification result.

## Snapshot manifest (frozen)

| Field | Means |
|---|---|
| `format` | `cogmem.brain-snapshot`. |
| `version` | `1`. |
| `createdAt` | ISO instant. |
| `coreVersion` | The kernel that wrote it. |
| `snapshot` | `{ file, byteLength, checksum }` for the `.snap`. |
| `counts` | The five frozen counts. |
| `soulVersions` | One `{ agentId, version }` per agent, the current version. |
| `config` | The four frozen configuration values. |
| `verification` | `{ ok, checkedAt, checks: { checksum, opens, counts }, detail? }`. |

## Counts (frozen)

| Count | Source |
|---|---|
| `events` | `memory_events` rows. |
| `episodes` | `memory_episodes` rows. |
| `frames` | `memory_frames` rows. |
| `atlasDocuments` | `memory_atlas_documents` rows. |
| `soulVersions` | `soul_versions` rows. |

## Configuration (frozen)

Only values needed to open the brain again; never a key or a passphrase.

| Field | Means |
|---|---|
| `vectorDimension` | The embedding dimension the snapshot expects. |
| `projectTimeZone` | The project clock. |
| `memoryProvider` | The memory role's provider. |
| `reasoningProvider` | The reasoning role's provider. |

## Verification (frozen)

| Check | Means |
|---|---|
| `checksum` | The sha256 of the DB bytes equals the snapshot header's checksum. |
| `opens` | The embedded database opens read-only. |
| `counts` | Every frozen count read from the embedded database equals the manifest's count. |

`ok` is true only when all three pass. A failed verification is kept in the manifest and reported;
it is not deleted, because a snapshot that cannot be trusted is evidence, not garbage.

## Bundle (frozen)

The moving bundle is for a machine to restore. It is deliberately not F9's Markdown archive, which
is for a person to read.

| Field | Value |
|---|---|
| `format` | `cogmem.brain-bundle`. |
| `version` | `1`. |
| `framing` | 4-byte little-endian manifest length, JSON manifest, then the DB bytes. |
| `manifest` | The snapshot manifest's fields, with `format` and `db` in place of `snapshot`. |
| `restore` | Verify the checksum, write the DB, open it and compare every frozen count. |
| `distinct from` | `cogmem sovereignty export` — Markdown sections for a human reader. |
| `shares with` | The snapshot's `VACUUM INTO` copy, sha256 and count verification. |

Restoring refuses an existing target unless `overwrite` is true, and refuses a checksum or count
mismatch rather than writing a partial brain.

## Recovery drill (frozen)

The drill is the closing condition, not a demonstration. It runs from a clean directory.

| Step | Asserts |
|---|---|
| `export` | A nightly snapshot is written and its verification is `ok`. |
| `restore` | The snapshot restores into a directory with no other brain file. |
| `open` | The restored kernel opens and a recall returns a memory. |
| `ledger` | `events`, `episodes`, `frames` and `atlasDocuments` match item by item. |
| `soul` | Every agent's current `version` and `content` match. |
| `profile` | Every profile entry's `ledger`, `key` and `value` match. |
| `procedures` | Every procedure entry's `domain`, `key`, `title` and `steps` match. |
| `commitments` | Every open commitment's `commitmentId`, `content` and `status` match. |

The script is `scripts/recovery-drill.ts`; its JSON output is the record. A drill that fails does not
close the ticket.

## Observatory health page (frozen)

| Endpoint | Method | Writes | Answer |
|---|---|---|---|
| `/observatory/health` | `GET`, `HEAD` | no | The last health report, the recent Dream runs, the latest frame and atlas compile instants, the latest context-budget receipt, the anomaly counts, and the latest snapshot's verification. |

The page reads the read-only connection. It never runs a check, because a check can record a
transition; the last report is what the shell or `doctor` persisted. A database that has never been
checked answers `checked: false` rather than inventing a status.

## Read-only companion mode (frozen)

| Field | Means |
|---|---|
| `mode` | `read_only` when `db_writable` is degraded, else `normal`. |
| `writes` | `assertWritable` throws `health_read_only`; the kernel's agent-facing write paths call it before appending. |
| `reads` | Recall, the books, the event stream and the observatory read path are unchanged. |
| `status` | `health.check` and `doctor` name the mode; the page shows it. |

## Errors (frozen)

| Code | When |
|---|---|
| `health_read_only` | A write was attempted in read-only companion mode. |
| `invalid_bundle` | The bundle's framing, format or version is not the frozen one. |
| `bundle_checksum_mismatch` | The bundle's DB bytes do not match its checksum. |
| `bundle_counts_mismatch` | The restored database's counts do not match the manifest. |
| `bundle_target_exists` | The restore target exists and `overwrite` is not true. |
| `snapshot_not_found` | A named snapshot or manifest does not exist. |

## API (frozen)

| Method | Does |
|---|---|
| `check` | Run the four checks; record transitions unless `record: false`. |
| `lastReport` | Read the persisted report, or `undefined`. |
| `notice` | Return the Dream-streak notice and its F18 decision, once per streak. |
| `assertWritable` | Throw `health_read_only` in read-only mode. |
| `snapshot` | Write, verify and rotate one nightly snapshot. |
| `list` | List the retained snapshots and their verification. |
| `verify` | Re-verify one snapshot by path. |
| `exportBundle` | Write a machine-restorable bundle. |
| `restoreBundle` | Verify and restore a bundle. |

## What this round wires

- `MemoryKernel.health` runs the self-checks; `doctor` prints them and the snapshot state; the shell
  tick runs `check` so a transition is recorded without a person asking.
- `MemoryKernel.backup.snapshot` runs at the end of `runNight` when a snapshots directory is
  configured. `cogmem backup snapshot|list|bundle|restore` is the operator face.
- The observatory gains a read-only health tab. Its only write remains the soul editor.
- The update boundary is stated rather than invented: 5.0 has **no pre-migration snapshot** — 4.0
  refuses an old database and writes no backup (ADR-0007), and `cogmem snapshot export|import` is
  the one DB snapshot format. The nightly snapshot reuses it, so there is no second format to
  reconcile.
