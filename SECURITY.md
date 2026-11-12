# Security

Cog is local-first by default. Memory data is stored in the configured SQLite database path.

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

## Agent roster

A registry file (`<workspace>/.cogmem/agents.json` first, then `~/.cogmem/agents.json`, or the
`--agents <path>` flag on `cogmem observatory`) lists the agents this install owns. It is a
roster, not an authentication mechanism: since R3 of #200 it carries names and project scopes
only, and there is no credential to present or compare.

- The roster is read-only. Nothing in this install mints a credential or looks one up; a
  `token`/`tokenDigest` field left behind in a file an older install wrote is ignored rather
  than trusted.
- A roster named by `--agents` that cannot be read is refused at startup instead of being
  treated as "no roster": an operator who believes the roster is in effect must not silently get
  an install that ignores it.
- No roster is the supported single-agent case, and is a different answer from a named roster
  that cannot be read.

## Reporting

Report vulnerabilities privately through the repository security advisory flow. Do not open public issues for exploitable security bugs.
