# Hermes Backend

Use core as a Hermes-compatible durable memory backend through a narrow filesystem contract.

## Default Contract

- `profile.md` contains durable profile/persona memory.
- `sessions/**/*.md` contains conversation/session memory.

## Install

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
./node_modules/.bin/cogmem-connect hermes --workspace .
./node_modules/.bin/cogmem-init --agent hermes
./node_modules/.bin/cogmem-doctor
```

## Local Quantized Embeddings

Imports use the configured kernel embedder. To import existing Hermes memory through a local quantized model, configure the kernel before running the import command:

```bash
ollama pull qwen3-embedding:0.6b
```

```toml
[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 1024

[embedding]
provider = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "qwen3-embedding:0.6b"
```

Use the matching vector dimension for the selected model. `qwen3-embedding:4b` uses 2560 dimensions and `qwen3-embedding:8b` uses 4096 dimensions.

## Migrate

Preview:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run
```

Import:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes
```

If Hermes stores memory somewhere else:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --profile ./memory/profile.md --sessions ./memory/sessions
```

Single session files and batches can be imported explicitly:

```bash
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md
./node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --session ./one.md --session ./two.md
```

The import command is idempotent. Re-running it against the same database skips records already processed by the cursor store.
Imported records are embedded through the configured kernel embedder during import.

## Runtime

```ts
import {
  HermesWorkspaceProfile,
  KernelAgentMemoryBackend,
  createMemoryKernelFromConfig,
} from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);
const profile = new HermesWorkspaceProfile(process.cwd());

const sources = profile.buildSourceDefinitions({
  projectId: 'hermes',
  profilePath: 'profile.md',
  sessionDir: 'sessions',
});
console.log(sources);

await memory.rememberTurn({
  agentId: 'hermes',
  projectId: 'hermes',
  sessionId: 'current',
  userText: 'Remember the release gate command.',
  assistantText: 'Stored.',
});

const recalled = memory.recall({
  agentId: 'hermes',
  projectId: 'hermes',
  query: 'what is the release gate?',
});

console.log(recalled.items);
```

If a Hermes workspace uses different paths, pass explicit `profilePath` and `sessionDir` values instead of changing core.

For agent-facing instructions, install or read `SKILL.md`. `./node_modules/.bin/cogmem-connect hermes --workspace .` copies it to `~/.hermes/skills/cogmem-memory/SKILL.md`.
