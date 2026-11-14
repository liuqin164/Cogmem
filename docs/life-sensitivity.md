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
