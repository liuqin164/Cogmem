# Person entity contract (v1)

Companion memory is mostly about people: the owner, family, friends, colleagues, and their
relationships, preferences and sore spots. The kernel's graph is a *memory* graph — an entity row
could say `type = 'person'`, but nothing said what a person is, how a name finds one, what happens
to a value after the owner corrects themselves, or how a memory that was attached to the wrong
person is taken back. This face writes those rules down.

The code is `src/person/PersonDirectory.ts`, reached as `MemoryKernel.persons`. It is held to this
document by `__tests__/person-entities.contract.test.ts`, which reads the frozen tables below and
fails when code and contract disagree. Version: `PERSON_CONTRACT_VERSION = 1`.

## What this face does not do

It adds no storage. A person is an `entity_instances` row with `type = 'person'`; an alias is an
`entity_aliases` row; a revised attribute is another `entity_attributes` row with a later
`updated_at`; a relation is an `entity_relations` row; an attached memory is an `entity_mentions`
row pointing at a neuron; a merge is `entity_merge_candidates` plus `entity_resolution_log`. **No
table, no column, no migration** — the 4.0 baseline schema is pinned object-for-object against the
installer's output, and a person layer is not a reason to unpin it.

It does not add a second resolution engine. The alias index, the project scope rule and the merge
audit are the ones `EntityStore` and `EntityGovernanceService` already own; this face reads them with
person semantics.

It does not read the Atlas. The `person` **facet** (`GLOSSARY.md`) is how a stored memory is located
on the atlas; this layer is the identity itself — who the person is, and what is attached to them.
Wiring the facet query to this directory is a later round's change, and this document says so
instead of implying the two are already one.

## The stable id

`personId` is the entity instance id (`entity_instances.instance_id`), stable for the person's
lifetime and never reused. A person is scoped to one project; the same full name in two projects is
two ids. A merge does not delete the source — the source instance is archived and its
`canonical_entity_id` points at the target, which is what makes the merge invertible.

## Aliases (frozen)

Nothing here stores an "alias kind". A nickname, a full name and a relational term are all
`entity_aliases` rows, and the discriminator is which id they resolve to — one person for the three
ways you can name them, and never a different person for a term nobody declared.

| Reference | Resolves to |
|---|---|
| `full_name` | The person whose `canonical_name` it is. |
| `nickname` | The person it was declared as an alias of (小名 / 芳芳). |
| `relational_term` | The person it was declared as an alias of (关系称呼 / 老婆). |

Resolution is **strict**: a reference that is not a declared alias or a canonical name is `null`.
It is never "the latest person". This is a deliberate difference from device and project references,
where an unnamed bare type noun (`显示器`) means the newest instance: a person guessed wrong is a
memory filed under the wrong human, and the store's own `resolveReference(…, 'person')` no longer
falls back that way either. If two people in one project share the reference, resolution throws
`ambiguous_person_reference` rather than picking the higher score.

## The face (frozen)

| Method | Writes | Does |
|---|---|---|
| `ensurePerson` | a person instance + aliases | Create or find the person by full name; idempotent on (project, name). |
| `resolvePerson` | — | Strictly resolve a reference to a person, or `null`. |
| `getPerson` | — | Read one person by id, project-scoped. |
| `addAlias` | an alias row | Declare another way to name this person. |
| `relate` | a relation row | A person-vocabulary edge between two people. |
| `relations` | — | This person's relation edges (both directions). |
| `reviseAttribute` | an attribute row | Record a new value for one key. |
| `attributes` | — | The current value per key. |
| `attributeHistory` | — | Every revision of one key, newest first. |
| `attachMemory` | a mention row | Attach one compiled memory to this person. |
| `detachMemory` | deletes a mention row | Undo a wrong attachment. |
| `memories` | — | The memories attached to this person. |
| `recall` | — | The person card: current attributes, relations, memories. |
| `graph` | — | The one-hop ego graph: the person and the people they are related to. |
| `mergePersons` | via the entity merge | Propose + apply a governed merge (see below). |
| `splitPerson` | via the entity merge | Undo a recorded merge by its candidate id, inside the project that owns it. |

Adding a method is an additive change and does not bump the constant. Removing or renaming one does.

## Versioned attributes

An attribute is append-only. `reviseAttribute` writes a new `entity_attributes` row; **the previous
value is history**, readable only through `attributeHistory`. `attributes` and `recall` return the
newest row per key, so a corrected value is what a default read sees and the old value is not in it.

Two rules make "newest" well-defined:

- writing the same value again records nothing — a revision is a change of what is believed, not a
  heartbeat;
- writes through one directory take strictly increasing timestamps (`updated_at` is the ordering
  key), so two revisions inside one millisecond cannot tie. This is in-process: two processes
  revising one key in the same millisecond still tie and the read order falls to the database. A
  revision sequence column would fix that and is not worth a migration.

