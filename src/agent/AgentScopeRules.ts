/**
 * Who may read a record, and who it is scoped to (#143, Ryu 2026-11-07 route 1).
 *
 * The rule is asked in three places now — the default lane, the compiled lanes, and the read-only
 * observatory — and a second copy of it is how two surfaces start disagreeing about the same
 * database. So the predicates live here, once, and every caller reads the same answer.
 *
 * Imported material is project-level public whatever `sourceAgent` says, because making an import
 * worth doing means the other agents in the project can read it; a turn someone had is scoped to
 * the agent that had it; and material whose chain names no agent — a migration, an old row, a
 * record written by a connection that had no identity — is public too.
 */

/**
 * The part of a ledger row these predicates read. `MemoryEvent` satisfies it, and so does a row the
 * observatory rebuilt from a read-only query without loading a whole kernel.
 */
export interface ScopedEvent {
  eventId?: string;
  sourceId?: string;
  payload?: unknown;
}

/** Source shapes the CLI adapters write, which name a tool rather than an agent. */
const IMPORT_LIKE_SOURCE = /^(hermes_state_db|conversation_markdown|openclaw_|soul_markdown)/;

function metadataOf(event: ScopedEvent): Record<string, unknown> {
  const payload = event.payload as { metadata?: Record<string, unknown> } | undefined;
  return payload?.metadata ?? {};
}

function agentTagsOf(event: ScopedEvent): string[] {
  const tags = metadataOf(event).tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === 'string' && tag.startsWith('agent:'));
}

/**
 * Whether material reached the project by being *imported* rather than by being said.
 *
 * The marker is an explicit fact of the write, and it is the import act itself — `metadata.imported`,
 * written by the CLI adapters (`src/bin/import-support.ts`), by `cogmem import`, and by the two
 * episode import paths (`cogmem episode import`, `cogmem_episode_import`).
 *
 * It is deliberately **not** `externalMessageId`. That field is the replay key — "the same id with the
 * same text writes nothing the second time" — and a host sets it on its own turns, including through
 * `cogmem_episode_append`. Reading it as an import marker made a turn that someone had project-public,
 * with its compiled products: measured on the box (#153), the build that counted it handed `hermes`'s
 * appended turn and four Atlas candidates to `pi`, while the build before it handed over nothing.
 */
export function isImportedMaterial(event: ScopedEvent): boolean {
  return metadataOf(event).imported === true;
}

/**
 * Whether one event is visible while an agent's view is selected.
 *
 * A record that names no source at all is public: the leniency is the same one the raw lane has
 * always granted, and it keeps a migrated or pre-identity row readable instead of invisible.
 */
export function isAgentRawEvent(event: ScopedEvent, agentId: string): boolean {
  if (!event.sourceId) return true;
  if (
    event.sourceId === agentId
    || event.sourceId.startsWith(`${agentId}:`)
    || event.sourceId.startsWith(`${agentId}-`)
  ) {
    return true;
  }
  const metadata = metadataOf(event);
  const explicitAgentTags = agentTagsOf(event);
  if (explicitAgentTags.length > 0) {
    return explicitAgentTags.includes(`agent:${agentId}`);
  }
  if (isImportedMaterial(event)) return true;
  const sourceType = typeof metadata.sourceType === 'string' ? metadata.sourceType : '';
  if (IMPORT_LIKE_SOURCE.test(sourceType)) return true;
  if (IMPORT_LIKE_SOURCE.test(event.sourceId)) return true;
  return false;
}

/**
 * The agent identities one event names, in the order the scope predicate would consider them.
 *
 * Used to build the roster the observatory offers, never to decide visibility: visibility asks
 * `isAgentRawEvent` with a candidate and reads the answer, so a name this returns is still only
 * listed once something is actually scoped to it.
 *
 * `actor_id` is deliberately not a name here. Measured on the 20,343-event corpus, it holds the
 * turn's role (`user`, `assistant`) on every row, and a roster built from it offered two labels
 * that selected almost nothing — a name the read-side predicate does not scope by, which is a
 * label that lies about what clicking it does. `metadata.sourceAgent` is the field the scope rule
 * itself reads, so it is the field that names an owner.
 */
export function candidateAgentsForEvent(event: ScopedEvent): string[] {
  const names = new Set<string>();
  for (const tag of agentTagsOf(event)) names.add(tag.slice('agent:'.length));
  const sourceAgent = metadataOf(event).sourceAgent;
  if (typeof sourceAgent === 'string' && sourceAgent.trim()) names.add(sourceAgent.trim());
  return Array.from(names);
}
