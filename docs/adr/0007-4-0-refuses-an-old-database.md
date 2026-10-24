# 4.0 is a clean start: an old database is refused, never upgraded

4.0 ships on a different schema baseline from 3.7.x, and until now a released
3.7.3 database was **upgraded in place** the first time 4.0 opened it: the kernel
detected the inherited `0015..0031` receipts, took a standalone backup, replayed
`0032`, and carried the data forward. That path is being withdrawn deliberately,
so this records why, what "refused" means precisely, and what has to change for
the code to agree.

## The decision

**4.0 does not migrate a pre-4.0 database.** Opening one is refused with an
actionable message; the file is not modified and no backup is written. The
operator keeps that database for Cogmem 3.7.x, or starts a new 4.0 database and
moves history across with 3.7.x's own export.

**A fresh database is still created, and that path stays.** "Clean start" means
the *upgrade* is gone, not that 4.0 cannot make a database. The empty-database
path — `FINAL_TABLES`, `FINAL_AUXILIARY_OBJECTS`, and the runtime guards, then
`_cogmem_bootstrap_state` — is the part that must keep working, and it is covered
by `__tests__/fresh-file-database.unit.test.ts`.

**The refusal is not a new failure mode.** A database that is neither 4.0-shaped
nor a healthy 3.7.3 release is already rejected today
(`unsupported_database_identity`, `unsupported_release_schema:<version>`,
`unsupported_release_schema:gap`). Those stay exactly as they are. Only the
branch that *accepted* a healthy 3.7.3 database changes: it now refuses, and it
refuses with a message that says what to do instead of a code that says what went
wrong.

## Why withdraw it rather than keep it working

- **It cannot be tested against the real thing any more.** The upgrade was
  verified through a 3.7.3 fixture plus a receipt-and-digest scheme that only
  worked because 4.0 still shipped the historical remit. A migration whose
  correctness rests on machinery the release is trying to delete is a liability
  that grows every release, and the fixture ages out of usefulness.
- **A silent in-place upgrade is the expensive kind of surprise.** It rewrites
  the operator's only copy on first open. The backup was a real mitigation, but
  it is still an irreversible write triggered by a read.
- **The 4.0 baseline is not 3.7.x plus a step.** 4.0 removed the search-path
  columns and the runtime state tables that 3.7.x wrote and cannot be attributed
  to a project, so "upgraded" already meant "canonical evidence kept, runtime
  read models discarded". That is a data-loss-shaped operation that has to be
  stated, and refusing says it in one sentence.

## What has to change, and in what order

The work is a deletion plus one replacement. The replacement comes first, because
deleting the runner before it lands removes fresh-database creation:

