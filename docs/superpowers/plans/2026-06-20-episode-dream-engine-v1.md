# Episode Dream Engine v1 Implementation Plan

1. Add failing unit tests for deterministic relation classification, episode grouping, soft/hard sealing, reopen rules, idempotent assignment, and project/session isolation.
2. Add schema migration 22 plus `EpisodeStore`, lifecycle types, closure receipts, Dream jobs, leases, and run receipts.
3. Add `EpisodeAssembler`; wire `rememberTurnWithResult`, tool/task ingestion, and existing import loops after authoritative raw writes with non-fatal metrics.
4. Refactor `DreamCuratorWorker` to accept an explicit bounded event set and annotate candidates with source episode metadata without weakening evidence validation.
5. Add `DreamScheduler` with auto mode, atomic leasing, expired-lease recovery, retries, bounded work, audit receipts, and explicit promotion only.
6. Add CLI `episode` and `dream` entrypoints while retaining `memory dream` compatibility.
7. Add bounded MCP episode/dream tools and update Hermes allow-list patching and MCP server instructions.
8. Extend maintenance/map/forget-user and BrainEval episode metrics.
9. Update OpenClaw plugin/skill, Hermes skill, README, changelog, migration/update docs, package/server versions, and release metadata to 3.5.0.
10. Run focused tests, complete test suite, typecheck/build, pack smoke, migration smoke, independent review, and fix all actionable findings before commit/push.