An attribute carries the live neuron it came from (`sourceNeuronId`). The evidence rule is the
store's — a neuron that is not live, or belongs to another project, is refused
(`entity_provenance_neuron_not_live`, `entity_project_scope_mismatch`) — and this face does not
weaken it.

## Attachment

`attachMemory` writes an `entity_mentions` row (`mentionType: 'attributed'`) keyed to a compiled
neuron. It is idempotent per (person, neuron): attaching the same memory twice is one attachment.
`detachMemory` **deletes** the mention row — every row for that pair, whatever write path left it,
because the correction is about the pair and not about which caller wrote the row. That is why a
mention is a join and not an audit line: a correction has to be visible on the next read, not hidden
behind a tombstone the reader has to know about. The person-facing recall reads only the surviving
rows, so detaching takes effect immediately.

Attaching the same neuron to two different people is allowed; which one is right is the owner's
call, and the wrong one is removed rather than the memory being moved.

## Merge and split

Both are governed actions, not helpers, and they reuse the existing entity merge:

- a **person** merge needs confidence ≥ 0.99 **and** at least one `user`-role evidence event, so a
  model's guess cannot merge two humans on its own; otherwise the call returns a candidate waiting
  for review;
- applying writes `entity_resolution_log` (`action = 'merge'`), archives the source and points it at
  the target — no row is deleted, and the source's own aliases and history stay attached to it;
- **split** is `splitPerson(candidateId)`, the inverse of a recorded merge: it restores the source's
  canonical id and status and removes the alias the merge wrote, and logs `action = 'revert'`.

**What a merge does not do, named rather than implied:** it redirects the *identity*, not the rows,
and it moves only the one alias the call names. A name that pointed at the source resolves to the
target afterwards **only if it was that alias or already the target's own**; the source's other
nicknames and relational terms stay on the archived source and stop resolving until a split
restores them, and the source's attributes, relations and attachments stay there too, so
`recall(target)` does not include the source's memories while `recall(source)` still returns them.
Consolidating a merged pair — which names, memories, attributes and edges follow the surviving
person, and which value wins when the two disagree — is a modelling decision, so it is left to the
ticket that needs it rather than settled in a line of code here.

**Scope ceiling, stated rather than implied:** splitting a person that was *never* merged is not
this action. There is no audit row to invert, and dividing one identity's memories and attributes
between two people is a modelling decision — a new ticket, not a reversal.

## Errors (frozen)

| Code | When |
|---|---|
| `project_id_required` | A call names no project. |
| `person_name_required` | `ensurePerson` names no full name. |
| `person_alias_required` | An alias write is empty, or a merge names no alias. |
| `unknown_person` | The id is not an entity, is not in this project, or no such merge candidate exists. |
| `not_a_person` | The id is an entity of another type. |
| `ambiguous_person_reference` | The reference matches more than one person in this project. |
| `invalid_person_relation_type` | The edge label is not a frozen relation label; the message names the set. |
| `person_relation_self` | An edge, or a merge, names the same person twice. |
| `person_attribute_key_required` | An attribute write or history read names no key. |
| `person_attribute_value_required` | An attribute write names no value. |
| `person_evidence_neuron_required` | An attribute write names no evidence neuron. |
| `person_memory_neuron_required` | An attachment names no neuron. |
| `invalid_limit` | A read limit is not a positive integer. |

Errors the stores already name pass through unchanged rather than being re-worded here:
`entity_project_scope_mismatch`, `entity_project_scope_not_exclusive`, `entity_provenance_neuron_not_live`,
`entity_mention_project_scope_mismatch` and `Entity merge candidate is not approved`.

## Relation labels (frozen)

The `entity_relations.relation_type` column is open text, and the store's structural four
(`same_as`, `related_to`, `replaced_by`, `mentioned_with`) are not enough to say how two people know
each other. A person edge `relate` accepts is one of:

| Label | Means |
|---|---|
| `spouse_of` | Married to. |
| `partner_of` | Partner of. |
| `parent_of` | A parent of. |
| `child_of` | A child of. |
| `sibling_of` | A sibling of. |
| `friend_of` | A friend of. |
| `colleague_of` | Works with. |
| `related_to` | Related, unspecified. |

An edge is directed as written and is not mirrored automatically: `relate(a, b, 'parent_of')` does
not write `child_of` on `b`. A reader that wants the inverse reads the incoming direction.

## Person fields (frozen)

| Field | Means |
|---|---|
| `personId` | The stable entity instance id. |
| `canonicalName` | The full name the person was created under. |
| `aliases` | The declared ways to name them, canonical name excluded. |
| `projectId` | The project boundary; every read is scoped by it. |
| `status` | `active` until merged or archived. |
| `createdAt` | When the person row was written. |
| `updatedAt` | When the person row was last touched. |
