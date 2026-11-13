/**
 * The person entity layer (#158, F4): a stable person id, aliases that resolve to it, relation
 * edges between people, versioned attributes, memories attached to a person, a person-scoped
 * recall and graph read, and a merge that is a governed action.
 *
 * Storage is already here and this face does not add a second one. A person is an
 * `entity_instances` row with `type = 'person'`; an alias is an `entity_aliases` row; a revised
 * attribute is another `entity_attributes` row with a later `updated_at`; a relation is an
 * `entity_relations` row; an attached memory is an `entity_mentions` row pointing at a neuron; a
 * merge is `entity_merge_candidates` + `entity_resolution_log`. No table, no column and no
 * migration is added — the 4.0 baseline schema is pinned.
 *
 * What this face adds is the *reading* that makes those rows a person:
 * - a name resolves only through an alias someone declared, never to "the latest person";
 * - the current value of an attribute is the newest row per key, and the older rows are history
 *   reachable only by asking for history; across a merge the survivor wins a key both sides carry
 *   and the merged side's value stays in that history;
 * - an attachment that was wrong is deleted, so the correction is visible on the next read.
 *
 * The written contract is `docs/person-entities.md`, held by
 * `__tests__/person-entities.contract.test.ts`.
 */
import type { EntityAttributeRecord, EntityMentionRecord, EntityRecord, EntityRelationRecord, EntityStore } from '../store/EntityStore.js';
import type { EntityGovernanceService, EntityMergeCandidate } from '../entity/EntityGovernanceService.js';

export const PERSON_CONTRACT_VERSION = 1;

/** The relation labels this face accepts. The store's column is open text; the face is not. */
export const PERSON_RELATION_TYPES = [
  'spouse_of',
  'partner_of',
  'parent_of',
  'child_of',
  'sibling_of',
  'friend_of',
  'colleague_of',
  'related_to',
] as const;
export type PersonRelationType = (typeof PERSON_RELATION_TYPES)[number];

/** `PersonRecord`'s field set, frozen by the contract document. */
export const PERSON_FIELDS = [
  'personId',
  'canonicalName',
  'aliases',
  'projectId',
  'status',
  'createdAt',
  'updatedAt',
] as const;

/** The face's methods, frozen by the contract document. Adding one is additive; removing is not. */
export const PERSON_API_METHODS = [
  'ensurePerson',
  'resolvePerson',
  'getPerson',
  'addAlias',
  'relate',
  'relations',
  'reviseAttribute',
  'attributes',
  'attributeHistory',
  'attachMemory',
  'detachMemory',
  'memories',
  'recall',
  'graph',
  'mergePersons',
  'splitPerson',
] as const;

/** The refusals this face names, frozen by the contract document. */
export const PERSON_ERROR_CODES = [
  'project_id_required',
  'person_name_required',
  'person_alias_required',
  'unknown_person',
  'not_a_person',
  'ambiguous_person_reference',
  'invalid_person_relation_type',
  'person_relation_self',
  'person_attribute_key_required',
  'person_attribute_value_required',
  'person_evidence_neuron_required',
  'person_memory_neuron_required',
  'invalid_limit',
] as const;
export type PersonErrorCode = (typeof PERSON_ERROR_CODES)[number];