1. **Replace fresh-database creation with a direct final-schema application.**
   Today a brand-new file goes through `SchemaMigrationRunner` with
   `[migration_0032]`, which applies `FINAL_TABLES` + `FINAL_AUXILIARY_OBJECTS`
   for the fresh case and is also where `PRAGMA temp_store = MEMORY` is set (the
   fix for VACUUM-adjacent temp-file spills, #61). A `createFinalSchema(db)`
   function has to take over both jobs, and `__tests__/fresh-file-database.unit.test.ts`
   is the test that proves it did.
2. **Turn the 3.7.3 acceptance branch into the refusal** in
   `SchemaMigrationRunner.assertSupportedReleaseSchema`, leaving the malformed
   and unknown cases untouched. Invert the upgrade tests in
   `__tests__/schema-migration.unit.test.ts` to assert refusal *and* that the
   fixture file is unchanged — "refused, not modified, not backed up" is the
   claim, so it has to be observed on the file.
3. **Delete the replay machinery**: `SchemaMigrationRunner`, `ALL_MIGRATIONS` /
   `KERNEL_MIGRATIONS`, `MigrationBackup`, `MigrationDigestManifest`, and
   `0032_multidimensional_memory_graph_3_7_4` — after step 1 has taken what it
   still needs. `src/migrations/v3_7_4/FinalSchemaDefinition.ts` and
   `FinalRuntimeGuards.ts` **stay**: stores import the guards at runtime, and the
   schema definition is the fresh-database schema. `MigrationUtils.ts` stays for
   the parts `PrivacyDeletionRegistry` and `MemoryAtlasIndexer` import.
4. **Delete the operator surface**: `src/bin/migrate.ts`,
   `src/bin/migrate-vectors.ts`, their `bin` entries and dispatch in
   `src/bin/cogmem.ts`, `scripts/verify-packed-migration.ts`, the
   `verify:packed-migration` script and its place in `prepublishOnly`, and the
   references in `.github/workflows/publish.yml`, `RELEASE_CHECKLIST.md`,
   `AGENTS.md`, `CONCURRENT_ACCESS.md`, `README.md`, `MEMORY_MODEL.md`,
   `MEMORY_ATLAS.md`, and the two `examples/*-backend` bundles that install an
   operations handbook telling people to run `cogmem migrate`.
5. **Say it in the documents**, in the same change as the code: the README
   upgrade section becomes "fresh install, no migration", and the CHANGELOG entry
   that currently describes the 3.7.3 → 4.0 upgrade is replaced by the refusal.

**The gate chain changes with it.** `bun run verify:packed-migration` verifies
that a packed tarball can upgrade a schema31 fixture; once the upgrade is gone
there is nothing for it to verify, so it goes, and `prepublishOnly` ends at
`npm pack --dry-run`. A release check that asserts a withdrawn behaviour is worse
than no check.

## What the first implementation attempt found

Written down because each of these cost real time to discover, and every one of
them changes how the change should be made.

- **A fresh 4.0 database has an empty `_schema_migrations` table.** The schema
  installer creates it; the migration runner used to fill it, and the runner is
  going away. So "the receipts table exists" is not evidence of an old database —
  reading a non-empty table as the signal is required, or the check refuses the
  databases this build just created. (First attempt: four test failures from
  exactly this.)
- **`_meta.schema_version = '32'` is the cheap 4.0 marker.** The kernel writes it
  once a database is set up. It is what separates "created by this release" from
  "a SQLite file someone pointed us at" without touching the schema.
- **Do not run the schema scan on the open path.** The existing gate accepted a
  4.0 database *without* walking the schema, because a recorded receipt made the
  plan empty. Adding the walk to every open made each kernel start slow enough
  that `snapshot.integration.test.ts` went from about half a second per test to
  nearly three, and one test crossed the suite's five-second budget. Accept on
  the `_meta` marker; run `finalSchemaIssue` only when the marker is absent, or
  from an explicit verify command.
- **`PRAGMA temp_store = MEMORY` has to move with the work it protects.** The
  runner set it before installing, which is the #61 fix for a temp directory that
  cannot be written. `createFinalSchema` must set it too — this trap was called
  out here when the decision was written, and was still walked into.
- **The refusal cannot land alone.** While `cogmem migrate` exists and the README
  documents it, a kernel that refuses an old database contradicts a command that
  upgrades one. The kernel change, the command/script deletions, and the document
  changes are one commit, not three.
- **`unsupported_release_schema:*` collapses into the refusal.** Health and gap
  checks existed to decide whether an upgrade was safe; with no upgrade there is
  nothing to be safe for, so any non-empty pre-4.0 history is refused the same
  way. That is why the issue lists those codes for deletion, and it is a
  simplification rather than a loss.

## Deliberate deviations from the issue's deletion list

- **The 3.7.3 fixture goes, and the refusal is tested against a synthetic
  database instead** (`__tests__/fixtures/migrations/` is deleted, as the issue
  lists). An earlier draft of this ADR argued for keeping it, because a real
  released database is stronger evidence than one the repository makes up. It was
  overruled by the acceptance, which asks for the fixtures to be gone, and the
  test builds the shape it needs explicitly: `_meta` at version 31 plus receipts
  `0015`-`0031`. That is honest about what is being tested — the *shape* 4.0 must
  refuse — and it does not leave a 1 MB gzip in the tree for one assertion.
- **`MigrationUtils.ts` and the `v3_7_4` guards stay** (the issue names the
  migration module generally). They are runtime dependencies of the stores, not
  upgrade machinery; deleting them would break belief, entity, binding, and Atlas
  stores on a fresh database.
- **The fixture-based rehearsal moved into `RELEASE_CHECKLIST.md`.** With the
  fixture gone, the checklist builds a 3.x-shaped database with `bun -e` and
  checksums it before and after the refusal, which is the same evidence a person
  can reproduce. The recorded measurements of the deleted upgrade (18 receipts,
  the 1,458,512 B backup) were removed rather than restated: they describe a path
  that no longer exists.
- **The test files are edited per case, not deleted whole.** The issue scopes
  this to "the cases for upgrading an old database"; `schema-migration.unit.test.ts`
  also covers the 4.0 identity and digest checks, which are still the guards on a
  database 4.0 *does* open.

## Consequences

- An operator upgrading from 3.7.x gets a clear refusal on first open instead of
  a rewrite. The cost is real: there is no supported way to carry a 3.7.x
  database into 4.0, and that has to be said plainly wherever upgrades are
  discussed rather than implied away.
- `_schema_migrations` keeps its meaning as "what this file has had applied", and
  the digest manifest stops existing. A 4.0 database is identified by its schema
  and its single receipt, not by a chain of historical ones.
- Roughly 1,500 lines of migration body stop shipping, along with the digest
  manifest and the backup helper. The next release has one schema path instead of
  two.
- Nothing about this decision is reversible by configuration. It is a release
  boundary, and the honest version of it is a refusal that names an alternative.
