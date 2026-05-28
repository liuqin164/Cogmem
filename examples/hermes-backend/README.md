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

The import command is idempotent. Re-running it against the same database skips records already processed by the cursor store.

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
