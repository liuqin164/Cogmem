/**
 * The one supersession rule: an untagged correction replaces the statement it
 * corrects, and only within the same speaker, project and subject.
 *
 * It lived inside `BrainRecall`, where it took the legacy path from 95.8% stale
 * leakage to 4.2%. The user-facing path (`KernelAgentMemoryBackend.recall`) had
 * no equivalent, so it leaked 95.8% of untagged stale values (#72). Two copies
 * of a rule like this drift; there is one.
 *
 * Three constraints come from measurements, not taste:
 *
 * - **Compare only within a speaker.** Two hosts reporting different values for
 *   the same subject are two reporters, not a correction. In the host path this
 *   is defence in depth: agent-scope isolation already drops another host's
 *   items before this runs, so the cross-host family passes either way
 *   (verified by disabling the key). `filterSuperseded` is the seam that has to
 *   hold when scope is not applied.
 * - **Compare only within a project.** A project boundary is not a correction.
 * - **Filter before truncating.** Slicing first lets a stale item occupy a slot
 *   that the statement which replaced it would have taken.
 */

export interface SupersessionView {
  /** Stable identity, used to remove the losing item. */
  id: string;
  /** The text the subject phrase and the correction marker are read from. */
  content: string;
  /** Ordering key. Milliseconds where the caller has them, a monotonically
   * increasing turn ordinal where it does not; only compared within one group. */
  createdAt?: number;
  topicPath?: string;
  tags?: string[];
  projectId?: string;
  /** The speaker. Two named agents are different reporters. */
  hostId?: string;
}

const SUBJECT_TERMINATORS = new Set([
  'is', 'was', 'are', 'were', 'will', 'now', 'scheduled', 'schedules',
  'on', 'at', 'in', 'starts', 'start', 'begins', 'begin', 'moves', 'moved',
  'runs', 'ran', 'happens', 'happened', 'becomes', 'became',
]);

/** Filler inside the subject phrase: it does not distinguish one subject from another. */
const SUBJECT_FILLER = new Set([
  'the', 'a', 'an', 'for', 'of', 'to', 'and', 'or', 'our', 'its', 'their', 'his', 'her',
]);

/** A correction prefix is framing, not subject: strip it so both sides match. */
export function normalizeContentForTopicKey(content: string): string {
  return content
    .replace(/^(correction|update|updated)\s*[:：]\s*/i, '')
    .replace(/^(更正|纠正|已更新)\s*[:：]\s*/, '')
    .trim();
}

/** Does this read as a correction of an earlier statement? */
export function looksLikeCorrection(content: string): boolean {
  return normalizeContentForTopicKey(content) !== content.trim()
    || /now\s+(?:is|scheduled|on)|现在[:：]\s*(?:是|安排在|为)|supersede|取代|替换/i.test(content);
}

/**
 * The topic signature two statements have to share to be compared.
 *
 * It is the **subject phrase** — the content words up to the first value marker
 * (`is`, `on`, `scheduled`, a date…) — with filler removed. That is the part a
 * correction keeps and a different fact does not: "the deployment window for
 * beacon" is the subject, "day 3" and "day 17" are the values it replaced.
 */
export function extractTopicKey(view: SupersessionView): string | undefined {
  if (view.topicPath) return view.topicPath;
  for (const tag of view.tags ?? []) {
    if (tag.startsWith('topic:')) return tag.slice(6);
    if (tag.startsWith('canonicalKey:')) return tag.slice(13);
  }
  const words = normalizeContentForTopicKey(view.content).toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{2,}/g) ?? [];
  const subject: string[] = [];
  for (const word of words) {
    if (SUBJECT_TERMINATORS.has(word)) break;
    if (SUBJECT_FILLER.has(word)) continue;
    subject.push(word);
    if (subject.length >= 6) break;
  }
  return subject.length >= 2 ? subject.join(' ') : undefined;
}

/**
 * The speaker a statement belongs to; untagged statements share one anonymous speaker.
 *
 * Only a *named* speaker is a different reporter.
 */
export function extractSpeaker(view: SupersessionView): string {
  if (view.hostId) return view.hostId;
  for (const tag of view.tags ?? []) {
    if (tag.startsWith('agent:')) return tag.slice(6);
  }
  return '_';
}

/**
 * Drop the statements a later correction in the same group replaced.
 *
 * Returns a copy of the input when nothing is superseded, so callers can use it
 * on every path without worrying about mutating what they passed in.
 */
export function filterSuperseded<T>(items: readonly T[], toView: (item: T) => SupersessionView | undefined): T[] {
  if (items.length <= 1) return [...items];
  const groups = new Map<string, Array<{ item: T; view: SupersessionView }>>();
  for (const item of items) {
    const view = toView(item);
    if (!view) continue;
    const topicKey = extractTopicKey(view);
    if (!topicKey) continue;
    const key = `${view.projectId ?? ''}|${extractSpeaker(view)}|${topicKey}`;
    const group = groups.get(key) ?? [];
    group.push({ item, view });
    groups.set(key, group);
  }
  const removed = new Set<string>();
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => (b.view.createdAt ?? 0) - (a.view.createdAt ?? 0));
    if (!looksLikeCorrection(group[0]!.view.content)) continue;
    for (const entry of group.slice(1)) removed.add(entry.view.id);
  }
  if (removed.size === 0) return [...items];
  return items.filter((item) => {
    const view = toView(item);
    return !view || !removed.has(view.id);
  });
}
