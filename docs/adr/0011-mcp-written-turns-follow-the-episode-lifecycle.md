# ADR-0011: A turn written over MCP follows the same episode lifecycle as an imported one

Status: accepted (4.0, unreleased)

## Context

4.0 has two ways for memory to enter: the import path (`import-openclaw`,
`import-hermes`, and the `cogmem_episode_import` tool) and the MCP write tools
(`cogmem_remember_turn`, `cogmem_episode_append`).

They did not share a lifecycle. Measured on a clean sandbox with the branch installed
from GitHub, in one project:

| step | result |
| --- | --- |
| `cogmem_remember_turn { userText }` | `ok: true` |
| the same with `ingestMode: "immediate_compile"` | `ok: true`, `compiled: true` |
| `cogmem memory search --query okapi` | `total: 1` — the event is in the ledger, under the right project |
| `cogmem memory recall --query "when does the okapi ship"` | `selectedCount: 0`, `reason: no_recall_evidence` |
| `cogmem memory tick`, then `memory dream` | tick runs; dream `skipped: true`, `no_sealed_episode_backlog` |
| `memory status` | `dreamedRawCount: 0`, `undreamedRawCount: 3`, `liveEmbeddings: 0` |

The cause is structural, not a bug in either half. Dream processes **sealed episodes**
only, and an episode exists only if the assembler was given the turn:

- `cogmem_episode_append` and `cogmem_episode_import` call
  `kernel.appendEpisodeMessageAsync()`, which records the raw event *and* advances the
  shared episode assembler.
- `cogmem_remember_turn` calls `KernelAgentMemoryBackend.rememberTurnWithResult()`,
  which records the raw event and compiles, and never touches the assembler.

So a remembered turn is stored, searchable, and unreachable by recall: nothing ever
creates the episode that Dream would later compile. The import path is recallable on
the same machine (`selectedCount: 1` for the imported OpenClaw workspace), which is
what made the difference visible.

## Decision

**A turn written over MCP enters memory through the same episode lifecycle as an
imported one.** Concretely, the rules this fixes, in the order they have to be
answered:

1. **Session identity.** `sessionId` names a conversation. A client that names one is
   taken at its word; a connection that names none uses its own session
   (`<hostId>-session`, the convention `cogmem-host-bridge` already follows), so one
   MCP process is one conversation. A host that multiplexes conversations in one
   process **must** pass `sessionId` per conversation — the server cannot see the
   boundary the host knows.
2. **Episode stream.** `(projectId, sourceAgent, sessionId)` identifies the stream an
   episode belongs to. A turn joins the open episode of its own stream and never
   another's: a differing project, agent or session starts or continues its own.
3. **Seal timing — reuse, invent nothing.** An episode is sealed by an explicit
   `cogmem_episode_seal`, by the idle sweep (`sealIdleEpisodes`, soft, reason
   `idle_timeout`), by soft→hard stabilization inside Dream (`soft_seal_stabilized`),
   or by a scope change (`EpisodeActiveScopeGuard`). **A turn is never sealed on its
   own**: sealing is a property of a conversation reaching a boundary, not of a write
   succeeding.
4. **Continuous conversation.** Turns inside the idle window stay in one open episode;
   the boundary is the idle gap, not a turn count. A long conversation is one episode
   until it goes quiet, which is what makes an episode mean a conversation.
5. **Attribution.** The episode's project comes from the connection (the server injects
   the bound project and rejects a differing one), the agent from the identity the
   connection authenticated as, and the session from the client when it names one.
   ADR-0006 is unchanged: identity is a fact about the connection, never a claim the
   caller makes beyond it.

## Consequences

- `cogmem_remember_turn` records its user and assistant messages through the assembler,
  the way `cogmem_episode_append` already does. `ingestMode` and `collection` stay
  accepted and are recorded on the events; what changes is that the turn's *lifecycle*
  no longer depends on them.
- Recall of a remembered turn becomes available after its episode is sealed and Dream
  has processed it — the same sequence the post-import documentation already describes,
  now true for both entry points.
- Making `immediate_compile` mean "recallable in this turn" is a separate design item:
  it would change what a compile knob promises about retrieval, and it is not what this
  decision settles.
- The raw-recall fallback stays as it is. Widening what recall can return would move
  #72's measured acceptance line (unmarked Family B: 91.7% current truth / 4.2% stale
  leaked against ≥87.5% / ≤10%), which is a retrieval-semantics decision with its own
  measurement, not a consequence of this one.

## Rejected alternatives

- **Seal each turn immediately.** Every turn would become its own episode: Dream noise,
  no conversation boundary, and `episode status` would stop meaning anything.
- **Add undreamed raw events to recall's fallback.** Smaller diff, but it changes what
  recall returns for every project and puts #72's acceptance at risk without a
  measurement; refused until it is evaluated on its own.
- **Leave it documented.** The server's own instructions tell an agent to record a turn
  and recall it later; documenting that this cannot work would be documenting the
  defect.
