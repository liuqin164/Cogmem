# Shared memory is deferred to 4.1, and 4.0 stores nothing for it

4.0 shipped a shared region — four MCP tools that let one agent publish memory
items and another subscribe to them — before the three things that make sharing
safe existed. The maintainer settled the direction instead: **4.0 does not share
memory between agents** (issue #68, under #50). This records what that decision
means for the code, and in particular whether the storage stays.

## Why not ship it half-built

Sharing memory means one agent's text reaches another agent's prompt. Three
prerequisites were missing, each an open issue in its own right:

| Missing piece | What goes wrong without it | Issue |
| --- | --- | --- |
| A trusted identity per connected agent | Any loopback client can claim a `hostId`, so "who published this" is unverifiable | #65 |
| Per-collection read permission | Every connected agent reads every collection; sharing is all-or-nothing | #66 |
| Provenance labelling on recall | Another agent's text enters the prompt as if it were the user's own memory | #67 |

Publishing without those produces a single namespace that any local process can
write into and read from, with authors that cannot be checked. That is worse
than no sharing, because it looks governed.

## The decision

**No profile registers a shared-memory tool.** `CORE_TOOLS` and `ADMIN_TOOLS`
name none, so `tools/list` never offers one and `isToolAllowed` never admits one.

**A call to a removed name answers `tool_not_found`, not `tool_not_in_profile`.**
The two answers are not interchangeable. `tool_not_in_profile` is advice: it
tells the caller to widen the profile and try again, and that advice is false
when no profile can reach the tool. The registration check therefore runs before
the profile check in the MCP request handler. A tool that exists but is outside
the profile keeps the `tool_not_in_profile` answer, which stays accurate there.

**No server creates the region.** Neither the stdio server nor the HTTP server
constructs `SqliteSharedMemory` any more, so the `shared_items` table is not
created as a side effect of starting Cogmem. A fresh 4.0 database carries no
shared-memory bookkeeping at all.

**The port and its adapter stay in the tree, unreachable.** `SharedMemoryPort`
(`src/ports/index.ts`) and `SqliteSharedMemory`
(`src/adapters/sqlite/SqliteSharedMemory.ts`) are kept for 4.1. They are exported
from neither `src/public.ts` nor `src/internal.ts` nor `src/adapters/index.ts`,
and no `package.json` subpath reaches them, so "internal only" is a property of
the export surface rather than a comment. `CogmemMcpRuntime` no longer carries a
`shared` field either: an injection point nobody can reach is still an entry
point, and it would have kept the region alive in the one place a plugin or a
third-party caller can pass options.

Their own tests (`__tests__/shared-memory.unit.test.ts`) stay and keep passing,
because the port is not deleted — it is reachable only the way it was written:
by constructing it directly inside this repository.

## Alternatives rejected

- **Delete the port, the adapter, and the table.** This is the cleanest reading
  of the 4.0 clean-start decision (#59), and it was rejected only because the
  work returns in 4.1 with the same shape. The storage is not *created* in 4.0,
  which is what clean start asks for; deleting the code as well would remove the
  tests that specify retraction and idempotence, and those specifications are
  not going to change.
- **Keep the tools registered and fail them with a "planned for 4.1" error.**
  A registered tool is a promise: hosts bake tool names into allow-lists, and a
  model that sees the name will call it. The error would fire on every turn
  rather than once, at configuration time.
- **Keep the tools behind a flag.** A hidden switch is still a shipped surface,
  and it makes the 4.0 contract "no sharing unless you know the flag" — which is
  the same half-built feature with a worse description.
- **Keep constructing the region so 4.1 has a warm table.** An unused table that
  no 4.0 code reads is storage the user did not ask for, and it made a fresh
  database carry a second schema owner besides the kernel.

## Consequences

- 4.1 creates the region deliberately rather than as a constructor side effect.
  Constructing `SqliteSharedMemory` must stop being how the table comes into
  existence; the schema should own it, the way it owns every other table.
- The tool counts drop with no behavioural loss: `core` 8 → 6, `admin` 26 → 22,
  `full` 40 → 36. `docs/mcp-hosts.md`, `README.md`, and `CHANGELOG.md` state the
  new numbers, and a release-metadata test recomputes them from the shipped
  registry so a future edit cannot drift the documentation from the code.
- A host that already pointed at one of these tools, or a saved allow-list that
  names one, now fails loudly at the first call instead of silently doing
  nothing. The answer says the tool does not exist, which is true.
- Identity work in #65 does not have a caller-visible effect yet: `hostId` still
  resolves from the connection and reaches the runtime, but nothing in 4.0 acts
  on it. That was already true of everything except shared memory, which is the
  part this decision removes. #65 has to give an identity a capability of its
  own, and that capability is the one that will make `hostId` observable again.
