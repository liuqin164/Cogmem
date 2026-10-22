# Cogmem 4.0: seekdb Base + MCP Multi-Host Design

Status: draft v2, awaiting acceptance
Date: 2026-10-22
Supersedes: v1 (SQLite base)
Scope: storage engine replacement, MCP integration surface, shared memory region,
tool profiles, host packaging

## Implementation status (2026-10-22)

Shipped on the SQLite backend, behind the domain ports:

- Six persistence ports (`src/ports/index.ts`) and SQLite adapters, including the
  shared region with idempotent publish and soft retraction.
- Streamable HTTP transport, one kernel per process, one transport per MCP session.
- Tool profiles `core` (6) / `admin` (19) / `full` (33), enforced on both
  `tools/list` and `tools/call`.
- Host configuration for Claude Code, Cursor, Codex, and Hermes in `docs/mcp-hosts.md`.

Still open:

- seekdb adapter behind the same ports; adoption is conditional (see
  `2026-10-22-cogmem-seekdb-evaluation.md`, condition C3 unverified).
- Per-connection project binding (D5): not implemented, `projectId` still comes
  from each call's arguments.


## 1. Goal

Rebuild cogmem on **seekdb** as its storage engine and ship one installable release that
works as a pure memory backend for Claude Code, Cursor, Hermes, and Codex.

There are no existing users, so the storage change needs no data migration and no
compatibility shim. The deliverable is a version that installs clean and runs on all four
hosts.

## 2. Non-goals

- Migrating 3.x SQLite databases. Fresh installs only.
- Hosted or multi-tenant service. No OAuth, no accounts, no cloud deployment.
- Cross-machine shared memory. Everything stays on one filesystem.
- A web UI, dashboard, or hosted API.
- Agent task execution, tool runtime, or skill runtime.
- Windows support beyond what the bindings already provide.

## 3. Storage decision: seekdb

Verified on this host (aarch64 Linux, Node v24.16.0, Bun 1.3.14):

```text
@oceanbase/seekdb-node   embedded open()                       -> OK
mysql2                   connect via unix socket               -> OK
version                  5.7.25-OceanBase seekdb-v1.4.0.0
                         (OceanBase 4.3.5.3)
VECTOR(4) + l2_distance + MATCH...AGAINST + scalar filter      -> OK
INSERT IGNORE                                                  -> OK
under Bun 1.3.14 (not only Node)                               -> OK
```

Why it fits cogmem better than SQLite:

- Vector, full-text, and scalar filters in one execution plan, replacing `sqlite-vec` /
  `hnswlib` plus the application-side merge code.
- Real MVCC and ACID across databases, retiring the single-writer rule in
  `CONCURRENT_ACCESS.md`.
- ~~`FORK DATABASE` / `MERGE TABLE`~~: evaluated and rejected. A database containing
  triggers cannot be forked (`fork database containing triggers not supported`), and
  Cogmem's schema defines 57 triggers. Dream curation keeps application-level staging.
- MySQL protocol, so any MySQL client or BI tool can inspect memory directly.

Cost, measured on this repository:

| Surface | Count |
|---|---|
| Files importing `bun:sqlite` | 81 |
| `new Database(...)` sites | 31 |
| `.prepare(...)` calls | 1,249 |
| `.exec(...)` calls | 294 |
| Synchronous result calls (`.all`/`.get`/`.run`/`.iterate`) | 1,472 |
| `PRAGMA` statements | 68 |
| FTS5 / `MATCH` references | 136 |
| Migration files | 33 |
| Test files touching the driver | 50 |
| `sqlite-vec` / `hnswlib` references | 22 |

This is a persistence-layer rewrite, not a driver swap. `mysql2` is async and
`bun:sqlite` is synchronous, so every one of those 1,472 call sites becomes `await`, and
async propagates up through the kernel, the MCP tools, the CLI commands, and 50 test files.

The cost is accepted: there are no users, and the alternative is carrying a synchronous
facade forever.

## 4. Storage topology

**Decision: one seekdb instance per machine, one database per host, one shared database.**

```text
seekdb instance  (managed process, unix socket + localhost TCP)
  ├── mem_claude    (Claude Code memory)
  ├── mem_cursor    (Cursor memory)
  ├── mem_codex     (Codex memory)
  ├── mem_hermes    (Hermes memory)
  └── mem_shared    (opt-in shared region)
```

