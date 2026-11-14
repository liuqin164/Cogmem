# Commitment book contract (v1)

A promise said out loud — "周五前回那封邮件", "我明天把文件发你", "客服说明天答复我" — is a turn
with a time obligation attached. This face is the fourth compiled book (F16 of #193): it records who
promised what, when it comes due, how it closed, and it keeps the two disciplines that make a
reminder bearable — **announce once** and **ask once**. The profile book compiles the person, the
session book the scene, the procedure book the craft, this book the unfinished things.

The code is `src/commitment/` (`CommitmentRecognition.ts`, `CommitmentBook.ts`), reached as
`MemoryKernel.commitments` and through `KernelAgentMemoryBackend.listCommitments` /
`.surfaceCommitments` / `.askCommitments` / `.dismissCommitment`. It is held to this document by
`__tests__/commitment-book.contract.test.ts`, which reads the frozen tables below and fails when
code and contract disagree. Version: `COMMITMENT_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model on the hot path.** Recognition and completion are deterministic lexical rules. A miss
  is silent; the seed set measures precision and recall instead of trusting the rules by inspection.
- **No task manager.** Only promises spoken in conversation enter. There is no priority, project or
  recurring-task vocabulary; that would be a GTD product, not this book.
- **No new storage.** An `OPENED` row is the promise, a `CLOSED` row is its completion or
  cancellation, and `SURFACED` / `ASKED` / `DISMISSED` rows are the discipline marks. No table, no
  column, no migration.
- **No observatory view this round.** The book is readable through the kernel and host API; the
  observatory page belongs with #136's follow-on design.
- **No occasion logic.** A candidate carries whatever the caller declared, as F6 does; F8 owns
  occasion trust.

## Owners (frozen)

| Owner | Means |
|---|---|
| `user` | The owner promised the agent (or themselves, in the agent's hearing). |
| `agent` | The agent promised the owner. Symmetric: the same rules, the same book, the same due marks. |
| `third-party` | Someone else promised the owner ("客服说明天答复我"). Recorded as `tentative`, because the promise was reported, not heard. |

## Statuses (frozen)

The state machine is **derived**, not stored: a clock alone never writes a row.

| Status | Means |
|---|---|
| `pending` | Open, and either no due instant or more than `COMMITMENT_DUE_SOON_MS` (24 h) away. |
| `due_soon` | Open, due within 24 h. |
| `overdue` | Open, past its due instant. |
| `completed` | Closed by completion evidence. |
| `cancelled` | Closed by the owner's cancellation. |

## Recognition (the rules)

A clause is a promise when it has a **future marker** (`明天`, `周五前`, `下周`, `月底`, `会`, `要`,
`将`, an `N 天后` form, or an English equivalent), an **action**, and a **first person** — or when a
**third party's promise verb** (`说`, `答应`, `承诺`, `表示`) is followed by a **recipient cue**
(`给我`, `回我`, `答复你`). The due instant or event condition is parsed from the same clause.

Refused, because the shape is not a promise: questions and requests, hypotheticals (`如果`), speaker
hedges (`可能`, `应该`, `尽量`), habits (`一般`, `通常`, `每次`), the past (`昨天`, `已经` without a
future marker), negation (`不会`, `不打算`) and wishes (`希望`, `想`). A third party's plan without a
recipient ("他说他明天要去跑步") is refused; a reported promise to the owner is not.

A conditional promise (`收到货以后我马上处理退款`, `等发货后我再联系你`) carries its
`dueCondition` and no `dueAt`: only the event can start its clock. The soft markers (`稍后`, `尽快`)
get the frozen 24-hour horizon.

## Completion and cancellation

Completion evidence is the owner's own word, in a later turn from the same side: explicit
(`已经发了`, `交完了`, `搞定了`, English `sent` / `done`) closes the promise and appends the
evidence turn to its `sourceRefs`; a recorded artifact may also close it by naming the commitment in
event metadata (`completesCommitment`). A **hedged** report (`应该已经发了`, `好像交了`) is ambiguous:
it closes nothing and earns **one** question, at a natural moment, ever — the `ASKED` row is the
mark. Completion matching requires shared content cues, so "邮件已经回了" does not close the promise
about the invoice.

## Announce once, ask once

`dueForAgent` is scoped to the calling agent when the promise's turn named one, so in a project with
several agents a promise wakes only the agent that made it.

`surfaceDue` returns the `due_soon` and `overdue` promises and writes a `SURFACED` row keyed by the
due instant. A second query for the same occurrence returns nothing, including after a restart. The
same mark is what F6's proactive candidate reads, so the shell cannot announce it twice either.
`askOnce` works the same way with `ASKED`.

`dismiss` silences one reminder for its current due instant and leaves the promise in the book. That
is F7's feedback loop read as a book mark until F7 lands; when F7 owns per-class weights, the mark
becomes its input rather than the whole rule.

## The face (frozen)

| Method | Writes | Does |
|---|---|---|
| `compile` | `OPENED` / `CLOSED` rows | Re-derive from the raw turns and append only what is new. Idempotent; safe at every turn boundary and at DREAMING. |
| `list` | — | The visible book, filtered by owner and derived status. |
| `surfaceDue` | a `SURFACED` row per occurrence | The arrived promises, announced once. |
| `dueForAgent` | — | The agent's own arrived promises for its wake assembly. Pure: reading does not consume the announce mark. |
| `askOnce` | an `ASKED` row per promise | The one question an ambiguous completion earns. |
| `dismiss` | a `DISMISSED` row | Silence one reminder for its current occurrence. |
| `complete` | a `CLOSED` row | Close on completion evidence (a real event in the project). |
| `cancel` | a `CLOSED` row | Close on the owner's cancellation. |
| `audit` | — | Every commitment row for the project, oldest first. |

Adding a method is an additive change and does not bump the constant. Removing or renaming one does.

## Entry fields (frozen)

| Field | Means |
|---|---|
| `commitmentId` | Stable id of (project, source turn, clause index). |
| `owner` | `user`, `agent` or `third-party`. |
| `agentId` | The agent whose turn made an `agent` promise, when the ledger named one; an unnamed one belongs to the single-agent case. |
| `content` | The clause, quoted. Never a paraphrase. |
| `dueAt` | The due instant, when the clause names one. |
| `dueCondition` | The event condition, when the clause names one instead of an instant. |
| `status` | One of the five derived statuses. |
| `confidence` | `explicit` for a first-person promise with a date; `tentative` for a reported third-party promise or a conditional one. |
| `sourceRefs` | The turn that made the promise and, once closed, the turn that closed it; never empty. |
| `openedAt` | When the promise was made. |
| `surfacedAt` | When it was announced, once. |
| `askedAt` | When the one ambiguity question was asked. |
| `closedAt` | When it was completed or cancelled. |
| `version` | 1 for the opening row, +1 per close. |

## Book events (frozen)

| Type | Written when | Payload |
|---|---|---|
| `COMMITMENT_OPENED` | A compile derives a promise it had not recorded. | `commitmentId`, `projectId`, `owner`, `content`, `dueAt?`, `dueCondition?`, `confidence`, `sourceRefs`, `openedAt`, `version` |
| `COMMITMENT_CLOSED` | Completion or cancellation evidence lands. | `commitmentId`, `projectId`, `status`, `closedAt`, `sourceRefs`, `version` |
| `COMMITMENT_SURFACED` | A due promise is announced. | `commitmentId`, `projectId`, `dueKey`, `at` |
| `COMMITMENT_ASKED` | The one ambiguity question is asked. | `commitmentId`, `projectId`, `question`, `at` |
| `COMMITMENT_DISMISSED` | A reminder is silenced for its occurrence. | `commitmentId`, `projectId`, `dueKey`, `at` |

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | A call names no project. |
| `commitment_id_required` | A call names no commitment. |
| `commitment_unknown` | The commitment has no row in this project. |
| `invalid_commitment_evidence` | Completion or cancellation names an event that is not in the project. |
| `invalid_limit` | A read limit is not a positive integer. |

## The seed gate

`__tests__/fixtures/commitment-seed.ts` is the F13-style seed set: explicit promises that must be
captured (owner and due kind asserted) beside ordinary talk that must not be. Precision and recall
are computed over it and the contract test refuses the round below 90% for either. The set is
curated, not an independent benchmark; the numbers are reported as measured, with that boundary.
