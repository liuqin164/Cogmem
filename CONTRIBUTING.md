# Contributing

## Setup

```bash
bun install
bun run typecheck
bun test
```

## Pull Request Gate

Before opening a pull request that changes core, run:

```bash
bun run build
bun run typecheck
bun test
npm pack --dry-run --json
npm publish --dry-run --access public
npm publish --access public
```

`cogmem` is distributed through the npm registry. Use `npm pack --dry-run --json` to verify package contents, then `npm publish --dry-run --access public` before `npm publish --access public`. Keep the GitHub branch or release synchronized for source review and for older GitHub-installed users migrating onto the npm-first updater.

## API Discipline

Only explicitly exported symbols in `src/public.ts` are public. Do not re-export `src/internal.ts` from the package entrypoint.

## Adapter Changes

Agent-specific adapters must keep core independent from host runtimes. Prefer a narrow workspace profile plus fixture-backed tests over importing another runtime.
