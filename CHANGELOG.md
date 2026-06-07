# Changelog

## 2.0.0-rc.1

- Split the memory kernel into an independently installable core package for GitHub source distribution.
- Added a stable Cogmem home directory with TOML configuration at `~/.cogmem/config.toml`.
- Added `core.vector_dimension` for TOML-based embedding dimension configuration, including high-dimension warnings.
- Removed legacy env-file/global-env configuration entrypoints; TOML is now the only supported configuration surface.
- Added `cogmem-init` and `cogmem-doctor` for first-run setup and validation.
- Added `cogmem-import-openclaw` and `cogmem-import-hermes` for command-triggered migration from existing agent workspaces.
- Added `KernelAgentMemoryBackend` for external agent integrations.
- Routed `KernelAgentMemoryBackend.recall()` through universe navigation by default, with BrainRecall retained as fallback.
- Exported the pulse/universe retrieval orchestrators for advanced agent integrations.
- Added core-native OpenClaw and Hermes workspace profiles.
- Added agent-facing OpenClaw and Hermes runbooks under `examples/*-backend/AGENTS.md`.
- Added snapshot, vector backend, governance, PII redaction, and encryption release hardening.
- Added a GitHub-only release checklist; `npm pack --dry-run` is used for artifact verification, not npm publishing.
- Added Chronological Memory Ledger helpers for raw event replay, source anchors, sourceRefs, and recall explanation drill-down.
- Added JSON/JSONL/CSV/TSV normalization source anchors and agent lifecycle facade methods for tool calls, tool observations, and task events.
- Added `cogmem-normalize-transcript` for dry-run friendly transcript normalization into source-ref Markdown before import.
- Added `memory_natural_emergence` benchmark baselines for critical recall, old-important recall, stale/superseded/suspect leakage, cross-project leakage, provenance completeness, context budget efficiency, pulse expansion, and inhibition correctness.
- Added the unified `cogmem` CLI, `cogmem update`, `cogmem-connect openclaw --auto`, and `cogmem-doctor --fix --agent openclaw` so OpenClaw can install/repair an automatic recall and turn-recording wrapper without hand-editing runtime files.
- Added selective agent turn ingestion modes so OpenClaw/Hermes can preserve raw ledger evidence without embedding every conversation turn.
- Added raw ledger FTS search through `MemoryKernel.searchRawEvents()` for source discovery and cold recall without requiring per-sentence vectors.
- Added bounded agent-facing `raw_ledger_fallback` after governed compiled recall misses.
- Added dream backlog status helpers for `raw_then_dream` coverage tracking.
- Added `cogmem compact` and `cogmem-doctor --storage` for vector-only storage diagnostics and safe compaction.
- Changed the OpenClaw automatic memory wrapper to queue `agent_end` remember jobs and drain them in the background, avoiding synchronous response blocking from slow embeddings or SQLite writes.
- Added best-effort OpenClaw lifecycle capture for tool calls, tool results, and task events when the host hook payload exposes them.
- Added operational noise suppression so heartbeat polls, `HEARTBEAT_OK`, and setup reminders remain auditable evidence but do not enter active agent context by default.
- Added session-aware and forensic recall intents for `KernelAgentMemoryBackend` and the OpenClaw auto-memory wrapper, separating current conversation context from retrieved history and requiring raw ledger anchors for exact wording.
- Added `compileAgentRecallQuery()` and `queryPlan` output for `KernelAgentMemoryBackend.recall()`, so long natural-language memory questions are distilled into bounded recall cues before semantic and raw-ledger lookup.
- Added forensic follow-up anchors (`anchorEventId` / `anchorText`) so adapters can answer "what were my exact words" from the previous raw source event instead of guessing from a vague query or imported summary.
- Added `cogmem memory` / `cogmem-memory` as a local audit console for status, raw ledger listing, raw text search, and event context drill-down.
