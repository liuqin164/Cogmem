# @CognitiveOS/core

Durable, local-first memory for agent frameworks.

`@CognitiveOS/core` is the standalone memory kernel. It does not import or require CognitiveOS. Use it when an agent such as OpenClaw, Hermes, LangGraph, or a custom runtime needs long-term memory with recall, provenance, snapshots, optional PII redaction, and optional encryption.

## Install

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
```

Core uses Bun because the default storage path uses `bun:sqlite`.

## Configure

For new users, start with the interactive wizard:

```bash
./node_modules/.bin/cogmem-init
./node_modules/.bin/cogmem-doctor
```

For automation or CI smoke tests:

```bash
./node_modules/.bin/cogmem-init --yes --agent none --dry-run
```

The wizard creates a stable Cogmem home directory. By default this is `~/.cogmem`; project-local installs can use `cogmem-init --scope project`.

```text
~/.cogmem/
  config.toml
  memory.db
  embeddings/
  snapshots/
  logs/
```

The main configuration lives at `~/.cogmem/config.toml`:

```toml
[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 384

[governance]
pii_redact_email = true
pii_redact_phone = true
pii_redact_ssn = true
encryption = false
```

Set `core.vector_dimension` to match the embedding model output. For example, `qwen3-embedding:8b` uses 4096 dimensions. High dimensions are supported, but `cogmem-doctor` warns at 2048+ dimensions because 4096-dimensional Float32 vectors use about 1.53 GiB for 100,000 memories before SQLite/index overhead.

TOML is the only configuration entrypoint. Environment variables are not read as global kernel configuration; they are only interpolated when explicitly referenced inside `config.toml`, for example `api_key = "${ANTHROPIC_API_KEY}"`.

## SDK Quickstart

```ts
import { createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();

await kernel.ingest({
  content: 'The build must run with Bun because storage uses bun:sqlite.',
  projectId: 'demo-agent',
});

const recall = kernel.recall('what runtime does the build use?', {
  projectId: 'demo-agent',
  limit: 5,
});

console.log(recall.rawEvidence.map((item) => item.content));
```

## Agent Backend Facade

External agents should prefer `KernelAgentMemoryBackend` over low-level graph APIs.

```ts
import { KernelAgentMemoryBackend, createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);

await memory.rememberTurn({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  sessionId: 'session-1',
  userText: 'Use sqlite-vec for the public release.',
  assistantText: 'Stored.',
});

const result = memory.recall({
  agentId: 'openclaw',
  projectId: 'workspace-a',
  query: 'which vector backend should the release use?',
});

console.log(result.recallMode); // "universe_navigation" unless the old recall path was needed
console.log(result.narrative?.headline);
console.log(result.pulseTrace);
console.log(result.temporalTraversal?.labels);
console.log(result.items);
```

`KernelAgentMemoryBackend.recall()` routes through universe navigation first. That means core activates related entities, temporal branches, and graph neighbors, assembles a narrative summary, and returns context that is already prepared for the agent. `MemoryKernel.recall()` remains available as the lower-level BrainRecall path; the backend uses it only as a fallback when universe navigation yields no scoped evidence.

## OpenClaw

Core includes a first-party OpenClaw workspace profile. It recognizes `USER.md`, `SOUL.md`, `PERSONA.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`, and session export folders.

To install the agent-facing skill file into an OpenClaw workspace:

```bash
./node_modules/.bin/cogmem-connect openclaw --workspace .
```

This writes `<workspace>/skills/cogmem-memory/SKILL.md`, OpenClaw's workspace skill location. The skill tells an agent how to install, validate, dry-run migration, migrate, and wire `KernelAgentMemoryBackend` without changing OpenClaw host config automatically.

Run the command after configuration to migrate existing OpenClaw memory into the kernel:

```bash
./node_modules/.bin/cogmem-init --agent openclaw
./node_modules/.bin/cogmem-doctor
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

```ts
import { OpenClawWorkspaceProfile, createMemoryKernelFromConfig } from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const profile = new OpenClawWorkspaceProfile(process.cwd());

for (const source of profile.buildInstalledBatchSources({ projectId: 'openclaw' })) {
  // Use MarkdownSourceLoader plus the exported source adapters to ingest source records.
  console.log(source);
}
```

See `examples/openclaw-backend/README.md` and `examples/openclaw-backend/SKILL.md`.

## Hermes

Core includes a conservative Hermes profile for filesystem-based memory exports:

- `profile.md` as durable profile/persona memory
- `sessions/**/*.md` as conversation/session memory

To install the agent-facing skill file into a Hermes workspace:

```bash
./node_modules/.bin/cogmem-connect hermes --workspace .
```

This writes `~/.hermes/skills/cogmem-memory/SKILL.md`, Hermes's primary skill location. The skill tells an agent how to install, validate, dry-run migration, migrate, wire `KernelAgentMemoryBackend`, and add the optional `cogmem-mcp` server without changing `~/.hermes/config.yaml` automatically.

Run the command after configuration to migrate existing Hermes memory into the kernel:

```bash
./node_modules/.bin/cogmem-init --agent hermes
./node_modules/.bin/cogmem-doctor
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes
```

If a Hermes install uses different paths, pass `profilePath` and `sessionDir` explicitly.

```ts
import { HermesWorkspaceProfile } from '@CognitiveOS/core';

const profile = new HermesWorkspaceProfile(process.cwd());
const sources = profile.buildSourceDefinitions({
  projectId: 'hermes',
  profilePath: 'profile.md',
  sessionDir: 'sessions',
});

console.log(sources);
```

See `examples/hermes-backend/README.md` and `examples/hermes-backend/SKILL.md`.

## CLI

```bash
cogmem-init              # interactive setup
cogmem-doctor            # validates config.toml and opens the kernel
cogmem-connect           # install OpenClaw/Hermes agent-facing SKILL.md files
cogmem-explain-recall    # explain pulse/temporal/narrative recall decisions
cogmem-mcp               # stdio MCP server exposing cogmem memory tools
cogmem-import-openclaw   # migrate OpenClaw workspace memory into core
cogmem-import-hermes     # migrate Hermes profile/session memory into core
cogmem-snapshot          # export/import snapshot helper
cogmem-re-embed          # re-embedding helper
cogmem-migrate-vectors   # vector backend migration helper; uses config vector_dimension unless --dimension is passed
```

## Public API Policy

The package entrypoint exports explicit stable and beta symbols only. Internal implementation stores and compilers are not exported from `@CognitiveOS/core`.

Stable integration APIs include `MemoryKernel`, `createMemoryKernelFromConfig()`, `KernelAgentMemoryBackend`, `OpenClawWorkspaceProfile`, and `HermesWorkspaceProfile`. Advanced recall orchestration symbols such as `UniverseNavigator`, `PulseRetrievalEngine`, `TemporalBranchSearch`, `NarrativeRecallAssembler`, `explainRecallWithKernel`, and the `listCogmemMcpTools` / `callCogmemMcpTool` helpers are exported as beta APIs for agents that need direct inspection, custom routing, or MCP hosting.

## Development

```bash
bun run --filter '@CognitiveOS/core' typecheck
bun run --filter '@CognitiveOS/core' build
bun run --filter '@CognitiveOS/core' test
```

Release dry-run:

```bash
cd packages/core
npm pack --dry-run --json
npm publish --dry-run --tag rc
```
