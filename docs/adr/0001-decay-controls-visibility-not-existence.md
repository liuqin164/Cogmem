# Activation decay controls visibility, not existence

A memory nothing has touched for months must still be recallable — that is the whole
promise of a bionic memory backend — yet the activation store decays on purpose so that
recently used memories surface first. We decided the two concerns stay separate:
activation decides *how readily* a memory surfaces, never *whether it exists*, and any
query whose facets match a cold node can resurrect it. Retrieval therefore never treats a
low activation score as a reason to exclude a candidate; it only orders it later.

## Consequences

- Compaction may drop vector blobs and stale indexes, but never a raw event or a facet
  projection for being cold. Pruning by temperature is forbidden.
- Recall must keep a path that reaches cold nodes when facets match, so a long-horizon
  query pays for scanning older projections instead of being answered from the hot set.
- `cogmem_graph_touch` raises nodes the agent actually used; read-only queries deliberately
  do not, so ordinary exploration cannot silently reshape what surfaces next.
