# ADR-0013: Cog is its own resident agent, and this install serves no other

Status: accepted (5.0, unreleased). Supersedes the host-facing parts of ADR-0002,
ADR-0004, ADR-0010 and ADR-0011, and ADR-0009's positioning of the product as a
kernel for plugin-style agents.

## Context

4.0 was positioned as a local-first memory kernel **for** plugin-style agents —
OpenClaw, Hermes, pi — and for the hosts that run them (ADR-0009). Everything
downstream followed: `cogmem connect` wrote host wiring, an MCP server face served
other agents, a credential register minted an identity per agent, a host test
matrix on the box was the release evidence for host support, and the README sold
a memory backend other software plugs into.

That support is being removed in five rounds under #200 (Ryu 2026-11-11):
the wiring (R1), the MCP surface (R2), the cross-agent identity frame (R3), the
host matrix and the box's host scenarios (R4), and packaging and voice (R5). Each
round is a normal release round — full suite, box where behaviour moves, no
deprecation window, because there are no users to migrate.

The direction is Ryu's decision of 2026-11-08 and 2026-11-12: **5.0 is its own
resident companion agent** — kernel stays host-agnostic, the shell is a long thin
layer inside this repository, memory is native to it.

## Decision

**Cog is the resident agent, and it is the only thing this install serves.** No
third-party agent attaches to this install, and none is supported:

- no `connect`, no per-host installers, no `[integrations.*]`, no host
  maintenance in `doctor`/`update` (R1);
- no MCP server face, no `cogmem-mcp`, no tool profiles (R2);
- no per-agent credentials, no `init --register-agent`, no `host-bridge` stdio
  entry for a foreign host (R3);
- no host-compatibility gate; the box is the **F13 companion-behaviour venue**,
  and the 5.0 release gate is a seven-day survival run plus F13 (R4);
- the product is **Cog**, the npm package stays `cogmem`, and the shipped bins are
  `cog` (the product's own entry point) and `cogmem` (the management CLI) (R5).

**What stays stays because Cog uses it, not because a host might.** The kernel
host API (`KernelAgentMemoryBackend`, `HostBridge.recallForHost`/`rememberForHost`),
the import bridge (`previewImport`/`applyImport`, #143) and publish/retract
(#146) are retained internal interfaces. Ryu 2026-11-12: being internal is not a
reason to relax them — the shell and future child agents are real consumers, so
they are built to formal interface standards (written contract, frozen list, error
semantics, version discipline, contract tests), scheduled with the F batch.

**`cogmem import openclaw|hermes` stays too.** It is an *operator* command that
reads a third party's existing on-disk data to bring history across; it is not a
publish or read endpoint for a foreign agent, and it attaches to nothing. The
same reading covers the adapters under `src/adapters/openclaw|hermes`: they are
the import bridge's format readers, and the ids they write into imported events'
metadata (`openclaw_daily_memory`, `hermes_state_db`, …) are data, not identity.

**An identity is no longer a host name.** `integrationScope(host, workspace)`
became `workspaceScope(workspace)` (`workspace-<hash8>`), and the CLI defaults
that used the literal `openclaw` now derive the Workspace's own scope (#207). The
isolation mechanics of ADR-0005/ADR-0009 are untouched: one Workspace is one
private scope, and two Workspaces cannot surface in each other.

## Consequences

- **ADR-0002, ADR-0004, ADR-0010 and ADR-0011 describe wiring that no longer
  exists.** They are kept verbatim as decision records — rewriting them would
  falsify what was decided then — and this ADR is the superseding record. ADR-0009
  is superseded on positioning, not on isolation.
- A reader of the old ADRs or of `docs/engineering/` is reading history. The
  README, `MEMORY_MODEL.md`, `MEMORY_ATLAS.md`, `GLOSSARY.md`,
  `RECALL_EXPLAINABILITY.md`, `docs/install.md` and `docs/observatory.md` describe
  what ships.
- The kernel does not become host-specific in the other direction either: it stays
  host-agnostic, because the resident shell is a consumer of the same interfaces
  any future child agent would use.
- The roster (`agents.json`) keeps only `hostId` and `projectId`. The `profile`
  field left with the MCP surface that ceilinged it (R5), and an old file naming
  one still loads because unknown fields are ignored.
- Nothing in this decision changes the memory model, the private-scope isolation,
  the observatory, the `#150` update machine, or the F-series primitives.
