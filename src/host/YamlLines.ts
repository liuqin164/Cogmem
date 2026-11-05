/**
 * The three line-level questions the Hermes YAML edits keep asking.
 *
 * There is no YAML parser here on purpose: the patchers write into a file a user also
 * edits by hand, and re-encoding it would reformat the whole document. Every edit is
 * therefore "find my line, walk to the end of what belongs to it, splice", and these are
 * the parts of that shape that were implemented twice before review called it (#116
 * review).
 */

export function leadingSpaces(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

/**
 * The index just past the block starting at `start` — the first non-blank line that is
 * not indented deeper than it, or the end of the file.
 *
 * Works for a mapping key (`  cogmem:` and everything under it) and for a list entry
 * (`    - command: "…"` plus its continuation lines), because both end where indentation
 * stops increasing.
 */
export function blockEnd(lines: string[], start: number): number {
  const indent = leadingSpaces(lines[start] ?? '');
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim() && leadingSpaces(line) <= indent) break;
    end += 1;
  }
  return end;
}

/** Whether anything non-blank sits between `from` and `to`. */
export function hasContent(lines: string[], from: number, to: number): boolean {
  return lines.slice(from, to).some((line) => line.trim().length > 0);
}

/** The text of a document whose remaining lines are all blank is empty, not whitespace. */
export function joinUnlessEmpty(lines: string[]): string {
  const text = lines.join('\n');
  return text.trim() ? text : '';
}