Rationale: with one instance, publishing from a host database into `mem_shared` is a single
atomic transaction. With one instance per host, publishing crosses process boundaries and
needs an outbox to stay consistent.

Isolation is still real: each host has its own database, schema, and retention. A corrupted
host database can be dropped and recreated without touching the others. What is given up is
process-level isolation, which has little value for four agents belonging to one person.

The instance is started explicitly:

```bash
cogmem db start          # spawn the managed seekdb process for this machine
cogmem db status         # endpoint, version, per-database size
cogmem db stop
```

The MCP server connects to it and never spawns a private copy. If the instance is down, the
MCP server reports `storage_unavailable` rather than starting its own, so two hosts can
never end up writing two different `mem_shared` databases.

## 5. Accepted decisions

| # | Decision | Rationale |
|---|---|---|
| D0 | seekdb replaces SQLite entirely | Section 3 |
| D1 | Hosts: Claude Code, Cursor, Hermes, Codex | User-selected target set |
| D2 | One database per host, one shared database, one instance | Section 4 |
| D3 | Shared region is `mem_shared` in the same instance | Cross-database publish is atomic |
| D4 | stdio is the default transport; Streamable HTTP is opt-in | All four hosts speak both; stdio stays zero-config |
| D5 | A connection binds exactly one project; conflicting `projectId` arguments are rejected | Removes the current "any caller reads any project" hole |
| D6 | Server-side tool profiles: `core` (6), `admin` (19 = core + every write tool), `full` (33). Default `core` | 33 tools cost context at list time in every host |
| D7 | Shared items are written by their publisher only; subscribers are read-only | Preserves "raw evidence is not rewritten by a third party" |
| D8 | Retraction is soft: hidden from recall, visible in explain/show with `retracted_at` | A subscriber's earlier reasoning must stay explainable |
| D9 | No outbox. Publish is one transaction inside the instance | v1's outbox existed only for WAL cross-file writes, which no longer exist |
| D10 | Dream and governance serialize on an advisory lock table, not a file lock | seekdb handles concurrent writers; the lock protects a logical operation |
| D11 | Version 4.0.0 | Storage engine and API contract both change |
| D12 | Embeddings stay external; vectors stored natively | seekdb stores and searches vectors, it does not call embedding models |
| D13 | Dream curation keeps application-level staging; no FORK/MERGE | Measured: a database with triggers cannot be forked, and Cogmem has 57 |
| D14 | Fresh schema, no migration chain | No users; one `schema.sql` replaces 33 migrations |

Shipped tool counts differ from D6: the implementation landed `core` 8, `admin` 23,
`full` 37, because several read-only graph and episode tools were added after that
decision. `docs/mcp-hosts.md` and the release metadata test carry the shipped numbers.

## 6. SQL dialect migration

| SQLite construct | Occurrences | seekdb / MySQL form |
|---|---|---|
| `ON CONFLICT ... DO UPDATE` | 141 | `ON DUPLICATE KEY UPDATE` |
| `INSERT OR IGNORE` / `INSERT OR REPLACE` | 75 | `INSERT IGNORE` / `REPLACE INTO` |
| `json_extract(x, '$.a')` | 47 | `JSON_EXTRACT(x, '$.a')`, verify unquoting |
| `PRAGMA ...` | 68 | removed, server-level settings |
| `FTS5 MATCH` | 136 | `MATCH(col) AGAINST('...')` |
| `RETURNING` | 2 | `LAST_INSERT_ID()` plus a follow-up select |
| `strftime` | 1 | `DATE_FORMAT` |
| `GLOB` | 4 | `LIKE BINARY` or `REGEXP` |
| `sqlite-vec` / `hnswlib` | 22 | `VECTOR(n)` + `l2_distance` + `APPROXIMATE` ordering |

Each row is a mechanical rewrite, and each is a place where behavior can drift silently, so
each gets a test that asserts the 3.7.5 behavior still holds.

## 7. MCP layer

### 7.1 Connection context

Resolved once per connection: `project`, `agent`, `sharedCollections`. Tool arguments named
`projectId` are validated against the bound project; a mismatch is an error result, not a
silent override.

### 7.2 Tool profiles