export interface PersonRecord {
  personId: string;
  canonicalName: string;
  aliases: string[];
  projectId: string;
  status: 'active' | 'pending_resolution' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface PersonAttribute {
  attributeId: string;
  personId: string;
  key: string;
  value: string;
  /** The live neuron that carried this value when it was written. */
  evidenceNeuronId?: string;
  recordedAt: number;
}

export interface PersonRelation {
  relationId: string;
  fromPersonId: string;
  toPersonId: string;
  /**
   * Open on read, closed on write. `relate` accepts only `PERSON_RELATION_TYPES`, but the column is
   * shared with the store's structural labels and with rows other write paths left, so a read that
   * claimed the union would be lying about at least one row it returns.
   */
  relationType: string;
  recordedAt: number;
}

export interface PersonMemory {
  mentionId: string;
  personId: string;
  neuronId: string;
  attachedAt: number;
  /** The compiled memory's text, when the lookup can still find the neuron. */
  content?: string;
}

export interface PersonRecall {
  person: PersonRecord;
  /** Current value per key, newest revision first; the survivor wins a key both merged sides carry. */
  attributes: PersonAttribute[];
  relations: PersonRelation[];
  memories: PersonMemory[];
}

export interface PersonGraphNode {
  id: string;
  kind: 'person';
  label: string;
}

export interface PersonGraphEdge {
  relationId: string;
  from: string;
  to: string;
  relation: string;
  kind: 'relation';
}

export interface PersonGraph {
  personId: string;
  nodes: PersonGraphNode[];
  edges: PersonGraphEdge[];
}

/** How this face reads a compiled neuron. Injected so the module does not import the graph. */
export type PersonMemoryLookup = (neuronId: string) => { content?: string } | null | undefined;

export interface PersonDirectoryPorts {
  entities: EntityStore;
  /** Merge/split ride the existing governed, audited entity merge. */
  governance: EntityGovernanceService;
  lookupMemory?: PersonMemoryLookup;
}

export interface EnsurePersonInput {
  projectId: string;
  /** The person's full name — the stable identity's display name, not another alias. */
  name: string;
  /** Nicknames and relational terms (小名 / 关系称呼). All of them resolve to this one id. */
  aliases?: string[];
  now?: number;
}

export interface RelatePersonsInput {
  projectId: string;
  fromPersonId: string;
  toPersonId: string;
  relationType: string;
  now?: number;
}

export interface RevisePersonAttributeInput {
  personId: string;
  projectId: string;
  key: string;
  value: string;
  /** The live neuron that carries this value. Attributes are evidence-bound, like facts. */
  sourceNeuronId: string;
  now?: number;
}

export interface AttachPersonMemoryInput {
  personId: string;
  projectId: string;
  neuronId: string;
  now?: number;
}

export interface MergePersonsInput {
  projectId: string;
  sourcePersonId: string;
  targetPersonId: string;
  /** The alias written onto the target, e.g. the nickname the source was known by. */
  alias: string;
  /** Ledger events that justify the merge. A person merge needs a `user`-role one. */
  evidenceEventIds: string[];
  confidence?: number;
  now?: number;
}

function personError(code: PersonErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value: string | undefined, code: PersonErrorCode, detail?: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw personError(code, detail);
  return trimmed;
}

export class PersonDirectory {
  private readonly entities: EntityStore;
  private readonly governance: EntityGovernanceService;
  private readonly lookupMemory: PersonMemoryLookup | undefined;
  /**
   * Attribute history is ordered by `updated_at`, and two revisions inside the same millisecond
   * would tie. Writes through this instance therefore take strictly increasing timestamps.
   * ponytail: in-process only; two processes revising one key in one millisecond still tie and the
   * read order falls to the database. A revision sequence column would fix that and is not worth
   * a migration.
   */
  private lastWriteAt = 0;

  constructor(ports: PersonDirectoryPorts) {
    this.entities = ports.entities;
    this.governance = ports.governance;
    this.lookupMemory = ports.lookupMemory;
  }

  /**
   * Create or find the person by their full name, writing the aliases in the same call.
   *
   * Idempotent on (projectId, name): the same full name is the same stable id, and an alias already
   * on a different person is left alone rather than stolen — resolving it then reports the ambiguity
   * instead of silently picking one.
   */
  ensurePerson(input: EnsurePersonInput): PersonRecord {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const name = requiredText(input.name, 'person_name_required');
    const now = input.now ?? Date.now();
    const record = this.entities.upsertEntity({
      canonicalName: name,
      type: 'person',
      aliases: input.aliases,
      // `status` is deliberately not passed: an existing instance keeps its own status, so
      // re-ensuring a merged-away name returns the archived person instead of resurrecting it and
      // making the name ambiguous again. A brand-new instance is active by the store's own default.
      createdFrom: 'person-directory',
      metadata: { projectId },
      createdAt: now,
    });
    return this.toPerson(record, projectId);
  }

