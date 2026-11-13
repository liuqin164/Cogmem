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
 *   reachable only by asking for history;
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
  'person_governance_unavailable',
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
  /** Current value per key, newest revision first. Older values are history. */
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
  /** Merge/split ride the existing governed, audited entity merge. Optional only for storage tests. */
  governance?: EntityGovernanceService;
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
  private readonly governance: EntityGovernanceService | undefined;
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
      status: 'active',
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
   */
  resolvePerson(reference: string, projectId: string): PersonRecord | null {
    const scope = requiredText(projectId, 'project_id_required');
    const text = reference.trim();
    if (!text) return null;
    const candidates = this.entities.listDisambiguationCandidates(text, 'person', { projectId: scope });
    if (candidates.length > 1) {
      throw personError('ambiguous_person_reference', `${text} matches ${candidates.length} people`);
    }
    const match = candidates[0]?.entity;
    return match ? this.toPerson(match, scope) : null;
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
    const current = this.attributes(person.personId, person.projectId).find((attribute) => attribute.key === key);
    if (current && current.value === value) return current;
    const record = this.entities.addAttribute({
      entityId: person.personId,
      attributeKey: key,
      attributeValue: value,
      sourceNeuronId,
      createdAt: this.nextWriteAt(input.now),
    });
    return this.toAttribute(record);
  }

  /** The current value of every attribute key: the newest row per key, newest revision first. */
  attributes(personId: string, projectId: string): PersonAttribute[] {
    const person = this.requirePerson(personId, projectId);
    const seen = new Set<string>();
    const current: PersonAttribute[] = [];
    for (const row of this.entities.listAttributes(person.personId, undefined, person.projectId)) {
      if (seen.has(row.attributeKey)) continue;
      seen.add(row.attributeKey);
      current.push(this.toAttribute(row));
    }
    return current;
  }

  /** Every revision of one key, newest first. The oldest entry is the value that was replaced. */
  attributeHistory(personId: string, key: string, projectId: string): PersonAttribute[] {
    const person = this.requirePerson(personId, projectId);
    return this.entities
      .listAttributes(person.personId, requiredText(key, 'person_attribute_key_required'), person.projectId)
      .map((row) => this.toAttribute(row));
  }

  /** Attach one compiled memory to a person. Attaching the same memory twice is one attachment. */
  attachMemory(input: AttachPersonMemoryInput): PersonMemory {
    const person = this.requirePerson(input.personId, input.projectId);
    const neuronId = requiredText(input.neuronId, 'person_memory_neuron_required');
    const existing = this.entities.listTimeline({
      entityId: person.personId,
      projectId: person.projectId,
      limit: 1000,
    }).find((mention) => mention.neuronId === neuronId);
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

  memories(personId: string, projectId: string, limit: number = 50): PersonMemory[] {
    const person = this.requirePerson(personId, projectId);
    if (!Number.isInteger(limit) || limit <= 0) throw personError('invalid_limit', String(limit));
    const seen = new Set<string>();
    const memories: PersonMemory[] = [];
    for (const mention of this.entities.listTimeline({
      entityId: person.personId,
      projectId: person.projectId,
      limit: limit * 2,
    })) {
      if (!mention.neuronId || seen.has(mention.neuronId)) continue;
      seen.add(mention.neuronId);
      memories.push(this.toMemory(mention, person.personId));
      if (memories.length >= limit) break;
    }
    return memories;
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

  relations(personId: string, projectId: string): PersonRelation[] {
    const person = this.requirePerson(personId, projectId);
    return this.entities
      .listRelations(person.personId, undefined, person.projectId)
      .filter((relation) => this.isPerson(relation.sourceEntityId) && this.isPerson(relation.targetEntityId))
      .map((relation) => this.toRelation(relation));
  }

  /**
   * Merge two people — a governed action, not a helper. It goes through the existing entity merge:
   * confidence ≥ 0.99 for a person and at least one `user`-role evidence event are required, or the
   * result is a candidate waiting for review. Applying writes `entity_resolution_log`; the source
   * person is archived and redirects to the target rather than being deleted, so the merge can be
   * undone with its history intact.
   */
  mergePersons(input: MergePersonsInput): EntityMergeCandidate {
    const governance = this.requireGovernance();
    const source = this.requirePerson(input.sourcePersonId, input.projectId);
    const target = this.requirePerson(input.targetPersonId, input.projectId);
    if (source.personId === target.personId) throw personError('person_relation_self');
    const candidate = governance.proposeMerge({
      projectId: source.projectId,
      sourceEntityId: source.personId,
      targetEntityId: target.personId,
      alias: requiredText(input.alias, 'person_alias_required'),
      confidence: input.confidence ?? 0.99,
      evidenceEventIds: input.evidenceEventIds,
      now: input.now,
    });
    return candidate.status === 'approved' ? governance.apply(candidate.candidateId, input.now) : candidate;
  }

  /**
   * Split = undo the recorded merge. A split of a person that was *never* merged is not this
   * action: there is no audit row to invert, and guessing which memories belonged to whom is a
   * modelling decision, not a reversal. (Scope ceiling, stated in the contract.)
   */
  splitPerson(candidateId: string, now?: number): EntityMergeCandidate {
    const governance = this.requireGovernance();
    const candidate = governance.get(candidateId);
    if (!candidate) throw personError('unknown_person', `merge candidate ${candidateId}`);
    return governance.revert(candidateId, now);
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

  private requireGovernance(): EntityGovernanceService {
    if (!this.governance) throw personError('person_governance_unavailable');
    return this.governance;
  }

  private isPerson(entityId: string): boolean {
    return this.entities.getByEntityId(entityId)?.type === 'person';
  }

  private nextWriteAt(now?: number): number {
    const next = Math.max(now ?? Date.now(), this.lastWriteAt + 1);
    this.lastWriteAt = next;
    return next;
  }

  private toPerson(record: EntityRecord, projectId: string): PersonRecord {
    const aliases = this.entities.listAliases(record.entityId, projectId);
    return {
      personId: record.entityId,
      canonicalName: record.canonicalName,
      aliases: aliases.filter((alias) => alias !== record.canonicalName),
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