| Profile | Tools |
|---|---|
| `core` (default) | `recall`, `remember_turn`, `episode_append`, `graph_explore`, `graph_node`, `explain_recall` |
| `admin` | core + episode repair/seal/import/status/audit, dream tick/status, maintenance tick, candidate review, frame review, topic operations |
| `full` | all 33 |

Selected with `--profile` or `[mcp] profile`. An unknown profile is a startup error.

### 7.3 Shared region schema

```sql
CREATE TABLE mem_shared.shared_publish (
  item_hash     CHAR(64) PRIMARY KEY,
  source_host   VARCHAR(64) NOT NULL,
  source_item   VARCHAR(128) NOT NULL,
  collection    VARCHAR(64) NOT NULL,
  payload_json  JSON NOT NULL,
  embedding     VECTOR(1024) NULL,
  published_at  DATETIME NOT NULL,
  retracted_at  DATETIME NULL,
  retracted_by  VARCHAR(64) NULL,
  FULLTEXT INDEX ft_payload (payload_json)
);
```

Publish writes the local row and the shared row in one transaction. Retraction is an
`UPDATE ... SET retracted_at`. Recall joins the subscriber's own rows with shared rows whose
`collection` is in the connection's `sharedCollections`.

### 7.4 Concurrency

seekdb permits concurrent writers, so the one-writer rule is retired. Dream, governance,
rebuild, and curation acquire a row in `cogmem_lock` keyed by `(database, operation)` with a
lease timestamp. A second holder waits or returns `operation_locked`.

### 7.5 Config

```toml
[core]
project = "hermes"
agent = "hermes"

[storage]
endpoint = "~/.cogmem/seekdb"   # instance data directory
database = "mem_hermes"         # this host's database

[mcp]
transport = "stdio"             # stdio | http
profile = "core"                # core | admin | full
http_port = 0                   # 0 = ephemeral

[shared]
database = "mem_shared"
collections = ["anchor"]        # collections this host publishes and reads
```

Absent `[shared]` disables sharing entirely.

## 8. Host matrix

Runtime requirement for every host: the cogmem MCP server needs the seekdb native binding,
so Node 22+ or Bun 1.3+. The binding is verified on aarch64 Linux only. x86_64 is expected
to work but is unverified and must be tested before release.

### 8.1 Claude Code

```bash
claude mcp add cogmem -- cogmem mcp --project claude --profile core
```

### 8.2 Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cogmem": {
      "type": "stdio",
      "command": "cogmem",
      "args": ["mcp", "--project", "cursor", "--profile", "core"]
    }
  }
}
```

`type: "stdio"` is mandatory in Cursor; an entry without it is ignored.

### 8.3 Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.cogmem]
command = "cogmem"
args = ["mcp", "--project", "codex", "--profile", "core"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Codex reads the MCP `instructions` field, so cogmem's server instructions apply without
extra configuration. Remote form uses `url = "http://127.0.0.1:7717/mcp"` plus
`bearer_token_env_var`. Do not use `codex mcp add --url` on 0.143.x: it writes a config its
own parser rejects.

### 8.4 Hermes

`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  cogmem:
    command: cogmem
    args: ["mcp", "--project", "hermes", "--profile", "core"]
