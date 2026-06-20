# Episode Dream Engine 3.5.1 Hardening Plan

1. Add regression tests for rich user/assistant context, short proposal acceptance/rejection, assistant-side relations, correction detection, and hard/subtopic/ambiguous topic movement.
2. Add schema migration 23 for episode audit metadata, semantic summaries, normalized closure reasons, Dream lifecycle fields, retry metadata, and active thread/source scope.
3. Upgrade the deterministic classifier and Episode Assembler while keeping live ingestion CPU-only and recording advisory review requirements.
4. Generate seal-time semantic summaries from raw events, preserve raw event IDs as the only evidence, and soft-seal low-confidence imported batches.
5. Pass Dream mode and episode metadata into `DreamCuratorWorker`, enforce candidate evidence subsets, cap candidates by mode, and add controlled terminal/retryable failure handling.
6. Replace line-index import identities with normalized stable identities; stream CLI JSONL with checkpoints and keep MCP imports bounded and prevalidated.
7. Guard MCP `dream_tick` with maintenance mode and enrich episode status for hookless agents.
8. Update OpenClaw/Hermes skills, plugin instructions, README, changelog, migration/update documentation, versions, and package metadata to 3.5.1.
9. Run focused tests after each batch, then full tests, typecheck, build, package dry run, migration smoke, pre-landing review, and adversarial review.

## Explicit Deferrals

- Full episode split/merge/move after promotion.
- Multi-worker Dream concurrency and global project fairness.
- Foreground LLM relation classification.

These items require protocols beyond a 3.5.1 hardening patch and are not counted as incomplete acceptance criteria for this release.
