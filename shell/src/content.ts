/**
 * One reader for the several content shapes a Pi plugin or provider may hand back: a string, or an
 * array of `{ type, text }` parts. Both the adapter and the mg provider need exactly this, and the
 * two copies had already started to drift.
 */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}
