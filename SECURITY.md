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
a host and a project, and sets a default tool profile. It is not an
authentication mechanism.

- Without a configured token, an unauthenticated client that can reach the
  loopback port may claim any `projectId` when the server was started without
  `--project`, and may choose a profile up to the profile the server launched with,
  never beyond it. It may **not** claim a `hostId`: a `hostId` says which agent
  the call runs as, so it is honoured only on an authenticated connection and is
  otherwise ignored, leaving the call running as the server rather than as the
  name in the header.
- With a token, the request is trusted and may set any valid profile. The token,
  not the header, is the boundary.
- With an agent registry (`<workspace>/.cogmem/agents.json` first, then
  `~/.cogmem/agents.json`, or `--agents <path>`), the presented credential
  authenticates *which agent* the connection is: it decides `hostId`, the project
  that agent is confined to, and its profile ceiling. A request presenting no
  registered credential is refused with `401`, including on loopback. The header
  keeps its role — narrowing those fields — and a `hostId` that disagrees with
  the credential is rejected with `host_identity_mismatch`. The stdio transport
  reads the credential from `COGMEM_AGENT_TOKEN` and refuses without it when a
  registry is loaded.
- **A credential that cannot be identified is refused.** If a connection presents
  a credential and no registry can be found to match it — or the registry named by
  `--agents` does not exist — the connection is rejected rather than served as an
  anonymous single agent with project access. No registry *and* no credential is
  the supported single-agent case, and is a different answer.
- A bound project cannot be switched: a differing `projectId` is rejected with
  `project_scope_violation` instead of reading another project's memory.
- The header is read per call, and a malformed header is ignored rather than
  rejected. Set `--project` when project isolation must not depend on what the
  client sends.

## Reporting

Report vulnerabilities privately through the repository security advisory flow. Do not open public issues for exploitable security bugs.
