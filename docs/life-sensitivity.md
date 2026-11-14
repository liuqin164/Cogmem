# Life-information sensitivity (#164, F10)

The keychain line keeps credentials out of recall. This is the separate line for what a companion
hears about an owner's life: **health, finance, identity papers and family privacy**. It reuses the
4.0 secret chain — one pattern table, a write-time mark on the ledger row, default-lane suppression,
and a forensic opening — rather than inventing a second mechanism.

The code is `src/security/LifeSensitivity.ts`. The narrow F6 interface it enters through is
`SensitivityTagSource` in `src/surfacing/SurfacingCandidates.ts`; that shape is frozen by
`docs/surfacing-candidates.md` and is not changed here. This document is held by
`__tests__/life-sensitivity.contract.test.ts`.

## What this face does not do

- **No model call.** The marks are deterministic regular expressions.
- **No storage of its own.** The mark is a field in the event payload; no table, column or
  migration is added.
- **No rewriting of the text.** Detection only. The owner's words are stored as said.
- **No claim about real-person readability.** Export is F9's face; this one only grades and marks.

## Categories (frozen)

| Category | Means |
|---|---|
| `health` | A condition, treatment, appointment or health-adjacent personal detail. |
| `finance` | Personal money: salary, savings, debt, a card or bank account. |
| `id` | Identity papers: national id, passport, driving licence, social security. |
| `family` | Family conflict or abuse. |

## Pattern table (frozen)

Each row is one detector in `LIFE_SENSITIVITY_PATTERNS`. The first column is the `kind` written into
the event mark.

| Kind | Category | Tier |
|---|---|---|
| `health_condition` | `health` | `high` |
| `health_visit` | `health` | `private` |
| `finance_account` | `finance` | `high` |
| `finance_personal` | `finance` | `private` |
| `government_id` | `id` | `high` |
| `government_id_personal` | `id` | `private` |
| `family_abuse` | `family` | `high` |
| `family_conflict` | `family` | `private` |

### Precision rule

A bare category word is not a finding. `医院` in "去医院看朋友", `收入` in a public market story,
and `divorce` in a divorce-rate report are ordinary text. A finding needs a **personal frame**
(`我的工资`, `my salary`) or a **concrete identifier** (`身份证号`, an SSN shape). This is why the
pattern table is contextual, and why the `life-info` tag source emits a `daily` tag when a text is
life-adjacent but unmarked: F6's broader marker table must not re-mark a benign turn.

## Write mark (frozen)

The write path runs the pattern table once and stores, only when something matched:

```ts
metadata.lifeSensitivityFindings = {
  total: number,
  byCategory: { health?: number, finance?: number, id?: number, family?: number },
  byTier: { private?: number, high?: number },
  byKind: { [kind: string]: number },
}
```

The mark travels with the evidence. Readers do not rescan text, so a correction that changes the
mark changes every later read.

## Public redaction face (#189, frozen)

The 4.0 secret chain was reachable only from inside the kernel, so a host that captured a channel
or terminal record had no public way to redact before writing. `src/public.ts` now exports the
same table and helpers the kernel uses; there is no second pattern list.

| Export | Signature | Semantics |
|---|---|---|
| `SECRET_PATTERNS` | `SecretPattern[]` | The one table, each row `{ kind, pattern, replacement }`. Read-only by convention; callers must not mutate the regexes. |
| `countSecretFindings` | `(text: string) => { total: number; byKind: Record<string, number> }` | Detection only; the text is not rewritten. A text with no match returns `{ total: 0, byKind: {} }`. |
| `redactSecretText` | `(text: string) => { text: string; count: number; chars: number }` | Rewrites every match with the table's replacement; `count` is findings replaced, `chars` is characters removed. Non-matching text comes back unchanged. |
| `secretFindingsMetadata` | `(text: string \| undefined, key?: 'secretFindings' \| 'secretFindingsAssistant') => Record<string, unknown>` | The write-path mark in the kernel's own shape; returns `{}` when nothing matched, so the ordinary row gains no field. |

Error semantics: all four are total over strings. They throw no error code, never return a
partial rewrite, and treat `''` / `undefined` as zero findings. The `/g` patterns are shared
state; the helpers reset `lastIndex` themselves, and a caller that reuses a pattern directly owns
that reset.

The shell's capture path calls these through `SecretRedactor` (`shell/src/kernel-host.ts`) instead
of borrowing `DeepWriteRedactor` from `cogmem/internal`; `__tests__/secret-public-surface.contract.test.ts`
reads this table back and compares it with the actual exports.

## Recall policy (frozen)

| Lane | Life-marked turn |
|---|---|
| default (`memory_recall`, historical discussion, action history) | withheld, trace reason `life_sensitivity_withheld` |
| `forensic_quote` / `exact_quote` | reachable, unchanged text |

A turn may carry both a secret and a life mark; the secret lane keeps its own reason
`secret_bearing_withheld`.

## Surfacing policy (frozen)

The mark enters F6 through the frozen `SensitivityTagSource` interface as source `life-info`.
`high` and `private` follow F6's channel table: withheld from `proactive`, allowed in `asked`.
Only the keychain source is hard-withheld from both channels.

## Correction (frozen)

`MemoryKernel.correctLifeSensitivity(eventId, tier)` with `daily`, `private`, `high`, or `null`
records `metadata.lifeSensitivityCorrection = { tier, correctedAt }`. The correction wins over the
write-time findings; `null` removes it and restores them. There is no cache: the next recall or
surfacing query sees the new tier.

