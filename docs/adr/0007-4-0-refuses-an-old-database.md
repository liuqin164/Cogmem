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

## Deliberate deviations from the issue's deletion list

- **The 3.7.3 fixture stays** (`__tests__/fixtures/migrations/main-3.7.3-schema31.sqlite.gz`).
  The issue lists the fixtures for deletion, but this is the only artifact that
  proves the refusal against a *real* released database rather than a synthetic
  one, and after this decision that is its whole purpose. Deleting it would leave
  the refusal tested only against databases this repository made up.
- **`MigrationUtils.ts` and the `v3_7_4` guards stay** (the issue names the
  migration module generally). They are runtime dependencies of the stores, not
  upgrade machinery; deleting them would break belief, entity, binding, and Atlas
  stores on a fresh database.
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
