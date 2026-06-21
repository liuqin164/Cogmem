# Changelog

## 3.6.0

- Added Memory Atlas v1, a bounded, project-scoped content graph over existing topics, entities, clusters, episodes, beliefs, action frames, time buckets, relations, and exact raw-event evidence. It is canonical-memory-safe and records only non-evidentiary access/activation telemetry, not a second fact store.
- Added generic query-facet resurrection. Time, target/entity, topic, memory kind, and ordinary query cues work like combined table filters; exact scoped matches can surface cold memory without changing truth, confidence, ownership, or governance state.
- Added graph overview, search, explore, node, neighbors, path, and timeline APIs through the kernel, CLI, and canonical-memory-safe MCP tools. Queries record non-destructive Atlas access/activation telemetry, and every evidence result carries an event ID plus a `cogmem memory show` drill-down command.
- Added deterministic Atlas activation and decay. Frequent navigation raises visibility, maintenance decays it, and cold evidence remains recoverable through exact facets. Database triggers mark only changed projects dirty so normal queries do not rebuild the entire graph.
- Added OpenClaw direct graph exploration through the generated plugin bridge, with bounded volatile `COGMEM_MEMORY_ATLAS` context and no MCP requirement. Hermes receives the same graph surface through MCP.
- Standardized every documented CLI `--json` command on `cogmem.cli.v1`: object payload fields are available at the top level, arrays use `items`, and Dream/status queue counters have stable top-level aliases while legacy nested objects remain during the compatibility window.
- Added schema migration 25 with transaction-safe Atlas projection, action evidence, access/activation, FTS, and dirty-state tables. A 3.5.2 database upgrades with `cogmem migrate --yes --backup --json`; Raw Ledger evidence is preserved.
- Bumped the OpenClaw plugin to 0.6.0 and updated OpenClaw/Hermes skills and runbooks with graph-first navigation and exact-source drill-down rules.

## 3.5.2

- Added the user-shaped Memory Ontology and project-scoped topic path, alias, relation, and governance registries. Explicit user operations are active, audited, and reversible; model proposals stay candidates and alias collisions fail closed for review.
- Wired advisory hybrid classification into asynchronous assembly/import paths while preserving the CPU-only foreground hook. Unknown turns now default to ambiguous review, reviewer fields are allow-listed, assistant context distinguishes proposal acceptance from question/fact answers, and unsafe soft-seal reopen paths are blocked.
- Hardened episode Dream evidence and ownership: invalid provider evidence is rejected without fallback, CPU project scope wins, assistant-only decisions and orphan corrections require confirmation, proposal confirmation uses bounded same-thread history, and summaries remain non-evidence hints.
- Added per-job Dream modes, deep recommendations, persisted per-episode failure diagnostics, multi-action episode status, and hookless recall freshness warnings.
- Added resumable CLI/MCP import diagnostics, ingest-key lifecycle state, source-agent identity validation, and unified asynchronous episode assembly for source imports.
- Added audited episode split, merge, move-event, reclassify, and Dream requeue/invalidation surgery with closure recomputation, cross-references, stale-candidate invalidation, and Dream requeue.
- Added shared malformed `COGMEM_*` block stripping, payload text allow-listing, schema migration 24/parity coverage, new BrainEval reliability gates, OpenClaw plugin 0.5.0, and updated OpenClaw/Hermes agent skills.

## 3.5.1

- Hardened Episode classification with previous assistant/user context, explicit assistant-side relations, confidence and audit signals, safe subtopic/ambiguous/hard switch handling, and an advisory-only hybrid review API that cannot write memory.
- Added non-evidence semantic episode summaries, multi-tag importance metadata, normalized closure reasons, source/thread-scoped active lookup with legacy upgrade fallback, and separate episode/Dream lifecycle state.
- Made micro, normal, and deep Dream modes change curator scope and candidate limits; added retryable, scheduled, and terminal failure states with backoff and episode-level error visibility.
- Enforced raw-event evidence subsets for episode candidates, paired assistant-proposal/user-confirmation evidence, orphan-correction review, decision temporal candidates, and existing prospective-memory deduplication boundaries.
- Replaced line-index import identity with stable source/session/role/time/content identity; added streaming JSONL checkpoints, resume support, confidence-aware batch sealing, and bounded MCP imports.
- Guarded MCP `cogmem_dream_tick` behind `maintenanceMode: true`, enriched hookless-agent status guidance, added schema migration 23, and updated OpenClaw plugin 0.4.1 plus OpenClaw/Hermes skills.

## 3.5.0

