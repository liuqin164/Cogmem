# Memory Atlas v2

Memory Atlas lets an agent inspect what Cogmem remembers before it chooses a precise recall or Raw Ledger drilldown. It is a rebuildable navigation projection, not a new source of truth.

## Data model

Atlas projects existing project-scoped records into these node kinds:

- Canonical content nodes: `episode`, `raw_event`, `cluster`, `belief`, `action`, `decision`, and `correction`.
- Facet nodes: `time`, `topic`, `issue`, `entity`, `session`, `thread`, `memoryKind`, and `actionKind`.
- Action frames are extracted deterministically from raw user evidence and link actor, target, action kind, time, topic, project, and evidence.

Existing memory edges remain canonical. Atlas adds derived navigation edges such as `OCCURRED_ON`, `OCCURRED_IN`, `ABOUT_TOPIC`, `PART_OF_ISSUE`, `INVOLVES_ENTITY`, `IN_SESSION`, `IN_THREAD`, and `HAS_EVIDENCE` without changing the underlying belief or binding graph. The 3.7.0 offline curator automatically proposes only bounded `SAME_ISSUE`, `FOLLOWS_UP`, and weak `RELATED_TO` episode relations; stronger relations such as `REFINES`, `CORRECTS`, `CONTRADICTS`, and `SUPERSEDES` remain reserved for explicit evidence-bearing governance/binding flows.

This is not a copied tree. One episode exists once as `episode:<id>`. A day, topic, issue, entity, session, memory kind, or action kind is only a facet entrance:

```text
time:2026-06-06 ───────┐
topic:.../memory-blackbox ─┼──> episode:<id>
issue:memory-context-blackbox ─┘
episode:<id> ──HAS_EVIDENCE──> raw_event:<eventId>
```

Search and explore output dedupe by `canonicalId`. When a canonical episode is reached through several facet paths, the result appears once with all `matchedFacets` and `matchedPaths`.

## Agent workflow

1. Use `graph_overview` when the user asks what is remembered.
2. Use `graph_explore` for broad history, project-state, relationship, or multi-facet questions.
3. Use `graph_search` when a topic/entity/cluster is already known and no expansion is needed.
4. Use `graph_node`, `graph_neighbors`, `graph_path`, or `graph_timeline` to narrow the graph. Timeline applies the available facets to any timestamped Atlas nodes; action frames are an optional richer result, not a requirement.
5. Use returned `sourceLocator.command` or event IDs with `cogmem memory show` before quoting exact source text.
6. Use normal `cogmem_recall` for a direct factual memory question.

Atlas summaries are `hint_only_not_evidence` in effect. Project scope, raw evidence ownership, and governance still decide what may be claimed as durable memory.

## Faceted cold-memory resurrection

Activation controls default visibility, not existence. Maintenance decays Atlas activation deterministically; an explicit `cogmem_graph_touch` raises nodes that the agent actually used. Read-only overview/search/explore calls do not change ranking. A query can still surface a cold node when its available facets match.

Facets include project, day/month/year, topic, issue, entity/person/project, session/thread, memory kind, action kind, and ordinary keywords. The engine combines the facets actually present in the message, similar to filtering multiple columns in a table. It does not require the fixed combination entity + time + action.

For example, all of these can revive cold memory:

- `6月6号聊过什么`
- `6月6号关于记忆黑盒聊过什么`
- `记忆黑盒后来有没有继续讨论`
- `memory graph 卡死的问题修了吗`
- `2025 某工具的决策`
- `我之前让你对某工具做过什么`
- `启动某工具`
- `在留更新里被纠正过的计划`
- `去年 OpenClaw 失败的配置事件`
- `餐车 POS 项目中关于库存的偏好`

Exact constraints may bypass the visibility floor. They never bypass `projectId`, evidence validation, or traversal limits. If strict intersection is empty, Atlas may relax day to parent month or issue to parent topic, but JSON must include `relaxationTrace`; it must not silently substitute a nearby memory.

`graph-search` and `graph-explore` include agent-facing `cards` when canonical episodes match:

```json
{
  "canonicalId": "episode:episode-xxx",
  "displayTitle": "CogMem Memory Context 黑盒与原文下钻",
  "oneLineSummary": "用户指出注入的 CogMem Memory Context 像黑盒，需要能从摘要下钻到原始对话。",
  "matchedFacets": [
    { "type": "time", "value": "2026-06-06" },
    { "type": "topic", "value": "PROJECT/Cogmem/memory-blackbox" }
  ],
  "matchedPaths": [],
  "relatedButNotSelected": [],
  "sourceLocator": {
    "command": "cogmem memory show --event evt-... --before 2 --after 2 --json"
  }
}
```

