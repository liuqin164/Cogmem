# Surfacing candidates contract (v1)

Surfacing is the companion's emergence action: a memory or commitment is put in front of the agent
before it is asked for. The kernel's half is deliberately smaller than the action. **The kernel
returns candidates and their reasons; the shell decides whether to speak, and how.** This document
is the contract for that kernel half.

The code is `src/surfacing/SurfacingCandidates.ts`, reached as `MemoryKernel.surfacing` and through
`KernelAgentMemoryBackend.surfacingCandidates`. It is held to this document by
`__tests__/surfacing-candidates.contract.test.ts`, which reads the frozen tables below and fails when
code and contract disagree. Version: `SURFACING_CONTRACT_VERSION = 1`.

## What this face does not do

- **No model call.** Grading and candidate selection are deterministic rules. A model may have
  produced the evidence offline; nothing here calls one.
- **No occasion trust.** The caller declares `channel` and `occasion`; both are recorded on the
  candidate and in its trace. This round attaches no trust to either. Occasion trust is F8 (#162).
- **No shell decision.** Whether a candidate is spoken, delayed or dropped is the shell's. The
  kernel only says what it has, why, how fresh it is, and how sensitive it is.
- **No new source.** Candidates come only from products that already exist: F2's pending wake
  intentions and confirmed/deferred prospective memories, F5's current profile entries, F15's
  procedure book, and the ledger's raw turns. F16's commitment ledger is not invented here.
- **No storage.** The query owns no table, column or migration. `withheld` is a read result, not a
  queue.
- **No push.** `candidate-pending` in `docs/events.md` remains unwired: this face is a pull query,
  and a shell that needs a push can wire the event when it has a consumer for it.

## Channels (frozen)

| Channel | Means |
|---|---|
| `proactive` | The agent is speaking first, without a question. |
| `asked` | The owner or shell asked; the query may carry a cue. |

The channel is required. An unknown channel is `invalid_surfacing_channel`.

## Sources (frozen)

| Source | Reads | Candidate id |
|---|---|---|
| `wake-intention` | F2 pending intentions. `proactive` sees only those whose instant has arrived; `asked` sees every pending one. | `intentionId` |
| `prospective-memory` | F2 confirmed or deferred prospective memories. `proactive` sees only due ones; `asked` sees the open ones in the service's 100-row page. | `candidateId` |
| `profile` | F5 current entries from all four ledgers. | `entryId` |
| `procedure` | F15's current procedure entries, recalled by the caller's task cue. A candidate contributes only when the caller supplied a cue; a proactive moment with no stated task has nothing to match. | `entryId` |
| `ledger` | `RAW_EVENT_RECORDED` turns. `proactive` scans the last 7 days; `asked` scans the last 90 days and also searches the cue across history; the cue still filters both. | `eventId` |

A candidate whose source has no refs is still returned when its product carries none; `sourceRefs`
is then empty and the trace says so.

## Candidate fields (frozen)

| Field | Means |
|---|---|
| `candidateId` | `surfacing:<source>:<sourceId>`; stable for one source product. |
| `source` | One of the frozen sources. |
| `channel` | The channel the caller declared. |
| `occasion` | The occasion the caller declared, if any. Recorded, never trusted. |
| `content` | The product's own text: an intention reason, a prospective title/details, `key: value`, or a ledger turn. |
| `sourceRefs` | The raw events the candidate is about. |
| `reason` | Exactly the decision trace's reason, reconstructed from its steps. |
| `confidence` | A deterministic 0–1 confidence for this source product. |
| `freshness` | The source's time and validity, below. |
| `sensitivity` | `daily`, `private` or `high`. |
| `decisionTrace` | The complete decision, below. |

## Result fields (frozen)

| Field | Means |
|---|---|
| `projectId` | The project the query was scoped to. |
| `channel` | The channel the caller declared. |
| `occasion` | The occasion the caller declared, if any. |
| `now` | The instant the query was computed for. |
| `candidates` | The candidates the channel allows, ranked and capped by `limit`. |
| `withheld` | The candidates the policy withheld, ranked and capped by `limit`; no content. |

## Withheld fields (frozen)

A candidate the channel policy or the keychain rule withheld is reported here **without its
content**. It exists so the filter is auditable; it is not a candidate the shell may speak.

| Field | Means |
|---|---|
| `candidateId` | The same id the candidate would have had. |
| `source` | One of the frozen sources. |
| `channel` | The channel the caller declared. |
| `occasion` | The occasion the caller declared, if any. |
| `sensitivity` | The tier that caused the withhold, or the tier of a hard-withheld keychain mark. |
| `reason` | Exactly the decision trace's reason. |
| `decisionTrace` | The complete decision, including the withholding step. |

## Freshness fields (frozen)

| Field | Means |
|---|---|
| `observedAt` | The source's own instant: a turn's occurrence, a due item's due time, a profile entry's evidence time. |
| `ageMs` | `now - observedAt`; negative means the source is due in the future. |
| `expiresAt` | When the candidate stops being timely, or `null` for a long-lived profile entry. |
| `expired` | `expiresAt !== null && now > expiresAt`. |

Due wake intentions and prospective memories stay timely for seven days after their instant; a
ledger turn stays timely for seven days after it occurred. A profile entry has no expiry. An expired
candidate is withheld from `proactive` and remains available in `asked`, with the trace naming it
`expired`.

## Sensitivity tiers (frozen)

| Tier | Means |
|---|---|
| `daily` | Ordinary life detail; safe to surface without special handling. |
| `private` | Personal but not dangerous: money, family friction, health-adjacent detail, tool output. |
| `high` | Medical, identity, secret or otherwise damaging if spoken at the wrong moment. |

### Channel policy (frozen)

This is the **default** policy. It is the only channel policy this round implements; an occasion is
recorded but cannot change it. F8 may later add an occasion-trust override for `private`; it may not
move `high` into `proactive` without a new contract version.

| Tier | `proactive` | `asked` |
|---|---|---|
| `daily` | allowed | allowed |
| `private` | withheld | allowed |
| `high` | withheld | allowed |

**Keychain exception.** A keychain mark is a hard withhold in **both** channels. It is still graded
`high` — the mark is at least high — but #142 already keeps secret-marked text out of every read
lane, and surfacing does not become the exception. The withheld entry carries ids and reasons, never
the text.

## Classifier (frozen)

The classifier is deterministic. These rules are listed in precedence order: the highest tier wins,
and a later lower tier cannot lower an earlier higher one.

1. A `keychain` tag on any source ref is `high` and hard-withheld.
2. Any tag source's `high` tag is `high`.
3. A high text marker is `high`.
4. A private text marker is `private`.
5. A private raw event type is `private`.
6. Otherwise `daily`.

Tags are supplied by the narrow interface below. Text markers are the classifier's own tables,
frozen here.

### High markers (frozen)

| Marker | |
|---|---|
| `病历` | |
| `诊断` | |
| `处方` | |
| `手术` | |
| `住院` | |
| `疾病` | |
| `癌症` | |
| `肿瘤` | |
| `高血压` | |
| `糖尿病` | |
| `心脏病` | |
| `哮喘` | |
| `抑郁` | |
| `焦虑症` | |
| `精神科` | |
| `心理治疗` | |
| `自杀` | |
| `自残` | |
| `家暴` | |
| `性侵` | |
| `艾滋病` | |
| `身份证号` | |
| `银行卡号` | |
| `信用卡号` | |
| `密码` | |
| `私钥` | |
| `medical record` | |
| `diagnosis` | |
| `prescription` | |
| `surgery` | |
| `hospitalized` | |
| `cancer` | |
| `depression` | |
| `therapy` | |
| `suicide` | |
| `self-harm` | |
| `domestic violence` | |
| `sexual assault` | |
| `social security` | |
| `bank card` | |
| `credit card` | |
| `password` | |
| `private key` | |
| `hiv` | |
| `aids` | |

### Private markers (frozen)

| Marker | |
|---|---|
| `工资` | |
| `薪资` | |
| `收入` | |
| `存款` | |
| `债务` | |
| `贷款` | |
| `房贷` | |
| `房租` | |
| `离婚` | |
| `吵架` | |
| `家庭矛盾` | |
| `体重` | |
| `过敏` | |
| `怀孕` | |
| `医院` | |
| `体检` | |
| `复查` | |
| `salary` | |
| `income` | |
| `debt` | |
| `mortgage` | |
| `divorce` | |
| `argument` | |
| `weight` | |
| `allergy` | |
| `pregnant` | |

### Private raw event types (frozen)

| Raw event type | |
|---|---|
| `tool_call` | |
| `tool_result` | |
| `action_result` | |

### Acceptance samples

These are the ticket's misclassification samples plus same-kind neighbours. The contract test runs
each one through the classifier and requires the stated tier.

| Sample | Expected |
|---|---|
| `医生给我开了处方，诊断是高血压。` | `high` |
| `我的病历放在医院档案里。` | `high` |
| `我的银行卡号是 6222 0000 0000 0000。` | `high` |
| `我的生日是五月一日。` | `daily` |
| `我们的结婚纪念日快到了。` | `daily` |
| `今天下午喝了一杯咖啡。` | `daily` |
| `我的工资这个月晚发了。` | `private` |
| `我对花生过敏。` | `private` |
| `明天去医院复查。` | `private` |

## Sensitive tag interface (frozen, F10 entry point)

F10's life-information marks enter through one narrow interface. Adding a source is additive and
does not bump the contract version; the surfacing service unions every source's tags and the
classifier takes the highest tier.

```ts
interface SensitivityTagSource {
  tagsFor(query: SensitivityTagQuery): readonly SensitiveTag[];
}
```

### Tag fields (frozen)

| Field | Means |
|---|---|
| `source` | Where the mark came from: `keychain`, `source-type`, and later `life-info`. |
| `tier` | `daily`, `private` or `high`. A `daily` tag does not raise the tier. |
| `reason` | Why the source marked it; carried into the decision trace. |
| `eventIds` | The source refs the tag applies to. Empty means the whole candidate; a tag whose ids do not intersect the candidate's refs does not apply. |

### Query fields (frozen)

| Field | Means |
|---|---|
| `projectId` | The project the candidate belongs to. |
| `eventIds` | The candidate's source refs, deduplicated. |
| `text` | The candidate's content. |
| `sourceType` | The product's source type, when it has one. |
| `metadata` | The source row's metadata, when it has one. |

### Built-in sources (frozen)

| Source | Tier | Means |
|---|---|---|
| `keychain` | `high` | Any source ref whose event carries the #142 secret mark. Hard-withheld. |
| `source-type` | `private` | A raw event type in the private table above. |

F10 adds `life-info` as a third `SensitivityTagSource`; it needs no change to this document, the
classifier or the candidate shape. A `life-info` tag of `high` is withheld from `proactive` and
allowed in `asked`; only the `keychain` source is hard-withheld.

## Decision trace (frozen)

| Field | Means |
|---|---|
| `version` | `surfacing_candidate_decision.v1`. |
| `reason` | Exactly `steps.map(step => \`${step.rule}=${step.outcome}\`).join('; ')`. |
| `steps` | The ordered decision, below. |

### Step fields (frozen)

| Field | Means |
|---|---|
| `rule` | `source`, `freshness`, `sensitivity`, `channel`, or `occasion` when one was declared. |
| `outcome` | The rule's answer. |
| `detail` | The ids, tier, policy or timestamps that answer it. |

Every candidate and withheld entry carries all four base steps in this order: `source`,
`freshness`, `sensitivity`, `channel`. `occasion` follows when the caller declared one. The
`reason` is reconstructed from those steps, so a reader can check the candidate field by field:

- the `source` outcome starts with the candidate's `source`, and its detail carries `sourceRefs`, the ref count (zero included);
- the `freshness` outcome is `upcoming`, `fresh` or `expired`, and its detail equals `freshness`;
- the `sensitivity` outcome equals the candidate's `sensitivity`;
- the `channel` outcome is `allowed` for a candidate and `withheld` for a withheld entry;
- the `occasion` outcome is `recorded` and changes no decision.

The trace is candidate-local: it is returned with the candidate and is not written to the recall
trace table. It carries the same versioned `reason` field the recall decision trace uses, and adds
ordered `steps` so each rule can be checked; recall's trace has no step list. `explain_recall`
explains a recall lane, so this trace travels inline with the candidate instead of opening a second
explain surface.

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | A call names no project. |
| `invalid_surfacing_channel` | The channel is not `proactive` or `asked`. |
| `invalid_surfacing_query` | `query` is present but not a string. |
| `invalid_surfacing_occasion` | `occasion` is present but not a string. |
| `invalid_limit` | `limit` is not a positive integer. |
| `invalid_surfacing_now` | `now` is not finite. |

## API (frozen)

| Method | Does |
|---|---|
| `candidates` | One channel's candidates and withheld entries at an injected instant. |

Adding a method is additive. Removing or renaming one, or changing a field, channel, tier, rule or
error meaning, is a breaking change and bumps `SURFACING_CONTRACT_VERSION`.

## Ranking and bounds

Candidates are ranked by source urgency — due prospective memory, due wake intention, profile,
ledger — then by confidence, then by the newer `observedAt`, then by id. The caller's `limit`
(default 20, maximum 100) caps both lists. The ledger scan is bounded at 200 rows per query and the
prospective-memory read at the service's 100-row page; wake intentions are read in full. A project
beyond those bounds sees the first page, not a silently widened one.

## Scope ceiling

The query is in-process and synchronous. It holds no timer and no queue; two processes on one
database each read the same ledger. The intended holder is the resident process that already holds
the kernel, the same ceiling F2's wake tick states. The face does not persist a decision and does
not emit `candidate-pending`; a shell that wants a push rather than a pull can wire that event
against this query's result without changing this contract.
