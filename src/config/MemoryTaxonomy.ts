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
import { escapeRegExp } from '../utils/Values.js';
import { RELATION_ENDPOINTS_TEXT } from '../semantic/RelationConstraintRegistry.js';
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
  /** The rules the facet planner matches a query against. Defaults only: not a `[taxonomy]` key (#170). */
  memoryKindRules: TaxonomyRule[];
  /** The action vocabulary, and the planner's action-kind rules. A project replaces it with `action_kinds`. */
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

/** The action vocabulary as the shipped registry defines it, with the one-line meanings. */
function actionKindsFromRegistry(): Array<ActionKindRule & { description: string }> {
  return ACTION_KIND_RULES.map((rule) => ({ ...rule, description: ACTION_KIND_DESCRIPTIONS[rule.kind] ?? '' }));
}

/**
 * A project's action vocabulary.
 *
 * An entry names a `kind`; `label`, `verb` and `pattern` are optional. A known kind keeps the shipped label and
 * pattern unless the project overrides them, so `action_kinds = [{ kind = "started" }]` narrows the vocabulary
 * without silently dropping the keyword rule behind it. A kind the registry does not know matches its own name,
 * which is what makes a project-invented action findable at all.
 */
function actionKindsFromConfig(entries: Array<Record<string, unknown>>): Array<ActionKindRule & { description: string }> {
  const known = new Map(ACTION_KIND_RULES.map((rule) => [rule.kind, rule] as const));
  return entries.map((entry) => {
    const kind = String(entry.kind);
    const base = known.get(kind);
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label : base?.label ?? kind;
    const verb = typeof entry.verb === 'string' && entry.verb.trim() ? entry.verb : base?.verb ?? kind;
    const patternSource = typeof entry.pattern === 'string' && entry.pattern.trim() ? entry.pattern : base?.pattern.source ?? escapeRegExp(kind);
    return { kind, label, verb, pattern: new RegExp(patternSource, 'iu'), description: String(entry.description ?? '') };
  });
}

export const DEFAULT_TAXONOMY: MemoryTaxonomy = {
  episodeKinds: MEMORY_FRAME_EPISODE_KINDS.map((id) => ({ id, description: EPISODE_KIND_DESCRIPTIONS[id] ?? '' })),
  memoryKindRules: PRESENTATION_MEMORY_KIND_RULES,
  actionKinds: actionKindsFromRegistry(),
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
 *
 * The `[taxonomy]` surface is `episode_kinds`, `action_kinds` and `relation_names` (#170). `memory_kind_rules`
 * used to be accepted and then dropped on the floor — validated as present, never validated as content, never
 * applied — so a project could set it and `doctor` would still say `custom`. It is an unknown field now, which
 * is the same answer any other key nobody reads gets, and it falls back loudly rather than pretending.
 */
export function validateTaxonomy(input: unknown): TaxonomyValidation {
  const reasons: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reasons: ['taxonomy_must_be_an_object'] };
  const allowed = new Set(['episode_kinds', 'action_kinds', 'relation_names']);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (!allowed.has(key)) reasons.push(`unknown_field:${key}`);
  }
  const list = (value: unknown, field: string): Array<Record<string, unknown>> => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { reasons.push(`${field}_must_be_an_array`); return []; }
    // Absent means "keep the default"; an empty list means a vocabulary that accepts no value at all, which is a
    // broken file rather than a way to declare none (#182). Leaving it through resolved to `source: custom` with
    // `episodeKinds: []`, so every frame was judged `invalid_episode_kind`.
    if (value.length === 0) reasons.push(`${field}_must_not_be_empty`);
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
  // `relation_names` is a list of strings rather than entries, so it needs the empty check without the id checks.
  const relationNames = (input as Record<string, unknown>).relation_names;
  if (Array.isArray(relationNames) && relationNames.length === 0) reasons.push('relation_names_must_not_be_empty');
  checkIds(episodeKinds, 'episode_kinds', 'id');
  // The action kind's id key is `kind`, not `id` (#170). With `id` every well-formed `action_kinds` entry was
  // judged missing its id, the whole section fell back to the default, and the reason named the wrong fault.
  checkIds(actionKinds, 'action_kinds', 'kind');
  for (const entry of episodeKinds) {
    if (entry?.description === undefined) reasons.push(`missing_description:${String(entry?.id ?? 'unknown')}`);
  }
  // A pattern a project supplies is compiled when the vocabulary is resolved, so an uncompilable one has to be
  // caught here rather than throwing inside `resolveTaxonomy`.
  for (const entry of actionKinds) {
    const pattern = entry?.pattern;
    if (pattern === undefined) continue;
    const kind = String(entry?.kind ?? 'unknown');
    if (typeof pattern !== 'string') { reasons.push(`invalid_pattern:${kind}`); continue; }
    try { new RegExp(pattern, 'iu'); } catch { reasons.push(`invalid_pattern:${kind}`); }
  }
  return { ok: reasons.length === 0, reasons };
}

export interface TaxonomyResolution {
  taxonomy: MemoryTaxonomy;
  /** Where the vocabulary came from, for `doctor` to show. */
  source: 'default' | 'custom' | 'invalid-fell-back';
  reasons: string[];
}

/**
 * Read a `[taxonomy]` config section.
 *
 * A broken vocabulary falls back to the default and says why, rather than failing the install: classification
 * is a dimension of compilation, not the memory system itself, so a typo in a vocabulary file must not stop
 * Cogmem from starting. `doctor` shows the source and the reasons, so a silent fallback cannot hide.
 */
export function resolveTaxonomy(section: unknown): TaxonomyResolution {
  if (section === undefined || section === null) return { taxonomy: DEFAULT_TAXONOMY, source: 'default', reasons: [] };
  // A section that is present but not an object is a broken file, not an absent one — the two get different
  // sources so `doctor` can tell "not configured" from "configured wrongly".
  if (typeof section !== 'object' || Array.isArray(section)) {
    return { taxonomy: DEFAULT_TAXONOMY, source: 'invalid-fell-back', reasons: ['taxonomy_must_be_an_object'] };
  }
  if (Object.keys(section as Record<string, unknown>).length === 0) return { taxonomy: DEFAULT_TAXONOMY, source: 'default', reasons: [] };
  const validation = validateTaxonomy(section);
  if (!validation.ok) return { taxonomy: DEFAULT_TAXONOMY, source: 'invalid-fell-back', reasons: validation.reasons };
  const raw = section as Record<string, unknown>;
  const episodeKinds = Array.isArray(raw.episode_kinds) ? raw.episode_kinds as Array<Record<string, unknown>> : undefined;
  const actionKinds = Array.isArray(raw.action_kinds) ? raw.action_kinds as Array<Record<string, unknown>> : undefined;
  return {
    taxonomy: {
      ...DEFAULT_TAXONOMY,
      episodeKinds: episodeKinds
        ? episodeKinds.map((entry) => ({ id: String(entry.id), description: String(entry.description ?? '') }))
        : DEFAULT_TAXONOMY.episodeKinds,
      actionKinds: actionKinds ? actionKindsFromConfig(actionKinds) : DEFAULT_TAXONOMY.actionKinds,
      relationNames: Array.isArray(raw.relation_names) ? raw.relation_names.map(String) : DEFAULT_TAXONOMY.relationNames,
    },
    source: 'custom',
    reasons: [],
  };
}
