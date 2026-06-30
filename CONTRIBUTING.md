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
npm publish --provenance --access public
```

`cogmem` is distributed through the npm registry. Use `npm pack --dry-run --json` to verify package contents. Normal publishing happens by creating a GitHub Release from the matching version tag; `.github/workflows/publish.yml` is intentionally triggered by the release `published` event, not by tag pushes. Use `npm publish --provenance --access public` only as an emergency manual fallback.

## API Discipline

Only explicitly exported symbols in `src/public.ts` are public. Do not re-export `src/internal.ts` from the package entrypoint.

## Adapter Changes

Agent-specific adapters must keep core independent from host runtimes. Prefer a narrow workspace profile plus fixture-backed tests over importing another runtime.
