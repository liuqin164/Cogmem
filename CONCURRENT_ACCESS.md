# Concurrent Access Contract

`cogmem` uses SQLite as the durable source of truth. The 2.0 vector backend keeps vectors in the same database file by default, so the same concurrency rules apply to memory, facts, embeddings, and vector rows.

## Supported

- Multiple readers may open the same database concurrently.
- One writer process may ingest, consolidate, re-embed, or import snapshots at a time.
- `cogmem memory status` and `cogmem memory candidates` use a lightweight SQLite read-only/query-only connection and do not initialize a full kernel.
- Short-lived CLI readers such as `re-embed status` are safe while the kernel is running.
- SQLite busy timeout is set to 5000 ms for core-owned database handles.

## Not Supported

- Two writer kernels ingesting into the same database path at the same time.
- Running `importSnapshot()` against a started kernel. The API throws `KernelRunningError` before replacing a live database file.
- Sharing one `MemoryKernel` instance across workers without external serialization.

## Operational Guidance

- Use a single long-lived writer per database file.
- Let the OpenClaw/Hermes host own that writer. Run one maintenance writer at a time; do not overlap Dream, governance, import, re-embedding, or repair jobs.
- Status/candidate inspection does not require stopping MCP. If a writer reports `SQLITE_BUSY`, wait for the active writer to finish instead of starting another full kernel.
- Use snapshot export/import for backups and promotion between environments.
- Prefer `vectorBackend: 'sqlite-vec'` for durable local deployments. Use `vectorBackend: 'hnswlib'` only when you explicitly need the legacy in-memory index behavior.

## Measured behaviour (2026-10-23)

Probe: `evals/concurrency/writer.ts`, four processes writing 20 turns each with
`immediate_compile`, all against one file.

- **Fresh database, four writers starting together.** Before the migration runner
  re-read its plan under the write lock, three of four processes died during schema
  migration (`table already exists`) and only one wrote turns. After the fix all four
  start, the schema is applied once, and the file still passes `PRAGMA integrity_check`.
- **Initialized database, four writers.** 12 of 80 turns failed with
  `database is locked` (`busy_timeout` is 5000 ms). No duplicates, no corruption.
  A failed call can leave its raw event committed, so a host that retries blindly
  creates a second turn for the same content. Treat `database is locked` as a signal
  to serialize, not to retry.

Four processes hammering one file is adversarial, not typical: two hosts exchanging
occasional turns stay well inside the budget. The contract above still holds, and one
HTTP server per database remains the supported multi-host shape.