- Added Episode Dream Engine v1. Raw messages are still written immediately, while deterministic session-scoped episode assembly gives Dream a bounded conversation-level unit instead of an arbitrary raw-event window.
- Added auditable open, soft-sealed, and sealed episode lifecycle, closure receipts, safe soft reopen, hard-seal protection, one-event-one-episode assignment, repair of unassigned raw evidence, and project-scoped forget cleanup.
- Added conditional `cogmem dream tick`: timers now wake a scheduler that chooses no work, micro, normal, or deep processing from the sealed backlog. Recall and OpenClaw foreground hooks never run Dream.
- Added leased, retryable, idempotent episode Dream jobs and run receipts. Every episode-derived candidate retains `sourceEpisodeId` plus exact raw event evidence and still requires existing CPU governance.
- Scoped message import idempotency to project, source agent, and source session; conflicting reuse is rejected, reserved identities can recover a missing Raw Ledger write, and exhausted Dream leases remain explicitly retryable.
- Added `cogmem episode` and `cogmem dream` CLIs plus bounded MCP episode append/import/status/seal and Dream tick/status tools for hookless Hermes-style agents.
- Unified existing OpenClaw/Hermes imports and live turn recording behind the same episode schema, with explicit batch sealing and duplicate-message protection.
- Added BrainEval episode grouping, boundary, evidence coverage, unassigned rate, candidate grounding, governance bypass, and Hermes import parity gates.
- Updated OpenClaw auto-memory plugin to 0.4.0, Hermes MCP allow-list repair, schema migration 22, package migration/update docs, and all agent-facing skills for the episode-first workflow.

## 3.4.0

- Added Strategy Cortex v1: deterministic current-turn strategy capsules select retrieval lanes, context-layer order, exact-source requirements, and bounded memory budgets before recall.
- Added one-retry deterministic replanning for intent/project changes, unmet source requirements, evidence conflict, and unsatisfied required-layer budgets. No online RL or multi-strategy generation is used.
- Added `COGMEM_STRATEGY_CONTEXT` with no instruction authority and full OpenClaw/Dream/Binding/reasoning-model hygiene so strategy metadata cannot become user evidence or durable memory.
- Added read-only `MemoryUseJudge`, project-scoped context outcome telemetry, offline diverse strategy selection, rollout comparison, and zero-tolerance context policy release gates.
- Added `cogmem strategy plan/outcomes`, `cogmem brain-eval --strategy-rollout` for precomputed offline outcomes, and read-only MCP `cogmem_strategy_plan` for agent inspection.
- Updated OpenClaw auto-memory plugin to 0.3.0 and Hermes MCP allow-list patching for `cogmem_strategy_plan`.
- Added schema migration 21 and extended `forgetUser(projectId)` to purge strategy outcome telemetry.
- Strategy/action separation is inspired by StraTA; Cogmem intentionally keeps online planning deterministic and performs multi-strategy comparison only on precomputed offline outcomes.

## 3.3.0

- Added confirmed-only Prospective Memory for intentions, commitments, reminders, open loops, and plans. Rejected items require new evidence to create a new version, and no execution/dispatch API exists.
- Added `cogmem prospective` candidate-state CLI and `cogmem brain-eval` safety/quality release gate.
- Added `cogmem_prospective` MCP state management with explicit project boundaries and distinct user confirmation evidence; it exposes no execution path.
- Added BrainEval metrics for recall, precision, provenance, budget compliance, stale/cross-project leakage, and unconfirmed prospective activation.
- Added schema migration 20 and completed the 2.8.0-3.3.0 cumulative migration path.
- Made migration backups transaction-consistent and WAL-aware through SQLite's native backup path.
- Extended `forgetUser(projectId)` across governance, entity, belief, temporal, context-receipt, and prospective projections, including shared canonical-alias rebuilding.
- Changed `cogmem update` to fail closed when GitHub has no latest-release metadata instead of silently installing mutable `main`.

## 3.2.0

- Added Context Cortex intent, safety suppression, layer activation, source-first drill-down, and a 25% default/30% maximum memory budget.
- Added persistent activation receipts that explain selected and suppressed memory IDs and reasons.
- Updated OpenClaw auto-memory plugin to 0.2.0: greetings skip memory, short continuations use only session state/turn bridge, and full recall is Cortex-filtered.
- Added schema migration 19.

## 3.1.0

- Added validity-window belief lookup and bounded project/entity timelines for milestones, decisions, corrections, and belief versions.
- Preserved correction reasons, evidence anchors, and supersession history while keeping current-state queries free of stale versions.
- Added schema migration 18 and public `TemporalMemoryService` access through `MemoryKernel`.

## 3.0.0

- Added an evidence-backed Belief Graph with ownership, versions, source roles, conflict records, and supersession chains.
- Enforced explicit user evidence for user-owned preferences, goals, boundaries, decisions, and facts; assistant/tool-only evidence is limited to project observations.
- Added deterministic reinforcement, correction, and contradiction behavior plus schema migration 17.

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
