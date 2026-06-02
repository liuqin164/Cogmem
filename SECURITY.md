# Security

`@CognitiveOS/core` is local-first by default. Memory data is stored in the configured SQLite database path.

## Data Handling

- Core does not require a hosted storage service.
- TOML is the only kernel configuration entrypoint. Security and governance settings live in `config.toml`; environment variables are only interpolated when explicitly referenced in that file.
- PII redaction is configured under `[governance]` with `pii_redact_email`, `pii_redact_phone`, and `pii_redact_ssn`.
- Field encryption is available by passing an `EncryptionProvider` when creating the kernel.
- Embedding providers may send text to the provider explicitly configured in `config.toml`.
- Snapshot files should be treated as sensitive because they contain exported memory data.
- Imports and migrations should be run with dry-run first when moving existing agent memory into core.
- Agent-facing recall is governed by default: archived memory, suspect LLM inference, suspect tool observations, and suspect unverified claims are suppressed from active context.
- Raw user utterances can be recalled as provenance evidence when explicitly tagged as raw user evidence; this does not promote them into verified facts.
- Recall explanations expose same-project `filteredEvidence` with `reason` and optional `governanceReason`. Scoped explanations must not expose filtered evidence from other projects.

## Reporting

Report vulnerabilities privately through the repository security advisory flow. Do not open public issues for exploitable security bugs.
