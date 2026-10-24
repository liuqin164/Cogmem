# One memory bridge, one database connection, a thin adapter per host

Cogmem now has to serve several hosts — Hermes, pi, DSH, Claude Code, and the
OpenClaw plugin that came first — and each one reaches memory through a
different mechanism. We settled on exactly one **Memory bridge**: a single
resident process holding the only connection to a database, with one thin
**Host adapter** per host on the other side of it. Adapters translate a host
**Host hook** into a bridge request and carry the result back into the prompt.
No adapter opens the database, understands the schema, or owns retrieval logic;
all of that lives in the bridge, which is the only place it can be fixed once.

## One writer, not one writer per host

A database connection is exclusive state. Budgeting in memory is already a
measured problem: four processes starting against one fresh database had three
of them die in schema migration, and four concurrent writers produced twelve
`database is locked` failures across eighty turns. That work produced a
single-connection rule, and one bridge per host would quietly repeal it — five
hosts would mean five connections, five warm-up costs, and five chances to
disagree about the currently applied schema.

So the bridge is *the* process: one kernel, one database handle, one migration
decision, one vector backend. A second host costs a socket, not a database.

## The adapter is deliberately thin

An adapter may do three things and nothing else:

| It does | It must not |
| --- | --- |
| Translate its host hook into one bridge request | Open the database or run SQL |
| Put the returned block into the prompt | Decide what is relevant |
| Record the finished turn when the host says one ended | Own decay, promotion, or schema |

The test of "thin" is mechanical: if two hosts need the same fix, the fix
belongs in the bridge. Anything an adapter knows about recall is a defect
waiting to diverge from every other adapter.

## Host hooks, and therefore order

The order hosts are taken on follows how much of the automatic path each one
can actually deliver, and each host is finished before the next starts:

- **Hermes first.** Its Python plugin mechanism is a real push hook:
  a `plugin.yaml` plus `register`, with `pre_llm_call` doing the injection.
  It is the closest structural match to the bridge that already ships.
- **pi** next, through `before_agent_start`.
- **DSH** next, through its prompt section.
- **Claude Code** last, through `UserPromptSubmit`. This adapter ships as
  written against the documented hook and is **not verified against a real
  client**, and must be labelled that way wherever it is described.

## MCP is demoted to a pull fallback, not removed

MCP was the first integration and stays as the path for a host that exposes no
hook — and as the fallback when a bridge is unreachable. It is not a
replacement for the bridge and it does not become the internal transport: an
adapter that talks to the bridge over MCP would make every push host depend on
a server being started, configured, and reachable. What MCP keeps is its
contract from ADR-0002: an explicit-recall path for hookless hosts, carried by
the `instructions` string and the tool descriptions.

## Considered Options

- **A bridge per host, each with its own database connection.** Rejected: it
  reintroduces the multi-writer failures that a single connection just removed,
  multiplies warm-up cost per host, and lets hosts drift onto different schemas.
  Every retrieval improvement would then have to land in each bridge separately.
- **All hosts over MCP, one bridge behind an MCP server.** Rejected: it turns
  push into pull. A host that can inject before the model answers would be made
  to ask for memory instead, and the user must run and configure a server before
  automatic recall works at all.
- **Adapters that query the database directly for the few things the bridge does
  not expose.** Rejected: the first such adapter makes the schema a public
  contract, and the second one makes two of them.

## Consequences

- A retrieval fix lands once. Adapters are small enough to review host by host.
- The bridge becomes a single point of failure for every host: if it is down,
  no host has memory. The fallback is explicit pull over MCP, which is why MCP
  is kept rather than deleted.
- **The OpenClaw installer changes shape.** It currently generates one plugin
  and one resident daemon per workspace (`cogmem-auto-memory-<hash>`, its own
  `bridgeSocket`, `projectId`, and `configPath`), so N bots mean N bridges and N
  database handles against the same database. Under this decision a bot gets an
  adapter and a project scope, while the bridge is started once. The installer's
  per-workspace plugin ID and socket layout are exactly what has to move, so
  OpenClaw is the migration that proves the shape rather than a host that
  already fits it.
- A host whose hook is unverified must say so. Claude Code's adapter carries the
  unverified label; a reader must not take "written" for "demonstrated".
- Adding a host is now a bounded task: one adapter, one hook, no database work.