```

## 9. Acceptance criteria

1. `cogmem db start` brings up the instance and `cogmem doctor` reports healthy.
2. A clean install creates the four host databases and `mem_shared` from one `schema.sql`.
3. Each host lists exactly the `core` tools and completes one recall and one write.
4. A memory published from host A is recallable from host B when both share the collection,
   and is not recallable when they do not.
5. A retracted shared item is absent from `recall` and present in `explain_recall` with
   `retracted_at` set.
6. A conflicting `projectId` argument returns an error result.
7. Vector recall returns the correct nearest item for a fixed embedding, proving the native
   index replaced `sqlite-vec` without behavior change.
8. Full-text recall matches the same query set FTS5 matched in 3.7.5.
9. Two hosts writing concurrently to `mem_shared` both commit, with no lock error surfaced.
10. `bun test __tests__` is green, with the async conversion complete and no skipped
    storage tests.

## 10. Verification

- **Storage conformance**: the same assertions that run against SQLite today run against
  seekdb, so dialect rewrites are proven equivalent rather than assumed.
- **Protocol conformance**: an MCP client harness drives initialize, tools/list, and tool
  calls for each profile, asserting tool counts and error shapes for all four hosts.
- **Real hosts**: Claude Code, Codex, and Hermes installed and driven end to end. Cursor is
  validated by config-schema conformance only; its GUI cannot run on this headless host.
- **Backups**: `~/.claude.json`, `~/.claude/`, `~/.codex/`, `~/.cursor/`, and
  `~/.hermes/config.yaml` are copied to `~/backups/hosts-<timestamp>/` before any host test,
  with a `restore.sh` exercised once before the first test.

## 11. Review focus

Uncovered by planned tests, likeliest first:

1. The seekdb process dies mid-transaction: expected a typed `storage_unavailable` result
   and a clean reconnect on the next call, not a hung MCP server.
2. A host database is dropped while its MCP server holds a connection: expected a clear
   error, not silent writes into a missing schema.
3. Two hosts publishing byte-identical content: expected one row, first publisher wins.
4. Recall when `mem_shared` is empty but configured: expected an empty result with a
   diagnostic, not a crash.
5. A `core`-profile host calling an admin tool by name: expected unknown-tool, not a
   permission leak.

## 12. Task breakdown

### Phase 0: storage foundation

- 0.1. Add `src/storage/` with an async `SqlClient` interface (`query`, `execute`,
  `transaction`); test asserts a transaction rolls back on a thrown error.
- 0.2. Implement the seekdb client over `mysql2` plus instance lifecycle
  (`start`/`status`/`stop`); test asserts a second `start` is idempotent.
- 0.3. Write `schema.sql` for the four host databases and `mem_shared`; test asserts a fresh
  instance reaches the expected table set in one run.
- 0.4. Port section 6 into checked helpers (`upsert`, `insertIgnore`, `jsonGet`,
  `fullTextMatch`); test asserts each helper against a live instance.

### Phase 1: store rewrite

- 1.1. Convert `src/store/` (35 files) to the async client; test asserts one store
  round-trips insert, read, and update.
- 1.2. Convert `src/core/MemoryGraph.ts` and the FTS paths to `MATCH ... AGAINST`; test
  asserts the 3.7.5 query set returns the same ids.
- 1.3. Replace `sqlite-vec`/`hnswlib` with a `VECTOR` column and `l2_distance`; test asserts
  nearest-neighbour parity on a fixed corpus.
- 1.4. Convert the 33 migrations into `schema.sql` and delete the migration chain.

### Phase 2: MCP surface

- 2.1. Connection context with project binding; test asserts a conflicting `projectId`
  errors.
- 2.2. Tool profiles; test asserts 6 / 22 / 33 per profile.
- 2.3. Shared publish, recall, and soft retraction; test asserts cross-database atomicity.
- 2.4. Advisory lock for Dream; test asserts the second holder gets `operation_locked`.
- 2.5. Streamable HTTP transport; test performs an initialize handshake over HTTP.

### Phase 3: hosts and release

- 3.1. Back up host configs and exercise `restore.sh`.
- 3.2. Wire Claude Code, Codex, and Hermes end to end; record each receipt.
- 3.3. Cursor config-schema conformance.
- 3.4. README, examples, CHANGELOG, `prepublishOnly`, version 4.0.0.

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Native binding unsupported on x86_64 or musl | Blocks release on other machines | Test x86_64 before release; document aarch64-only if unverified |
| Async conversion changes ordering or transaction boundaries | Silent data races | Convert store by store with a test per store; keep transactions explicit |
| Dialect drift (JSON unquoting, case sensitivity, collation) | Wrong recall results | Section 6 helper set plus a conformance suite comparing to 3.7.5 behavior |
| Instance lifecycle (crash, port conflict, stale socket) | MCP server unusable | `db status`/`doctor` checks, typed `storage_unavailable`, documented recovery |
| FORK/MERGE unavailable for trigger-bearing schemas | No kernel-level curation sandbox | Application-level staging tables stay; do not design around FORK |
| 2.2 GB preallocated disk and ~300 MB RSS per instance | Heavy for a personal install | One instance for all hosts, `datafile_size` 1G minimum, document the footprint |
| Bun SQL type and pooling semantics (DECIMAL as Buffer, `USE` not sticky) | Silent wrong values or cross-database reads | Normalize types in the adapter; fully qualify table names; test both |
