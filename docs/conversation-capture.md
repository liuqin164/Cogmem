# Conversation capture contract (v1)

Companion conversation is raw material, not a tool transcript (#157). The kernel's existing write
faces record a turn as a role, some text and a session; a shell that wants to keep *who* spoke,
*where* and *in which thread* has to invent its own encoding, and two shells invent two. This face
writes that meaning down where the ledger is appended.

The code is `src/conversation/ConversationCaptureService.ts`, reached as
`MemoryKernel.conversationCapture` and — the host API — as
`KernelAgentMemoryBackend.captureConversationTurn` / `.listConversationTurns`. It is held to this
document by `__tests__/conversation-capture.contract.test.ts`, which reads the frozen tables below
and fails when code and contract disagree. Version: `CONVERSATION_CAPTURE_CONTRACT_VERSION = 1`.

## What this face does not do

It does not change any existing write face. `rememberTurn`/`rememberTurnWithResult`,
`ingestToolCall`, `ingestToolObservation` and `ingestTaskEvent` keep their shapes and their rows, and
the contract test pins them against drift. The one existing surface whose accepted *values* widen is
`cogmem episode append --role`, which now accepts `other` too: the ledger can hold a role the flag
refused, and a CLI that cannot name what the column holds is drift, not isolation. It also does not
add a second store: a captured turn is a `RAW_EVENT_RECORDED` row in `memory_events`, like every
other turn.

It also does not widen the derived projections, and says so rather than implying otherwise: the
ledger's Atlas dirty triggers and the action-frame extractor read `user` and `tool` rows, and the
episode title generator reads `user` and `assistant`/`agent` rows — so an `other` turn is in the
ledger, in its episode and in the raw recall lane, but it is not an Atlas node and does not name an
episode. Widening the triggers is a change to the pinned baseline schema, so it is a decision for a
later round rather than a line smuggled into this one.

## The write

`captureConversationTurn(turn)`:

1. checks the turn shape below and refuses with the frozen error codes,
2. applies the explicit-exclusion pass every kernel write path runs (`<COGMEM_PRIVATE>` never becomes
   an event; what is written is the stripped text),
3. appends one ledger row, which is where the secret mark and the PII redaction are applied, as they
   are for every other raw event,
4. hands the row to episode assembly, and
5. compiles the turn through the kernel's one ingest entry point (`MemoryKernel.ingest`) — the same
   path `ingestToolObservation` uses, so a large turn costs what a large tool result costs (#199).

The ledger row is written before the compile: if the compile throws, the turn is still captured and
the caller sees the error. Episode assembly is an organizational index and cannot fail the write. The
returned record's `text` is the row's own text — after exclusion and redaction — so a write and a
later read agree.

## Speakers (frozen)

| Speaker | Means |
|---|---|
| `owner` | The person the companion belongs to. |
| `other` | A third party in the conversation: a human who is neither the owner nor the agent. |
| `agent` | The companion's own turn. |

A third party may also carry its own display name (`turn.speakerLabel`, e.g. 小明). It is display
only: the filter reads `speaker`.

## Speaker → ledger role (frozen)

| Speaker | `role` | Why |
|---|---|---|
| `owner` | `user` | The kernel already reads a `user` turn as the owner: `silenceMs`, prospective confirmation evidence and the social gate. |
| `other` | `other` | A third party's words must not read as the owner speaking, and they are not the agent's own turn either. |
| `agent` | `assistant` | The agent's own turn, unchanged. |

`other` is the one value this round adds to `MemoryEventRole`. It exists because the ledger had no
way to say "a human, but not the owner", which is exactly the gap this ticket names.

## Turn fields (frozen)

| Field | Means |
|---|---|
| `eventId` | The ledger row this turn is. |
| `projectId` | The project boundary; a read is scoped by it. |
| `agentId` | The identity the turn was captured on behalf of. |
| `sessionId` | The session the turn belongs to — the ledger's existing column. Required and non-empty. |
| `threadId` | The thread inside the session. Defaults to the session id. |
| `turnId` | The turn's id inside the thread. Derived when the caller does not pass one. |
| `turnSeq` | The ledger's turn sequence for that thread. |
| `speaker` | One of the frozen speakers. |
| `speakerLabel` | Optional display name for the speaker. |
| `channel` | Where it was said (`terminal`, `telegram`, …). Required and non-empty. |
| `lane` | Always `conversation`. |
| `role` | The ledger's coarse role for that speaker, from the table above. |
| `text` | The written text: the caller's own text, minus what explicit exclusion and redaction removed. Never trimmed. |
| `occurredAt` | The instant the turn happened. Defaults to the clock at the write. |
| `compiledNeuronId` | Set when the compile half produced a neuron; the ledger row exists either way. |

## Capture lanes

A capture lane is where a row *came from*, and it is a fact on the row rather than a second store:

| Lane | Row |
|---|---|
| `conversation` | A `message` row whose payload metadata carries `captureLane: 'conversation'`, plus `speaker`, `channel` and `sourceAgent`. |
| `tool` | A `tool_call` or `tool_result` row. It never carries `captureLane`, which is what keeps `listConversationTurns` free of tool rows without asking a second table. |

## The read

`listConversationTurns({ projectId, speaker?, channel?, threadId?, sessionId?, limit? })` returns the
turns this face wrote, oldest first, in ledger order. `speaker` is the discriminative filter: one
speaker's turns, never another's ("what he said" does not return what I said). Inferring that filter
from the question's own wording (`他说的`) is **not** this round's change — the filter is explicit
and typed, and the discrimination is asserted with it.

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | The turn names no project. |
| `agent_id_required` | The turn names no identity. |
| `conversation_session_id_required` | The turn names no session. |
| `conversation_channel_required` | The turn names no channel. |
| `conversation_text_required` | The turn has no text. |
| `invalid_conversation_speaker` | The speaker is not one of the frozen three; the message names the set. |
| `invalid_limit` | A read limit that is not a positive integer. |