  /**
   * Resolve a reference to a person by an alias or by the full name — nickname, full name and
   * relational term alike. Strictly: an undeclared reference is `null`, never "the latest person".
   * Throws when two people in this project share the reference, because guessing is worse than
   * asking.
   *
   * A reference whose identity was merged away still resolves: the alias rows stay on the archived
   * source, so the active-only lookup cannot see them, and the audit's redirect chain is followed to
   * the survivor. The chain is walked hop by hop (A→B→C lands on C), and a `revert` removes the hop,
   * so a split stops the following on the very next read.
   */
  resolvePerson(reference: string, projectId: string): PersonRecord | null {
    const scope = requiredText(projectId, 'project_id_required');
    const text = reference.trim();
    if (!text) return null;
    const redirects = this.mergeRedirects(scope);
    const surfaced = this.surfaceCandidates([
      ...this.entities.listDisambiguationCandidates(text, 'person', { projectId: scope }).map((candidate) => candidate.entity),
      // The merged-away identities keep their alias rows, so an archived match has to join the
      // ambiguity check: otherwise merging two same-named people would silently make the name
      // unambiguous and pick whichever one stayed active.
      ...this.entities.listByAlias(text, 'person', scope, { inactiveOnly: true }),
    ], redirects);
    if (surfaced.length > 1) {
      throw personError('ambiguous_person_reference', `${text} matches ${surfaced.length} people`);
    }
    const match = surfaced[0];
    return match ? this.toPerson(match, scope, redirects) : null;
  }

  getPerson(personId: string, projectId: string): PersonRecord | null {
    const scope = requiredText(projectId, 'project_id_required');
    const record = this.entities.getByEntityId(personId);
    if (!record || record.type !== 'person') return null;
    if (!this.entities.listProjectScopes(record.entityId).includes(scope)) return null;
    return this.toPerson(record, scope);
  }

  addAlias(personId: string, alias: string, projectId: string, now?: number): PersonRecord {
    const person = this.requirePerson(personId, projectId);
    const text = requiredText(alias, 'person_alias_required');
    this.entities.addAlias(person.personId, text, person.projectId, now ?? Date.now());
    return this.requirePerson(person.personId, person.projectId);
  }

  /** An edge from one person to another, with a person-vocabulary label. */
  relate(input: RelatePersonsInput): PersonRelation {
    const from = this.requirePerson(input.fromPersonId, input.projectId);
    const to = this.requirePerson(input.toPersonId, input.projectId);
    if (from.personId === to.personId) throw personError('person_relation_self');
    const relationType = requiredText(input.relationType, 'invalid_person_relation_type');
    if (!(PERSON_RELATION_TYPES as readonly string[]).includes(relationType)) {
      throw personError('invalid_person_relation_type', `expected one of ${PERSON_RELATION_TYPES.join(', ')}`);
    }
    const record = this.entities.addRelation({
      sourceEntityId: from.personId,
      targetEntityId: to.personId,
      relationType,
      projectId: from.projectId,
      createdAt: input.now ?? Date.now(),
    });
    return this.toRelation(record);
  }

  /**
   * Revise one attribute. Appends a row; the previous value stays readable through
   * `attributeHistory` and is gone from `attributes` (and from `recall`) immediately.
   *
   * The same value twice records nothing — a revision is a change of what is believed, not a
   * heartbeat.
   */
  reviseAttribute(input: RevisePersonAttributeInput): PersonAttribute {
    const person = this.requirePerson(input.personId, input.projectId);
    const key = requiredText(input.key, 'person_attribute_key_required');
    const value = requiredText(input.value, 'person_attribute_value_required');
    const sourceNeuronId = requiredText(input.sourceNeuronId, 'person_evidence_neuron_required');
    // The dedupe is about *this identity's own* rows, not the merged union: revising the survivor
    // must not be answered by a value the merged-away side carried.
    const current = this.entities.listAttributes(person.personId, key, person.projectId)[0];
    if (current && current.attributeValue === value) return this.toAttribute(current);
    const record = this.entities.addAttribute({
      entityId: person.personId,
      attributeKey: key,
      attributeValue: value,
      sourceNeuronId,
      createdAt: this.nextWriteAt(input.now),
    });
    return this.toAttribute(record);
  }

  /**
   * The current value of every attribute key, newest revision first; the survivor's value wins a key
   * the merged side also carries.
   *
   * After a merge this is the union of both sides, but a key both sides carry is a *conflict* and the
   * survivor's value wins — attributes have a right and a wrong, so neither side is overwritten. The
   * merged side's losing value is not hidden: it stays readable through `attributeHistory`.
   */
  attributes(personId: string, projectId: string): PersonAttribute[] {
    const person = this.requirePerson(personId, projectId);
    const { group } = this.mergedGroup(person.personId, person.projectId);
    const seen = new Set<string>();
    const current: PersonAttribute[] = [];
    for (const member of group) {
      for (const row of this.entities.listAttributes(member, undefined, person.projectId)) {
        if (seen.has(row.attributeKey)) continue;
        seen.add(row.attributeKey);
        current.push(this.toAttribute(row));
      }
    }
    return current.sort((left, right) => right.recordedAt - left.recordedAt);
  }

