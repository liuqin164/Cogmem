# Intention ledger contract (v1)

An intention is the agent's own plan — what it has decided to do next. A commitment is a debt to
the owner (F16 of #193): what was promised, and when it comes due. They are different books. A plan
does not owe anyone anything until it is said as a promise, and a promise is not a plan the agent
made for itself. This face is the intention ledger (F22 of #216): it records the plan, where it came
from, whether it is still active, and what became of it.

The code is `src/intention/` (`IntentionRecognition.ts`, `IntentionBook.ts`), reached as
`MemoryKernel.intentions`, through `KernelAgentMemoryBackend.listIntentions` /
`.proposeIntention` / `.updateIntention` / `.closeIntention` / `.convertIntention` /
`.scheduleIntention`, and through the session face's open-loop port. It is held to this document by
`__tests__/intention-book.contract.test.ts`, which reads the frozen tables below and fails when
code and contract disagree. Version: `INTENTION_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model on the hot path.** Conversation recognition is deterministic lexical rules. Dream
  compilation may use a model offline; it hands this face candidate text and the experience events
  it came from, and the face records them. Nothing in this module calls a model.
- **No commitment creation.** Conversion links an intention to a commitment that is already in
  F16. It writes no `COMMITMENT_*` row and changes no F16 method. F16's own recognizer remains the
  only way a promise opens.
- **No new storage.** An `OPENED` row is the intention, an `UPDATED` row is a self-correction, and
  a `CLOSED` row is its ending. No table, no column, no migration.
- **No observatory view or endpoint this round.** The owner's veto is the kernel method below; the
  observatory's intention page, when it lands, is read-only and adds no write route.
- **No soul or rule governance change.** The soul and the rules stay owner-written; an intention is
  the agent's own plan, which is why the agent may create, correct and abandon it.
- **No task manager.** There is no priority, project or recurring-task vocabulary. A plan is a
  sentence and its provenance.
- **No F6 surfacing source.** F6 does not gain an `intention` source this round. Active intentions
  are consumed by the wake assembly through F14's existing open-loop port.

## The two books are isolated

The commitment recognizer is the authority on promise shape. A clause it recognizes as a promise is
a commitment, and the intention recognizer refuses it: a promise never enters the intention book.
The intention book writes only `INTENTION_*` rows, so an intention never enters the commitment book.
The contract test measures both directions.

The boundary has one visible consequence, stated rather than hidden: F16's frozen rule claims any
dated first-person plan (`我周五前把报告整理好`), so such a clause is a commitment under F16's
contract, not an intention. The intention book owns undated self-plans from conversation, and
dream-derived candidates, which may carry a target time because they are not raw turns.

## Formation (the rules)

**Hot path — conversation.** `compile` reads the project's raw turns in order and derives an
intention from an agent/assistant clause that has a first person, a plan marker (`计划`, `准备`,
`决定`, `安排`) and an action, and that F16's recognizer does not claim. Questions, requests,
hypotheticals, hedges, habits, the past, negation and wishes are refused, as they are for promises.
A miss is silent. The same clause yields its content and any due instant the clause names.

**Dream boundary — experience.** `propose` accepts candidate text, the agent it belongs to, and at
least one existing event as `sourceRefs`. The caller may have used a model offline; this face
validates the refs and appends the candidate. A candidate with no real evidence is refused. The
same candidate proposed twice is one row.

The split is the contract: deterministic rules decide what a turn said, and a dream-time caller may
propose what an experience meant. Neither path lets a model write an unbound intention on the hot
path.

## Statuses (frozen)

The state machine is derived, not stored: a clock alone never writes a row.

| Status | Means |
|---|---|
| `active` | Open. It has no closing row. |
| `done` | Closed by completion evidence: the agent's later word or an artifact naming the intention. |
| `abandoned` | Closed by the agent's own abandonment or the owner's veto. |
| `converted` | Closed because the plan became a commitment; `convertedTo` names the F16 entry. |

## Origins (frozen)

| Origin | Means |
|---|---|
| `conversation` | Derived from an agent turn by the deterministic rules. |
| `dream` | Proposed at the DREAMING boundary from experience, with its evidence. |

## Close reasons (frozen)

`closeReason` is the audit's word for why a row closed. It is the distinction the status alone
cannot carry: a vetoed intention and a self-abandoned one are both `abandoned`.

| Close reason | Status | Means |
|---|---|---|
| `done` | `done` | Completion evidence landed. |
| `abandoned` | `abandoned` | The agent gave the plan up. |
| `vetoed` | `abandoned` | The owner vetoed it; `vetoEventId` names the owner's turn. |
| `converted` | `converted` | The debt moved to F16; `convertedTo` names the commitment. |

## The face (frozen)

| Method | Writes | Does |
|---|---|---|
| `compile` | `OPENED` / `CLOSED` rows | Re-derive conversation intentions from the raw turns and close the ones with completion evidence. Idempotent; safe at a turn boundary and at DREAMING. |
| `propose` | an `OPENED` row | Record a dream candidate with its evidence. Idempotent for the same candidate. |
| `list` | — | The book, filtered by agent, derived status and limit. |
| `activeForAgent` | — | The agent's active intentions for its wake assembly. Pure: reading does not change a row. |
| `update` | an `UPDATED` row | The agent corrects its own content or target time. |
| `close` | a `CLOSED` row | The agent ends its own plan as `done` or `abandoned`, with evidence. |
| `veto` | a `CLOSED` row | The owner vetoes: `abandoned`, traced, effective on every read. |
| `convert` | a `CLOSED` row | Link the intention to an existing F16 commitment; the intention side becomes `converted`. |
| `schedule` | an `UPDATED` row | Register the intention's target time as an F2 wake intention and record its id. |
| `audit` | — | Every intention row for the project, oldest first. |

Adding a method is an additive change and does not bump the constant. Removing or renaming one does.

## Entry fields (frozen)

| Field | Means |
|---|---|
| `intentionId` | Stable id: derived from (project, source turn, clause index) for conversation, or from (project, agent, content, evidence) for a dream candidate. |
| `agentId` | The agent whose plan this is; absent when the ledger named none (the single-agent case). |
| `content` | The clause, quoted. Never a paraphrase. |
| `origin` | `conversation` or `dream`. |
| `status` | One of the four derived statuses. |
| `dueAt` | The optional target instant. |
| `wakeIntentionId` | The F2 wake intention registered by `schedule`, once. |
| `convertedTo` | The F16 `commitmentId` this intention became, once converted. |
| `sourceRefs` | The turn or experience events that produced the intention, and the evidence that closed it. Never empty. |
| `openedAt` | When the intention was recorded. |
| `updatedAt` | When the agent last corrected it. |
| `closedAt` | When it became done, abandoned or converted. |
| `closeReason` | `done`, `abandoned`, `vetoed` or `converted`. |
| `vetoEventId` | The owner's veto turn, when `closeReason` is `vetoed`. |
| `version` | 1 for the opening row, +1 per update or close. |

## Book events (frozen)

| Type | Written when | Payload |
|---|---|---|
| `INTENTION_OPENED` | A compile derives a plan it had not recorded, or a dream candidate is proposed. | `intentionId`, `projectId`, `agentId`, `content`, `origin`, `dueAt?`, `sourceRefs`, `openedAt`, `version` |
| `INTENTION_UPDATED` | The agent corrects content or target time, or schedules the plan. | `intentionId`, `projectId`, `content?`, `dueAt?`, `wakeIntentionId?`, `updatedAt`, `version` |
| `INTENTION_CLOSED` | Completion, abandonment, veto or conversion lands. | `intentionId`, `projectId`, `status`, `closeReason`, `closedAt`, `sourceRefs`, `convertedTo?`, `vetoEventId?`, `version` |

## Consumption

`activeForAgent` is a pure read. The kernel wires it into F14's `openLoops` port, so a restart
rebuilds the `working_set` lane with the active plans and their `sourceRefs`; the lane order is
F14's and is not changed.

`schedule` consumes F2's existing `register`: the intention's `dueAt` becomes a wake intention at
that instant, with the intention's content as the reason and its `sourceRefs` as the evidence.
Scheduling twice is one wake intention.

`convert` consumes F16's existing `audit` read to require that the named commitment is really in
the project. It then closes the intention side as `converted` and leaves the commitment exactly as
F16 recorded it. There is no second commitment and no second promise.

## Governance

The soul and the rules are the owner's: the agent may read them and propose a change, but it cannot
write them. An intention is the opposite case because it is the agent's own plan — the agent may
create, correct, complete or abandon it, and every one of those acts is an appended row. The owner
keeps the audit and the veto: a veto closes the intention as `abandoned` with `closeReason:
vetoed` and the owner's turn in `sourceRefs`, and every read in the project sees it as closed.

The agent-facing backend exposes the agent's methods and no `veto`. The owner's veto is the kernel
method; the observatory does not gain a write route this round.

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | A call names no project. |
| `agent_id_required` | A proposal names no agent. |
| `intention_id_required` | A call names no intention. |
| `intention_unknown` | The intention has no row in this project. |
| `invalid_intention_evidence` | Completion, abandonment or veto names an event that is not in the project. |
| `invalid_intention_status` | A close status is not `done` or `abandoned`, or an update names no field or targets a closed intention. |
| `invalid_source_refs` | A dream candidate names no source, or a source that is not in the project. |
| `intention_due_required` | `schedule` is called on an intention with no `dueAt`. |
| `intention_content_required` | A proposal or update names no content. |
| `invalid_intention_at` | A target instant is not a finite number. |
| `commitment_unknown` | `convert` names a commitment that F16 does not hold in this project. |
| `invalid_limit` | A read limit is not a positive integer. |

## The seed gate

`__tests__/fixtures/intention-seed.ts` is the F16-style seed set: agent self-plans that must be
captured beside ordinary talk, promises, questions and other speakers' plans that must not be.
Precision and recall are computed over it and the contract test refuses the round below 90% for
either. The set is curated, not an independent benchmark; the numbers are reported as measured,
with that boundary.
