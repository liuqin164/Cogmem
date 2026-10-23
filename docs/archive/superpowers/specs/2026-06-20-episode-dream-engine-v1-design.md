# Cogmem 3.5.0 Episode Dream Engine v1

## Decision

Cogmem will preserve every message in the Raw Ledger immediately, but Dream will stop treating an arbitrary raw-event window as its primary consolidation unit. A low-cost, deterministic Episode Assembler groups raw events by project and session, records auditable relations, and seals bounded episodes. A conditional scheduler then claims sealed episodes and passes their exact raw evidence to the existing candidate-only Dream Curator. Existing CPU governance remains the only path to durable semantic memory.

This release does not add online reinforcement learning, foreground LLM classification, automatic durable promotion, or automatic tool execution.

## Architecture

The write and recall lanes are separate:

```text
Write lane:
Raw Ledger -> Episode Assembler -> sealed episode -> Dream Scheduler
           -> episode-grounded candidates -> CPU Governance

Recall lane:
Query -> Strategy Cortex -> Context Cortex -> governed recall pack
```

Strategy Cortex is not downstream of Dream and Episode metadata is not recall evidence. Episode summaries, closure receipts, scheduler receipts, strategy capsules, activation receipts, and memory-use judgments are derived control data. Durable candidates must cite raw event IDs from one project.

## Episode Model

Episode lifecycle and Dream job lifecycle are intentionally independent.

- Episode status: `open`, `soft_sealed`, `sealed`.
- Dream job state: `pending`, `processing`, `processed`, `failed`, `skipped`.
- Soft seals may reopen only inside the same project/session and bounded return window.
- Hard seals never reopen automatically.
- Explicit user closure, manual seal, and import batch boundary can hard-seal.
- Assistant completion, idle timeout, and uncertain topic change can only soft-seal.

Every event belongs to at most one episode. Episode assignment is idempotent. Deterministic noise remains in Raw Ledger with an explicit ignored disposition; it neither extends nor creates an episode and is not misreported as an assembler failure. Classification is deterministic and bounded in v1. An advisory LLM classifier is deferred until it can run asynchronously against a stable proposal contract.

## Dream Scheduling

`dream tick` is a wake-up and policy decision, not a forced full scan. Auto mode selects:

- `none` for no eligible sealed work.
- `micro` for one high-value decision, correction, preference, goal, or prospective episode.
- `normal` for a multi-episode or ordinary sealed backlog.
- `deep` only when explicitly requested in v1.

The scheduler claims each job with an atomic conditional update, recovers expired leases, limits attempts, records a run receipt, and never runs from recall. Candidate generation remains candidate-only unless an operator explicitly requests governance promotion.

Legacy `cogmem memory dream` remains available for compatibility, but uses episode scheduling. The low-level `MemoryKernel.runDreamCurator()` API remains for deliberate migration/repair integrations; normal CLI, MCP, OpenClaw, and Hermes paths cannot silently bypass the episode boundary.

## Ingestion

OpenClaw and MCP/import paths converge after raw write:

- `rememberTurnWithResult` records user/assistant raw events and appends them to one episode synchronously using CPU rules.
- tool/task events join the same open episode when session context permits.
- import commands validate bounded batches before writes, derive stable retry keys when source IDs are absent, scope identities by project/source/session, reject conflicting identity reuse, recover reserved-but-missing raw writes, assemble session batches, and seal at explicit batch boundaries.
- MCP append/import operations are count- and size-bounded and never run Dream implicitly.

Assembler failures are non-fatal: raw evidence stays authoritative, a pipeline metric is recorded, and repair can assign unassigned events later.

## Security Invariants

1. Raw write occurs before interpretation.
2. Episode summaries and receipts cannot satisfy evidence requirements.
3. User-owned memory still requires explicit user-role raw evidence.
4. Assistant/tool-only claims cannot become user-owned durable memory.
5. Cross-project episode evidence is rejected before candidate insertion.
6. `COGMEM_*` blocks and strategy/activation/outcome control data are stripped or rejected.
7. Dream produces candidates only; governance owns promotion, rejection, supersession, and confirmation.
8. MCP recall and OpenClaw `before_prompt_build` never trigger Dream.
9. Import and scheduler claims are idempotent and bounded.
10. `forgetUser(projectId)` purges episode, job, and run rows before raw evidence is removed.

## Public Surfaces

CLI:

- `cogmem episode append|import|list|get|seal|status|repair`
- `cogmem dream tick|status|retry`

MCP:

- `cogmem_episode_append`
- `cogmem_episode_import`
- `cogmem_episode_status`
- `cogmem_episode_seal`
- `cogmem_dream_tick`
- `cogmem_dream_status`

The CLI accepts generic JSONL first. Existing OpenClaw/Hermes importers reuse the same assembler after their existing source-specific parsing and deduplication rather than introducing a second import parser.

## Acceptance Gates

- live and imported events produce the same episode schema;
- related turns group and bounded topic/idle changes seal predictably;
- hard seals do not reopen and soft seals reopen only under safe scope rules;
- empty ticks do nothing and recall never runs Dream;
- one episode cannot be processed twice without explicit reprocessing;
- failed leases can retry without losing evidence;
- every candidate from episode Dream cites raw source events and its source episode;
- governance bypass rate is zero;
- migration, backup/update path, forget-user purge, build, package smoke, and full tests pass.

Practical confidence is conditional on these executable gates. No software change can be guaranteed mathematically, but after all gates pass there is no known structural blocker in the scoped design.