  /**
   * Every revision of one key, newest first, across the survivor and every identity merged into it.
   * This is where a conflicting value the merged side carried stays queryable instead of vanishing
   * behind the survivor's answer.
   */
  attributeHistory(personId: string, key: string, projectId: string): PersonAttribute[] {
    const person = this.requirePerson(personId, projectId);
    const attributeKey = requiredText(key, 'person_attribute_key_required');
    const { group } = this.mergedGroup(person.personId, person.projectId);
    const history: PersonAttribute[] = [];
    for (const member of group) {
      for (const row of this.entities.listAttributes(member, attributeKey, person.projectId)) {
        history.push(this.toAttribute(row));
      }
    }
    return history.sort((left, right) => right.recordedAt - left.recordedAt);
  }

  /** Attach one compiled memory to a person. Attaching the same memory twice is one attachment. */
  attachMemory(input: AttachPersonMemoryInput): PersonMemory {
    const person = this.requirePerson(input.personId, input.projectId);
    const neuronId = requiredText(input.neuronId, 'person_memory_neuron_required');
    const existing = this.entities.findMention({
      entityId: person.personId,
      neuronId,
      projectId: person.projectId,
    });
    if (existing) return this.toMemory(existing, person.personId);
    const mention = this.entities.recordMention({
      entityId: person.personId,
      neuronId,
      projectId: person.projectId,
      mentionType: 'attributed',
      createdAt: this.nextWriteAt(input.now),
    });
    return this.toMemory(mention, person.personId);
  }

  /** Undo a wrong attachment. Effective on the next read — there is no tombstone to wait for. */
  detachMemory(input: AttachPersonMemoryInput): boolean {
    const person = this.requirePerson(input.personId, input.projectId);
    const neuronId = requiredText(input.neuronId, 'person_memory_neuron_required');
    return this.entities.removeMention({
      entityId: person.personId,
      neuronId,
      projectId: person.projectId,
      updatedAt: this.nextWriteAt(input.now),
    }) > 0;
  }

  /**
   * The memories attached to this person, unioned with those of every identity merged into them. The
   * source's own rows stay on the source and are read through it unchanged; a split removes the
   * source from the group, so the union separates on the next read.
   *
   * The union is ordered by attachment time across the whole group and only then capped, so a
   * survivor with a full page of its own does not starve the merged side out of the answer.
   */
  memories(personId: string, projectId: string, limit: number = 50): PersonMemory[] {
    const person = this.requirePerson(personId, projectId);
    if (!Number.isInteger(limit) || limit <= 0) throw personError('invalid_limit', String(limit));
    const { group } = this.mergedGroup(person.personId, person.projectId);
    const seen = new Set<string>();
    const memories: PersonMemory[] = [];
    for (const member of group) {
      for (const mention of this.entities.listTimeline({
        entityId: member,
        projectId: person.projectId,
        limit: limit * 2,
        // A merged-away identity is archived, not empty: the attachments it carried are still its rows,
        // and the survivor answers with them while the merge stands.
        includeInactive: true,
      })) {
        if (!mention.neuronId || seen.has(mention.neuronId)) continue;
        seen.add(mention.neuronId);
        memories.push(this.toMemory(mention, person.personId));
      }
    }
    return memories.sort((left, right) => right.attachedAt - left.attachedAt).slice(0, limit);
  }

  /** The person card: who this is, what is currently believed about them, who they know, what happened. */
  recall(personId: string, options: { projectId: string; memoryLimit?: number }): PersonRecall {
    const person = this.requirePerson(personId, options.projectId);
    return {
      person,
      attributes: this.attributes(person.personId, person.projectId),
      relations: this.relations(person.personId, person.projectId),
      memories: this.memories(person.personId, person.projectId, options.memoryLimit ?? 50),
    };
  }

