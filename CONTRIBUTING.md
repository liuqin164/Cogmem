# Contributing

## Setup

```bash
bun install
bun run --filter '@CognitiveOS/core' type
bun run --filter '@CognitiveOS/core' test
```

## Pull Request Gate

Before opening a pull request that changes core, run:

```bash
bun run --filter '@CognitiveOS/core' build
bun run --filter '@CognitiveOS/core' type
bun run --filter '@CognitiveOS/core' test
cd packages/core && npm pack --dry-run --json
```

`@CognitiveOS/core` is distributed from GitHub for this release candidate. Use `npm pack --dry-run --json` only to verify the package contents; do not publish the package to npm.

## API Discipline

Only explicitly exported symbols in `src/public.ts` are public. Do not re-export `src/internal.ts` from the package entrypoint.

## Adapter Changes

Agent-specific adapters must keep core independent from CognitiveOS. Prefer a narrow workspace profile plus fixture-backed tests over importing another runtime.
