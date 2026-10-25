# 9. 4.0 is a local memory kernel for plugin agents, several of whom share one device and none of whom share memory

ADR-0005 records why 4.0 does not share memory between agents, and what the code
does about it. This records the positioning that decision sits inside — the part
the README says in one line and that everything else has to stay consistent with
(issue #50, maintainer decision of 2026-10-24).

## The position

**4.0 is a local-first memory kernel for plugin-style agents** — OpenClaw, Hermes,
pi — and for the hosts that run them. One Cogmem database backs one kernel.
**Several agents on the same device attach to that kernel**, each with its own
private memory and its own project scope, and each getting automatic recall.

Three boundaries follow, and they are the reason this is worth writing down:

- **Private is the default and the only mode in 4.0.** An agent reads the memory
  inside its own project scope and nothing else. There is no collection to join,
  no switch to flip, and no tool that publishes.
- **One device.** Several hosts on one machine, through one bridge. Not across
  devices, not through a cloud, not through a shared filesystem two machines can
  both reach.
- **An agent's identity is established, never self-reported.** Isolation between
  agents sharing a process is only as good as that rule, which is ADR-0006: the
  identity comes from the connection and its credential, and a request header may
  narrow it but never introduce or change it. This is why isolation was P0 for
  4.0 rather than a follow-up hardening pass.

## The README headline stays neutral, on purpose

The maintainer reserved the headline choice (single-agent kernel versus
multi-agent memory) and the "What cogmem Is Not" wording; the position above
decides what 4.0 *does* without deciding how to sell it. The current headline —
"Agent-native memory kernel for AI agents and the hosts that run them" — is the
neutral one, and a guard in `__tests__/mcp-host-recall-modes.unit.test.ts` fails
if a rewrite picks either side.

That guard is deliberate friction: the previous headline ("for a single AI agent")
and the previous exclusion ("Multi-agent shared team memory") are both gone, and a
future editor who reintroduces A-leaning or B-leaning wording should have to make
that a decision rather than a copy edit. **Changing the headline is a decision, not
a wording fix.**

## What the shared region will have to guarantee, when it arrives in 4.1

ADR-0005 names the three prerequisites: a trusted per-agent identity (#65, now
ADR-0006), per-collection read permission (#66), and provenance labelling on recall
(#67). The maintainer's earlier shape for it — selective and explicitly enabled,
scoped to one device, with provenance, withdrawal and read permission as
first-class guarantees rather than best effort — is what those issues are for. None
of it is implemented in 4.0, and none of it should be described in 4.0's
documentation as though it were.

## Consequences

- The README states mechanics that hold either way: one database, several hosts,
  one project scope per agent, and no sharing tool in any profile.
- Documentation for 4.0 must not promise sharing, provenance across agents, or
  collection permissions. `cogmem_shared_*` is not an available tool name, and the
  answer to calling one is `tool_not_found` (ADR-0005).
- The 4.1 issues (#63, #66, #67) carry the sharing work and are labelled `4.1`;
  this ADR is the boundary they must not quietly cross back over.
