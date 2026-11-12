# Memory observatory

A read-only page for looking at a corpus: a 3D star map of the Memory Atlas, the ledger's shape over
time, and the recall decisions that were stored. `cogmem observatory` serves it on `/observatory/`
from its own loopback process — the resident the update stops and starts.

```bash
cogmem observatory
# cogmem memory observatory (read-only) on http://127.0.0.1:7337/observatory/
```

## The constraints, and where each one is enforced

| Constraint | Where it lives |
|---|---|
| The database is never written | `openObservatoryDatabase` in `src/observatory/HttpServer.ts` opens a read-only connection; SQLite refuses a write on it. A `:memory:` or `file:`-URI database gets no page at all rather than being handed the kernel's writable handle. `__tests__/observatory.unit.test.ts` hashes the file across a full endpoint traversal and reads the observatory's own SQL for write statements. |
| Loopback only, with no option to change it | `isLoopbackAddress` in `src/observatory/routes.ts`, checked on the socket address of every request, and the URL the process prints always names `127.0.0.1`. The page's process binds loopback (`127.0.0.1`) and every request whose socket address is not loopback is refused. |
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

The roster is the identities the ledger names (`metadata.sourceAgent` and `agent:` tags) plus the family
roster's own agents. Two departures from the note's wording, both measured:

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
lane itself: `KernelAgentMemoryBackend.recall()` is where the CLI,
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
- Recall keeps its read-only contract. The row is audit telemetry, the same shape as the activation a
  recall pack touches or an explicit Atlas touch records. Nothing a later recall can read is written.

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

## Running the resident process

`cogmem observatory` serves the page; it is a subcommand of the one shipped bin, so a global
install (`npm install -g cogmem`) resolves it directly. A source checkout runs
`dist/bin/observatory.js` instead, as the second unit below does.

systemd user unit, `~/.config/systemd/user/cogmem-observatory.service`:

```ini
[Unit]
Description=Cogmem memory observatory
After=network.target

[Service]
Type=simple
ExecStart=%h/.npm-global/bin/cogmem observatory --port 7337 --db %h/.cogmem/memory.db
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
cogmem init                 # writes ~/.cogmem/config.toml; --db would create the dir on its own
systemctl --user daemon-reload
systemctl --user enable --now cogmem-observatory
```

`ExecStart` must be an absolute path to a real executable. Four variants were
tried on this machine:

| `ExecStart` | Result |
|---|---|
| `%h/.local/bin/cogmem observatory ...` | `status=203/EXEC` |
| `cogmem observatory ...` | `status=203/EXEC` |
| absolute path to an npm-installed `cogmem` wrapper | `active (running)`, answers on 7337 |
| `/usr/local/bin/bun /path/to/Cogmem/dist/bin/observatory.js ...` | `active (running)`, answers on 7337 |

`~/.local/bin/cogmem` is not where a global npm install lands: `npm config get
prefix` decides the directory, and the `cogmem` wrapper goes in its `bin/`.
Find the real path before writing the unit:

```bash
npm config get prefix        # e.g. /home/you/.npm-global
command -v cogmem            # e.g. /home/you/.npm-global/bin/cogmem
```

Substitute whatever `command -v cogmem` prints; the wrapper form is otherwise
equivalent to the bun plus entrypoint form.

A bare `cogmem` also fails, because the systemd user manager does not inherit
your shell `PATH`. Its default is
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin`,
which excludes `~/.npm-global/bin` and `~/.local/bin`. Confirm with
`systemctl --user show-environment | grep PATH`.

From a source checkout, skip the installed wrapper and run the entrypoint:

```ini
[Service]
Type=simple
WorkingDirectory=/path/to/Cogmem
ExecStart=/usr/local/bin/bun /path/to/Cogmem/dist/bin/observatory.js --port 7337 --db %h/.cogmem/memory.db
```

Two failure modes to expect on the first start:

- `status=203/EXEC` in `systemctl --user status` means the binary in `ExecStart`
  does not exist or is not executable. Nothing from the server is logged.
- `unable to open database file` in `journalctl --user -u cogmem-observatory` now means
  something other than a missing directory: the process creates the `--db` parent
  path itself. Check permissions on the directory, a read-only filesystem, or a
  `--db` value the service user cannot resolve to an absolute path.

Restarting drops in-flight page requests; a browser reloads and the page is there. There is no
session to reconnect, because the observatory answers plain HTTP rather than a protocol.

### Upgrading a resident process

The resident process does not hot-reload: it keeps the code it started with. So after a package
update the process still answers as the old version until it is restarted, and **both versions are
real** — one on disk, one serving. `cogmem doctor` reports that state rather than picking a number:

```
OK version 4.2.0 (latest 4.2.0)
OK resident process 4.1.0 (pid 3021, http, cogmem-observatory.service)
WARN version_skew: the resident process is still serving 4.1.0 (pid 3021); the disk is at 4.2.0. Run `systemctl --user restart cogmem-observatory.service` to take effect.
```

The unit name comes from the process's own cgroup, so it is the one systemd started, not one this
document assumed. `cogmem doctor --json` carries the same facts under `version`: `disk`, `latest`,
`updateAvailable`, `serving` (one entry per process, with `pid`, `version`, `transport`,
`url`, `systemdUnit`), `skew` and `restartRequired`.

Unattended, put the upgrade in a maintenance window and let systemd do the restarting. Two units,
beside the service above:

```ini
# ~/.config/systemd/user/cogmem-update.service
[Unit]
Description=Stage the next Cogmem release
After=network-online.target

[Service]
Type=oneshot
ExecStart=%h/.npm-global/bin/cogmem update --yes
```

```ini
# ~/.config/systemd/user/cogmem-update.timer
[Unit]
Description=Check for a Cogmem release once a day

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now cogmem-update.timer
systemctl --user list-timers cogmem-update.timer
```

`cogmem update --yes` stops and starts `cogmem-observatory.service` through `systemctl` itself, so
the oneshot needs no extra restart step, and a run where the release is already installed changes
nothing and restarts nothing — `Persistent=true` firing after a machine was off all week therefore
costs one no-op. If you would rather the restart be the unit's decision, run
`cogmem update --yes --stage-only` in the oneshot and add
`ExecStartPost=systemctl --user restart cogmem-observatory.service`; the trade is that the restart
then happens on every firing, including the ones with nothing to stage.

Never make the service restart itself: a process that stops itself mid-upgrade leaves a unit that
is neither the old version nor the new one, and a low-privilege process usually cannot start its
own unit anyway.
