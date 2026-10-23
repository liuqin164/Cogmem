# Cogmem

An agent's memory kernel: it keeps what happened, and later puts the relevant part back in front of the agent without being searched for.

## Language

### Surfacing

**Pulse**（二级脉冲）:
A memory arriving in two waves — a direct hit, then an associative spread that brings neighbouring context with it.
_Avoid_: search, query, lookup

**Pulse 1**:
The direct wave: a cue activates the memories it names or nearly names.
_Avoid_: exact match, keyword hit, top-k

**Pulse 2**:
The associative wave: the direct hit spreads along time, people, place and topic, returning context the cue never mentioned.
_Avoid_: expansion, neighbour lookup, rerank

**Emergence**（浮现）:
A memory being present before it is asked for. The agent does not search; the relevant memory is already in front of it.
_Avoid_: auto-recall, injection, preload

**Cold memory**:
A memory nothing has touched for a long time. It stays reachable: coldness lowers how readily it surfaces, never whether it exists.
_Avoid_: expired, stale, deleted

### Locating a memory

**Facet**:
One of the six ways a person locates a memory: time, person, place, event, topic, state. This is the vocabulary the product speaks in.
_Avoid_: dimension, filter, tag, slot

**Dimension**:
One of the thirteen axes the memory graph stores a node on. Storage vocabulary only; a person never names one.
_Avoid_: facet, column, axis

### Scope

**Drill-down**（下钻）:
Following a surfaced memory back to the words that produced it. Within one project it is always available; across projects it is never available; a forgotten memory is gone for good.
_Avoid_: trace, lookup, citation

**First-class memory backend**（一等记忆后端）:
A memory subsystem the host takes as its default path rather than an optional tool: recall goes there first, and anything it surfaces can be traced back to the original words.
_Avoid_: memory plugin, vector store, RAG add-on
