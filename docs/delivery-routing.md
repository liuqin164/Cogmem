# Delivery routing contract (v1)

F6 produces candidates; F12 carries them. This face is the last mile between the two: it decides
whether a candidate is delivered now, accumulated for the next natural contact or the morning
summary, or suppressed. The decision is deterministic, reads only signals that already exist, and
carries a trace a reader can use to answer "why did this not arrive at 2 a.m.?".

The code is `src/delivery/DeliveryRouting.ts`, reached as `MemoryKernel.deliveryRouter` and through
`KernelAgentMemoryBackend.deliveryRoute` / `.deliveryRouteBatch`. It is held to this document by
`__tests__/delivery-routing.contract.test.ts`, which reads the frozen tables below and fails when
code and contract disagree. Version: `DELIVERY_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model call.** Urgency, sensitivity, occasion, user state, channel and feedback are table
  lookups and comparisons. A model may have produced the candidate offline; nothing here asks one
  whether to send it.
- **No new source.** The candidate comes from F6, the occasion from F8, the user state from F2, the
  channel from F12 and the level from F7. This face adds no signal and no table.
- **No storage or queue.** A decision is a return value. The shell holds an accumulated candidate
  in its own state; the batch result names the set a morning summary would contain.
- **No transport.** The shell passes the decision's strength to F12's `deliver`; this face never
  prints, sends or opens a channel.
- **No caller-declared occasion.** The backend resolves the occasion from the connection's F8
  binding. The kernel-level router takes an occasion because its caller already resolved one.

## Version (frozen)

| Field | Value |
|---|---|
| `contractVersion` | `1` |
| `decisionVersion` | `delivery_route_decision.v1` |

## Inputs (frozen)

| Input | Source |
|---|---|
| `candidate.urgency` | Derived from F6's `source`, `freshness` and `confidence` by the table below. |
| `candidate.sensitivity` | F6's `daily`, `private` or `high` tier. |
| `occasion` | F8's resolved occasion: `private`, `group` or `public`. |
| `userState` | F2's state at the decision instant: `in-conversation`, `idle` or `night-dnd`. |
| `channel.reachability` | F12's `online` or `offline`. |
| `channel.interruptibility` | F12's `high`, `normal` or `low`. |
| `feedback.level` | F7's level for the candidate's source type. |
| `feedback.stopped` | F7's stop for the candidate's source type. |

## Urgency (frozen)

Urgency is not a new judgement: it is read off F6's source, freshness and confidence.

| Urgency | Condition |
|---|---|
| `high` | Source is `wake-intention`, `prospective-memory` or `commitment`, and the item is due or arrived (`ageMs >= 0`, not expired). |
| `normal` | Source is one of those three but the item is upcoming or expired, or `confidence >= 0.85`. |
| `low` | Everything else. |

## User states (frozen)

| State | Means |
|---|---|
| `in-conversation` | The owner is in an active conversation on the channel now. |
| `idle` | The channel is reachable but no conversation is active. |
| `night-dnd` | The owner's night do-not-disturb window is open. |

## Decisions (frozen)

| Decision | Means |
|---|---|
| `deliver` | Hand the candidate to F12 now at the chosen strength. |
| `accumulate` | Hold the candidate for a later natural contact or the morning summary. |
| `suppress` | Do not deliver and do not accumulate. The trace says why. |

## Destinations (frozen)

| Destination | Means |
|---|---|
| `current-channel` | The active F12 channel. |
| `next-contact` | The next natural contact on the channel. |
| `morning-summary` | The next morning summary. |
| `none` | Nothing is held. |

## Strength mapping (frozen)

| Decision | Destination | Strength |
|---|---|---|
| `deliver` | `current-channel` | `proactive` for urgent, `incidental` for a natural contact. |
| `accumulate` | `next-contact` or `morning-summary` | `incidental` when it is finally mentioned. |
| `suppress` | `none` | `silence`. |

## Rules (frozen)

Precedence is top to bottom. The first matching rule decides; later rules do not run.

| Order | Condition | Decision | Destination | Reason |
|---|---|---|---|---|
| `1` | F7 stopped the type. | `suppress` | `none` | `feedback_stopped` |
| `2` | Tier is `high` and the occasion is not `private`. | `suppress` | `none` | `high_sensitivity_shared_surface` |
| `3` | The channel is `offline`. | `accumulate` | `next-contact` | `channel_offline` |
| `4` | `night-dnd` and effective urgency is not `high`. | `accumulate` | `morning-summary` | `night_quiet` |
| `5` | `in-conversation`, effective urgency `high`, interruptibility not `low`. | `deliver` | `current-channel` | `urgent_in_conversation` |
| `6` | `in-conversation`, effective urgency `normal`, interruptibility not `low`. | `deliver` | `current-channel` | `natural_contact` |
| `7` | `in-conversation`, effective urgency `high`, interruptibility `low`. | `accumulate` | `next-contact` | `channel_not_interruptible` |
| `8` | `in-conversation`, effective urgency `low`. | `accumulate` | `next-contact` | `not_urgent` |
| `9` | `idle`, effective urgency `high`. | `accumulate` | `next-contact` | `idle_no_active_channel` |
| `10` | `idle`, effective urgency not `high`. | `accumulate` | `next-contact` | `not_urgent` |
| `11` | `night-dnd`, effective urgency `high`, interruptibility not `low`. | `deliver` | `current-channel` | `night_highest_urgency` |
| `12` | `night-dnd`, effective urgency `high`, interruptibility `low`. | `accumulate` | `morning-summary` | `channel_not_interruptible` |

Two consequences are the ticket's discriminator:

- the same candidate routes differently by user state: `in-conversation` can deliver, `idle`
  accumulates unless the channel is highly interruptible, and `night-dnd` accumulates every
  non-highest urgency to the morning summary;
- a `high` candidate never reaches a `group` or `public` surface, because rule 2 runs before every
  delivery rule.

## Feedback downgrade (frozen)

F7's level lowers the derived urgency before the rules run. A stopped type is suppressed by rule 1.

| Level | `high` becomes | `normal` becomes | `low` becomes |
|---|---|---|---|
| `0` | `high` | `normal` | `low` |
| `1` | `normal` | `low` | `low` |
| `2` | `low` | `low` | `low` |
| `3` | `low` | `low` | `low` |

## Morning summary

`routeBatch` returns `morningSummary`: the ids whose destination is `morning-summary`. It also
returns `accumulated` (every accumulate decision) and `nextContact` (the subset held for the next
natural contact). The three lists are derived from the same decisions, so a reader can compare the
summary with the accumulated set item by item.

## Decision trace (frozen)

Every decision carries the complete trace. The reason is exactly
`steps.map(step => \`${step.rule}=${step.outcome}\`).join('; ')`.

| Field | Means |
|---|---|
| `version` | `delivery_route_decision.v1`. |
| `reason` | The step-derived string above. |
| `steps` | The rules that ran, in order. |

### Step fields (frozen)

| Field | Means |
|---|---|
| `rule` | `sensitivity`, `feedback`, `reachability`, `user_state` or `route`. |
| `outcome` | That rule's result. |
| `detail` | The values the rule read, including the route reason code. |

### Decision fields (frozen)

| Field | Means |
|---|---|
| `candidateId` | The F6 candidate id. |
| `decision` | `deliver`, `accumulate` or `suppress`. |
| `destination` | `current-channel`, `next-contact`, `morning-summary` or `none`. |
| `strength` | F12's `proactive`, `incidental` or `silence`. |
| `urgency` | The derived urgency before F7's downgrade. |
| `effectiveUrgency` | The urgency after F7's downgrade. |
| `reason` | The decision trace's reason string. |
| `reasonCode` | The frozen reason code. |
| `decisionTrace` | The complete decision. |

### Batch result fields (frozen)

| Field | Means |
|---|---|
| `decisions` | One decision per candidate, in input order. |
| `accumulated` | The ids with decision `accumulate`. |
| `nextContact` | The ids with destination `next-contact`. |
| `morningSummary` | The ids with destination `morning-summary`. |

## Errors (frozen)

| Code | When |
|---|---|
| `invalid_delivery_candidate` | The candidate id is empty, or its source, tier, freshness or confidence is invalid. |
| `invalid_delivery_user_state` | `userState` is not one of the frozen three. |
| `invalid_delivery_occasion` | The occasion is not one of F8's three. |
| `invalid_delivery_channel` | Reachability or interruptibility is not a frozen F12 value. |
| `invalid_delivery_feedback` | The level is not a non-negative integer, or `stopped` is not boolean. |
| `invalid_delivery_now` | `now` is not finite. |

## API (frozen)

| Method | Does |
|---|---|
| `route` | One candidate at one instant, with F7's state read from the kernel face. |
| `routeBatch` | Many candidates at one instant, plus the accumulated, next-contact and morning-summary sets. |

Adding a method, field or reason is additive. Removing or renaming one, or changing a rule, a
precedence order, a destination or an error meaning, is a breaking change and bumps
`DELIVERY_CONTRACT_VERSION`.

## What this round wires

The kernel exposes `deliveryRouter`; `KernelAgentMemoryBackend.deliveryRoute` resolves the
connection's F8 occasion and calls it, and `deliveryRouteBatch` returns the morning-summary sets.
The shell consumes the decision's `strength` through F12's `deliver`. No queue is persisted: the
shell's existing runtime state is the holder, and a restart recomputes from the same signals.
