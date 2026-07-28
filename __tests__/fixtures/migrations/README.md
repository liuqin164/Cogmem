# Historical migration fixtures

`f71b20a-source.sqlite.gz` and `f71b20a-dist.sqlite.gz` were generated from
the exact Cogmem development commit `f71b20a` with Bun 1.3.11. Each database
started as the schema-14 fixture used by `migrate-cli.unit.test.ts`, then ran
the old source or checked-in dist migration CLI through schema 45.

The fixtures intentionally contain the real function-text checksums written by
that runner for receipts 0001 through 0045. Tests expand each database and run
the current source and dist migration CLIs, covering all four artifact upgrade
directions. Do not recreate these files with the current migration runner.

`3.5.2-real.sqlite.gz` was created by the exact `3.5.2` tag
(`5b3e9d0`) through its public `createMemoryKernel()` and
`PolicyExecutionStore`. It retains the original schema-24
`memory_events` table without `project_scope` and an executed legacy policy
record, then checkpoints the WAL before compression.

Compressed SHA-256:

```text
32b6f84ce6ab8a550c2b3d92e8d13d288d8bf98ec197e08f5447928a05b44c00  f71b20a-source.sqlite.gz
b1c623a7dbde28980b2802845fede6ab35788e5ab7d950eb0dd9174b94cd3d4f  f71b20a-dist.sqlite.gz
f004eba9e4244b645f6f71fb6e00037cefbe4a5abe95f2cf82616f08edcf4c59  3.5.2-real.sqlite.gz
```
