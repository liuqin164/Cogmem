---
name: cogmem-memory
description: Use cogmem as pi's durable memory. Use when the user asks what was decided earlier, refers to past work or relationships, wants something remembered across sessions, or when the cogmem MCP server needs wiring or repair.
---

# cogmem Memory Backend for pi

Use this skill when a pi workspace needs `cogmem` as its durable memory.

For the full command matrix, recall contracts, Atlas filters, governance actions, and repair
commands, read [references/operations.md](references/operations.md).

## Ground Rules

- Use TOML config only: `~/.cogmem/config.toml` or a project `.cogmem/config.toml`.
- Do not create `.cogmem.env` files and do not pass `--env-path`.
- Do not configure kernel behavior through hidden environment variables; write TOML instead.
- Do not run your own vector search before calling `cogmem_recall`. Recall already performs
  activation, temporal traversal, graph traversal, and narrative assembly.
- Treat entity aliases as governed candidates. Never merge people from pronouns, family
  labels, job titles, assistant text, or tool output alone; require explicit user evidence.

## How memory reaches you

pi is a **pull** host. Nothing injects memory into the prompt — there is no hook to install, so
Cogmem cannot observe a pi conversation on its own. Two consequences:

- If you do not call the memory tools, nothing is remembered. A conversation you did not
  record is gone.
- Before answering a question about the past, call `cogmem_recall`. Do not answer from the
  visible context and assume that is all there is.

## Identity — the project is the identity, not your agentId

The MCP server `connect pi` wires is bound to this workspace: it is started with
`--project pi-<workspace-hash>` and `--config <workspace>/.cogmem/config.toml`.

Since 4.0 the connection's identity is the only authority for both writing and reading: the
credential first, then the host's fixed identity, then the bound project. **An `agentId` you
pass in a tool call is a label, not an identity** — it is recorded as `clientAgentId` and never
overrides the connection. Passing one cannot reach another agent's memory.

So:

- Do **not** pass `projectId` or `sessionId` to `cogmem_recall`: the server is already bound,
  and naming a different project is rejected.
- Do **not** pass `agentId` expecting it to change which memory you see. It does not.
- `cogmem_remember_turn` needs only `userText` (and `assistantText` when there is one). The
  identity fields are filled from the connection.

## Tools

pi exposes the server's tools under its MCP prefix — `mcp__cogmem__cogmem_recall`,
`mcp__cogmem__cogmem_remember_turn`, and so on. The `core` profile serves six:

| tool | use it for |
| --- | --- |
| `cogmem_recall` | a direct factual question about the past |
| `cogmem_remember_turn` | recording a finished turn you want kept |
| `cogmem_episode_append` | one message of a conversation, with a stable id |
| `cogmem_explain_recall` | auditing *why* a recall returned what it did |
| `cogmem_graph_explore` | broad inventory, project history, relationships |
| `cogmem_graph_node` | one node's evidence and raw drilldown ids |

If pi's built-in `tool-search` extension is active and the tool surface is large, these may be
**deferred**: search for them first, then invoke through the bridge, because calling a deferred
tool by name directly is rejected. `-builtin:tool-search` in pi's settings loads them directly.

## Recording a conversation

Call `cogmem_remember_turn` after a meaningful exchange, or `cogmem_episode_append` per message
when you want the episode lifecycle to see each one. A turn is only in memory once a tool call
has returned `ok: true` — saying "I'll remember that" is not remembering.

## Wiring

`connect pi --auto` installs this skill and patches `~/.pi/agent/mcp.json`. To do it by hand:

```bash
pi mcp add cogmem -- /absolute/path/to/cogmem mcp --config /path/to/ws/.cogmem/config.toml --project pi-abc12345
pi mcp list
```

The `command` must be absolute, or a name the process pi spawns can resolve. A bare `cogmem`
that pi cannot find is not a degraded entry: pi never starts the server, and the failure is
easy to miss because the entry still looks configured.

pi has **no history importer**. `cogmem-import-openclaw` and `cogmem-import-hermes` do not apply
to pi, and running one would import from a host that is not there.
