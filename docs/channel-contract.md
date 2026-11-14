# Channel contract (v1)

The shell and a channel share one shape, so adding a channel does not change the kernel or the
shell. This document is that shape: message in, surfacing out, presence, and account identity. The
occasion declaration is F8's (`docs/occasion-scope.md`), consumed here as-is.

The code is `src/channel/ChannelContract.ts`, reached as `ChannelContract` and through the kernel's
`occasionScope`. It is held to this document by `__tests__/channel-contract.contract.test.ts`,
which reads the frozen tables below and fails when code and contract disagree. The first
implementation is the shell's local terminal channel (`shell/src/channels/terminal.ts`).
Version: `CHANNEL_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model call.** Ingress validates, resolves an occasion and names a role. Delivery validates a
  strength. Neither asks a model anything.
- **No caller-declared occasion.** A message may carry `declaredOccasion`; it is recorded only so a
  disagreement with the registration is visible. The registration decides, exactly as F8 freezes.
- **No transport.** This face does not read a socket, print a line or call a platform API. A channel
  implementation owns its transport and consumes this shape.
- **No storage.** Registrations and presence are in-process. Nothing is written to a table, column
  or file; a restart re-registers.
- **No delivery policy.** F18 (#195) decides *whether* a candidate is delivered, accumulated or
  suppressed. This face only carries the chosen strength and refuses to emit `silence`.

## Version (frozen)

| Field | Value |
|---|---|
| `contractVersion` | `channel_contract.v1` |
| `numericVersion` | `1` |

The version field is carried by every registration result, ingress result, presence record and
delivery result. Its format is `channel_contract.v<major>`; the contract test pins the format and
the current value.

## The four faces (frozen)

| Face | Means |
|---|---|
| `message-in` | A channel line arrives with an account, text and instant; the occasion is resolved from the binding. |
| `surfacing-out` | The shell asks the channel to carry one candidate at a chosen strength. |
| `presence` | The channel reports reachability, a coarse owner-activity signal and its interruptibility. |
| `identity` | Each channel account is registered as the owner or another person. |

## Registration (frozen)

A host registers once, at connection setup. The returned session is opaque by identity; a caller's
own object is not a session and `ingest`/`deliver` refuse it.

| Field | Means |
|---|---|
| `channelId` | The connection's stable identity, e.g. `terminal`, `telegram:group:-100…`. Non-empty. |
| `occasion` | One of F8's three occasions, declared at registration. |
| `accounts` | The channel accounts this connection carries; exactly one is `owner`. |
| `reachability` | `online` or `offline`; defaults to `online`. |
| `interruptibility` | `high`, `normal` or `low`; defaults to `normal`. |

## Message in (frozen)

`ingest` validates the message and resolves the occasion from the session's registration. An
unknown account is treated as `other` and the identity step says `unknown`, so third-party material
is never assumed to be the owner's.

| Field | Means |
|---|---|
| `contractVersion` | `channel_contract.v1`. |
| `channelId` | The registered channel. |
| `accountId` | The account that sent the message. |
| `role` | `owner` or `other`; an unknown account is `other`. |
| `text` | The message text, non-empty. |
| `at` | The message instant. |
| `occasion` | The resolved occasion. |
| `occasionBinding` | `bound` or `unbound`. |
| `declaredOccasion` | The caller's declaration when one was supplied. |
| `decisionTrace` | The identity and occasion steps. |

## Surfacing out (frozen)

The strength is chosen by F18's delivery router. This face carries it and the channel implementation
decides how to render it. `silence` never leaves the process.

### Strengths (frozen)

| Strength | Means |
|---|---|
| `proactive` | The companion speaks first: a direct message. |
| `incidental` | The companion mentions it in passing during a natural contact. |
| `silence` | Nothing leaves the channel. |

### Surfacing input (frozen)

| Field | Means |
|---|---|
| `candidateId` | The F6 candidate id being surfaced. |
| `strength` | One of the three strengths above. |
| `text` | The candidate's text; optional, and never emitted at `silence`. |
| `reason` | Why the router chose this strength, for the trace. |
| `declaredOccasion` | Recorded only; the registration decides. |

### Delivery result (frozen)

| Field | Means |
|---|---|
| `contractVersion` | `channel_contract.v1`. |
| `channelId` | The registered channel. |
| `candidateId` | The F6 candidate id. |
| `strength` | The requested strength. |
| `outcome` | `delivered` or `silenced`. |
| `occasion` | The resolved occasion. |
| `reason` | The decision trace's reason string. |
| `decisionTrace` | The occasion, presence and strength steps. |

## Presence state (frozen)

Presence is a coarse signal, not a location tracker. The shell updates it when a channel starts,
stops or learns that the owner is active.

### Reachability (frozen)

| Reachability | Means |
|---|---|
| `online` | The channel can carry a message now. |
| `offline` | The channel cannot carry a message now; delivery is silenced. |

### Owner activity (frozen)

| Activity | Means |
|---|---|
| `active` | The owner is present on this channel now. |
| `idle` | The owner has been present recently but is not in a conversation now. |
| `away` | The owner has not been present recently. |

### Interruptibility (frozen)

| Level | Means |
|---|---|
| `high` | The channel may interrupt the owner. |
| `normal` | The channel may speak during a natural contact. |
| `low` | The channel may only be spoken to when the owner is already in conversation. |

### Presence fields (frozen)

| Field | Means |
|---|---|
| `contractVersion` | `channel_contract.v1`. |
| `channelId` | The registered channel. |
| `reachability` | `online` or `offline`. |
| `ownerActivity` | `active`, `idle` or `away`. |
| `interruptibility` | `high`, `normal` or `low`. |
| `updatedAt` | The injected instant of the update. |

## Identity binding (frozen)

The account registry is the only identity source. A message cannot declare itself the owner: an
unknown account resolves to `other`.

| Role | Means |
|---|---|
| `owner` | This account is the owner's. |
| `other` | This account is another person. |

### Account fields (frozen)

| Field | Means |
|---|---|
| `accountId` | The channel's stable account identity. |
| `role` | `owner` or `other`. |

## Decision trace (frozen)

Every ingress and delivery result carries a trace. The reason is exactly
`steps.map(step => \`${step.rule}=${step.outcome}\`).join('; ')`.

| Outcome | Means |
|---|---|
| `bound` | A registered binding resolved; its occasion is applied. |
| `unbound` | No registered binding; `public` is applied. |
| `mismatch` | The caller declared an occasion that differs from the binding; the binding won. |

### Trace fields (frozen)

| Field | Means |
|---|---|
| `version` | `channel_decision.v1`. |
| `reason` | The step-derived string above. |
| `steps` | The rules that ran, in order. |

### Step fields (frozen)

| Field | Means |
|---|---|
| `rule` | `identity`, `occasion`, `presence` or `strength`. |
| `outcome` | That rule's result. |
| `detail` | The values the rule read. |

## Errors (frozen)

| Code | When |
|---|---|
| `invalid_channel_registration` | The channel id, occasion, accounts or presence defaults are invalid. |
| `invalid_channel_message` | The account id or text is empty, the instant is not finite, or a declared occasion is unknown. |
| `invalid_channel_presence` | A presence value or instant is invalid. |
| `invalid_channel_surfacing` | The candidate id or strength is invalid, or a declared occasion is unknown. |
| `channel_session_unbound` | The session was not issued by this registry. |

## API (frozen)

| Method | Does |
|---|---|
| `register` | Issue a session for one channel. Last registration for a channel wins. |
| `ingest` | Validate one inbound message and resolve its occasion and role. |
| `presence` | Store and return the channel's current coarse presence. |
| `deliver` | Validate one surfacing strength and refuse to emit `silence` or an offline channel. |

Adding a method, field or frozen value is additive. Removing or renaming one, or changing an
occasion, strength, role, presence meaning or error meaning, is a breaking change and bumps
`CHANNEL_CONTRACT_VERSION` and the `contractVersion` tag together.

## Change discipline

- **Additive is backward compatible.** A new optional field, a new method, or a new account role
  value may ship without a version bump when old readers can ignore it.
- **Semantics are not additive.** Changing what an existing strength, role, presence value or
  occasion means — or making a previously optional field required — is a breaking change and bumps
  the major version.
- **The tag follows the number.** `contractVersion` is always `channel_contract.v<numericVersion>`;
  the contract test fails if the two disagree.
- **A channel that cannot establish its occasion registers nothing.** F8 then answers `public`, the
  strictest occasion. There is no per-call occasion override.

## First implementation: the shell's local terminal channel

`shell/src/channels/terminal.ts` is the first implementation, and it enters only through this face:

- it registers `terminal` as `private`, with one `owner` account, `online` reachability and `high`
  interruptibility;
- a typed line goes through `ingest` before `shell.submit`, and the ingress trace is appended to the
  shell's trace;
- surfacing goes through `deliver`; `proactive` and `incidental` print, `silence` prints nothing;
- `start` sets presence `online`/`active`, `stop` sets `offline`/`away`;
- it has no OpenMaus dependency. The 5.0 shape is self-owned.

The kernel's own terminal backend uses the same session's binding, so recall and surfacing on that
connection resolve the same occasion the channel registered.

## Second channel walkthrough: a generic IM chat

This is paper only: no code. A generic IM bot has a stable `channelId` (`im:group:<id>`), one owner
account and any number of other accounts, and a transport that receives lines and sends messages.
The same contract carries it:

| Face | Walkthrough | Covered |
|---|---|---|
| `message-in` | The bot registers `im:group:<id>` as `group`; each line carries the sender's account id. `ingest` resolves `group` from the registration and marks an unregistered sender `other`. | yes |
| `surfacing-out` | The router asks for `proactive`, `incidental` or `silence`; the bot sends a direct message, adds an aside to the next reply, or sends nothing. | yes |
| `presence` | The bot reports `online` while connected, `idle` between conversations, and its platform interruptibility (a group is `normal`, a muted channel is `low`). | yes |
| `identity` | The bot's account registry names the owner's account `owner` and every other participant `other`; no message text can change that. | yes |
| `version` | The bot records `channel_contract.v1` on every result and refuses a future major it does not understand. | yes |

All four faces and the version field are covered; the only channel-specific work is the transport
and the registration values. No kernel or shell change is needed.
