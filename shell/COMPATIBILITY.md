# Pi compatibility baseline (F11 #165)

- **Target Pi version: `@earendil-works/pi-coding-agent@1.5.0`** (pinned; see `src/pi/target.ts`).
  The box's installed CLI is 1.4.0 and its local package is 1.3.0; the adapter is written against the
  1.5.0 extension types and tested with the plugins below.
- Compatibility object is the **plugin contract** (tool registration, event hooks, TypeBox
  parameters, extension loading), not Pi's package as a runtime dependency. The shell does not import
  Pi's loop; it reimplements the contract.

## Deliberate deviations (shell rules, not Pi's)

- **Tool calls in one assistant message run sequentially.** Pi's core defaults `toolExecution` to
  `"parallel"` (`pi-agent-core/dist/agent.js:147`), prepares calls in assistant order, then runs them
  concurrently — `tool_execution_end` in completion order, result messages in assistant order
  (`agent-loop.js:417-470`, the contract stated at `types.d.ts:20-24`). The shell runs each call to
  completion before the next, because its four tools mutate one workspace and the capture and
  checkpoint paths are order-sensitive. The ordering guarantees are kept (results land in assistant
  order); the concurrency is given up, and a per-call `executionMode` is not offered.
- **`tool_execution_start` names the arguments `input`, Pi names them `args`.** No plugin in the
  exercised set reads that event; if one appears, the translation belongs in `src/pi/adapter.ts`
  beside the `tool_call`/`tool_result` bridges, not in the core payload.

## Real plugins exercised through the adapter

| Plugin | Version | Kind | What the test drives |
|---|---|---|---|
| `pi-web-access` | 0.47.0 | tool | loads, registers its tools/commands, and one tool executes through the adapter into the shell tool registry |
| `@lalalic/channel` | 1.0.6 | channel | loads, receives a channel message over its own WebSocket protocol, and the message reaches the shell as an inbound turn |
| `debug-provider` (the example shipped in `@earendil-works/pi-coding-agent`'s `examples/extensions`) | 1.5.0 | command | loads, registers the `debug-provider` command, drops its entry renderer with a trace, and the command's own handler runs against the shell's UI shim |

The two npm plugins are pinned in `package.json`; the third ships inside the pinned Pi package, so its
version is `PI_TARGET_VERSION` by construction. The test records the version it loaded (see
`test/pi-adapter.test.ts` and the `pi_plugin_loaded` trace line).

## In scope

- `registerTool` with TypeBox `parameters`
- `on(event, handler)` for the full lifecycle: `before_agent_start`, `agent_start`, `turn_start`,
  `message_start/update/end`, `tool_execution_start/update/end`, `turn_end`, `finishTurn`,
  `prepareNextTurn`, `prepareRequest`, `agent_end`, `agent_settled`, `session_start/shutdown`, plus
  `tool_call` → `beforeToolCall` and `tool_result` → `afterToolCall`
- `registerCommand`, `registerProvider`, `registerFlag`/`getFlag`, `sendMessage`/`sendUserMessage`
  (`deliverAs: steer | followUp`), `exec`, `getSettings`, `events`
- lifecycle: adapter load translates registration, then fires `session_start`

## Refused or dropped (documented, not promised away)

Every capability named below is asserted against the trace in `test/pi-adapter.test.ts`, so this list
and the log cannot drift apart.

- **Refused** (`PiCapabilityUnsupported`), traced as `pi_capability_refused`: `registerMcpServer`
  (the shell is not an MCP host — it has no MCP client, and since #200 R2 it serves no outward MCP
  face either) and `registerVirtualModel` are refused while the plugin loads, so the plugin is
  disabled and the reason is additionally recorded as `pi_plugin_refused`. The interactive UI surface
  is only reachable from a call the adapter hands a context to — an event handler, a tool's `execute`,
  or a command handler: `ui.select`, `ui.confirm`, `ui.input`, `ui.editor` and `ui.custom` are refused
  at the call and traced there, and the plugin keeps running without a user.
- **Dropped** (traced as `pi_capability_dropped`, plugin keeps running): rendering-only
  registrations — `registerMessageRenderer`, `registerEntryRenderer`, `registerToolRenderer`,
  `registerMarkdownTransformer`, `registerShortcut` — because a resident headless process has no renderer
  or key surface.
- **Empty, and recorded**: `sessionManager.getEntries` and `sessionManager.getBranch` return `[]` (no
  session tree exists headlessly; a plugin that tolerates an empty history keeps working, one that needs
  the tree does not) and `setActiveTools` is a no-op because the cage whitelist decides the loadout. Each
  call records the drop the first time, so the degradation is visible in `.cogmem-shell/shell-events.jsonl`.
- Payload parity is at the documented field level, not byte-for-byte: `turn_end` carries
  `{ message, toolResults, turnIndex }`, `agent_end` carries `{ messages, summary }` (the `summary`
  is a companion superset). Entry ids, boundary state and session-tree fields are absent by design.
