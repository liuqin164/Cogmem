# OpenClaw Backend

Use core as OpenClaw's durable memory backend without installing CognitiveOS.

## Install

```bash
export COGMEM_CORE_REPO="github:<owner>/CognitiveOS-core#main"
bun add "$COGMEM_CORE_REPO"
./node_modules/.bin/cogmem-connect openclaw --workspace .
./node_modules/.bin/cogmem-init --agent openclaw
./node_modules/.bin/cogmem-doctor
```

## Local Quantized Embeddings

Imports use the configured kernel embedder. To import existing OpenClaw memory through a local quantized model, configure the kernel before running the import command:

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
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run
```

Import:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw
```

Single source files and batches can be imported explicitly:

```bash
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./one.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --session ./one.md --session ./two.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./one.md
./node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --memory ./one.md --memory ./two.md
```

The import command is idempotent. Re-running it against the same database skips records already processed by the cursor store.
Imported records are embedded through the configured kernel embedder during import.

## Runtime

```ts
import {
  KernelAgentMemoryBackend,
  OpenClawWorkspaceProfile,
  createMemoryKernelFromConfig,
} from '@CognitiveOS/core';

const kernel = createMemoryKernelFromConfig();
const memory = new KernelAgentMemoryBackend(kernel);
const profile = new OpenClawWorkspaceProfile(process.cwd());

const sources = profile.buildInstalledBatchSources({ projectId: 'openclaw' });
console.log(sources);

await memory.rememberTurn({
  agentId: 'openclaw',
  projectId: 'openclaw',
  sessionId: 'current',
  userText: 'Remember that public release uses sqlite-vec.',
  assistantText: 'Stored.',
});

const recalled = memory.recall({
  agentId: 'openclaw',
  projectId: 'openclaw',
  query: 'which vector backend should release use?',
});

console.log(recalled.items);
```

The profile imports memory sources only. It ignores operational files such as `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, and `BOOTSTRAP.md` by default.

For agent-facing instructions, install or read `SKILL.md`. `./node_modules/.bin/cogmem-connect openclaw --workspace .` copies it to `<workspace>/skills/cogmem-memory/SKILL.md`.

`cogmem-connect` does not edit `~/.openclaw/openclaw.json`. Current OpenClaw memory config is OpenClaw-owned (`memory.backend` supports backends such as `"builtin"` and `"qmd"`). Do not add unknown host config fields for CognitiveOS-core; install a real OpenClaw plugin wrapper with a valid manifest/schema before changing host runtime wiring.
