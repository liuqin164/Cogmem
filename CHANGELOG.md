# Changelog

## 2.9.0

- Added evidence-backed, project-scoped entity merge candidates with stricter explicit-user-evidence requirements for person entities.
- Made entity merges reversible through alias, redirect, archive, and resolution-log operations; source entities are never destructively deleted.
- Unified Memory Binding entity IDs with canonical `EntityStore` identity and added schema migration 16.

## 2.8.0

- Added evidence-backed `MemoryGovernancePlan`, strict CPU validation, idempotency keys, project and ownership checks, transactional execution, and audit records. Missing raw evidence and assistant/tool-only user-owned memory are rejected before persistence.
- Added Memory Binding v1.5 primitives: `TopicPathRegistry`, `ClaimKeyGenerator`, `BindingDecisionEngine`, activation-aware weighted edges, and bounded read-only `BrainGraphView` traversal.
- Split graph edge confidence, stability, and activation so maintenance decay affects memory surfacing rather than historical truth or provenance.
- Added schema version 15 and `cogmem migrate` with dry-run, legacy schema adoption, idempotent migration tracking, and optional pre-migration database backup.
- Changed `cogmem update --yes` to resolve GitHub Releases, install the selected release, and invoke the newly installed schema migration command with backup enabled.

## 2.7.1

- Fixed OpenClaw Markdown role-boundary parsing for empty `user:` / `assistant:` headers with multiline bodies, preventing assistant self-correction text from being attached to the preceding user event. Adjacent exact duplicate exports are collapsed with an import diagnostic while non-adjacent repeats remain chronological evidence.
- Preserved source chronology from OpenClaw headings such as `# Session: 2026-06-06 14:00:43 UTC`; imported turns now use the session start as their ordered timestamp base instead of the downloaded file mtime.
- Changed Dream correction handling so explicit user clarifications become promoted organizational `correction` records instead of false `contradictions`; negative-form questions such as `是不是...` do not trigger correction classification. Assistant self-correction remains conversational evidence and cannot create a user-owned correction.
- Tightened model-proposed conflict candidates: they now require two or more distinct, exact raw event IDs from the current Dream window. Hallucinated IDs and `evidenceEventIds: ["all"]` are rejected instead of being rebound to unrelated window evidence.
- Rejected malformed memory-model output as observable non-fatal provider diagnostics instead of adding queue garbage to `needs_confirmation`; later successful provider runs supersede the diagnostic audit record.
- Added auditable review-queue aging to host-owned maintenance ticks. The default 30-day TTL marks stale `needs_confirmation` candidates `superseded` with a status reason while preserving all evidence rows.
- Added `agent_recall_decision.v1` traces to API, CLI, MCP, explain-recall, OpenClaw audit output, and volatile prompt context. Agent-scoped explain-recall now uses the same selected evidence path as normal agent recall.
- Fixed raw-ledger fallback so Chinese/non-FTS text recovery searches the fully scoped ledger instead of only a recent fixed window. Equal raw cue matches prefer the original user event, and past-memory queries prefer a cue-matching raw user anchor over a compiled assistant retelling.
- Bumped the core schema to version 14 for deep-write candidate `status_reason` and `updated_at` lifecycle metadata.

## 2.7.0

- Added Memory Binding v0: high-value user raw events are now deterministically bound to stable topic/entity paths such as `PROJECT/Cogmem/memory-write-pipeline` during agent turn recording. Bindings are source-anchored organization hints, not promoted facts or beliefs.
- Added Historical Binding, Cluster Fusion, and Graph Recall v1 on top of Memory Binding: same-topic user events now strengthen fused clusters, correction events create review-flagged correction clusters, and agent recall can follow binding graph anchors back to raw ledger evidence before falling back to vector/FTS paths.
- Added Graph Recall v1.1 stabilization: deterministic `BindingClassifier`, project alias/topic keyword routing, claim-key cluster IDs to avoid over-fusion, explicit `CORRECTS`/`CONTRADICTS` correction edges, query-aware graph anchor ranking, observable non-fatal binding failures, `cogmem memory bind` backfill for imported/raw events, and schema version 13 for binding sidecar tables.
- Added `MemoryKernel.listMemoryBindings()`, `MemoryKernel.listMemoryClusters()`, `MemoryKernel.listMemoryEdges()`, `MemoryKernel.bindRawEvents()`, `MemoryKernel.recallMemoryBindingGraph()`, and memory-map counters for binding, topic, entity, cluster, and edge organization so agents can inspect where important raw events are attached before relying on long-term compiled memory.
- Fixed `MemoryKernel.forgetUser(projectId)` to purge durable activation hotspots and memory bindings for the forgotten project, preventing stale memory-map and maintenance-tick exposure.
- Fixed `cogmem connect hermes --auto` so existing Hermes `cogmem-mcp` entries are updated with missing `cogmem_memory_map` and `cogmem_maintenance_tick` tool allow-list entries.
- Reviewed the bounded reasoning, tool schema, and Dream Curator prompt changes: Cogmem recall blocks, turn bridges, and session state remain evidence-only and cannot create durable user memory without explicit user evidence and CPU governance.

