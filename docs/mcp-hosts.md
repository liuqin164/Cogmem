# Connecting Cogmem to a host

Cogmem exposes one MCP endpoint. Any host that speaks MCP can attach to it over
stdio or Streamable HTTP. HTTP is the recommended path: one resident process
serves every client, and the database keeps a single writer.

```
cogmem mcp --transport http --host <host-id> --profile core --port 7337
```

The endpoint is `http://127.0.0.1:7337/mcp`. It binds to loopback by default.

This page covers the MCP path in full. It is the fallback path for a host with no
Cogmem adapter: the push path, the **Memory bridge** behind it, and the per-host
adapter roadmap are in ADR-0004 and in the
[README](../README.md#how-memory-reaches-the-model).

Verification status: the OpenClaw 2026.10.5, Hermes v0.22.2, and codex-cli
0.163.0 sections were run end to end against this repository: connect, discover
tools, execute `cogmem_remember_turn` and `cogmem_recall`, then remove the entry
and confirm the host config is back to its original bytes. The Claude Code and
Cursor sections follow those vendors' published configuration formats, checked
line by line against the vendor reference on 2026-10-23 (links at the end), and
have not been exercised against a live client: both need credentials this
machine does not have (an Anthropic key or a Cursor account), and Cursor's
client is a desktop app.

Bind the connection to one project with `--project <id>`. Every call is then
stamped with that project, and a call that names a different one is rejected
with `project_scope_violation` instead of reading another project's memory.
Without `--project`, each call's `projectId` argument decides.

## Profiles

The server exposes 36 tools. A host does not need all of them.

| Profile | Tools | Use for |
|---|---|---|
| `core` | 6 | Everyday agent work: recall, record a turn, inspect evidence |
| `admin` | 22 | Operators: sealing episodes, dream ticks, governance review, importing host history |
| `full` | 36 | Debugging and tool discovery |

`core` is: `cogmem_recall`, `cogmem_remember_turn`, `cogmem_episode_append`,
`cogmem_graph_explore`, `cogmem_graph_node`, `cogmem_explain_recall`.

A tool outside the profile returns `tool_not_in_profile` instead of running. A
name that is in **no** profile returns `tool_not_found`: there is no profile to
widen to, so the two answers stay distinct.

## How memory reaches the model

Two paths exist, and they promise different things. Keep two questions apart on
every host: **what the host exposes** (a **Push hook** — a **Host hook** that runs
before the model answers) and **what Cogmem ships for it** (a **Host adapter** that
uses that hook). Having a hook makes emergence possible; only a shipped adapter
makes it true.

**Push — Emergence.** The host exposes a push hook and a Cogmem adapter uses it,
so recalled memory is already in the prompt before the model answers. The model
never asks. Today exactly one adapter ships, the Cogmem plugin for OpenClaw:
`before_prompt_build` injects the
recall block. `agent_end` records the finished turn; it does not make memory
emerge.

**Pull — explicit.** No adapter runs before the model answers on this path:
either the host speaks MCP only, or it exposes a hook that no Cogmem adapter uses
yet. The model has to call `cogmem_recall` itself. The server's
`instructions` string is what tells it to; that string is product surface, not
documentation. It only names tools the profile the server started with exposes —
a per-call identity that narrows the profile does not rewrite it.

| Host | Path | Push hook the host exposes | Cogmem adapter | What happens before the model answers |
|---|---|---|---|---|
| OpenClaw + the Cogmem plugin | push | `before_prompt_build` | shipped and verified | Recall is already in the prompt |
| OpenClaw via `openclaw mcp add` | pull | `before_prompt_build` | not installed on this path | The model must call `cogmem_recall` |
| Hermes | pull | `pre_llm_call` | planned, first in the roadmap (ADR-0004) | The installed `cogmem-memory` skill documents when to call `cogmem_recall` |
| pi | pull | `before_agent_start` | planned | The model must call `cogmem_recall` |
| DSH | pull | prompt section | planned | The model must call `cogmem_recall` |
| Claude Code | pull | `UserPromptSubmit` | planned; unverified against a real client when it lands | Same contract, delivered by `instructions` |
| Cursor | pull | none, MCP only | none | Same |
| Codex | pull | none, MCP only | none | Same |

The hook names come from the vendor sources recorded in
[host-plugin-record-hooks.md](./host-plugin-record-hooks.md). `Path` is what
Cogmem does today, so a host that has a hook and a planned adapter is `pull`
here, and stays `pull` until its adapter ships: ADR-0002 requires capability and
delivery to be stated separately, and ADR-0004 fixes the order the adapters land
in — Hermes, then pi, DSH, and Claude Code last, written against the documented
hook and **not verified against a real client**, which is the label it carries
wherever it is described.

Do not describe a pull-only host as automatic. Its agent then looks for a memory
that never surfaced, finds none, and concludes Cogmem does not work. Emergence
is the property only the push path can claim, and today the OpenClaw adapter is
the only adapter on it.

## Shared memory — planned for 4.1, not in 4.0

4.0 does not expose shared memory. No profile registers a shared-memory tool, so
a call to one is answered `tool_not_found`, and starting a server no longer
creates the shared region's storage.

The reason is that the three things shared memory needs are not in 4.0: a
trusted identity for each connected agent
([#65](https://github.com/liuqin164/cogmem/issues/65)), per-collection read
permission ([#66](https://github.com/liuqin164/cogmem/issues/66)), and
provenance labelling that keeps another agent's memory at lower trust
([#67](https://github.com/liuqin164/cogmem/issues/67)). Shipping
publish/subscribe without them would hand every connected bot one shared
namespace with no way to say who wrote what.

The port and its SQLite adapter stay in the tree for 4.1, reachable from neither
the MCP surface nor a package entry point. When the three issues above land, the
tools come back as an opt-in feature rather than a default region.

## Importing host history

Three admin-profile tools wrap the `cogmem import-hermes` / `import-openclaw`
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

## Claude Code

```bash
claude mcp add --transport http cogmem http://127.0.0.1:7337/mcp --scope user
```
With a token:

```bash
claude mcp add --transport http cogmem http://127.0.0.1:7337/mcp --scope user \
  --header "Authorization: Bearer $COGMEM_TOKEN"
```

Verify inside Claude Code with `/mcp`; the server should show `connected`.
`--scope user` makes it available across projects; `--scope project` writes it
into `.mcp.json` for the repo instead; no `--scope` means local scope.

The same server as a `.mcp.json` entry, for a repo that should carry the config:

```json
{
  "mcpServers": {
    "cogmem": {
      "type": "http",
      "url": "http://127.0.0.1:7337/mcp",
      "headers": { "Authorization": "Bearer ${COGMEM_TOKEN}" }
    }
  }
}
```

`type` is not optional. Claude Code reads an entry with no `type` as a stdio
server, so a `url` without one is skipped with
`MCP server "cogmem" has a "url" but no "type"; add "type": "http"`. The value
`streamable-http` is accepted as an alias for `http`. `${VAR}` expands from the
environment, and `${VAR:-default}` supplies a fallback.

`--transport http` tries Streamable HTTP first and falls back to SSE when the
server refuses it; that fallback needs Claude Code v2.1.265 or later. Pass
`--transport sse` to force SSE on an older build.

## Cursor

Write `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "cogmem": {
      "url": "http://127.0.0.1:7337/mcp",
      "headers": {
        "Authorization": "Bearer ${env:COGMEM_TOKEN}"
      }
    }
  }
}
```

Omit `headers` when no token is configured. Cursor interpolates
`${env:NAME}` in any string field, `auth` included. `envFile` exists but only for
stdio entries; remote HTTP and SSE entries take `headers` instead.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.cogmem]
url = "http://127.0.0.1:7337/mcp"
bearer_token_env_var = "COGMEM_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Codex reads the token from the named environment variable at connect time; the
variable must be exported in the shell that launches Codex. Drop
`bearer_token_env_var` when the server has no token.

To bound the tool surface on the Codex side as well, list names explicitly:

```toml
enabled_tools = ["cogmem_recall", "cogmem_remember_turn", "cogmem_episode_append"]
```

Verified with codex-cli 0.163.0: `codex mcp add cogmem --url ...` registers the
server, `codex mcp list` shows it `enabled`, and `codex exec` calls
`cogmem_remember_turn` and `cogmem_recall` for real (the transcript prints
`mcp: cogmem/cogmem_remember_turn (completed)`).

Two things that bite on this version:

- `wire_api = "chat"` is rejected outright: "no longer supported, set
  `wire_api = "responses"`". A provider that only speaks chat completions cannot
  back Codex at all; it needs a `/v1/responses` endpoint.
- `codex exec` runs tool calls through its sandbox. Against a loopback MCP server
  the default sandbox blocked the connection, and `--dangerously-bypass-approvals-and-sandbox`
  was needed for the run to complete. For an interactive session, set
  `default_tools_approval_mode = "auto"` on the server entry (documented values:
  `auto`, `prompt`, `writes`, `approve`) or approve each call.

## Hermes

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  cogmem:
    url: http://127.0.0.1:7337/mcp
    headers:
      Authorization: Bearer ${COGMEM_TOKEN}
    enabled: true
```

Omit `headers` when no token is configured. Hermes reads `url` and `headers`
for HTTP servers and falls back to `command`/`args` for stdio.

Verified against Hermes v0.22.2:

```bash
hermes mcp add cogmem --url http://127.0.0.1:7337/mcp --connect-timeout 20
hermes mcp test cogmem
```

`hermes mcp add` is verified against Hermes v0.22.2 on an HTTP endpoint with no
token. It prompts twice: whether the server needs authentication, then whether
to enable all discovered tools. Both answers can be piped on stdin
(`printf 'n\nY\n' | hermes mcp add ...` saves the server, and Hermes prints how
many discovered tools it enabled — that line read `(8/8 tools enabled)` when this
was checked, against the 8-tool `core` profile shipping at the time; 4.0's
`core` profile serves 6, so expect `(6/6 ...)` today). What does *not* work is
leaving stdin empty: the authentication prompt falls back to `getpass` and reads
an empty API key, and the enable prompt then reads EOF and cancels without
saving. Give both answers explicitly when scripting it.

`hermes mcp test <name>` reconnects and lists the discovered tools, so it is the
non-interactive way to confirm the entry. Remove one with
`hermes mcp remove <name>`.

`cogmem connect hermes --auto` writes that entry for you, and `--hermes-config
<path>` points it at a config outside `~/.hermes`. The readers take the same flag,
so an integration written elsewhere is not read back as missing:

```bash
cogmem connect hermes --auto --hermes-config /srv/hermes/config.yaml
cogmem doctor --hermes-config /srv/hermes/config.yaml
```

Without it, `doctor` looks at `~/.hermes/config.yaml` and will recommend
`connect hermes` again — and that recommendation writes to the default path, so an
agent following it blindly would create a second integration.

---

## OpenClaw

Verified against OpenClaw 2026.10.5:

```bash
openclaw mcp add cogmem \
  --url http://127.0.0.1:7337/mcp \
  --transport streamable-http
openclaw mcp probe
```

`--transport streamable-http` is required. Without it OpenClaw assumes the
legacy SSE transport, sends a GET to the endpoint, and fails with
`SSE error: Non-200 status code (400)`.

`openclaw mcp probe` reports the discovered tool count per server; 6 means the
`core` profile, 36 means `full`.

`openclaw mcp add` prints only `Saved MCP server "cogmem" to <path>`; the tool
count comes from `openclaw mcp probe`. To remove a server, run
`openclaw mcp unset <name>`; `openclaw mcp remove` does not exist and returns
`OpenClaw mcp has no command "remove"`. After any change, run
`openclaw mcp reload` so the next turn picks up the new config. Editing
`mcp.servers` in `~/.openclaw/openclaw.json` by hand also works, but `unset` is
the supported path and keeps the file well formed.

Tool execution was verified end to end on 2026.10.5: an agent turn called
`cogmem_remember_turn` and `cogmem_recall`, and the marker text landed in
`memory_events` plus its neuron projection.

One gotcha when you want an agent turn that is not the live gateway session:

- `openclaw agent --local` refuses to start while a gateway owns the state
  directory: `A Gateway is running for this state directory (pid ..., port ...).
  Run without --local to use it`. Either stop the gateway or take the normal
  path, which is to send the turn through it.
- `openclaw agent -m "..." --session-key <key>` runs one isolated session through
  the running gateway and, without `--deliver`, sends the reply nowhere. That is
  enough to exercise MCP tools without touching any chat channel.

---

## pi

pi reads MCP servers from `$HOME/.pi/agent/mcp.json`, and from a project-local
`.pi/mcp.json` when one exists. The entry is `{command, args}`:

```json
{
  "mcpServers": {
    "cogmem": {
      "command": "/absolute/path/to/cogmem",
      "args": ["mcp", "--config", "/path/to/ws/.cogmem/config.toml", "--project", "pi-<workspace-hash>"]
    }
  }
}
```

`connect pi --auto` writes that entry and installs the skill in one step:

```bash
cogmem connect pi --workspace /path/to/ws --auto --json
pi mcp list          # → connected, 6 tools
```

The skill goes to `~/.agents/skills/cogmem-memory/`, which is the Agent Skills location pi
actually scans — measured against a real pi: the same skill under `~/.pi/skills/` was **not**
listed. `connect` leaves every other server in `mcp.json` alone, and `--pi-config` names a
different file.

By hand, pi's own command is the supported path:

```bash
pi mcp add cogmem -- /absolute/path/to/cogmem mcp --config /path/to/ws/.cogmem/config.toml --project pi-abc12345
pi mcp list          # → connected, 6 tools
```

**`command` has to be absolute, or resolvable by the process pi spawns.** pi does not
resolve a bare `cogmem` from the shell that ran the command, and an entry it cannot spawn
is an integration that silently never starts. The same trap applies to every host here;
`connect` records an absolute launcher for exactly this reason (#94).

**`--project` is the identity, not `--agent`.** pi sends its own `agentId` on the write
calls, and since #92 a caller-supplied `agentId` is a label rather than the authority: the
connection's identity is the credential, then the host's fixed identity, then the bound
project. So a turn pi stores is written under `pi-<workspace-hash>` and found again by
`memory recall --project pi-<workspace-hash>` with no `--agent`. Before that fix the write
and the read disagreed and the memory was invisible to the connection that wrote it.

Verified against a real pi conversation: the agent called `cogmem_remember_turn` itself,
the turn landed (`rawEvents=5`, `vectors=1`), and the default recall returned it.

pi has no Cogmem adapter, so its row above stays `pull` / `planned` — shipping `connect pi`
does not make the adapter shipped, and ADR-0002 requires those two facts to be stated
separately. The same is true of Hermes, whose `connect hermes --auto` has shipped for a while
while its adapter column still reads `planned`. Nothing injects recall: the installed
`cogmem-memory` skill is what tells the agent when to record and recall, and the agent has to
make the call itself.

pi has **no history importer**, so `connect pi` prints no import steps — running
`import-hermes` under a pi heading would be a step that cannot work.

## stdio fallback

Every host above also accepts stdio. Use it when a host cannot reach a local
port, or when you want the host to own the process lifetime:

```json
{
  "mcpServers": {
    "cogmem": {
      "command": "cogmem-mcp",
      "args": ["--db", "/home/you/.cogmem/memory.db", "--profile", "core"]
    }
  }
}
```

`cogmem-mcp` is a `bin` entry of the package, so it only resolves after a global
install (`npm install -g cogmem`). In a source checkout the command is not on
`PATH` and the host fails with `command not found`; point `command` at the
entrypoint directly instead:

```json
{
  "mcpServers": {
    "cogmem": {
      "command": "bun",
      "args": ["/path/to/Cogmem/dist/bin/mcp.js", "--db", "/home/you/.cogmem/memory.db", "--profile", "core"]
    }
  }
}
```

Both forms were run: `cogmem-mcp` from a global install and `bun dist/bin/mcp.js`
from the checkout. Both answer `initialize` and `tools/list` in JSON-RPC on
stdout (one object per line, not SSE).

The `--db` directory is created if it does not exist. The server makes parent
directories before opening the file, so `--db ~/.cogmem/memory.db` works on a
fresh machine without running `cogmem init` first. `cogmem init` is still what
writes a config file and runs the embedding probe; it is not a prerequisite for
`--db`. Paths that are not plain files (`:memory:`, `file:` URIs) are left
untouched.

stdio starts one process per client connection. Each process opens the
database, so do not run several stdio clients against the same database file at
the same time.

## Running the resident process

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

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 unauthorized` | Server has `--token`; the host is not sending the header. The body is the bare word `unauthorized` |
| `tool_not_in_profile` | Tool is outside the active profile; restart with `--profile admin` |
| `session_not_found` (HTTP 404) | The MCP session expired or the server restarted; reconnect the host |
| `Bad Request: Server not initialized` (HTTP 400) | A request arrived without `mcp-session-id`, or before `initialize`. Send the session header |
| `Failed to start server. Is port 7337 in use?` | Another process holds the port; check with `ss -ltnp` |
| Host connects but sees 6 tools | Expected: `core` profile |
| `tool_not_found` | The name is not a Cogmem tool at all, in any profile. Check the name; on 4.0 this is the answer for the shared-memory tools that shipped before 4.0 and return in 4.1 |

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

## Official documentation

Every configuration shape above is checked against the vendor's own reference.
Where a section is marked unverified, this is what it was checked against
instead of a live client.

| Host | Reference | Checked |
|---|---|---|
| Claude Code | https://code.claude.com/docs/en/mcp | 2026-10-23 |
| Cursor | https://cursor.com/docs/mcp | 2026-10-23 |
| Codex | https://developers.openai.com/codex/mcp | 2026-10-23 |
| Hermes | https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference | 2026-10-23 |
| OpenClaw | https://docs.openclaw.ai/tools/mcp | 2026-10-23 |

The protocol itself is specified at
https://modelcontextprotocol.io/specification. Cogmem advertises only the
`tools` capability, which is the part every one of these hosts implements.
