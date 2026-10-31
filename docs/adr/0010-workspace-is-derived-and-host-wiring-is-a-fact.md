# The Workspace is the directory containing `.cogmem`, and a Host integration is a fact on disk

## The decision

**A Workspace is the directory that contains `.cogmem/`.** It is derived, not declared: every command
finds it by walking up for `.cogmem/config.toml`, so it is the same answer for `init`, `doctor`,
`connect`, `import` and `update`. `integrations.<host>.workspace_dir` remains only for a host whose
own workspace is genuinely elsewhere — Hermes' `~/.hermes` — and is then resolved **relative to the
Workspace**, never to the config directory.

**A Host integration is a fact about files on disk.** `connect <host> --auto` is what makes it true:
it may record that it wired a host, and the Install gate decides from the installed artifacts rather
than from a preference. A host that has been wired does not read back as unwired, and `update` does
not decline to maintain files that `connect` wrote.

**`nextSteps` are outstanding work, not advice.** They list only steps that are not yet satisfied, so
an Agent following them converges. A step that is optional but recommended belongs in a diagnostic.

**A Host integration's project scope is derived from its Workspace.** One Workspace is one private
memory scope, so an OpenClaw or Hermes integration is confined to a project named after the Workspace,
and every command that names that project — the steps `connect` prints, the README — names the same
one. Two Workspaces on one machine stay two scopes.

**A registration belongs to the place that can find it, and an unfindable registry fails closed.** A
registry written under a Workspace is read from that Workspace; a reader that finds no registry must
serve the connection as unauthenticated and confined, never as an anonymous client with free rein.
Losing a registry is a misconfiguration, and ADR-0006 exists so that a misconfiguration cannot read
another agent's memory.

## Why

Three defects reached a 1,683-test suite by surviving on one path it never walked — the documented
`install → init → doctor → connect → import` journey. All three were the same mistake: a fact that
two commands computed independently, and nobody had said which one was canonical.

- The OpenClaw plugin id is `cogmem-auto-memory-<sha256(workspaceRoot)>`. `connect` hashed `<ws>`;
  `doctor` hashed `<ws>/.cogmem`, because `init` wrote `workspace_dir = "."` and the config layer
  resolves that relative to the config directory. **`doctor` could never see the plugin `connect` had
  just installed**, so it could not report it installed, could not report it stale, and the
  `doctor --fix --plugin-only` repair it names was unreachable.
- `integrations.openclaw.enabled` is read by `update` to decide whether to refresh the plugin. A host
  wired by `connect` alone left it `false`, so **`update` silently refused to maintain what `connect`
  had written** — while `init`'s own warning text said `connect` "does not change this switch".
- The gate recommended `connect` unconditionally, so it never converged, and `connect` printed
  `./node_modules/.bin/cogmem` — a path that does not exist on the one-line-installer path, the one
  the README documents.

**An audit of the journeys that walk found six more, and they are the same family, not the same three
bugs.** Twelve sites derive a workspace root and they disagree; a host's project scope is derived from
that root in one place and named literally in another; a registry is written where its readers do not
look. Two of the six break the promise the journey exists to keep:

- **The memory a user imports is invisible to the agent.** `connect` writes the plugin a project named
  after the Workspace, then prints an import step naming the literal `openclaw`. The import succeeds,
  and automatic recall through the installed plugin returns nothing. The user is told their memory is
  in, and their agent never sees it.
- **`update` writes a second Host integration rather than refreshing the first**, because it passes
  the config directory as the OpenClaw workspace. Two plugin entries, two load paths, two memory
  scopes: double injection, and a history split in half.
- **A registered agent can be served as an unregistered one.** `init --scope project --register-agent`
  writes the registry under the Workspace; the MCP and bridge readers look only beside the home
  directory. The connection is then treated as unauthenticated instead of being refused — the failure
  direction ADR-0006 was written to close.

## Considered options

- **Keep `workspace_dir = "."` and resolve it relative to the config's parent.** The minimum edit, and
  it fixes today's arithmetic — but it leaves `"."` meaning "here", which is the ambiguity that
  produced the bug. Deriving the Workspace removes the field from the answer entirely.
- **Write an absolute workspace path at init time.** Unambiguous, but the config is meant to travel
  with its Workspace (ADR-0003); an absolute path from one machine is wrong on the next.
- **Let `init --agent` stay the only writer of `enabled`, and have the gate ignore it.** The switch is
  a Human-required setting, so this is defensible — but it leaves `update` refusing to maintain a host
  that is wired, which is a worse failure than the one it avoids. Recording the fact where the fact is
  established is the smaller lie.
- **Treat `nextSteps` as advice and carry doneness in the gate's summary alone.** Then an Agent that
  follows the steps loops forever, which is exactly what the gate exists to prevent.
- **Drop the Workspace-derived project name and use the literal `openclaw` everywhere.** Simpler, and
  it makes today's printed import step correct without touching it — but it merges every OpenClaw
  Workspace on the machine into one memory scope, which is the sharing ADR-0005 and ADR-0009 both
  refuse. The name is derived because the scope is private, not because it is convenient.
- **Make every registration global.** Fewer readers to teach, but it makes registration a property of
  the machine while everything else — config, database, plugins — is a property of the Workspace, and
  it leaves two Workspaces unable to register an agent of the same name.
- **Keep the current fail-open behaviour when a registry is not found.** Ruled out on ADR-0006's terms:
  a reader that cannot find the registry has not established that the caller may act, and answering as
  though it had is the exact confusion that ADR removed.

## Consequences

- Workspace is a glossary term; `workspaceDir` leaves the command output, and the four commands
  compute one answer.
- `init` no longer writes `workspace_dir` for project scope, so an existing config keeps working and
  its `"."` value is simply no longer load-bearing.
- `connect` writes `integrations.<host>.enabled = true` for the host it wired. This does not re-tier
  the switch: ADR-0003 tiers the integration switches Human-required, and they stay that way — an
  unattended `init --yes` still enables no host. What changes is *which* human step records it.
  `connect`'s step is `actor: operator`, `safeForAutomation: false`, so an operator running it is the
  decision; and the Agent path still stops at the gate. The sentence in `init`'s warning text that
  says `connect` "does not change this switch" is the thing superseded, not the ADR.
- The term **Host integration** enters the glossary, because "the switch is off" and "the host is
  wired" were being read as the same statement and they are not.
- Four commands must share one CLI-invocation resolver rather than each answering "how do I invoke
  `cogmem`" separately, and a printed step carries the arguments the command was just given rather
  than a `.` of its own.
- **The project a Host integration writes to is the one its own printed steps import into.** Until
  this holds, an import reports success and the agent recalls nothing — so a journey check that only
  asserts "the import exited 0" would pass over it. It asserts recall.
- **A registry that cannot be found fails closed**, and the readers look in the Workspace before the
  home directory. This is the one consequence here that is a security property rather than a
  consistency one.
- The journey gets one end-to-end check through the CLI process boundary — the seam #39's slices
  already use. It asserts the gate's level and its **exact** diagnostic set, not the exit code alone:
  every defect above exits 0.
- Because the audit found six more defects by walking one journey once, the check is part of this
  work rather than a follow-up. A suite of 1,683 tests is not evidence that a journey works; walking
  it is.

