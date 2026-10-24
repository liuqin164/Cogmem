# An agent's identity comes from its credential, and a request may only narrow it

4.0 lets several plugin agents share one resident Cogmem process. That only works
if the process can tell them apart, and until now it could not: `hostId` was a
field in the `x-cogmem-identity` header, so any client that could reach the
loopback port could call itself any agent and read that agent's project. The
`--token` that existed was a single shared secret — it proved the caller was
allowed to *use* the server, not which agent it was. This records how an agent is
registered, where its credential lives, and what a request may do with it.

## The decision

**A credential names the agent.** Each agent is registered with a bearer
credential; the transport presents it, and the server derives `hostId`, the
`projectId` the agent is confined to, and the agent's tool-profile ceiling from
the registration. Nothing in the request establishes an identity.

**A request may narrow, never widen or replace.** Concretely, against a
registered connection:

| Field in the header | What happens |
| --- | --- |
| `hostId` | Must equal the authenticated `hostId`. A different one is rejected with `host_identity_mismatch`; a header may never introduce one where a credential established none. |
| `projectId` | Must equal the bound project. A different one is rejected with `project_scope_violation`. |
| `profile` | May narrow. A wider profile is refused down to the registered ceiling rather than granted. |

Disagreement is rejected rather than silently ignored, because a caller asking to
be someone else is either misconfigured or hostile, and both should hear about it.
The exception is deliberate: with no credential at all there is no identity to
change, so a claimed `hostId` on an unauthenticated loopback connection is
ignored and the call runs as the server — which is what keeps the documented
per-session header working for the two fields that do narrow (`projectId`,
`profile`) without a credential.

**Registration lives in `~/.cogmem/agents.json`,** next to `config.toml` and not
inside it:

```json
{
  "agents": [
    { "hostId": "bot-a", "token": "<secret>", "projectId": "project-a", "profile": "admin" },
    { "hostId": "bot-b", "token": "<secret>", "projectId": "project-b" }
  ]
}
```

Three reasons it is a separate JSON file rather than a TOML section:

- It is **credentials**, not configuration. Applying a different file mode and a
  different review path to secrets is easier when they are not interleaved with
  the settings a user is expected to edit.
- The config loader is a small hand-written TOML reader. An array of tables is
  the one TOML shape it does not parse, and extending a parser to hold secrets is
  not a trade worth making for a first registration format.
- A missing file is meaningful and must stay distinguishable from an empty one:
  absent means "one agent, no registry" and is not an error, while a file that
  exists and cannot be understood **is** an error. Ignoring a malformed registry
  would serve every agent as anonymous while the operator believed they were
  registered — the exact failure the file exists to prevent.

**Credentials are compared by digest.** The presented value is hashed and the
digest looked up, so no comparison walks the secret byte by byte and a failed
lookup cannot be timed to reveal a prefix. Registration refuses a duplicate
`hostId` or a duplicate credential: an agent that cannot be told apart from
another is not registered, it is a shared secret.

**`--agents <path>` overrides the location**, and `cogmem mcp --transport http`
loads `~/.cogmem/agents.json` when it exists.

## How `init` generates credentials

Registration is a mode of `init`, not part of its configuration flow:
`--register-agent` writes the registry and returns without touching
`config.toml`. That is forced by the order things happen in — the second agent on
a machine is onboarded long after the config exists, and `init` refuses to
overwrite an existing config — so folding registration into configuration would
mean hand-editing a file to add an agent.

The shape, all of it implemented:

- **`cogmem init --register-agent <hostId>`**, repeatable, generates a credential
  for that agent and writes or updates its entry. The credential is 32 bytes from
  a CSPRNG, hex-encoded, and is printed **once**, at creation, because the stored
  form is not reversible and a credential that can be read back later is a
  credential that leaks out of backups.
- **Defaults follow the existing convention:** `projectId` is the `hostId` unless
  `--project` says otherwise, matching the way one agent has meant one project
  everywhere else in the product; the profile ceiling is the profile the server
  was launched with, because registering an agent should not silently grant more
  than the operator already gave the server.
- **Re-running for an existing `hostId` refuses to overwrite** unless `--rotate`
  is passed. Silently replacing a credential breaks the host already using it, and
  that failure would surface as an authentication error in someone else's logs.
- **`init --yes` does the same unattended**, with those defaults, and reports the
  registered agents as steps the way it reports every other unattended decision.
- **The one-line installer still installs and stops** (ADR-0003) and registers
  nothing. Registration is configuration, and that installer does not write
  configuration.

## Alternatives rejected

- **Keep the single global `--token` and let the header name the agent.** This is
  the status quo: one credential shared by every agent, which answers "may you
  use the server" and not "which agent are you". Two agents with the same secret
  cannot be isolated from each other by any amount of header checking.
- **Trust the credential to *widen* the profile, as the global token did.** A
  registration is a statement about one agent's ceiling. Letting its own header
  exceed that ceiling would make the registration advisory, and the ceiling is
  how an operator confines a bot to `core` on purpose.
- **Put credentials in `config.toml`.** See above; the parser and the audience
  for the file are both wrong for secrets.
- **Reject a `hostId` claim on an unauthenticated connection.** Stricter, but it
  breaks the documented per-session header for hosts that set all three fields
  and rely only on `projectId`/`profile` narrowing. Ignoring the claim keeps
  those working and still denies the identity.

## Consequences

- **The bridge path uses the same resolver.** `cogmem-host-bridge` takes
  `--token` (or `COGMEM_AGENT_TOKEN`) and resolves it through this same
  `AgentRegistry`; `--host` and `--project` may only agree with the registration.
  Without a registry nothing changes, so a single-agent install and its generated
  plugin are untouched. **What is still not converted is the in-process OpenClaw
  plugin**, which pins its identity from install-time configuration rather than a
  credential. That is a different question and left open: the plugin opens the
  kernel itself, so there is no transport to authenticate, and the answer there is
  about what a host may write into its own pinned scope rather than about who it
  claims to be.
- **`init` does not generate credentials yet.** The registration file is
  currently written by hand or by an operator; the issue asks for `init` and the
  installer to produce one entry per agent. That is the next piece, and it must
  keep the single-agent flows (`init`, `init --yes`, the one-line installer,
  npm-global) working unchanged.
- **`hostId` now has a source but still no capability to spend.** It reaches the
  runtime as before; what changed is that it cannot be forged. The tests that
  demonstrate isolation therefore assert on *memory scope* (`project_scope_violation`
  and an empty recall) rather than on a hostId appearing in a response.
- **stdio is unchanged.** One process per client means the process is the agent,
  and `--host` is a label the operator chooses when they start it. A registry for
  stdio would add a file to read without adding an isolation property, because
  the client cannot choose the process it is speaking to.
