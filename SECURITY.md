# Security

`cogmem` is local-first by default. Memory data is stored in the configured SQLite database path.

## Data Handling

- Core does not require a hosted storage service.
- TOML is the only kernel configuration entrypoint. Security and governance settings live in `config.toml`; environment variables are only interpolated when explicitly referenced in that file.
- PII redaction is configured under `[governance]` with `pii_redact_email`, `pii_redact_phone`, and `pii_redact_ssn`.
- Field encryption is available by passing an `EncryptionProvider` when creating the kernel.
- Embedding providers may send text to the provider explicitly configured in `config.toml`.
- Snapshot files should be treated as sensitive because they contain exported memory data.
- Imports and migrations should be run with dry-run first when moving existing agent memory into core.
- Raw chronological ledger events are written through the kernel so configured PII redaction runs before persistence. Encrypted deployments still treat ledger payloads as sensitive.
- Agent-facing recall is governed by default: archived memory, suspect LLM inference, suspect tool observations, and suspect unverified claims are suppressed from active context.
- Raw user utterances can be recalled as provenance evidence when explicitly tagged as raw user evidence; this does not promote them into verified facts.
- Recall explanations expose same-project `filteredEvidence` with `reason` and optional `governanceReason`. Scoped explanations must not expose filtered evidence from other projects.

## Session identity

The HTTP transport accepts an `x-cogmem-identity` header that binds a session to
a host, a project, and a tool profile. It is not an authentication mechanism.

- Without a configured token, an unauthenticated client that can reach the
  loopback port may claim any `hostId` and `projectId`, and may narrow the tool
  profile but never widen it.
- With a token, the request is trusted and may set any valid profile. The token,
  not the header, is the boundary.
- A call that names a different `projectId` than the session binding is rejected
  with `project_scope_violation` instead of reading another project's memory.

## Reporting

Report vulnerabilities privately through the repository security advisory flow. Do not open public issues for exploitable security bugs.
