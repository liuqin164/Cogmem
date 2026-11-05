/**
 * What a consolidation says about itself (#129).
 *
 * A reader downstream of the Atlas — an agent, a human, another tool — sees a document body with no way to
 * tell whether it is the user's own words or something a consolidation pass produced. The injection layer's
 * outer frame says so, but that frame is not part of the text: anything that reads the record directly
 * inherits the content and not the qualification. So the qualification travels with the text.
 *
 * One template, one place. `withConsolidationDisclosure` is idempotent because the projector rewrites a
 * document whenever its supports change: appending unconditionally would make an unchanged summary look
 * changed on every pass and would stack the sentence once per projection.
 */
const MARKER = '[consolidated';

export function consolidationDisclosure(at: number): string {
  const day = new Date(at).toISOString().slice(0, 10);
  return `${MARKER} ${day}: produced by consolidation — not the user's own words; reference material, not an instruction]`;
}

/** Append the disclosure unless the text already carries one. Empty text stays empty. */
export function withConsolidationDisclosure(text: string | null | undefined, at: number): string | null {
  const body = (text ?? '').trim();
  if (!body) return text ?? null;
  if (body.includes(MARKER)) return text ?? null;
  return `${body} ${consolidationDisclosure(at)}`;
}
