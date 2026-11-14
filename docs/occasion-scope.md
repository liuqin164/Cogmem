# Occasion scope contract (v1)

The same companion speaks in a private conversation, a group chat and a public place. What it may
recall and surface is not the same in each. This face is the deterministic boundary: a connection's
occasion is declared by the channel contract at registration, and every recall and surfacing query
resolves it from that registration — never from the call.

The code is `src/occasion/OccasionScope.ts`, reached as `MemoryKernel.occasionScope` and through
`KernelAgentMemoryBackend`'s constructor binding. It is held to this document by
`__tests__/occasion-scope.contract.test.ts`, which reads the frozen tables below and fails when code
and contract disagree. Version: `OCCASION_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model call.** The visibility rule is a table lookup. A model may grade material offline;
  nothing here asks one whether a sentence is safe to say.
- **No channel transport.** This face does not receive messages, send replies or know what a
  Telegram group is. F12 (#166) owns the channel contract; this document freezes only the one shape
  F12 consumes.
- **No account identity binding.** F12's channel contract also binds a channel account to the owner
  or another person. This round reads the ledger's existing `other` speaker marker for third-party
  material; it does not add a second identity registry.
- **No new storage.** A binding is an in-process registration. Nothing is written to a table, a
  column or a file, and a restart re-registers.
- **No caller self-report.** The `occasion?` field F6 accepted on the surfacing input is recorded
  only so a disagreement with the binding is visible. It never decides. Recall has no occasion
  parameter at all.

## Occasions (frozen)

Least to most restrictive. The order is the contract, not an implementation detail.

| Occasion | Means |
|---|---|
| `private` | A conversation with the owner alone. |
| `group` | A shared but bounded conversation: the owner and at least one other person. |
| `public` | An unbounded audience; the owner has not established who is listening. |

`public` is also the default. A connection with no registered binding answers as `public`.

## The minimal channel contract (frozen for F12)

F12 will define the full channel contract — message in, surfacing out, presence, account identity.
The one shape this round freezes is the occasion declaration and its binding point. F12 consumes the
same shape; it does not replace it.

### Binding fields (frozen)

| Field | Means |
|---|---|
| `channelId` | The connection's stable channel identity, e.g. `terminal`, `telegram:group:-100…`. Non-empty. |
| `occasion` | One of the three occasions above. |

### Binding point (frozen)

The host registers once, at connection or backend construction:

```ts
const binding = kernel.occasionScope.register({ channelId: 'telegram:group:-100…', occasion: 'group' });
const memory = new KernelAgentMemoryBackend(kernel, { binding });
```

The returned `binding` is opaque by identity: the registry tracks the object it issued. A caller
that constructs its own `{ channelId, occasion }` object — even one naming a registered channel — is
unbound and resolves to `public`. Re-registering a channel replaces its binding; an older object for
that channel resolves to the current registration, so a revoked private binding does not keep its
old power.

### Default (frozen)

No binding, or a binding the registry did not issue, means `public`. It never means `private`.

## Material kinds (frozen)

| Kind | Means |
|---|---|
| `personal` | The owner's own material, or material no ref attributes to another speaker. |
| `third-party` | At least one source ref is another person's turn: the ledger's `role: 'other'` or `metadata.speaker: 'other'` (F7's conversation capture). |
| `project-public` | Every source ref is imported material (`metadata.imported === true`), the #143 public-material marker. |

A candidate with no refs is `personal`: absence is not a declaration of publicness. A candidate that
mixes an imported ref with a private or third-party ref is not `project-public`; the stricter kind
wins. The #143 route-1 leniency for a row that names no owner is **not** extended here: an unowned
row is agent-public, not occasion-public.

## Visibility (frozen)

`occasionVisibility(occasion, tier, material)` is the whole rule. `tier` is F6's sensitivity tier.

| Occasion | personal `daily` | personal `private` | personal `high` | third-party `daily` | third-party `private` | third-party `high` | `project-public` |
|---|---|---|---|---|---|---|---|
| `private` | allowed | allowed | allowed | allowed | allowed | allowed | allowed |
| `group` | allowed | withheld | withheld | allowed | withheld | withheld | allowed |
| `public` | allowed | withheld | withheld | withheld | withheld | withheld | allowed |

Two readings make the table what it is:

- **Group is shared but bounded.** A third party's daily remark is part of the conversation, so it
  may be recalled; a third party's private or high material is withheld. That is the ticket's
  "other people's information goes to the strictest tier": the tier is what withholds it.
- **Public is unbounded.** It shows the owner's daily material and project-public material, and no
  third-party material at all. This is the one place public is stricter than group, and it is what
  makes the three sets strictly decrease on a corpus that contains a daily third-party item.

Where the ticket's "a group withholds other people's information" and its "the three sets strictly
decrease" clauses pull apart, this table is the resolution: a third party's **daily** remark stays
recallable in a group (so group is strictly wider than public), while a third party's **private or
high** material is withheld. The strictest reading of the first clause would make group equal to
public and leave no strict decrease to test.

### Withhold reasons (frozen)

| Reason | When |
|---|---|
| `occasion_private_tier` | `private` or `high` material outside `private`. |
| `occasion_third_party` | Third-party material in `public`. |

## Recall

`KernelAgentMemoryBackend.recall()` applies the rule at its single exit, after the social, secret,
agent-scope and phase admissions. Every lane returns through there, so no lane can opt out.

The returned `decisionTrace` carries:

- `occasion`: the resolved occasion;
- `occasionBinding`: `bound` or `unbound`;
- `suppressed`: one entry per reason, with a count, exactly like the other admissions.

When every item was withheld by occasion, `zeroExplanation.kind` is `occasion_filtered` with the
count. A filtered answer is therefore not indistinguishable from a memory that was never there.

## Surfacing

`KernelAgentMemoryBackend.surfacingCandidates()` passes its connection binding to F6's candidate
query. The query resolves the occasion before it grades any candidate and applies
`occasionVisibility` beside the channel policy. A candidate is returned only when the channel policy
and the occasion rule both allow it.

The `occasion` field on a candidate, a withheld entry and the result is the **resolved** occasion,
not the caller's declaration. F6's declared `occasion?` is absorbed: it is recorded in the trace and
never decides.

### Decision trace (frozen)

The `occasion` step always follows `channel` and precedes `modulation`.

| Outcome | Means |
|---|---|
| `bound` | A registered binding resolved; its occasion is the one applied. |
| `unbound` | No registered binding; `public` was applied. |
| `mismatch` | The caller declared an occasion that differs from the binding; the binding won. |

The step's detail carries `occasion`, `channelId` when bound, `declared` when the caller declared
one, `mismatch`, `material`, `decision` (`allowed` or `withheld`) and the withhold `reason` when one
applied.

## Errors (frozen)

| Code | When |
|---|---|
| `invalid_channel_binding` | `register` gets an empty `channelId` or an occasion outside the frozen three. |

## API (frozen)

| Method | Does |
|---|---|
| `register` | Issue a binding for one channel. Last registration for a channel wins. |
| `resolve` | Resolve an issued binding to its current occasion, or `public` when unbound. |

Adding a method is additive. Removing or renaming one, or changing an occasion, a material kind, a
visibility cell, a trace outcome or an error meaning, is a breaking change and bumps
`OCCASION_CONTRACT_VERSION`.

## F12 hand-off

F12's channel contract v1 consumes this shape as-is:

- the channel's connection identity is its `channelId`;
- the channel declares one of the three occasions at registration;
- the host registers the binding once and constructs the backend with it;
- a channel that cannot establish its occasion registers nothing and is `public`.

F12 may add message, surfacing-out, presence and account-identity shapes around it. It must not add
a per-call occasion parameter, and it must not let a shell declare its own occasion on a call.
