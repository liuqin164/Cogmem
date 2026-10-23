# "Automatic" is promised only where the host exposes a hook

The vision says a relevant memory should surface on its own, without the agent searching.
Only a host with a pre-prompt hook can deliver that: the memory has to be in the prompt
before the model answers. Hosts that connect over MCP alone (Cursor, Codex, Claude Code)
can only *pull* — the model has to decide to call recall. We decided not to blur the two:
"emergent / automatic" is reserved for hook-capable hosts, and MCP-only hosts are
documented as an explicit-recall contract, carried by the server `instructions` string and
the tool descriptions rather than by marketing language.

## Consequences

- Documentation must state the mode per host. A Cursor user must not expect OpenClaw's
  behaviour, and a support answer that conflates them is a bug in the docs.
- The MCP `instructions` string becomes load-bearing product surface: it is the only place
  that tells a hookless model when to recall first.
- Two different quality signals: push hosts are judged on whether the injected block is
  used, pull hosts on whether recall is called at all.