| Correction | Effect |
|---|---|
| `daily` | The turn is released from default-lane suppression and grades `daily` in surfacing. |
| `private` | The turn is withheld from `proactive`; `asked` and forensic quote still reach it. |
| `high` | Same channel rule as `private`, graded `high`. |
| `null` | The write-time mark is authoritative again. |

## Acceptance samples

The test seeds each row as a ledger turn and requires the stated surfacing tier and default-lane
recall outcome.

### Positive samples

| Text | Tier |
|---|---|
| `医生给我开了处方，诊断是高血压。` | `high` |
| `my medical record says the diagnosis is cancer` | `high` |
| `我的工资这个月晚发了。` | `private` |
| `my salary was late this month` | `private` |
| `我的身份证号是 110101199001011234。` | `high` |
| `my social security number is 123-45-6789` | `high` |
| `我们正在办离婚。` | `private` |
| `my wife and I had another argument about our family` | `private` |

### Negative samples

These are category-adjacent but not personal findings. They must grade `daily` and must not be
withheld.

| Text |
|---|
| `今天去医院看朋友。` |
| `我去医院看朋友，顺便吃了饭。` |
| `央行发布财经新闻，市场收入预期上升。` |
| `the company reported strong income growth in the public market` |
| `公司发布了新的信用卡产品。` |
| `公开报道说离婚率在上升。` |
| `their family movie was warm and funny` |
| `the argument in the paper is weak` |

## Limits

- The detector is language-paired but not exhaustive. A miss is preferred to marking ordinary
  conversation; the owner can add a mark with a `high` / `private` correction.
- The forensic lane is an explicit intent, not a different database. A caller that asks for the
  words themselves can still read them; that is the designed opening.

## Composition

F8's occasion gate and F10's life-information gate were designed apart. This section is the
composition rule. It is duplicated verbatim in `docs/occasion-scope.md` and
`docs/life-sensitivity.md`; both copies must stay identical.

The gates are an **intersection**: a candidate is returned only when every gate allows it. A gate
that withholds names itself in the trace, so a reader can tell which one said no. On the surfacing
face the four gates are F6's channel policy, F7's modulation, F8's occasion and F10's tier; on
recall, F10's life mark and F8's occasion are the two that can withhold a turn.

### Recall

`default` is the ordinary lane (`memory_recall`, historical discussion, action history).
`forensic` is the explicit `forensic_quote` / `exact_quote` intent. `asked` is the surfacing
channel, not a recall lane.

| Mark | private | group | public / unbound |
|---|---|---|---|
| none, `daily` | allowed | allowed | allowed |
| none, `private` / `high` | allowed | withheld (`occasion_private_tier`) | withheld (`occasion_private_tier`) |
| third-party, `daily` | allowed | allowed | withheld (`occasion_third_party`) |
| third-party, `private` / `high` | allowed | withheld (`occasion_private_tier`) | withheld (`occasion_private_tier`) |
| life, `private` / `high` — default | withheld (`life_sensitivity_withheld`) | withheld (`life_sensitivity_withheld`) | withheld (`life_sensitivity_withheld`) |
| life, `private` / `high` — forensic | allowed | withheld (`occasion_private_tier`) | withheld (`occasion_private_tier`) |
| keychain — default | withheld (`secret_bearing_withheld`) | withheld (`secret_bearing_withheld`) | withheld (`secret_bearing_withheld`) |
| keychain — forensic | allowed | withheld (`occasion_private_tier`) | withheld (`occasion_private_tier`) |

The life and keychain rows are the semantic decision: **a private occasion does not lift F10's
default-lane withhold.** The owner reaches life material through the explicit forensic/exact
intent, not through ordinary recall; that intent still has to pass F8's occasion, so group, public
and unbound withhold it. The `asked` surfacing channel is the other explicit opening: it may show
life material in `private` (below), but never in group, public or unbound.

### Surfacing

`proactive` is the companion speaking first; `asked` is the owner or shell asking. F7 modulates
`proactive` only. F10 supplies the tier; F6's channel policy and F8's occasion then read it.

| Mark | private | group | public / unbound |
|---|---|---|---|
| `daily` | `proactive` allowed; `asked` allowed | both channels allowed | both channels allowed |
| `private` / `high` | `proactive` withheld (F6 channel); `asked` allowed | both channels withheld (`occasion_private_tier`) | both channels withheld (`occasion_private_tier`) |
| third-party `daily` | `proactive` allowed; `asked` allowed | both channels allowed | both channels withheld (`occasion_third_party`) |
| keychain | both channels withheld (hard) | both channels withheld (hard) | both channels withheld (hard) |

A withheld candidate's `decisionTrace.steps` carries one step per gate (`sensitivity`, `channel`,
`occasion`, `modulation`), so the reason string names every gate that said no. A recall
`decisionTrace.suppressed` carries one entry per reason, so `life_sensitivity_withheld`,
`occasion_private_tier`, `occasion_third_party` and `secret_bearing_withheld` remain
distinguishable. The pack's non-direct slots (associative items, entity attributes and belief
touches) are built after `recall()` and apply the same life and occasion gates; a slot cannot
reintroduce material the direct answer withheld.

This section qualifies the frozen tables above; it changes no tier, pattern, channel policy or
occasion.