Agents should prefer `cards` over raw node labels for historical discussion because cards preserve the canonical episode, match reason, and drilldown command.

Action-history queries use the same card model. Entity cues such as a project, tool, person, or service name combine with operational action kinds including `started`, `installed`, `configured`, `restarted`, `stopped`, and `operated`. If the user asks for exact wording, follow the card's `sourceLocator.command` or call `cogmem memory recall --intent forensic_quote`; do not quote from a compiled summary or a daily memory file.

## Bounds

- Default/hard node limit: 8/30.
- Default/hard neighbor hops: 1/2.
- Default/hard evidence per node: 2/10.
- Maximum path length: 6 hops.
- Maximum visited nodes per path query: 2,000.
- Maximum query length: 1,000 characters.
- Raw excerpts are opt-in; evidence IDs and drilldown commands are always available.

Atlas works without vectors and without an LLM. Dream may later improve organization, but it cannot manufacture evidence.

BrainEval release fixtures fail closed on Atlas project isolation, node/hop bounds, evidence locators, path reconstruction, multi-facet cold-memory resurrection, and canonical-source immutability.

## CLI

```bash
cogmem memory graph --project <id> --json
cogmem memory graph-search --project <id> --query <query> --json
cogmem memory graph-explore --project <id> --query <query> --json
cogmem memory graph-explore --project openclaw --query "6月6号关于记忆黑盒聊过什么" --json
cogmem memory graph-explore --project openclaw --query "启动 <工具名>" --json
cogmem memory graph-node --project <id> --id <node-id> --json
cogmem memory graph-neighbors --project <id> --id <node-id> --hops 1 --json
cogmem memory graph-path --project <id> --from <node-id> --to <node-id> --json
cogmem memory graph-timeline --project <id> --query <query> --json
cogmem memory graph-timeline --project openclaw --query "对 <实体或工具名> 做过什么操作" --include-evidence --json
cogmem memory graph-reindex --project <id> --event <event-id> --json
cogmem memory graph-reindex --project <id> --episode <episode-id> --json
```

`graph-explore` and `graph-timeline` accept `--now <epoch-ms>` for deterministic relative-time parsing and `--evidence-limit <1..10>` for bounded evidence. Node results distinguish `evidenceTotal` from `evidenceReturned`.

Graph reads try to refresh dirty Atlas state, but they default to stale-safe operation for diagnostics. If refresh is blocked by SQLite busy, JSON includes `atlasFresh: false` and `refreshError` while returning the existing projection. Use `--refresh` to force a fresh rebuild or `--no-refresh` to inspect the current projection only.

Use `graph-reindex` after an audited episode repair or binding repair when one event/episode needs fresh card/facet projection. It updates the targeted episode card, raw-event node, source locator, and episode facet edges without rebuilding the whole project graph.

## MCP

The canonical-memory-safe tools are:

- `cogmem_graph_overview`
- `cogmem_graph_search`
- `cogmem_graph_explore`
- `cogmem_graph_node`
- `cogmem_graph_neighbors`
- `cogmem_graph_path`
- `cogmem_graph_timeline`
- `cogmem_graph_touch`

The seven query tools never rewrite Raw Ledger, topics, beliefs, episodes,
evidence, or activation. MCP declares them read-only and idempotent. An agent
may call `cogmem_graph_touch` after it actually selects/uses returned nodes;
that explicit telemetry operation changes visibility only.

Hermes and other hookless agents use these through MCP. They still need `cogmem_episode_append` or `cogmem_episode_import` because Cogmem cannot observe their conversation automatically.

OpenClaw uses the same core service through its direct plugin bridge. Broad questions inject a bounded volatile `<COGMEM_MEMORY_ATLAS>` block; that block is stripped before the turn is remembered. MCP is not required for OpenClaw.

## Migration and repair

Upgrade an existing 3.5.2 database with:

```bash
cogmem migrate --yes --backup --json
```

Migration 0025 creates and backfills the disposable projection. Migration 0026 adds exact memory-kind metadata, projection health, and candidate-review audit state. Migration 0027 corrects 3.6.0-upgraded databases by marking Atlas projections dirty until the real action/time rebuild runs. Cogmem 3.7.0 keeps the projection-first schema and adds facet nodes, canonical cards, issue hints, and episode relation edges during Atlas rebuild/maintenance. `cogmem memory tick` refreshes only dirty projects, records rebuild errors, prunes old access telemetry, and decays navigation activation without starting a daemon.
