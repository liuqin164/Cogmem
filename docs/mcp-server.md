# The Cogmem MCP server

Cogmem exposes one MCP endpoint over stdio or Streamable HTTP. HTTP is the
recommended path: one resident process serves every client, and the database
keeps a single writer.

```
cogmem mcp --transport http --host <host-id> --profile core --port 7337
```

The endpoint is `http://127.0.0.1:7337/mcp`. It binds to loopback by default.

Bind the connection to one project with `--project <id>`. Every call is then
stamped with that project, and a call that names a different one is rejected
with `project_scope_violation` instead of reading another project's memory.
Without `--project`, each call's `projectId` argument decides.

### Two bins ship: `cogmem` and `cogmem-mcp`

`cogmem <subcommand>` is the entry point, and it is the only way in for commands: the
`cogmem-<command>` aliases (twenty of them in 3.x) were removed in 4.0, along with the
deprecation warning they printed. `cogmem-mcp` is the exception because existing
configurations name it as the MCP server command — a configuration written before the
upgrade is not rewritten, so removing it would break a working install silently.

### Without a model provider, recall is lexical

`memory` and `reasoning` default to `rule_only`, and that is not only about answer quality:
the deterministic curator then marks every event `shouldEmbed: false` and stores it
`raw_ledger_only`, so nothing enters the vector index and recall answers from the raw
ledger by literal match. Measured on a 1,230-message, 12-month corpus: 8 of 12
paraphrased questions were answered at rank 1, 9 of 12 within five, and every answer came
from `raw_ledger_fallback` — the three misses were exactly the questions whose words do
not appear in the fact ("最多几次" against "上限是五次"). `cogmem doctor` reports
`rule_only` as a warning; configuring a model provider is what turns the semantic half on.

What a `rule_only` install can and cannot do, stated plainly: it finds a memory whose
words are close to the question, and it will not find one that only shares its meaning —
"归档数据保留多久" does not reach a memory that says "归档保留期定成七年" unless those
words appear. The compiled layer (episodes, frames, Atlas) still contributes: it labels a
matching answer with the topic it belongs to (`displayTitle`, an `atlas_node` tag) and the
recall trace reports how many compiled cards were consulted. What it does not do is answer
instead of the raw text, or match a paraphrase. Both need a model provider.


## Profiles

The server exposes 40 tools. A host does not need all of them.

| Profile | Tools | Use for |
|---|---|---|
| `core` | 6 | Everyday agent work: recall, record a turn, inspect evidence |
| `admin` | 26 | Operators: sealing episodes, dream ticks, governance review, importing host history |
| `full` | 40 | Debugging and tool discovery |

A discovered tool count says which profile is in effect: 6 means the
`core` profile, 40 means `full`.

