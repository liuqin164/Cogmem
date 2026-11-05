# OpenClaw runtime mode

How Cogmem attaches to a running OpenClaw agent, and where the time goes.

## The hook path

```
user message
  → before_prompt_build (30s budget)
      → recall bridge
          → strategy + recall + activation
      → <COGMEM_RECALL_CONTEXT> injected into the prompt
  → model
  → agent_end (60s budget)
      → remember bridge
          → strip injected blocks
          → selective compile
```

Injected blocks are marked `volatile="true" persistence="forbidden"
lifecycle="current_turn_only"`, and `stripRecallBlocksBeforeRemember` removes
them before the turn is stored, so recalled memory is never re-ingested as new
memory.

The block carries `sourceLocator=cogmem memory show --event <id> --before 2
--after 2 --json`, which is the drill-down path to the exact raw text.

## Resident kernel

The bridge holds one kernel per workspace. `before_prompt_build` does not start
a kernel; it sends one JSON line over a Unix socket to a process that already
has the database open.

```
plugin (OpenClaw)  --unix socket-->  bridge.mjs serve  ->  one kernel, one DB handle
```

Why: opening the kernel costs 500ms to 2s depending on graph size (schema
checks, schema postconditions, atlas hydration). Paying it per turn made
every prompt slower as the memory grew.

### Lifecycle

- The plugin starts the daemon when it registers, and warms the kernel there, so
  the first prompt does not pay for it either.
- Before each hook the plugin pings the socket. No answer means the daemon died:
  it is started again, and the call proceeds.
- The daemon reports its `PLUGIN_VERSION`. A daemon from another build is killed
  and replaced, because it would otherwise keep an old kernel and an old payload
  shape.
- If the daemon cannot be reached at all, the bridge falls back to a one-shot
  process. Correct, just slow. This is also the path when `bridgeDaemon` is
  `false`.
- The entrypoint travels with the warm-up. A bridge that warmed without it
  resolved whatever `cogmem` was installed and cached that module for every
  later request, so the host ran a different build than the one it configured.
  When an entrypoint is set, the bridge refuses to fall back to a package name:
  a stale Cogmem is worse than a loud error.

### Socket

- Path: `<pluginDir>/run/bridge.sock`, mode `0600`.
- Protocol: one JSON request per line, one JSON response per line.
- Requests: `{ "command": "recall" | "remember" | "context" | "health" | ..., "payload": { ... } }`
- Responses: `{ "ok": true, "result": ... }` or `{ "ok": false, "error": "..." }`

An error response is surfaced, never retried in a fresh process: a `remember`
that failed after writing would otherwise be duplicated.

## Measured

Same machine, same database, 1083 events / 91 neurons:

| Path | p50 |
|---|---|
| one process per hook (before) | 1008 ms |
| resident daemon, warm | 55-108 ms |
| daemon start + kernel warm | ~1.2 s, once, at plugin register |

Empty memory still costs about 500 ms per hook in one-shot mode, because the
cost is the kernel open, not the retrieval.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `bridgeDaemon` | `true` | Use the resident kernel |
| `bridgeSocket` | `<pluginDir>/run/bridge.sock` | Socket path |
| `bridgeTimeoutMs` | `5000` | Per-request timeout before falling back |

Turning `bridgeDaemon` off restores the one-process-per-hook behaviour.

## Operating it

```bash
ss -xlp | grep bridge.sock          # daemon pid
kill <pid>                          # stop it; the next hook starts a new one
```

The daemon is detached on purpose: a gateway restart reuses the warm kernel.
Nothing else writes to the database through it, so the single-writer rule in
CONCURRENT_ACCESS.md still holds.
