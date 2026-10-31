# Two install paths, one flow, settings tiered by who may decide

Cogmem is installed either by a person following a guided wizard or by an agent
running unattended, and both must end on the same contract. We settled on exactly
two **Install paths** — Operator and Agent — that differ only in *who answers the
setup questions*, not in what gets installed or how success is judged: the installer
installs, `cogmem init` configures, `cogmem doctor` gates, and every step names one
**Install actor** (agent, operator, or host). Every setup setting is tiered
**Agent-decidable**, **Human-required**, or **Settle-later**; a Human-required
setting met without a human falls back to a conservative default and is reported as
a WARN, rather than failing the install or inventing a decision on the user's behalf.

## Setting tiers

| Setting | Tier |
| --- | --- |
| Database path, vector backend | Agent-decidable |
| PII redaction (email, phone, SSN) | Agent-decidable, all on by default |
| Model names, vector dimension | Settle-later |
| Embedding / memory / reasoning provider | Human-required |
| Any API key | Human-required |
| AES encryption passphrase | Human-required |
| OpenClaw / Hermes integration switches | Human-required |

## Considered Options

- **The five install paths the README used to list** (npm local, `bun add`,
  npm+bun, `npm -g`, curl installer). Rejected: a reader cannot tell which is
  theirs, and an agent picks the cheapest rather than the correct one. Four of them
  are legitimate answers to "I already have a JS project", not to "install cogmem",
  so they were demoted to an appendix rather than deleted.
- **A separate agent installer.** Rejected: two scripts drift, and the real
  difference between the paths is settings, not steps.
- **`--yes` meaning "accept every default", including provider and passphrase.**
  Rejected: that makes an unattended run spend money and invent a passphrase whose
  loss destroys the database.

## Consequences

- The installer stops invoking the wizard. `curl | bash` installs and links; the
  wizard is an explicit next step. This removes the silent no-tty degradation where
  the installer ran `cogmem init --yes` on the user's behalf, which contradicted
  `connect`'s own `interactive_init` step (`actor: operator`,
  `safeForAutomation: false`).
- Host detection (`~/.hermes`, OpenClaw workspace markers) is advisory: printed as a
  suggestion, never written into the config unless the operator confirms it or the
  agent passes `--agent <host>` explicitly. Machine-global state must not decide what
  a project's config contains.
- `cogmem doctor` becomes the **Install gate** for install, update, and post-connect,
  with four outcomes: not installed, OK, WARN, FAIL. "No config yet" is *not
  installed* — exit 0 with the next command — where it used to be FAIL with exit 1,
  which mislabelled the most common post-install state as a broken one.
- `rule_only` is a WARN, never a FAIL. It is a legitimate end state, just not a good one.
- A CLI directory outside `PATH` is a WARN that prints the exact `export` line for an
  operator, or the absolute `binDir` for an agent. It is never a silent success.
- Both paths emit one structured shape — `installGate` plus `nextSteps` reusing
  `connect`'s `{id, actor, safeForAutomation, command, when, purpose}` — so the
  human-facing text and the agent-facing JSON are a single flow rendered twice.
- One install serves many workspaces: the package lives in one place while config
  resolves per workspace (walk up for `.cogmem/config.toml`, fall back to
  `~/.cogmem/config.toml`). The Operator path defaults to global scope, the Agent
  path to project scope.

## Amendment: what "the flag was passed explicitly" means

An audit of the install-path slices could not settle one sentence from the code:
"never enables a host in the written config unless the agent passes `--agent <host>`
explicitly". `--agent auto` passes a value, not a host name, and it was worth asking
whether that counts.

**It does.** `--agent auto` is an explicit request for detection to decide, and it is
only reachable by typing it: the unattended default is `none`, so an agent-installed
config contains no host nobody asked for. The interactive wizard is the third case and
asks a human (step 6, "Enable OpenClaw batch source integration?"), so in all three
paths the decision is either the flag or a person — machine-global state never decides
on its own.

`__tests__/init-agent-flag.unit.test.ts` pins the three: a detected workspace with no
flag writes `enabled = false`, the same workspace with `--agent auto` writes `true`, and
`--agent none` writes `false`. The flag parser also carried an `agentExplicit` field
that nothing read; it was removed rather than kept as a hint that some behaviour
depended on it.