`core` is these six, and each one says which step of the retrieval chain it is (#118).
Index first, detail by ID: a broad answer returns identifiers, and the caller pays for
the detail only on what it chose.

| Tool | Step | Why it is in `core` |
|---|---|---|
| `cogmem_recall` | index | The everyday entry point: governed context for a question, with the evidence ids that reached it |
| `cogmem_graph_explore` | index | Broad inventory across the Atlas when the question is "what do I have", not "what is this" |
| `cogmem_graph_node` | detail | One node by id, with neighbors and evidence ids — the fetch that `graph_explore` makes cheap to need |
| `cogmem_explain_recall` | detail | Why a given recall answered as it did, for a result the caller already has |
| `cogmem_remember_turn` | write | Records a user/agent turn and follows the episode lifecycle (ADR-0011) |
| `cogmem_episode_append` | write | One bounded raw message with its session and turn fields set explicitly |

**Two writes is the pair to watch.** `cogmem_remember_turn` and `cogmem_episode_append`
both put a turn in the ledger from different levels — the first through the episode
lifecycle, the second message by message — and a third write would be the count going up
without the surface getting better. Anything new that writes belongs in one of these two,
or replaces one of them, before it becomes a tool.

A tool outside the profile returns `tool_not_in_profile` instead of running. A
name that is in **no** profile returns `tool_not_found`: there is no profile to
widen to, so the two answers stay distinct.


## Shared memory — opt-in, off by default

Sharing between agents ships in 4.1 and is **off unless the operator turns it on**: `[shared] enabled`
in `config.toml` is the switch, and a default install shares nothing.

With the switch on, four `admin`-profile tools cover the region:

| Tool | Profile | Behaviour |
|---|---|---|
| `cogmem_shared_publish` | admin | Publishes items into a collection. The first publisher of a collection owns it, and only the owner may publish into it afterwards |
| `cogmem_shared_retract` | admin | Soft retraction: the item leaves subscriptions, stays explainable, and only its publisher may retract it |
| `cogmem_shared_subscribe` | admin | Reads the shared collections |
| `cogmem_shared_explain` | admin | Looks up one item by hash, including when and by whom it was retracted |

The model is **publish and read** ([#146](https://github.com/liuqin164/cogmem/issues/146), Ryu 2026-11-06):
while the switch is on, every agent that can connect reads every shared collection. Three rules bound it:

- **Writing is explicit and owner-only, reading is not gated per reader.** The first publisher of a
  collection owns it; only the owner may publish into it or retract from it, and a retraction takes effect
  immediately. Reading is open to any connected agent, so the per-reader list that 4.1 first shipped with
  is retained in the schema but consulted nowhere — a future multi-user deployment can turn that check
  back on, and until then there is no branch to keep in step.
- **Identity comes from the connection, never from the arguments.** A caller cannot name itself a
  different publisher or retractor, and a call with no identity reads nothing rather than everything
  (ADR-0006: a `hostId` needs a credential).
- **Writing is refused while the switch is off**: `shared_disabled`, rather than a silent no-op.

`cogmem doctor` lists every collection with its owner, item count, and the fact that it is readable by
every agent that can connect, and it reports the switch. Publishing and retraction are recorded;
**who subscribed is not**, so read-side auditing is not something this release can answer.

## Importing host history

Three admin-profile tools wrap the `cogmem import hermes` / `import openclaw`
pipeline so a host can pull its own prior transcripts into the ledger without
shelling out.

| Tool | Profile | Behaviour |
|---|---|---|
| `cogmem_import_preview` | admin | Dry-run: discovers sources, parses them, returns `recordsWouldIngest` per source. Writes nothing |
| `cogmem_import_apply` | admin | Runs the pipeline: `recordRawEvent` → ingest → consolidate → rebuild Memory Atlas. Idempotent per source |
| `cogmem_import_status` | admin | Reports every registered source for a project with its path, adapter kind, last processed timestamp and already-ingested record count |

`agent` is `openclaw` or `hermes`; `workspaceRoot` is where the host keeps its
sessions. `since` / `until` bound the window. `cogmem_import_preview` carries
`readOnlyHint: true`, so a client that gates destructive calls will run it
without a prompt.

`cogmem_import_status` orders sources most recently processed first and takes
`limit` (default 50, must be a positive integer). `sources` is truncated to
`limit` while `totalSources` always reports the full count, so a caller can tell
"there are more" from "that is all".

## Security

The endpoint is loopback-only by default. Any local process can reach a
loopback port, so set a token when the machine is shared:

```bash
cogmem mcp --transport http --port 7337 --token "$(openssl rand -hex 24)"
```

With `--token`, every request must send `Authorization: Bearer <token>`.
Without it, requests get `401`.

### Per-session identity

A host that serves several bots over one resident server can bind a session with
a header:

```
x-cogmem-identity: {"hostId":"cursor","projectId":"project-a","profile":"core"}
```

Every field is optional. Five rules bound what it can do:

- **The profile is a default, not a lock.** The profile the server *launched*
  with is the ceiling: a call may narrow it and may raise it back up to that
  ceiling, but a header can never exceed it.
- **A token removes the ceiling.** An authenticated request may set any valid
  profile; the token is the trust boundary, not the header.
- **A `hostId` needs a credential.** A `hostId` says *which agent* the call runs
  as, so it is honoured only on an authenticated connection. Without a token it
  is ignored: the call runs as the server, never as the name in the header. A
  local process cannot promote itself to another agent by asking.
- **A bound project cannot be switched.** A `projectId` that differs from the
  binding — or from `--project` — is rejected with `project_scope_violation`.
- **An unknown profile is rejected** with `unknown_tool_profile:<value>`.

The header is read on **every call**, not only when the session opens: one
request can override a field for that call without changing the binding. A
malformed header is ignored rather than rejected, which leaves the session
unbound and lets call arguments choose the project — so a deployment that needs
project isolation should set `--project`. With no token configured, any process
that can reach the loopback port can claim a `projectId` when the server has no
`--project` binding, but it cannot claim a `hostId` at all; it still cannot
exceed the launch profile.

### Registering several agents

One resident server can serve several agents, each with private memory. Each
agent is registered with its own credential in `<workspace>/.cogmem/agents.json`,
falling back to `~/.cogmem/agents.json`. Only a digest of the credential is
stored:

```json
{
  "agents": [
    { "hostId": "bot-a", "tokenDigest": "<sha256 hex>", "projectId": "project-a", "profile": "admin" },
    { "hostId": "bot-b", "tokenDigest": "<sha256 hex>", "projectId": "project-b" }
  ]
}
```

Readers look in the Workspace first, then beside the home directory: a
registration written by `cogmem init --scope project --register-agent` is read
from the Workspace it was written under, from any directory. `--agents <path>`
points somewhere else, and a path that is named but cannot be read **refuses to
start** — that is a misconfiguration, not the single-agent case.

With a registry loaded the credential decides the identity: a request that
presents no registered credential is refused with `401` even on loopback,
`projectId` is the project that agent is confined to, and `profile` is that
agent's ceiling. A header may narrow those fields but never change them — a
`hostId` that disagrees is rejected with `host_identity_mismatch`.

The **stdio** transport enforces it the same way, from the environment the host
launched the process with: with a registry loaded, `cogmem mcp` requires
`COGMEM_AGENT_TOKEN` to hold a registered credential and exits with
`agent_credential_required` otherwise. A credential that cannot be found is
refused, never served as an anonymous client with project access.

No registry anywhere is the single-agent case and is not an error — but a
credential that arrives when there is no registry to identify it *is* refused,
which is a different answer from "no registry configured". A file that exists and
cannot be read is an error, because serving every agent as anonymous while the
operator believes they are registered is the failure the file prevents.

Register an agent with `init`, which mints the credential for you:

```bash
cogmem init --register-agent bot-a                    # prints the credential once
cogmem init --register-agent bot-b                    # add a second agent later
cogmem init --register-agent bot-a --rotate           # replace a lost credential
cogmem init --register-agent bot-c --dry-run --json   # see what it would write
```

Each run writes `agents.json` and prints the credential exactly once — the file
keeps only a digest, so it cannot be read back. `--rotate` is required to replace
an existing credential, because silently swapping one breaks the host already
using it. This mode never writes `config.toml`: that is what lets the second
agent be onboarded on a machine whose config already exists.


## Running the resident process

`cogmem-mcp` is a `bin` entry of the package, so it only resolves after a global
install (`npm install -g cogmem`); a source checkout runs `dist/bin/mcp.js` instead,
as the second unit below does.

systemd user unit, `~/.config/systemd/user/cogmem-mcp.service`:

```ini
[Unit]
Description=Cogmem MCP server
After=network.target

[Service]
Type=simple
ExecStart=%h/.npm-global/bin/cogmem mcp --transport http --port 7337 --host local --profile core --db %h/.cogmem/memory.db
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
cogmem init                 # writes ~/.cogmem/config.toml; --db would create the dir on its own
systemctl --user daemon-reload
systemctl --user enable --now cogmem-mcp
```

`ExecStart` must be an absolute path to a real executable. Four variants were
tried on this machine:

| `ExecStart` | Result |
|---|---|
| `%h/.local/bin/cogmem ...` | `status=203/EXEC` |
| `cogmem mcp ...` | `status=203/EXEC` |
| absolute path to an npm-installed `cogmem` wrapper | `active (running)`, answers `initialize` |
| `/usr/local/bin/bun /path/to/Cogmem/dist/bin/mcp.js ...` | `active (running)`, answers `initialize` |

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
ExecStart=/usr/local/bin/bun /path/to/Cogmem/dist/bin/mcp.js --transport http --port 7337 --profile core --db %h/.cogmem/memory.db
```

Two failure modes to expect on the first start:

- `status=203/EXEC` in `systemctl --user status` means the binary in `ExecStart`
  does not exist or is not executable. Nothing from the server is logged.
- `unable to open database file` in `journalctl --user -u cogmem-mcp` now means
  something other than a missing directory: the server creates the `--db` parent
  path itself. Check permissions on the directory, a read-only filesystem, or a
  `--db` value the service user cannot resolve to an absolute path.

Restarting loses live MCP sessions; hosts reconnect on the next call.

### Upgrading a resident process

The resident process does not hot-reload: it keeps the code it started with. So after a package
update the process still answers as the old version until it is restarted, and **both versions are
real** — one on disk, one serving. `cogmem doctor` reports that state rather than picking a number:

```
OK version 4.3.0 (latest 4.3.0)
OK resident process 4.2.0 (pid 3021, http, cogmem-mcp.service)
WARN version_skew: the resident process is still serving 4.2.0 (pid 3021); the disk is at 4.3.0. Run `systemctl --user restart cogmem-mcp.service` to take effect.
```

The unit name comes from the process's own cgroup, so it is the one systemd started, not one this
document assumed. `cogmem doctor --json` carries the same facts under `version`: `disk`, `latest`,
`updateAvailable`, `serving` (one entry per process, with `pid`, `version`, `transport`,
`hostId`, `url`, `systemdUnit`), `skew` and `restartRequired`.

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

`cogmem update --yes` stops and starts `cogmem-mcp.service` through `systemctl` itself, so the
oneshot needs no extra restart step, and a run where the release is already installed changes
nothing and restarts nothing — `Persistent=true` firing after a machine was off all week therefore
costs one no-op. If you would rather the restart be the unit's decision, run
`cogmem update --yes --stage-only` in the oneshot and add
`ExecStartPost=systemctl --user restart cogmem-mcp.service`; the trade is that the restart then
happens on every firing, including the ones with nothing to stage.

Never make the service restart itself: a process that stops itself mid-upgrade leaves a unit that
is neither the old version nor the new one, and a low-privilege process usually cannot start its
own unit anyway.


## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 unauthorized` | Server has `--token`; the host is not sending the header. The body is the bare word `unauthorized` |
| `tool_not_in_profile` | Tool is outside the active profile. The message names every profile that does expose it, so restart with one of those |
| `session_not_found` (HTTP 404) | The MCP session expired or the server restarted; reconnect the host |
| `Bad Request: Server not initialized` (HTTP 400) | A request arrived without `mcp-session-id`, or before `initialize`. Send the session header |
| `Failed to start server. Is port 7337 in use?` | Another process holds the port; check with `ss -ltnp` |
| Host connects but sees 6 tools | Expected: `core` profile |
| `tool_not_found` | The name is not a Cogmem tool at all, in any profile. Check the name |
| `shared_disabled` | A `cogmem_shared_*` call on an install that did not set `[shared] enabled` |

Check the endpoint by hand. The first call has no session; take the
`mcp-session-id` response header and send it on every later call:

```bash
curl -s -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  http://127.0.0.1:7337/mcp
```

Responses are `text/event-stream`, so the JSON sits on a `data:` line. To list
the tools, replay the session id:

```bash
SID=$(curl -s -D - -o /dev/null -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  http://127.0.0.1:7337/mcp | grep -i '^mcp-session-id:' | tr -d '\r' | cut -d' ' -f2)

curl -s -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  http://127.0.0.1:7337/mcp

curl -s -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  http://127.0.0.1:7337/mcp
```
