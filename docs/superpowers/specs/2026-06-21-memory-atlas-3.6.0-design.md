# Cogmem 3.6.0 Memory Atlas Design

## Goal

Make an agent aware of what it remembers, then let it navigate from a bounded
content graph to exact raw evidence. Existing recall remains the direct factual
lookup path. Memory Atlas never mutates canonical memory; it records only
non-destructive navigation access/activation telemetry and is not a new source
of truth.

## Confidence contract

“100% confidence” means every requirement in the user request has an executable
disposition: implementation plus regression test, existing behavior plus proof,
or an explicit fail-closed boundary. It does not mean unknown future defects are
mathematically impossible.

Release is blocked when any of these are unproven:

- every JSON command has a documented, versioned top-level contract;
- 3.5.2 databases migrate with one command, backup, idempotence, and Atlas
  backfill receipts;
- every Atlas query is project-isolated, bounded, source-anchored, and useful
  without vectors or an LLM;
- cold memory remains reachable through exact combinations of the conditions present in the query;
- graph summaries never replace raw evidence;
- MCP, OpenClaw direct integration, CLI, docs, plugin files, and agent skills
  describe the same tool-selection contract;
- full tests, typecheck, build, package inspection, and clean migration smoke
  pass from the released 3.5.2 schema.

## Current state

Cogmem already has five graph-capable data planes:

1. `memory_topics`, `memory_entities`, `memory_bindings`, `memory_clusters`, and
   `memory_edges` form the deterministic source-anchored Binding Graph.
2. `topic_nodes`, aliases, relations, and operations form the user-shaped,
   governed Topic Ontology.
3. episodes, closure receipts, Dream jobs, and candidates form the temporal
   consolidation graph.
4. beliefs, entity timelines, and raw ledger events provide governed claims,
   time, and source evidence.
5. activation stores and edge activation already provide deterministic decay.

`memory_map.v1` describes this system anatomy. It is intentionally retained.
`memory_atlas.v1` describes actual remembered content.

## Approaches considered

### A. Query existing tables directly

Lowest migration cost and always fresh, but broad search becomes a union of
unindexed scans, action queries remain weak, and stable cross-surface node IDs
do not exist. Acceptable for a prototype, not for growing memory stores.

### B. Copy every memory object into a second canonical graph

Fast queries, but creates duplicate truth, complex synchronization, and silent
drift between Atlas and Raw Ledger/governance. Rejected.

### C. Unified live adapters plus a rebuildable minimal projection

Selected. Source records remain canonical. Atlas normalizes source records at
query time, while a small FTS document index, action-frame projection, and
access-activation table accelerate navigation. Every projected row points back
to its source table and raw event IDs and can be rebuilt.

Completeness: 10/10 for the requested 3.6.0 scope without creating a new memory
authority or hidden daemon.

## Architecture

```text
Raw Ledger / Binding / Topic / Episode / Belief / Temporal
                         |
                         v
               MemoryAtlasIndexer
        rebuildable documents + action frames
                         |
                         v
                MemoryAtlasService
 overview | search | explore | node | neighbors | path | timeline
             |             |                 |
             v             v                 v
            MCP            CLI        OpenClaw direct bridge
                         |
                         v
              raw event source drill-down
```

### Stable node types

- `project`
- `topic`
- `entity`
- `cluster`
- `episode`
- `belief`
- `action`
- `time`
- `event` only for explicit evidence expansion

Raw events are evidence leaves. They are not returned in overview by default.

### Stable relations

Existing active Binding Graph and governed Topic Ontology relations are
preserved. Atlas v1 additionally derives two source-anchored navigation
relations from action frames: `OCCURRED_IN` and `TARGETS`. Raw evidence is
returned as typed drilldown records rather than materialized as millions of
default graph edges.

Derived edges never claim new facts. Their metadata names the deterministic
derivation and evidence IDs.

## Action Frame

Entity-only graph search cannot answer “what did I ask you to do to Hermes last
year?” Atlas therefore indexes deterministic action frames from user evidence:

```ts
type MemoryActionFrame = {
  actionId: string;
  projectId: string;
  frameType: 'operation' | 'configuration' | 'repair' | 'install' |
    'connect' | 'update' | 'compare';
  actor: 'user';
  action: string;
  targetEntityId?: string;
  targetLabel?: string;
  topicPath?: string;
  occurredAt: number;
  episodeId?: string;
  evidenceEventIds: string[];
  confidence: number;
};
```

Only raw user evidence may create an action frame. Deterministic extraction is
conservative and may return no frame. Model output may later propose candidate
labels through Dream, but cannot activate or replace a frame's evidence.

## Query behavior

### `overview`

Returns a bounded ranked union of project, topic, entity, cluster, episode,
belief, action, and time nodes. Correction/contradiction clusters and
review-state nodes remain visible as ordinary source-anchored nodes rather
than being copied into a second conflict store. It favors activation,
support, and recency, but is not exhaustive.

### `search`

Locates nodes only through project-scoped FTS with a parameterized lexical
fallback. Governed topic canonical names and active aliases are indexed.
Stable IDs use `node`, not text search. Exact search does not suppress cold
nodes.

### `explore`

Compiles broad text into the available lexical, entity, time, action, memory-kind, topic, and project cues. No fixed cue tuple is required.
It returns a bounded graph slice and executable next actions.

### `node`

Returns one node, metadata, direct neighbors, evidence IDs, excerpts only when
requested, and exact `cogmem memory show` commands.

### `neighbors`

Default one hop, hard maximum two hops.

### `path`

Bounded traversal between two known nodes. Hard maximum six hops, with exact
edge checks and chunked frontier expansion so dense high-confidence branches
cannot silently hide an older exact path.
It never traverses another project.

