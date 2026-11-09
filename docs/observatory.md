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
| The database is never written | `openObservatoryDatabase` in `src/mcp/http.ts` opens a read-only connection; SQLite refuses a write on it. A `:memory:` or `file:`-URI database gets no page at all rather than being handed the kernel's writable handle. `__tests__/observatory.unit.test.ts` hashes the file across a full endpoint traversal and reads the observatory's own SQL for write statements. |
| Loopback only, with no option to change it | `isLoopbackAddress` in `src/observatory/routes.ts`, checked on the socket address of every request, and the URL the process prints always names `127.0.0.1`. The observatory has no bind setting of its own — it rides the MCP process (§f-4), so `--bind 0.0.0.0` still opens the port, and every request that arrives on anything but loopback is refused. |
| Only reads | `createObservatoryRoutes` answers `GET`/`HEAD` and returns `405` with an `Allow` header for anything else. |
| Live and demo never mix | Demo mode is a single explicit entry (`?demo=1`), loads `web/demo.json`, never calls the API, and marks every page with a fictional badge and no watermark. |

The page cannot run `explain` on demand in this version. That path can write a trace row, and the
observatory reads stored traces instead (`GET /observatory/recalls`) — written by the default recall
lane, see [Recall decisions](#recall-decisions-and-who-writes-them).

## Endpoints

All under `/observatory`, all `GET`, all loopback. `project=` defaults to the project with the most
events; `agent=` defaults to the merged view.

| Endpoint | Answer |
|---|---|
| `/observatory/snapshot?project=&agent=` | Nodes with coordinates plus `status` and `evidenceTotal`, per-type and per-relation counts, the arm legend, the time histogram, the agent roster, `source`, `generatedAt`, `watermark`. `topicPath` is not repeated per node: the arm is its disclosed form. In a single-agent view the per-type counts and the arms describe that view, while `nodesTotal` stays the project's own count |
| `/observatory/node/:id?project=&agent=` | One node, its evidence locators (with the exact `cogmem memory show …` drilldown), and its one-hop neighbours. `404` when the node is outside the selected agent's view |
| `/observatory/timeline?project=&agent=&from=&to=` | Events per day × event type |
| `/observatory/recalls?project=&agent=&limit=` | Stored recall decisions, one per task. `available: false` when the database has no `trace_events` table — the honest answer, and not an error |
| `/observatory/recalls/:recallId` | One decision's full payload and its parent chain. `404` when the id is outside the selected agent's view — the list is scope-filtered, so the detail has to be too |

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
Each layer is one `Points` object with its own fade uniform, which is 3 draw calls for the map plus one
for decorative star dust, one for the selection ring, and one for the selected node's edges. Rendering
is built for ~20,000 points.

Zoom brings the layers in, not a checkbox: `L1` fades in as the camera closes to 520 units and is fully
on by 330, `L2` between 300 and 150. The three buttons set a ceiling on top of that, and the legend
prints which layers are currently drawn. On a phone-sized viewport `L2` never fades in, the sprite size
is halved, and `L1` keeps the 3,000 most activated nodes — the legend says how many were left out.

**Truncation.** The snapshot keeps at most 20,000 nodes, ordering `L0`, then `L1`, then `L2` by
activation, support and time. When anything is dropped, the response carries a `truncation` object and
the page prints it in the corner: no silent caps.

Two numbers differ from the research note, on purpose, because the measurement moved them:

- the note capped `L2` at 5,000 and sent anything past ~5,000 nodes to viewport pagination. The
  20,343-event corpus has 14,271 nodes in total, and the note's own budget says 20,000 nodes fit in one
  fetch — measured at 826 KB gzipped. So one fetch, one cap of 20,000, one truncation marker; the
  pagination path is not built until a corpus needs it.
- the note allowed ~400 edges for a selected node's neighbourhood. The detail panel shows the atlas
  service's own bounded first hop (30), because that is the answer every other surface prints and a
  second budget here would be a second opinion.

**Mobile.** `prefers-reduced-motion` or a viewport at or under 900 px turns off the background dust and
the idle rotation, halves the device pixel ratio ceiling and the sprite size, drops `L2`, caps `L1` at
3,000 nodes, and renders on demand instead of every frame.

## Agent scope

The roster is the identities the ledger names (`metadata.sourceAgent` and `agent:` tags) plus the hosts
wired to this install. Two departures from the note's wording, both measured:

- `actor_id` is not one of them: it holds a turn's role (`user`, `assistant`) on every row of the real
  corpus, and offering it as a view produced labels that selected nothing.
- Atlas documents are not read for names either: measured, 0 of 14,271 carry a `sourceAgent` in their
  `metadata_json`, and `metadata.sourceAgent` is the field the scope rule itself reads. If a projector
  ever stamps an owner on a document, the roster should read it.

Selecting an identity filters the same way the recall lanes do (#143 route 1) — the predicates are the
same functions, in `src/agent/AgentScopeRules.ts`:

- the agent's own records (`source_id` or an `agent:` tag naming it),
- imported material (`metadata.imported`), which is project-public by design,
- records that name no agent at all.

The composition is one function, `eventsVisibleToAgent`, beside the predicates; the recall lanes and
this page both call it, deriving their chain from their own shape. A node's chain is bounded the way
the atlas service bounds its evidence (8 anchors, then 16 source refs each), and an anchor whose event
the database no longer has contributes nothing. Both bounds can only hide an owner, never invent one.

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

## Recall decisions, and who writes them

The recall page reads decisions that a real recall already stored (#187). The producer is the default
lane itself: `KernelAgentMemoryBackend.recall()` is where the MCP tool, the CLI, the host bridge,
`recallPack()` and explain's re-run all arrive, so one row is written there per recall rather than at
each call site. `RecallDecisionTrace` owns the payload, and it carries ids, reasons and the lane:
the question, the lane that answered, why, the ids the recall returned, and the ids each gate
withheld with the reason it withheld them. An item's text is never in a row — a secret-marked turn is
withheld from every lane (#142, #177, #178), and this is the surface an operator audits those lanes
with, so it must not become the leak the lanes closed.

Two consequences worth stating rather than discovering:

- `explain` re-runs the default lane, so an explain is a recall and it records one. The *page* still
  never runs `explain`: it reads stored rows, which is what keeps its connection read-only.
- The table is created on the first recall rather than when the kernel opens. The 4.0 baseline schema
  is pinned object-for-object against the installer's own output, and this table is not the
  installer's; it appears when there is a decision to record. Until then `available: false` is the
  honest answer to "has anything recalled here".
- `cogmem_recall` keeps `readOnlyHint: true`. That hint is about canonical memory, which recall still
  never changes: the row is audit telemetry, the same shape as the activation a recall pack touches
  or `cogmem_graph_touch` records. Nothing a later recall can read is written.

**Retention.** `trace_events` is append-only, so `RECALL_TRACE_MAX_ROWS` (5,000 rows, newest win)
bounds it: the writer sweeps with one `DELETE` per 256 appends, and the sweep target sits one interval
below the ceiling so the table cannot pass it. `cogmem doctor --storage` reports
`recall_decisions=<rows>/<cap>`; a database where nothing has recalled reports `0`, and a table that
cannot be read at all is left out rather than printed as zero.

**Cost.** Measured on the 20,343-event corpus: recall median 209.84 ms before the write existed and
205.35 ms after (25 samples each, same script, fresh copies of the same file — the difference is inside
run-to-run noise). The write itself is 26.9 µs median / 47.0 µs p95 per row, and the retention sweep is
amortized at 17.8 µs per recall. A write that throws is a `recall_trace_failed` non-fatal pipeline
event; the recall returns as if nothing had happened.

**One number moved.** The secret gate used to count a withheld event per encounter — the same marked
turn reached by two search texts counted twice. It counts distinct events now, because the row has to
name them and naming one event twice would be a lie about how many there were. So
`decisionTrace.suppressed[].count` for `secret_bearing_withheld` is "distinct events", not "gates
fired"; nothing about what recall returns changed.
