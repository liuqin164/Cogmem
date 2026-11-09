# Memory observatory

A read-only page for looking at a corpus: a 3D star map of the Memory Atlas, the ledger's shape over
time, and the recall decisions that were stored. It is served by the resident MCP process on
`/observatory/`.

```bash
cogmem mcp --transport http            # prints the observatory URL beside the MCP one
# cogmem memory observatory (read-only) on http://127.0.0.1:7337/observatory/
```

## The constraints, and where each one is enforced

| Constraint | Where it lives |
|---|---|
| The database is never written | `openObservatoryDatabase` in `src/mcp/http.ts` opens a read-only connection; SQLite refuses a write on it. `__tests__/observatory.unit.test.ts` hashes the file across a full endpoint traversal and reads the observatory's own SQL for write statements. |
| Loopback only, with no option to change it | `isLoopbackAddress` in `src/observatory/routes.ts`, checked on the socket address of every request. The MCP face may bind elsewhere; this one still refuses. |
| Only reads | `createObservatoryRoutes` answers `GET`/`HEAD` and returns `405` with an `Allow` header for anything else. |
| Live and demo never mix | Demo mode is a single explicit entry (`?demo=1`), loads `web/demo.json`, never calls the API, and marks every page with a fictional badge and no watermark. |

The page cannot run `explain` on demand in this version. That path can write a trace row, and the
observatory reads stored traces instead (`GET /observatory/recalls`).

## Endpoints

All under `/observatory`, all `GET`, all loopback. `project=` defaults to the project with the most
events; `agent=` defaults to the merged view.

| Endpoint | Answer |
|---|---|
| `/observatory/snapshot?project=&agent=` | Nodes with coordinates, per-type and per-relation counts, the arm legend, the time histogram, the agent roster, `source`, `generatedAt`, `watermark` |
| `/observatory/node/:id?project=&agent=` | One node, its evidence locators (with the exact `cogmem memory show …` drilldown), and its one-hop neighbours. `404` when the node is outside the selected agent's view |
| `/observatory/timeline?project=&agent=&from=&to=` | Events per day × event type |
| `/observatory/recalls?project=&agent=&limit=` | Stored recall decisions, one per task. `available: false` when the database has no `trace_events` table — the honest answer, and not an error |
| `/observatory/recalls/:traceId` | One decision's full payload and its parent chain |

Bodies are gzipped when the client asks. `watermark` is `max(global_seq)`; the aggregation is cached in
process memory per `(project, watermark, max(updated_at))` and recomputed when either moves.

Measured on the 20,343-event corpus (14,271 nodes, 17,596 edges): the snapshot is 3,355,038 bytes of
JSON, 826,039 gzipped, 504 ms cold and 83 ms from cache.

## What the star map encodes

Three things, and nothing else:

- **arm** — the node's top-level grouping: the first segment of its `topic_path`, else a one-hop topic
  node, else its project. The page states which rule produced the arms. The 20,343-event corpus has a
  null `topic_path` on every row and no topic nodes, so it is one arm, and the panel says so.
- **colour** — the node type.
- **size** — `support` and `activation`.

Radius is a hash scatter with a fixed falloff: it carries no meaning. A radius that also encoded time
or support would be a reading the data does not support.

The layout is deterministic — a pure function of node ids and arms (`src/observatory/GalaxyLayout.ts`),
never a force simulation — so the same database opens onto the same galaxy.

**LOD.** `L0` is `project`/`topic`/`cluster`, `L1` everything aggregated, `L2` `raw_event`/`event`.
Each layer is one `Points` object the page can hide, which is 3 draw calls for the map plus one for
decorative star dust, one for the selection ring, and one for the selected node's edges. Rendering is
built for ~20,000 points.

**Truncation.** The snapshot keeps at most 20,000 nodes, ordering `L0`, then `L1`, then `L2` by
activation, support and time. When anything is dropped, the response carries a `truncation` object and
the page prints it in the corner: no silent caps.

**Mobile.** `prefers-reduced-motion` or a viewport at or under 900 px turns off the background dust and
the idle rotation, halves the device pixel ratio ceiling, and renders on demand instead of every frame.

## Agent scope

The roster is the identities the corpus names (`metadata.sourceAgent` and `agent:` tags) plus the hosts
wired to this install. `actor_id` is deliberately not one of them: measured on the real corpus it holds
a turn's role (`user`, `assistant`) on every row, and offering it as a view produced labels that
selected nothing.

Selecting an identity filters the same way the recall lanes do (#143 route 1) — the predicates are the
same functions, in `src/agent/AgentScopeRules.ts`:

- the agent's own records (`source_id` or an `agent:` tag naming it),
- imported material (`metadata.imported`), which is project-public by design,
- records that name no agent at all.

All three pages share the scope. A node outside the selected view is absent from the map and `404` from
the detail endpoint — not served with a warning.

## Vendoring three.js

`web/three.bundle.js` is `three@0.187.0` plus `examples/jsm/controls/OrbitControls.js`, bundled into one
minified browser-ESM file and committed. No CDN, no network at runtime, no npm dependency:
775,476 bytes (196,756 gzipped), MIT, with the upstream licence text beside it in `web/three.LICENSE`.

To regenerate it:

```bash
mkdir -p /tmp/threevend && cd /tmp/threevend
curl -s -o three.tgz "$(curl -s https://registry.npmjs.org/three/0.187.0 \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["dist"]["tarball"])')"
tar xzf three.tgz
mkdir -p node_modules && cp -r package node_modules/three
printf "export * from 'three';\nexport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n" > entry.js
bun build entry.js --outfile=three.bundle.js --target=browser --format=esm --minify
```

Then re-add the `/*! … */` header, copy it to `src/observatory/web/three.bundle.js`, and copy
`package/LICENSE` to `web/three.LICENSE`. `bun run build` copies the whole `web/` directory into
`dist/observatory/web`, and `package.json` ships it.

## Known gap

No product path writes `trace_events`: `TraceStore.initSchema` is the only place the table is created
and nothing constructs a `TraceStore`. So the recall page is empty on every real database, with the
empty state saying why. Tracked separately rather than fixed here.
