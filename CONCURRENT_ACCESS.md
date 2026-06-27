# Concurrent Access Contract

`cogmem` uses SQLite as the durable source of truth. The 2.0 vector backend keeps vectors in the same database file by default, so the same concurrency rules apply to memory, facts, embeddings, and vector rows.

## Supported

- Multiple readers may open the same database concurrently.
- One writer process may ingest, consolidate, re-embed, import snapshots, or run vector migrations at a time.
- `cogmem memory status` and `cogmem memory candidates` use a lightweight SQLite read-only/query-only connection and do not initialize a full kernel.
- Short-lived CLI readers such as `re-embed status` are safe while the kernel is running.
- SQLite busy timeout is set to 5000 ms for core-owned database handles.

## Not Supported

- Two writer kernels ingesting into the same database path at the same time.
- Running `importSnapshot()` against a started kernel. The API throws `KernelRunningError` before replacing a live database file.
- Running `migrate-vectors` while another process is writing embeddings or neurons.
- Sharing one `MemoryKernel` instance across workers without external serialization.

## Operational Guidance

- Use a single long-lived writer per database file.
- Let the OpenClaw/Hermes host own that writer. Run one maintenance writer at a time; do not overlap Dream, governance, import, migration, re-embedding, or repair jobs.
- Status/candidate inspection does not require stopping MCP. If a writer reports `SQLITE_BUSY`, wait for the active writer to finish instead of starting another full kernel.
- Use snapshot export/import for backups and promotion between environments.
- Run `cogmem migrate-vectors --db <memory.db> --dry-run` before migrating persisted embeddings into `vector_index`.
- Prefer `vectorBackend: 'sqlite-vec'` for durable local deployments. Use `vectorBackend: 'hnswlib'` only when you explicitly need the legacy in-memory index behavior.