## 2.5.0

- Added explicit collection routing for agent recall so operational memory remains the default path while creative artifacts such as `collection:theseus` must be requested intentionally.
- Added `cogmem memory map` / MCP `cogmem_memory_map` for agent and host self-inspection of raw ledger, compiled memory, recall routes, maintenance surfaces, and safety bounds.
- Added `cogmem memory tick` / MCP `cogmem_maintenance_tick` for host-owned maintenance ticks with activation decay and upkeep suggestions, without starting hidden daemons.
- Added OpenClaw context hygiene safeguards: volatile `<COGMEM_RECALL_CONTEXT>`, compact `<COGMEM_TURN_BRIDGE>`, session-only `<COGMEM_SESSION_STATE>`, recall-block stripping before remember, user-only `selective_compile` signals, and current-session compiled-memory exclusion.
- Added labeled source-context replay metadata. Agent-facing `sourceContext` and `cogmem memory show --json` now expose per-event `label`, `textLength`, optional `charRange` / `sourceRange`, and strict before/after `window` metadata with anchor exclusion, chronological ordering, role filter, and overlap handling.
- Changed OpenClaw automatic memory injection to render `sourceWindow`, labeled `sourceBefore` / `sourceAfter`, and `sourceTruncation` metadata so agents can cross-reference injected memory with raw ledger drill-down before quoting exact text.
- Added raw source position propagation from imported source refs into raw ledger events when source offset, line range, or character range is available.

## 2.0.0

