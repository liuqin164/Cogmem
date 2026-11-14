# Memory sovereignty (#163, F9)

The owner's controls over memory, next to the sensitivity marks of #164. Four actions, one audit:

- **Pause** stops intake while the owner wants a window off the record. It is a kernel state checked
  on the write path, not a read-time filter: a paused project appends no ledger row at all.
- **Delete by time range** removes a half-open window `[start, end)` from the ledger, from the
  compiled books that cite it, and from the graph derived from it.
- **Export** writes a human-readable archive, not a database dump. It reads the current ledger and
  books, so an exported file cannot contain a range that was deleted.
- **Audit** is the owner's read of the first three: action, range, counts and time.

The code is `src/sovereignty/MemorySovereigntyService.ts`, reached through `kernel.sovereignty`.
This document is held by `__tests__/memory-sovereignty.contract.test.ts`, which reads the frozen
tables back and compares them with the exported constants.

## What this face does not do

- **No model call.** Pause, deletion and export are deterministic.
- **No second store.** Pause lives in `_meta`; the control history lives in
  `governance_audit_log`. Memory itself is still only the ledger and its projections.
- **No content in the audit.** A `delete_range` row carries the window, the counts and the time.
  It never carries the deleted text.
- **No claim about real-person readability.** The archive format and structure are self-checked
  here. "A person who does not read code can follow it" is a merge-acceptance judgement for
  Susan/Ryu, not something this round claims to have passed.

## The face (frozen)

| Method | Does |
|---|---|
| `status` | Reads whether the project is paused and since when. |
| `pause` | Stops intake for the project; idempotent. |
| `resume` | Ends the pause; later writes land normally. |
| `deleteRange` | Deletes `[start, end)` and its derived rows, then recompiles. |
| `exportArchive` | Writes the Markdown archive to `outputPath`. |
| `audit` | Lists this project's sovereignty actions, newest first. |

## Actions (frozen)

| Action | Written when |
|---|---|
| `pause_recording` | A pause begins. |
| `resume_recording` | A pause ends. |
| `delete_range` | A range deletion commits. |
| `export_archive` | An archive is written. |

## Status fields (frozen)

| Field | Means |
|---|---|
| `projectId` | The project scope the status was read for. |
| `paused` | Whether intake is currently refused. |
| `since` | The pause instant, present as a field; undefined when not paused. |

## Audit fields (frozen)

| Field | Means |
|---|---|
| `auditId` | The audit row's id. |
| `action` | One of the frozen actions. |
| `projectId` | The project scope, as the caller named it. |
| `range` | The action's window; an instant action has `start === end`. |
| `counts` | What the action counted; pause uses `{}`. |
| `createdAt` | When the action was recorded. |

The stored `project_id` is `sha256:<scope>`, so the audit table does not carry the plain project
name. The read maps it back to the caller's scope.

## Delete counts (frozen)

| Count | Means |
|---|---|
| `events` | Ledger rows removed from the window. |
| `derivedEntries` | Compiled-book rows outside the window whose `sourceRefs` cite it. |
| `entryVersions` | Every version removed from the affected entry streams. |
| `neurons` | Neurons sourced from a removed event. |
| `facts` | Facts attached to a removed neuron. |
| `synapses` | Synapses touching a removed neuron. |
| `beliefs` | Beliefs sourced from a removed event or neuron. |
| `entityMentions` | Mentions attached to a removed neuron. |
| `episodes` | Episodes overlapping the window. |
| `frames` | Frames belonging to a removed episode. |

Every field is present on every result; a field that removed nothing is `0`.

## Export sections (frozen)

| Section | Carries |
|---|---|
| `Conversations` | Ledger turns, each with time, role, event id and sensitivity label. |
| `Profile` | Facts, preferences, relations and ongoing entries with their recorded time. |
| `Procedures` | The procedure book's entries and steps. |
| `Commitments` | The commitment book's promises, status and due time. |
| `Memory graph` | Active Atlas nodes by type and label. |

## Export counts (frozen)

| Count | Means |
|---|---|
| `events` | Conversation turns written. |
| `profile` | Profile entries written. |
| `procedures` | Procedure entries written. |
| `commitments` | Commitment entries written. |
| `graph` | Graph nodes written. |

## Errors (frozen)

| Code | Raised when |
|---|---|
| `project_id_required` | The project id is missing or whitespace only. |
| `recording_paused` | A write is attempted while the project is paused. |
| `invalid_sovereignty_range` | `start` or `end` is not finite, or `start >= end`. |
| `invalid_sovereignty_path` | The export path is empty. |
| `invalid_limit` | The audit limit is not a positive integer. |

## Pause policy (frozen)

| Entry | Paused behaviour |
|---|---|
| `recordRawEvent` / conversation capture / tool calls | refused with `recording_paused`; no ledger row |
| `ingest` | refused with `recording_paused`; no neuron, no ledger row |
| Anything already recorded before the pause | unchanged and readable |

An attempted write during a paused window is not buffered and not written later. The owner's read
is `status`, which names the pause instant; the shell can show it.

## Range deletion policy (frozen)

The window is half-open: `start <= occurredAt < end`.

1. Ledger rows in the window are removed.
2. Every `profile-entry:*`, `procedure-entry:*` and `commitment:*` stream with a version citing a
   removed event is removed whole, so no older or newer version survives as a ghost.
3. Neurons, facts, synapses, beliefs, entity mentions and their vectors sourced from those events
   are removed.
4. Episodes overlapping the window and their frames are removed.
5. Atlas documents citing the window are removed, then the Atlas is rebuilt from the remaining
   ledger.
6. The profile, procedure and commitment books recompile. Their visible read is the proof: an
   entry whose evidence is gone does not come back.

Session summaries are read-time views of the ledger, so removing the ledger rows is what removes
them. The audit row is written after the delete transaction and before the recompile, so a failed
recompile cannot hide that the deletion happened.

## Export policy (frozen)

- Sections appear in the frozen order above; headings are `## <Section>`.
- Each conversation turn names its ISO time, role and event id.
- Each entry names its source when the book carries `sourceRefs`, and its sensitivity label when
  the cited event carries a secret or life-sensitivity mark.
- The archive is built from the current ledger and books, so deleted ranges are absent.
- The export's audit row carries the path and counts, never the text.

Projectless scope (`''`) is supported: pause and deletion still work on its ledger, and the
project's books are empty because the book compilers require a named project.