  /** The person's ego graph, one hop: the person, the people they are related to, and the edges. */
  graph(personId: string, options: { projectId: string }): PersonGraph {
    const person = this.requirePerson(personId, options.projectId);
    const nodes = new Map<string, PersonGraphNode>([[person.personId, { id: person.personId, kind: 'person', label: person.canonicalName }]]);
    const edges: PersonGraphEdge[] = [];
    for (const relation of this.relations(person.personId, person.projectId)) {
      for (const id of [relation.fromPersonId, relation.toPersonId]) {
        if (nodes.has(id)) continue;
        const other = this.entities.getByEntityId(id);
        nodes.set(id, { id, kind: 'person', label: other?.canonicalName ?? id });
      }
      edges.push({
        relationId: relation.relationId,
        from: relation.fromPersonId,
        to: relation.toPersonId,
        relation: relation.relationType,
        kind: 'relation',
      });
    }
    return { personId: person.personId, nodes: [...nodes.values()], edges };
  }

  /**
   * The person's relation edges (both directions), unioned with those of every identity merged into
   * them. An endpoint that was merged away is reported as the survivor, so the read never hands back
   * a ghost id; an edge whose two ends collapse onto one identity is dropped, and two rows that
   * collapse onto the same edge are one relationship and are reported once.
   */
  relations(personId: string, projectId: string): PersonRelation[] {
    const person = this.requirePerson(personId, projectId);
    const { group, redirects } = this.mergedGroup(person.personId, person.projectId);
    const seen = new Set<string>();
    const relations: PersonRelation[] = [];
    for (const member of group) {
      for (const relation of this.entities.listRelations(member, undefined, person.projectId)) {
        if (!this.isPerson(relation.sourceEntityId) || !this.isPerson(relation.targetEntityId)) continue;
        const from = this.survivorId(relation.sourceEntityId, redirects);
        const to = this.survivorId(relation.targetEntityId, redirects);
        if (from === to) continue;
        const key = `${from}\0${to}\0${relation.relationType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push(this.toRelation({ ...relation, sourceEntityId: from, targetEntityId: to }));
      }
    }
    return relations;
  }

  /**
   * Merge two people — a governed action, not a helper. It goes through the existing entity merge:
   * confidence ≥ 0.99 for a person and at least one `user`-role evidence event are required, or the
   * result is a candidate waiting for review. Applying writes `entity_resolution_log`; the source
   * person is archived and redirects to the target rather than being deleted, so the merge can be
   * undone with its history intact.
   */
  mergePersons(input: MergePersonsInput): EntityMergeCandidate {
    const source = this.requirePerson(input.sourcePersonId, input.projectId);
    const target = this.requirePerson(input.targetPersonId, input.projectId);
    if (source.personId === target.personId) throw personError('person_relation_self');
    const candidate = this.governance.proposeMerge({
      projectId: source.projectId,
      sourceEntityId: source.personId,
      targetEntityId: target.personId,
      alias: requiredText(input.alias, 'person_alias_required'),
      confidence: input.confidence ?? 0.99,
      evidenceEventIds: input.evidenceEventIds,
      now: input.now,
    });
    return candidate.status === 'approved' ? this.governance.apply(candidate.candidateId, input.now) : candidate;
  }

  /**
   * Split = undo the recorded merge. A split of a person that was *never* merged is not this
   * action: there is no audit row to invert, and guessing which memories belonged to whom is a
   * modelling decision, not a reversal. (Scope ceiling, stated in the contract.)
   *
   * The id is the merge *candidate*'s, and the project is checked here so one project cannot revert
   * another's merge by id.
   */
  splitPerson(mergeCandidateId: string, projectId: string, now?: number): EntityMergeCandidate {
    const scope = requiredText(projectId, 'project_id_required');
    const candidate = this.governance.get(mergeCandidateId);
    if (!candidate || candidate.projectId !== scope) {
      throw personError('unknown_person', `merge candidate ${mergeCandidateId} is not in project ${scope}`);
    }
    return this.governance.revert(mergeCandidateId, now);
  }

  private toRelation(relation: EntityRelationRecord): PersonRelation {
    return {
      relationId: relation.relationId,
      fromPersonId: relation.sourceEntityId,
      toPersonId: relation.targetEntityId,
      relationType: relation.relationType,
      recordedAt: relation.createdAt,
    };
  }

  private requirePerson(personId: string, projectId: string): PersonRecord {
    const scope = requiredText(projectId, 'project_id_required');
    const record = this.entities.getByEntityId(personId);
    if (!record) throw personError('unknown_person', personId);
    if (record.type !== 'person') throw personError('not_a_person', `${record.entityId} is ${record.type}`);
    if (!this.entities.listProjectScopes(record.entityId).includes(scope)) {
      throw personError('unknown_person', `${personId} is not in project ${scope}`);
    }
    return this.toPerson(record, scope);
  }

  private isPerson(entityId: string): boolean {
    return this.entities.getByEntityId(entityId)?.type === 'person';
  }

  /** The merge redirects in force for a project, keyed by the identity that was merged away. */
  private mergeRedirects(projectId: string): Map<string, string> {
    return new Map(this.governance.listMergeRedirects(projectId)
      .map(({ sourceEntityId, targetEntityId }) => [sourceEntityId, targetEntityId]));
  }

  /** Follow a redirect chain to the identity that is active now, or `null` when it lands on none. */
  private surface(entity: EntityRecord, redirects: Map<string, string>): EntityRecord | null {
    let current = entity.entityId;
    const visited = new Set<string>([current]);
    while (redirects.has(current)) {
      const next = redirects.get(current)!;
      if (visited.has(next)) return null;
      visited.add(next);
      current = next;
    }
    const record = current === entity.entityId ? entity : this.entities.getByEntityId(current);
    return record?.status === 'active' ? record : null;
  }

  private surfaceCandidates(entities: EntityRecord[], redirects: Map<string, string>): EntityRecord[] {
    const byId = new Map<string, EntityRecord>();
    for (const entity of entities) {
      const resolved = this.surface(entity, redirects);
      if (resolved) byId.set(resolved.entityId, resolved);
    }
    return [...byId.values()];
  }

  private survivorId(entityId: string, redirects: Map<string, string>): string {
    const record = this.entities.getByEntityId(entityId);
    return record ? this.surface(record, redirects)?.entityId ?? entityId : entityId;
  }

  /**
   * The survivor and every identity currently merged (transitively) into them, nearest first. The
   * redirect map rides along so a caller that also remaps endpoints does not re-read the audit, and a
   * caller that already read it can pass its own.
   */
  private mergedGroup(personId: string, projectId: string, known?: Map<string, string>): { group: string[]; redirects: Map<string, string> } {
    const redirects = known ?? this.mergeRedirects(projectId);
    const reverse = new Map<string, string[]>();
    for (const [source, target] of redirects) {
      const sources = reverse.get(target) ?? [];
      sources.push(source);
      reverse.set(target, sources);
    }
    const group = [personId];
    const seen = new Set(group);
    for (let index = 0; index < group.length; index += 1) {
      for (const source of reverse.get(group[index]!) ?? []) {
        if (seen.has(source)) continue;
        seen.add(source);
        group.push(source);
      }
    }
    return { group, redirects };
  }

  private nextWriteAt(now?: number): number {
    const next = Math.max(now ?? Date.now(), this.lastWriteAt + 1);
    this.lastWriteAt = next;
    return next;
  }

  private toPerson(record: EntityRecord, projectId: string, redirects?: Map<string, string>): PersonRecord {
    const { group } = this.mergedGroup(record.entityId, projectId, redirects);
    const names: string[] = [];
    for (const member of group) {
      for (const alias of this.entities.listAliases(member, projectId)) {
        if (!names.includes(alias)) names.push(alias);
      }
    }
    return {
      personId: record.entityId,
      canonicalName: record.canonicalName,
      // Every name that resolves to this person, including the ones the merged-away identities
      // declared: while the merge stands the survivor answers to all of them.
      aliases: names.filter((alias) => alias !== record.canonicalName),
      projectId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toAttribute(record: EntityAttributeRecord): PersonAttribute {
    return {
      attributeId: record.attributeId,
      personId: record.entityId,
      key: record.attributeKey,
      value: record.attributeValue,
      evidenceNeuronId: record.sourceNeuronId,
      recordedAt: record.updatedAt,
    };
  }

  private toMemory(mention: EntityMentionRecord, personId: string): PersonMemory {
    const neuronId = mention.neuronId!;
    const content = this.lookupMemory?.(neuronId)?.content;
    return {
      mentionId: mention.mentionId,
      personId,
      neuronId,
      attachedAt: mention.createdAt,
      ...(content === undefined ? {} : { content }),
    };
  }
}
