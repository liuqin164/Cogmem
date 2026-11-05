# "Automatic" is promised only where the host exposes a hook

The vision says a relevant memory should surface on its own, without the agent searching.
Only a host with a pre-prompt hook can deliver that: the memory has to be in the prompt
before the model answers. Hosts that connect over MCP alone can only *pull* — the model
has to decide to call recall. We decided not to blur the two:
"emergent / automatic" is reserved for hook-capable hosts, and MCP-only hosts are
documented as an explicit-recall contract, carried by the server `instructions` string and
the tool descriptions rather than by marketing language.

**This ADR originally named OpenClaw as the only hook-capable host. That was wrong.**
Hooks are a property of the host, not of Cogmem's willingness to use them, and
`docs/host-plugin-record-hooks.md` records pre-prompt hooks in three more, from vendor
sources: Hermes fires `pre_llm_call` before the model is called, pi fires
`before_agent_start` before an agent run, and Claude Code exposes `UserPromptSubmit`.
DSH contributes a prompt section. So the line falls between *hosts that have a hook* and
*hosts reachable only over MCP* (Cursor, Codex, and any host attached with `mcp add`),
not between OpenClaw and everyone else.

The claim a reader is entitled to is narrower than "this host has a hook": it is that
**Cogmem injects on that host today**. Having a hook makes the push path possible; only a
shipped, verified adapter makes it true. That distinction is what the per-host
documentation must carry — "has a hook, adapter not written yet" and "adapter shipped" are
different sentences, and neither may be rounded up to "automatic".

## Consequences

- Documentation must state the mode per host. A Cursor user must not expect OpenClaw's
  behaviour, and a support answer that conflates them is a bug in the docs.
- **State capability and delivery separately, per host.** Which hook the host exposes, and
  whether a Cogmem adapter using it actually ships. An unverified adapter (Claude Code's)
  is labelled unverified wherever it is described; see ADR-0004.
- The MCP `instructions` string stays load-bearing product surface: it is the channel that
  tells a model on a hookless path when to recall first.
- Two different quality signals: hosts with a working adapter are judged on whether the
  injected block is used, hookless hosts on whether recall is called at all.
