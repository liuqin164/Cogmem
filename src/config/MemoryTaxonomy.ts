/**
 * The classification vocabulary, in one place (#132).
 *
 * It used to be spread across the code: the episode kinds lived in a constant and were then hand-copied into
 * the frame JSON schema, into the validator's Set and into the processor prompt, so adding a kind meant finding
 * all four. The memory-kind rules lived in a function-local constant, the marker table somewhere else again, the
 * action kinds in their own registry, and the relation names in the prompt as a literal string.
 *
 * This module does **not** decide which table applies where: each consumer keeps the list it already used, so the
 * default behaviour is what it was. It is the place those lists are defined, so a project can replace them and a
 * guard can assert the copies agree with the source.
 *
 * Descriptions are new metadata — the previous constants had ids only. They exist because a taxonomy a person
 * edits needs to say what a kind means; the ids, and therefore the behaviour, are unchanged.
 */
import { ACTION_KIND_RULES, type ActionKindRule } from '../utils/ActionKindRegistry.js';
import { RELATION_ENDPOINTS_TEXT } from '../semantic/RelationConstraintRegistry.js';
import { MEMORY_KIND_MARKERS } from '../atlas/MemoryAtlasQueryCompiler.js';
import { MEMORY_FRAME_EPISODE_KINDS } from '../semantic/MemoryFrameTypes.js';

export interface TaxonomyKind {
  id: string;
  description: string;
}

export interface TaxonomyRule {
  id: string;
  pattern: RegExp;
}

export interface MemoryTaxonomy {
  episodeKinds: TaxonomyKind[];
  /** The rules the facet planner matches a query against. */
  memoryKindRules: TaxonomyRule[];
  /** The markers the Atlas query compiler matches a query against. */
  memoryKindMarkers: TaxonomyRule[];
  actionKinds: Array<ActionKindRule & { description: string }>;
  /** Relation names, as the processor prompt lists them. */
  relationNames: string[];
  /** The endpoint triples as the prompt prints them, derived from the registry. */
  relationEndpointsText: string;
}

/** The episode kinds, with the one-line meanings a person editing the vocabulary needs. */
const EPISODE_KIND_DESCRIPTIONS: Record<string, string> = {
  discussion: 'A conversation about a subject, without a decision or an action.',
  operation: 'Something was done — installed, configured, restarted, run.',
  decision: 'A choice was made and settled.',
  correction: 'An earlier statement was corrected.',
  diagnostic: 'A problem was investigated, with findings.',
  planning: 'What will be done, as opposed to what was.',
  status_update: 'A progress report with no decision or action of its own.',
  preference: 'A stated like or dislike.',
  other: 'None of the above.',
};

const ACTION_KIND_DESCRIPTIONS: Record<string, string> = {
  started: 'Something was started.', installed: 'Something was installed.', configured: 'Something was configured.',
  restarted: 'Something was restarted.', stopped: 'Something was stopped.', operated: 'Something was run or handled.',
  implemented: 'Something was built, fixed, released or merged.', reviewed: 'Something was reviewed or checked.',
  decided: 'A decision was recorded as an action.', debugged: 'Something was debugged or investigated.',
};

/** The rules the planner used, unchanged — same ids, same patterns, same order. */
const PRESENTATION_MEMORY_KIND_RULES: TaxonomyRule[] = [
  { id: 'bug', pattern: /(bug|问题|卡死|failure|故障|错误|报错)/i },
  { id: 'decision', pattern: /(decision|决定|方案|结论)/i },
  { id: 'plan', pattern: /(计划|下一步|策略|plan)/i },
];

/** The markers the Atlas query compiler used, unchanged. */
const PRESENTATION_MEMORY_KIND_MARKERS: TaxonomyRule[] = MEMORY_KIND_MARKERS.map(([pattern, id]) => ({ id, pattern }));

/**
 * The relation names exactly as the prompt lists them today, in that order. Kept as data rather than derived
 * from the registry, because deriving it would reorder a prompt sentence that hosts already read — the ticket's
 * rule is that the default text is unchanged, and a reordering is a change even when the set is the same.
 */
const PRESENTATION_RELATION_NAMES = [
  'PARTICIPATED_IN', 'PERFORMED', 'INVOLVES', 'PART_OF_PROJECT', 'PART_OF_EVENT', 'ABOUT_TOPIC', 'ADDRESSES_ISSUE',
  'ADVANCES_TASK', 'DEPENDS_ON', 'BLOCKED_BY', 'OCCURRED_ON', 'OCCURRED_IN', 'LOCATED_AT', 'HAS_STATE',
  'CHANGED_FROM', 'CHANGED_TO', 'BROADER_THAN', 'NARROWER_THAN', 'SAME_EVENT', 'SAME_ISSUE', 'FOLLOWS_UP',
  'RELATED_TO', 'CORRECTS', 'CONTRADICTS', 'SUPERSEDES', 'SUPPORTED_BY', 'DERIVED_FROM', 'LIKES', 'FRIEND_OF',
  'FAMILY_OF',
];

export const DEFAULT_TAXONOMY: MemoryTaxonomy = {
  episodeKinds: MEMORY_FRAME_EPISODE_KINDS.map((id) => ({ id, description: EPISODE_KIND_DESCRIPTIONS[id] ?? '' })),
  memoryKindRules: PRESENTATION_MEMORY_KIND_RULES,
  memoryKindMarkers: PRESENTATION_MEMORY_KIND_MARKERS,
  actionKinds: ACTION_KIND_RULES.map((rule) => ({ ...rule, description: ACTION_KIND_DESCRIPTIONS[rule.kind] ?? '' })),
  relationNames: PRESENTATION_RELATION_NAMES,
  relationEndpointsText: RELATION_ENDPOINTS_TEXT,
};

export interface TaxonomyValidation {
  ok: boolean;
  reasons: string[];
}

/**
 * Unknown fields, duplicate ids and empty descriptions are the three ways a taxonomy file goes wrong. It fails
 * loudly here so the caller can decide; the caller falls back to the default and says so in `doctor`.
 */
export function validateTaxonomy(input: unknown): TaxonomyValidation {
  const reasons: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reasons: ['taxonomy_must_be_an_object'] };
  const allowed = new Set(['episode_kinds', 'memory_kind_rules', 'action_kinds', 'relation_names']);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (!allowed.has(key)) reasons.push(`unknown_field:${key}`);
  }
  const list = (value: unknown, field: string): Array<Record<string, unknown>> => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { reasons.push(`${field}_must_be_an_array`); return []; }
    return value as Array<Record<string, unknown>>;
  };
  const checkIds = (entries: Array<Record<string, unknown>>, field: string, idKey: string) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      const id = typeof entry?.[idKey] === 'string' ? String(entry[idKey]).trim() : '';
      if (!id) { reasons.push(`${field}_entry_without_${idKey}`); continue; }
      if (seen.has(id)) reasons.push(`duplicate_${idKey}:${id}`);
      seen.add(id);
      const description = entry?.description;
      if (description !== undefined && String(description).trim() === '') reasons.push(`empty_description:${id}`);
    }
  };
  const episodeKinds = list((input as Record<string, unknown>).episode_kinds, 'episode_kinds');
  const actionKinds = list((input as Record<string, unknown>).action_kinds, 'action_kinds');
  checkIds(episodeKinds, 'episode_kinds', 'id');
  checkIds(actionKinds, 'action_kinds', 'id');
  for (const entry of episodeKinds) {
    if (entry?.description === undefined) reasons.push(`missing_description:${String(entry?.id ?? 'unknown')}`);
  }
  return { ok: reasons.length === 0, reasons };
}
