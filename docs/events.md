# Kernel event stream contract (v1)

The kernel's memory event stream is how the resident shell wakes up instead of polling for new
memory. It is an in-process subscription face on the host API (`KernelAgentMemoryBackend.subscribe`,
backed by `MemoryKernel.events`), plus one read-only HTTP face that serves the same stream over SSE
from the observatory process.

This document is the contract. The code is `src/events/`; the two are held together by
`__tests__/event-stream.contract.test.ts`, which reads the frozen list out of the table below and
fails if the implementation and this file disagree. Version: `EVENT_CONTRACT_VERSION = 1`
(`src/events/MemoryEventStream.ts`).

## Event types (frozen)

Four types, frozen as a list. "Present" means the type is defined and named here; "producer today"
is what actually emits it. A type with no producer is not half-wired — nothing pretends to emit it,
and the ticket that owns it wires it when its source exists.

| Type | Means | Producer today | Owner if unwired |
|---|---|---|---|
| `ledger-append` | A row committed to the ledger. | `EventStore.onAppend` — every `EventStore.append`, the one path all ledger writes route through. | — |
| `compile-done` | A compile pass finished. `payload.kind` is `dream` or `consolidation`. | `MemoryKernel.runDreamTick` (`dream`), `MemoryKernel.consolidate` (`consolidation`). | — |
| `prospective-due` | A prospective memory reached its due time. | none | F2 (#156) |
| `candidate-pending` | A surfacing candidate is waiting for review. | none | F6 (#160) |

Adding a type is an additive change and does not bump the constant. Removing or renaming a type,
re-wording an envelope field, or changing cursor, filter or error semantics is a breaking change: it
bumps `EVENT_CONTRACT_VERSION` and says so in the changelog.

## Envelope

```json
{
  "cursor": 41,
  "type": "ledger-append",
  "at": 1777449600000,
  "projectId": "cogmem",
  "agentIds": ["cog"],
  "topic": "memory/auditability",
  "payload": { "eventId": "evt-…", "streamId": "…", "streamType": "thread", "eventType": "RAW_EVENT_RECORDED", "globalSeq": 20431 }
}
```

| Field | Meaning |
|---|---|
| `cursor` | Stream position, assigned by the stream. Never set by a producer. |
| `type` | One of the frozen four. |
| `at` | Wall-clock ms at which the producer observed the event. |
| `projectId` | The project the event belongs to, when it has one. |
| `agentIds` | Every agent the event is scoped to. Absent or empty means no agent owns it, which the scope rule (#143) reads as project-public — an empty list is not "nobody can see it". |
| `topic` | The topic the event belongs to, when the producer knows one. Most ledger rows know none. |
| `payload` | Ids and counts only. The ledger's text stays in the ledger; this stream is not a second read path, and repeating a turn's text here would be a second leak surface (#142). |

## Cursor semantics

- A cursor is a monotonic integer per process lifetime, starting at 1. It is a **stream position**,
  not the ledger's `global_seq`.
- `since` is exclusive. A subscription replays every buffered event with `cursor > since`, in cursor
  order, then continues live. Replay and live registration are one synchronous block, so no event
  can slip through the seam and none is delivered twice.
- The subscription handle's `cursor` is the position consumed — the highest event the subscriber has
  seen, matched or not. Pass it back as `since` after a reconnect: the client then receives exactly
  the events that followed, once each, in order. This is the disconnect test.
- Replay is bounded by the buffer, `DEFAULT_EVENT_BUFFER_CAPACITY = 1024` events. A `since` older
  than that is `cursor_expired`; the gap is real and is reported, not silently skipped.
- A `since` beyond this stream's head is also `cursor_expired`: the cursor belongs to another process
  or to a previous lifetime of this one, and this stream cannot resume from it. Recovery in both
  cases is to subscribe with no `since`, starting live at the head.

## Filter semantics

A filter has four dimensions; every dimension present is required (AND).

| Dimension | Matches |
|---|---|
| `project` | `event.projectId === project`. |
| `agent` | `event.agentIds.includes(agent)`. An event with no agents is project-public and is not matched by an agent filter. |
| `topic` | `event.topic === topic`. A row with no topic is not matched by a topic filter. |
| `types` | `event.type` is in the list. Absent or empty means every type; an unknown type is `invalid_filter`, not an empty result. |

Filters apply identically to replayed and live events: a subscription never sees an event that the
filter excludes, however it arrived.

## Error semantics

`KernelEventStreamError` carries a `code`, and for cursor errors the `oldestCursor` and `headCursor`
that explain it. The HTTP face maps the codes to statuses rather than stringifying them.

| Code | When | Recovery | HTTP |
|---|---|---|---|
| `invalid_cursor` | `since` is not a non-negative integer. | Fix the caller. | `400` |
| `cursor_expired` | The stream cannot resume from `since`: evicted from the buffer, or beyond the head. | Subscribe again with no `since`; the events in the gap are gone. | `409` |
| `invalid_filter` | `types` names a type outside the frozen list. | Fix the caller. | `400` |

## Delivery and failure isolation

- Delivery is synchronous and in cursor order.
- A callback that throws is unsubscribed, and its error is swallowed. The producer is unaffected —
  in particular a ledger append has already committed before its `ledger-append` event is delivered,
  so a broken or absent subscriber cannot fail a write — and every other subscriber still receives
  the event. A throwing subscriber is dropped rather than retried: a consumer that fails on an event
  will fail on it again.
- A callback must not write to the kernel. Delivery is synchronous, so a write inside a callback
  re-enters `emit` while it is still walking its buffer; that is undefined behaviour and not a
  supported pattern.

## The HTTP face

`GET /observatory/events`, served by the same loopback process as the rest of the observatory.

- Loopback only and `GET` only, exactly like the other endpoints; `HEAD` is `405`. It writes nothing:
  there is no database connection behind it.
- Query: `project`, `agent`, `topic`, `since`, `types` (comma-separated). A refused cursor or filter
  is the table above.
- Frames are standard SSE — `id: <cursor>`, `event: <type>`, `data: <envelope JSON>` — and `id` is
  what a client sends back as `since`. `: ping` comments every 15 s keep an idle connection alive.
- When the observatory has no kernel, the endpoint answers `503`.

## Scope ceiling

The stream is in-process. A ledger write made by another process is not seen by this process's
stream; each kernel instance emits only what it appended itself. Cross-process tailing would be a
durable event log with its own delivery semantics, and it is not promised here — the resident process
that holds the kernel is the one that serves the shell and the SSE face.

<!-- ponytail: process-local stream, no durable log. Wire a cross-process tail when F2 (time
     awareness) needs wake-ups from writers other than the resident kernel. -->