- Split the memory kernel into an independently installable core package for GitHub source distribution.
- Added a stable Cogmem home directory with TOML configuration at `~/.cogmem/config.toml`.
- Added `core.vector_dimension` for TOML-based embedding dimension configuration, including high-dimension warnings.
- Removed legacy env-file/global-env configuration entrypoints; TOML is now the only supported configuration surface.
- Added `cogmem init` and `cogmem doctor` for first-run setup and validation.
- Added `cogmem import-openclaw` and `cogmem import-hermes` for command-triggered migration from existing agent workspaces.
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
- Added the unified `cogmem` CLI, `cogmem update`, `cogmem connect openclaw --auto`, and `cogmem doctor --fix --agent openclaw` so OpenClaw can install/repair an automatic recall and turn-recording wrapper without hand-editing runtime files.
- Added selective agent turn ingestion modes so OpenClaw/Hermes can preserve raw ledger evidence without embedding every conversation turn.
- Added raw ledger FTS search through `MemoryKernel.searchRawEvents()` for source discovery and cold recall without requiring per-sentence vectors.
- Added bounded agent-facing `raw_ledger_fallback` after governed compiled recall misses.
- Added dream backlog status helpers for `raw_then_dream` coverage tracking.
- Added `cogmem compact` and `cogmem doctor --storage` for vector-only storage diagnostics and safe compaction.
- Changed the OpenClaw automatic memory wrapper to queue `agent_end` remember jobs and drain them in the background, avoiding synchronous response blocking from slow embeddings or SQLite writes.
- Added best-effort OpenClaw lifecycle capture for tool calls, tool results, and task events when the host hook payload exposes them.
- Added operational noise suppression so heartbeat polls, `HEARTBEAT_OK`, and setup reminders remain auditable evidence but do not enter active agent context by default.
- Added session-aware and forensic recall intents for `KernelAgentMemoryBackend` and the OpenClaw auto-memory wrapper, separating current conversation context from retrieved history and requiring raw ledger anchors for exact wording.
- Added `compileAgentRecallQuery()` and `queryPlan` output for `KernelAgentMemoryBackend.recall()`, so long natural-language memory questions are distilled into bounded recall cues before semantic and raw-ledger lookup.
- Added forensic follow-up anchors (`anchorEventId` / `anchorText`) so adapters can answer "what were my exact words" from the previous raw source event instead of guessing from a vague query or imported summary.
- Added `cogmem memory` / `cogmem-memory` as a local audit console for status, raw ledger listing, raw text search, and event context drill-down.
- Added `MemoryKernel.runDreamCurator()` and `listDreamCandidates()` plus `cogmem memory dream` / `cogmem memory candidates` so `raw_then_dream` produces source-anchored candidate memories and an auditable governance queue without creating vectors or verified facts.
- Added explicit Memory Curator / Dream Worker model support through the existing TOML `[memory_model]` OpenAI-compatible role, including local Ollama or cloud endpoints. Model output is normalized into candidate-only governance records for user preferences, project memories, long-term goals, boundaries, failure lessons, diagnostics, summaries, temporal updates, and conflicts.
- Added dream curator schedule helpers for host-owned `manual`, `interval`, `daily`, and `continuous` workflows without starting a hidden core daemon.
- Added `semanticCuePhrases`, `temporalHints`, and `sourceContext` to agent-facing recall so wording-drift questions such as `记忆黑盒` can find older `存档位置属于黑盒` raw evidence and agents can drill down to exact raw ledger context.
- Added raw ledger anchors for imported OpenClaw/Hermes records so legacy memory files remain searchable through `cogmem memory search/show/recall` after curation while imported summaries stay `canAnswerExactQuote=false`.
- Added `cogmem import-openclaw --reindex-raw` / `cogmem import-hermes --reindex-raw` to backfill raw ledger anchors for records imported by older versions without duplicating compiled memory or hot vectors.
- Added `cogmem memory recall` as an agent-facing active memory search command using `KernelAgentMemoryBackend.recall()` with query plans and source context, so OpenClaw can query CogMem when automatic prompt injection is empty.
- Expanded the Memory Curator / Dream Worker with semantic tag, indexing decision, semantic relation, and edge-adjustment candidates for host-owned curation loops without directly mutating verified memory.
- Added `cogmem memory govern`, `cogmem memory dream --promote`, and `cogmem memory dream --watch` so hosts can run a supervised curation/governance loop without cron-only polling or unbounded candidate backlog.
- Added `KernelAgentMemoryBackend.recallPack()` with direct recall, associative graph/activation neighbors, entity cards, belief touches, and a charge vector for pre-answer agent context assembly.
- Added persistent activation tracking plus `MemoryKernel.runMaintenanceTick()` and `cogmem memory tick` for explicit host-owned upkeep suggestions without starting a hidden daemon.
- Added `MemoryKernel.buildMemoryMap()` and `cogmem memory map` so agents and hosts can inspect memory anatomy, data lanes, hard bounds, counters, and recommended commands.
- Added collection routing via `collection:<name>` tags and `--collection`, keeping `collection:theseus` creative artifacts out of default operational recall unless requested explicitly.
- Added MCP `collection` support for `cogmem_remember_turn`, `cogmem_recall`, and `cogmem_explain_recall`, plus new `cogmem_memory_map` and `cogmem_maintenance_tick` tools.
- Added CPU promotion handling for source-anchored summaries/preferences and semantic organization candidates while keeping uncertain claims in `needs_confirmation` and never upgrading them to verified facts automatically.
- Deduplicated Dream Curator provider warnings and supersede stale provider diagnostics after a later successful structured memory-model run.
- Added Hermes `state.db` import support for SQLite `messages` history, including explicit `--state-db`, automatic workspace-root discovery, source-anchored raw ledger records, and message timestamp precedence over `InsertTime`.
- Added Hermes JSONL session-export normalization for one-session-per-line objects with `messages[]`.
- Fixed semantic relation candidates so promoted records keep a readable `content.summary` instead of empty organization metadata.
- Fixed agent-facing raw fallback recall to retry host-neutral keyword cues and avoid returning duplicate user/assistant events from the same turn.
- Fixed the one-line installer so `curl | bash` starts `cogmem init` from `/dev/tty` instead of consuming an exhausted pipe.
- Fixed `cogmem update` so `latest` dynamically resolves the GitHub latest release payload instead of fabricating a nonexistent `releases/latest/download/cogmem.tgz` package URL.
- Fixed Hermes active recall when `vectors=0` by letting agent-facing recall fall back to source-anchored raw ledger evidence for imported Hermes records instead of filtering them out by source id.
- Fixed agent-facing recall quality when universe navigation returns non-matching compiled candidates by preferring raw ledger cue matches; inventory queries now expand into structured cues such as `库存管理`, `在库`, `产品コード`, and `数量`.
- Fixed MCP `cogmem_recall` to use the same agent-facing recall backend as `cogmem memory recall`, so project-only Hermes calls can return raw ledger fallback items with `sourceContext` instead of empty `items` when compiled evidence or vectors are absent.
- Fixed `cogmem memory status --json` to expose stable top-level `rawEvents`, `vectors`, `dreamedRawCount`, `undreamedRawCount`, and `dreamCoverageRate` fields.
- Fixed Hermes `state.db` and JSONL transcript timestamp handling for numeric epoch-second message timestamps, and added WAL-mode SQLite immutable read fallback for `state.db`.
