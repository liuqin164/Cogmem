# cogmem 3.0.0 Release Checklist

This release is distributed through GitHub Releases. Do not run npm publish.

## Required Metadata

- `package.json` name is `cogmem`.
- `package.json` version is `3.0.0`.
- Public export `.` points to `dist/public.js` and `dist/public.d.ts`.
- Internal subpath `./internal` exists only as an explicit advanced subpath.
- `install.sh` is tracked and uses the latest GitHub release asset.
- Local databases, SQLite sidecars, `.DS_Store`, and `dist/.tsbuildinfo` are not tracked.

## Required Binaries

- `cogmem`
- `cogmem init`
- `cogmem doctor`
- `cogmem connect`
- `cogmem update`
- `cogmem-compact`
- `cogmem memory`
- `cogmem explain-recall`
- `cogmem-mcp`
- `cogmem import-openclaw`
- `cogmem import-hermes`
- `cogmem normalize-transcript`
- `cogmem snapshot`
- `cogmem re-embed`
- `cogmem migrate-vectors`
- `cogmem migrate`

## Required Documentation

- README explains the vision, architecture, limits, and one-line install command.
- README says this is a single-agent memory kernel, not an agent team shared brain.
- README distinguishes embedding models from Dream Curator memory-model LLMs.
- README and integration docs explain labeled `sourceContext`, strict before/after window metadata, `charRange` / `sourceRange`, and OpenClaw `sourceWindow` / `sourceTruncation` injection.
- README and skills explain collection routing, `cogmem memory map`, and `cogmem memory tick` as host-owned inspection and maintenance surfaces.
- README and skills explain `decisionTrace` / `recallDecision`, source-first raw fallback, correction semantics, and review-queue aging.
- README and skills explain `cogmem update --yes`, migration dry-run, backups, and that Raw Ledger evidence is never rewritten by schema migration.
- README and skills explain that entity aliases are evidence-backed, project-scoped, reversible, and stricter for person entities.
- README and skills explain Belief Graph ownership, user-evidence requirements, reinforcement, conflict review, and supersession history.
- OpenClaw skill explains self-install, import, active recall, `--auto`, and `doctor --fix`.
- Hermes skill explains self-install, MCP wiring, `connect hermes --auto`, and `/reload-mcp`.
- SECURITY documents local-first storage, explicit external providers, snapshots as sensitive, and governed recall.

## Verification

Run from the repository root:

```bash
bun run typecheck
bun run build
bun test
npm pack --dry-run --json
```

The pack dry-run must include built public API files, CLI files, examples, docs, and `install.sh`. It must not include local databases or machine-specific files.