### `timeline`

Applies whichever timestamp, memory-kind, topic/entity keyword, and action cues
are present. This is the preferred route for questions such as “去年我让你对
Hermes 做过什么操作”, but it also reconstructs decisions, corrections, and
other timestamped nodes without requiring an action frame. Results carry
episode IDs when the source event already belongs to an episode.

## Bounds

- default nodes: 8, hard maximum: 30;
- default neighbor hops: 1, hard maximum: 2;
- default evidence per node: 2, hard maximum: 10;
- path hard maximum: 6 hops and 2,000 visited nodes;
- raw excerpts are omitted unless `includeEvidence=true`;
- every evidence result contains `eventId` and a `memory show` command;
- vectors and LLMs are optional; SQLite FTS and deterministic graph traversal
  are the baseline;
- all inputs have length/range allow-lists before FTS or traversal.

## Visibility and faceted resurrection

Atlas visibility is an operational score, not memory truth:

```text
visibility = lexical/path match + support + activation + source updated time
             + available project/time/kind/action filters
```

Successful graph use records an access receipt in a separate Atlas activation
table. It does not mutate Raw Ledger, beliefs, topics, or evidence. Maintenance
tick decays Atlas node activation and existing edge activation deterministically.

Low activation affects overview ranking only. Exact node IDs, governed aliases,
or any sufficiently selective available facet combination can still surface a
cold node. This is faceted resurrection: no entity + time + action tuple is
required.

## Dream responsibilities

No periodic reasoning model is required for freshness or decay.

- ingestion and graph access update deterministic projections/activation;
- maintenance tick performs deterministic refresh, decay, and diagnostics;
- Dream remains low-frequency, host-owned deep organization for sealed
  episodes, repeated topics, corrections, conflicts, or explicit maintenance;
- summaries are navigation hints and never evidence.

New memories continue through Raw Ledger, Episode Assembler, Binding
classification, Topic/Entity resolution, and governance. Atlas is the indexed
destination and navigation surface, not the classifier or authority.

## Integration surfaces

### Core API

`MemoryKernel` exposes read-oriented `graphOverview`, `graphSearch`,
`graphExplore`, `graphNode`, `graphNeighbors`, `graphPath`, and `graphTimeline`
methods.

### MCP

Expose matching `cogmem_graph_*` tools with `destructiveHint=false` and with
`readOnlyHint=false`/`idempotentHint=false` because successful navigation
records access activation. Server
instructions teach broad inventory -> explore, known node -> search/node,
relationship -> neighbors/path/timeline, direct fact -> recall, source proof ->
node evidence/memory show.

### OpenClaw

OpenClaw does not need MCP. The installed plugin bridge calls the Core API
directly. Broad inventory/project-history prompts receive a bounded
`<COGMEM_MEMORY_ATLAS>` block before normal recall. The block is explicitly
non-authoritative and stripped before remembering.

### CLI

Add `memory graph`, `graph-search`, `graph-explore`, `graph-node`,
`graph-neighbors`, `graph-path`, and `graph-timeline`.

## CLI JSON contract

All command JSON remains unwrapped: primary fields stay at the top level. A
shared formatter adds `schemaVersion` and `command` without moving existing
fields. A command whose primary result is an array emits that array as `items`.

Queue-producing memory commands also expose canonical top-level snake-case
counters while retaining legacy nested objects during 3.6.x:

```json
{
  "schemaVersion": "cogmem.cli.v1",
  "command": "memory.status",
  "candidate": 15190,
  "promoted": 4953,
  "needs_confirmation": 281,
  "beliefs": 244,
  "dreamCandidateQueue": {}
}
```

No caller needs `queue.candidate` for the primary counters, and existing callers
using nested fields continue to work.

## Migration

Migration `0025_memory_atlas` creates Atlas documents/FTS, action frames,
evidence links, access receipts, activation, and projection state. It backfills
all existing topics, entities, clusters, episodes, beliefs, and source links.

One supported upgrade command from 3.5.2:

```bash
cogmem migrate --yes --backup --json
```

The command performs a WAL-aware backup, applies migration 0025 transactionally,
runs deterministic Atlas backfill, reports counts, and is idempotent. Factory
startup remains migration-backed and can repair a missing projection without
altering source memory.

## Failure handling

- invalid/cross-project node IDs fail closed;
- malformed FTS input is sanitized and length-bounded;
- projection failure marks Atlas degraded but does not block Raw Ledger writes;
- missing projection rows fall back to live source adapters and schedule a
  deterministic refresh recommendation;
- evidence IDs that no longer resolve are returned as diagnostics, not invented
  excerpts;
- no Atlas tool performs Dream, governance, external calls, or tool execution.

## Test gates

- CLI JSON top-level counters, metadata, compatibility, and command matrix;
- project isolation across every Atlas method and adapter;
- bounded nodes/hops/evidence and traversal visit budget;
- exact cold-memory resurrection with arbitrary supported facet combinations;
- source event IDs and drill-down commands;
- zero bindings, vectors unavailable, and no LLM;
- action frames require raw user evidence;
- access telemetry cannot mutate source memory;
- 3.5.2 fixture migration, backup, backfill counts, repeat migration, and recall
  equivalence before/after;
- MCP schemas/instructions and OpenClaw direct bridge behavior;
- package contents, public exports, tracked `dist`, and agent documentation.

## Explicit non-goals

- web graph UI;
- all-memory context dumps;
- hidden maintenance daemon;
- replacing recall, Raw Ledger, Binding, Topic Governance, Episode, or Dream;
- automatic activation of model-proposed relations;
- multi-agent shared Atlas in 3.6.0.
