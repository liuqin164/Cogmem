import type { Database } from 'bun:sqlite';

/**
 * The small coercions that were written out again in each file that needed one.
 *
 * Only the ones that were *identical* moved here. Three names that look alike stayed
 * where they are, because they are not the same function and merging them would change
 * behaviour quietly:
 *
 * - `tokenSet` has four different tokenisers (one splits on punctuation, one on
 *   `\p{L}\p{N}` runs, one keeps CJK);
 * - `optionalString` has three different answers for `"   "` — trimmed to undefined, kept,
 *   or accepted by `length > 0`;
 * - `clamp` in `TopicPathRegistry` clamps to 0..1 and ignores non-finite input; the ones
 *   here take explicit bounds.
 */

/** An object, or an empty one. Never an array, never null. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** The object a JSON string holds, or `{}`. Malformed or non-object text is empty. */
export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

/**
 * The string a value is, or `''`.
 *
 * Named for what it does: it does not stringify anything, and calling it `stringify` is
 * how a caller ends up expecting `JSON.stringify`.
 */
export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `value`, cut to `maxLength` with a trailing ellipsis when it was longer. */
export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

/** `value` confined to `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Whether a table exists, asked of the schema the connection is already on. */
export function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/** A number as two digits. Written out in six places before this. */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `value` with the characters a regex reads as syntax escaped. Written out in two places before this. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
