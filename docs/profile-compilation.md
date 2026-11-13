# Profile compilation contract (v1)

A companion's memory is not only what happened; it is what is *understood* about the owner — the
facts, preferences, relations and open items that answer "who is this person, and how should I behave
around them". Existing compilation is generic: facts, beliefs, frames and an Atlas, each a product of
its own kind. This face is the specific form the ticket asks for (F5 of #159): **four ledgers, every
entry carrying its `sourceRefs`, correctable by the owner, and entering default recall under its own
priority and decay rule.**

The code is `src/profile/ProfileCompiler.ts`, reached as `MemoryKernel.profile`. It is held to this
document by `__tests__/profile-compilation.contract.test.ts`, which reads the frozen tables below and
fails when code and contract disagree. Version: `PROFILE_CONTRACT_VERSION = 1`.

## What this face does not do

It adds no storage. Every version of an entry is a `memory_events` row on a per-entry stream
(`profile-entry:<entryId>`), a correction is another row on the same stream, and a ledger's recompile
leaves a `PROFILE_LEDGER_RECOMPILED` receipt — so the ledger is the state, the history and the audit,
the way F2 stored a wake intention. **No table, no column, no migration.**

It does not call a model and it does not read free text. The compiler derives from evidence that is
already governed and evidence-bound: live `facts`, active `beliefs`, declared person `relations`, and
owner-confirmed `prospective` items. A model may have produced that evidence offline; this layer is
deterministic, so the same evidence always compiles the same profile.

It does not decide a merge's read side. Which names, memories, attributes and edges follow a merged
person is #214's modelling decision, not this round's; the profile reads relations through F4's
`entity_relations` exactly as they stand.

## The ledgers (frozen)

| Ledger | Compiles from | An entry is |
|---|---|---|
| `facts` | Live `facts` and active `beliefs` whose predicate is not a preference and not transient. | A standing fact about the owner or their world. |
| `preferences` | The same sources, restricted to a preference predicate. | A like, dislike, preference or avoidance. |
| `relations` | `entity_relations` between two `person` entities, with a person relation label. | Who someone is to someone else. |
| `ongoing` | Owner-confirmed `prospective_memories`. | An open commitment, plan, reminder or loop. |

An entry's `key` is its identity within the ledger — a fact or belief's `subject.predicate` (or the
belief's `canonicalKey`), a relation's `from.relationType.to`, an ongoing item's `canonicalKey` — and its
`value` is the current claim. Recompiling a changed key appends a version; it never edits one.

## The face (frozen)

| Method | Writes | Does |
|---|---|---|
| `compile` | entry versions + a ledger receipt | Derive the ledgers from their evidence and append a version per changed entry. Idempotent. |
| `entries` | — | The current value per key, one per (ledger, key). |
| `history` | — | Every version of one entry, newest first. The oldest is the replaced value. |
| `recall` | — | Current entries, cue-matched and ranked by the frozen priority/decay score. |
| `correct` | a corrected version + a ledger receipt | The owner's correction: reaches the source events and recompiles that ledger. |
| `audit` | — | Every profile row for the project, oldest first. |

Adding a method is an additive change and does not bump the constant. Removing or renaming one does.

## Entry fields (frozen)

| Field | Means |
|---|---|
| `entryId` | The stable id of (project, ledger, key); a version never gets a new one. |
| `ledger` | One of the four ledgers. |
| `key` | The claim's identity within the ledger. |
| `value` | The claim itself. |
| `sourceRefs` | The raw events this version was compiled from; never empty. |
| `recordedAt` | When the evidence behind this version was recorded — the decay clock. |
| `compiledAt` | When this version was written. |
| `version` | 1 for the first version, +1 per later one. |
| `status` | `current` for the newest version, `superseded` for the rest, `retired` when a recompile no longer derives the key. |

## Ledger events (frozen)

| Type | Written when | Payload |
|---|---|---|
| `PROFILE_ENTRY_COMPILED` | A compile derives a value for a key that changed. | `entryId`, `projectId`, `ledger`, `key`, `value`, `sourceRefs`, `recordedAt`, `compiledAt`, `version` |
| `PROFILE_ENTRY_CORRECTED` | The owner corrects an entry. | The same, with the correction turn among `sourceRefs`. |
| `PROFILE_ENTRY_RETIRED` | A full recompile no longer derives the key. | The same, carrying the value the entry had. |
| `PROFILE_LEDGER_RECOMPILED` | A ledger finishes compiling. | `projectId`, `ledger`, `entries`, `written`, `compiledAt` |

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | A call names no project. |
| `invalid_profile_ledger` | The ledger is not one of the four; the message names the set. |
| `profile_key_required` | A correction or history read names no key. |
| `profile_value_required` | A correction names no value. |
| `profile_correction_event_required` | A correction names no event. |
| `profile_correction_event_invalid` | The event does not exist, is another project's, or is not a `user` turn. |
| `profile_entry_unknown` | A correction names a (ledger, key) that has no current entry. |
| `invalid_limit` | A read limit is not a positive integer. |

## Exclusion rules (frozen)

Each of the four ledgers has a recorded sample of what must **not** be compiled into it, and each rule
is held by a discriminating test rather than by intent.

| Rule | Ledger | Means |
|---|---|---|
| `evidence_required` | facts | A fact or belief with no live source event is not a long-term understanding; it is not compiled. |
| `transient_predicate` | facts | `has_issue` / `issue_correction` describe what happened once, so they enter no ledger. |
| `preference_predicate_required` | preferences | A one-off feeling carries no preference predicate, so it never becomes a preference. |
| `person_to_person_required` | relations | A structural edge (`mentioned_with`) or an endpoint that is not a person is not a relation. |
| `evidence_required` | relations | A relation nothing backs — no `sourceNeuronId` and no memory attached to either person — is not compiled. |
| `owner_confirmed_only` | ongoing | A machine's `pending` candidate and every terminal status are not the owner's open items. |

## Recall priority (frozen)

The four ledgers are ranked against each other by this order, highest first, and a profile entry is
never ranked against ordinary compiled memory.

| Ledger | Why it leads the one below |
|---|---|
| `ongoing` | A commitment has an instant attached to it. |
| `relations` | The people around the owner frame what a memory is about. |
| `preferences` | Preferences shape how the agent should behave. |
| `facts` | Facts are background. |

A recall score is `weight × 2^(-age / PROFILE_DECAY_HALF_LIFE_MS)`, where `weight` is the ledger's
place in the order above (4, 3, 2, 1) and `age` is `now - recordedAt`. The half-life is 90 days:
a profile is the long-term understanding, so it fades slowly, and a corrected entry's `recordedAt` is
the correction's instant, so a correction also refreshes its weight.

The profile enters `KernelAgentMemoryBackend.recall()` as a **separate lane**: its items are appended
after the ordinary lanes instead of being merged through the compiled lane's cue ranking, so a profile
entry never displaces the memory the question named. A cue matches an entry when a CJK bigram, latin
word or number of the cue appears in `key` + `value`; an empty cue matches everything and the
priority/decay order decides the cut. Exact-quote and previous-session lanes are not given the profile:
they ask for words, not for an understanding.

## Correction reaches the source

`correct({ ledger, key, value, correctionEventId })` requires the correction event to be a `user` turn
in the same project. It appends a `PROFILE_ENTRY_CORRECTED` version whose `sourceRefs` name **both**
that turn and the entry's existing source events, so the chain from the profile back to what it was
compiled from is not broken by the correction. The correction is appended **after** the existing
sources, so the entry's first source ref — the event a recall item anchors, and therefore the one the
identity rule reads — stays the event the entry was compiled from; a correction cannot widen an owned
entry to another identity. Then it recompiles the whole ledger — the ticket's "该册重编译", and the
`PROFILE_LEDGER_RECOMPILED` receipt is its evidence.

A source-derived version never overwrites a newer correction: a compile writes a version only when the
value changed **and** the derived evidence is newer than the current version's `recordedAt`, so the
owner's word stands until evidence newer than the correction says otherwise. A corrected value leaves
the default read immediately and stays readable through `history`.

A compile is a full recompile of the ledgers it names: a key the evidence no longer derives — a
completed commitment, a revoked belief — gets a `PROFILE_ENTRY_RETIRED` version and leaves `entries`
and `recall`. A correction is the owner's last word on its key and is not retired by the absence of
the source it corrected; the entry returns to service if newer evidence for the key appears.

## Cross-identity rule

The profile is a compiled product, so it is judged by #153's final rule and no other. A profile recall
item anchors the raw event the entry was compiled from, which puts it on the same chain the secret gate
(#142) and the agent scope gate (#143/#154) already walk: a turn one identity had stays with that
identity, imported material is project-level public, and material whose chain names no agent is public.
The compiler adds no second visibility rule and stores no visibility flag.

## Predicates and statuses

The classification is a closed vocabulary, so a typo cannot move an entry into the wrong ledger.

## Preference predicates (frozen)

| Preference predicate | |
|---|---|
| `likes` | |
| `dislikes` | |
| `prefers` | |
| `avoids` | |
| `loves` | |
| `hates` | |

## Transient predicates (frozen)

| Transient predicate | Means |
|---|---|
| `has_issue` | Something is wrong right now. |
| `issue_correction` | The correction of such an issue. |

## Live fact statuses (frozen)

| Live fact status | Means |
|---|---|
| `verified` | Confirmed. |
| `provisional` | Written, not yet confirmed. |
| `provisional_enriched` | Provisionally written, then enriched. |

## Ongoing statuses (frozen)

| Ongoing status | Means |
|---|---|
| `confirmed` | The owner confirmed it. |
| `deferred` | The owner deferred it; still open. |

## Scope ceiling

The compiler is in-process and synchronous. Two processes holding one database can both compile; each
reads the same evidence and appends its own receipt, and the ledger append is the only arbiter. The
intended holder is the one resident process that already holds the kernel, the same ceiling F2's wake
tick states. Beyond `PROFILE_EVIDENCE_LIMIT` (500) evidence rows and `MAX_PROFILE_LEDGER_ROWS` (4000)
profile rows, the compiler reads the newest and the caller must raise or page the bound.
