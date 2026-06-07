# @CognitiveOS/core 2.0.0-rc.1 Release Checklist

This release candidate is GitHub-only. The package is not published to npm.

## Scope

- Release target: `@CognitiveOS/core` version `2.0.0-rc.1`.
- Distribution: GitHub source/tag install, for example `bun add github:<owner>/CognitiveOS-core#v2.0.0-rc.1`.
- Do not run npm publish.
- Treat `npm pack --dry-run --json` as a local artifact integrity check only.

## Metadata

- `package.json` version is `2.0.0-rc.1`.
- Public package export `.` points to `dist/public.js` and `dist/public.d.ts`.
- Internal subpath export `./internal` points to `dist/internal.js` and `dist/internal.d.ts`.
- Package `bin` entries exist for all documented CLI commands:
  - `cogmem-init`
  - `cogmem-doctor`
  - `cogmem-connect`
  - `cogmem-update`
  - `cogmem-compact`
  - `cogmem-memory`
  - `cogmem-explain-recall`
  - `cogmem-mcp`
  - `cogmem-import-openclaw`
  - `cogmem-import-hermes`
  - `cogmem-snapshot`
  - `cogmem-re-embed`
  - `cogmem-migrate-vectors`

## Documentation

- README explains GitHub-only installation and says the package is not published to npm.
- SECURITY documents local-first storage, explicit external embedding providers, snapshots as sensitive, and governed recall.
- CONTRIBUTING uses `bun run --filter '@CognitiveOS/core' type`, `build`, `test`, and `npm pack --dry-run --json` as the core gate.
- CHANGELOG has a `2.0.0-rc.1` section covering the GitHub-only package split and release hardening.

## Verification Commands

Run from the repository root:

```bash
bun run --filter '@CognitiveOS/core' type
bun run --filter '@CognitiveOS/core' build
bun run --filter '@CognitiveOS/core' test
```

Run from `packages/core`:

```bash
npm pack --dry-run --json
```

If the local npm cache is not writable, run the pack dry-run with a temporary cache:

```bash
npm_config_cache="$(mktemp -d)" npm pack --dry-run --json
```

The dry-run output must include built public API files, internal subpath files, CLI files under `dist/bin`, examples, and release docs. It must not create or publish a real package release.
