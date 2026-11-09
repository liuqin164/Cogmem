import { socialTurnResources } from '../config/LanguagePacks.js';
/**
 * Social-turn gating: does this message carry anything to look up?
 *
 * The judgement is about content, not phrasing. Chinese small talk has unbounded variants — 这次谢谢你啦,
 * 太感谢了, 辛苦了, 麻烦你了, 不客气, 好的收到, 嗯嗯, 回头聊 — so a list of complete phrases always leaks.
 * What can be listed are the two ends: the fillers to strip (thanks, greetings, acknowledgements,
 * apologies, farewells, particles) and the cues that prove there is something to find (entities,
 * numbers, dates, content questions, memory cues, task verbs). Strip the fillers, then let the
 * residue decide: empty residue is small talk, a cue in the residue is a real turn, anything else is
 * the grey zone the caller handles with a relevance floor.
 *
 * This file is the canonical source. `ContextCortex` classifies with it (`social` intent, no layers),
 * `MemoryGate` shares its filler vocabulary, the Pi and Hermes adapters import it, and the OpenClaw
 * plugin's copy is generated from `socialTurnGateSource()` — there is no second hand-written list.
 *
 * Fail-open by construction, because the costs are asymmetric: suppressing a real question is an
 * incident, injecting one extra pleasantry is not. Anything the residue cannot disprove stays real.
 */

const SKIPPABLE = /[\s\p{P}\p{S}]/u;

function isPunctuationOnly(text: string): boolean {
  return /^[\s\p{P}\p{S}]*$/u.test(text);
}

/**
 * Longest-match segmentation over the filler vocabulary, with backtracking, so a word is only
 * removed when the whole message can be covered by fillers. 「好看」 therefore survives (看 is not a
 * filler) while 「这次谢谢你啦」 dissolves completely — the property that makes a token list safe here.
 */
function fillerSpans(text: string, fillerTokens: readonly string[]): Array<{ start: number; end: number }> {
  const lowered = text.toLowerCase();
  const length = text.length;
  const reachable = new Array<boolean>(length + 1).fill(false);
  const from = new Array<number>(length + 1).fill(-1);
  reachable[0] = true;
  for (let index = 0; index < length; index += 1) {
    if (!reachable[index]) continue;
    // Punctuation, symbols and spaces are not content: a comma between two fillers must not turn
    // 「好的，就这样吧」 into a turn with a residue.
    if (SKIPPABLE.test(text[index]!)) {
      reachable[index + 1] = true;
      from[index + 1] = index;
    }
    for (const token of fillerTokens) {
      const end = index + token.length;
      if (end <= length && lowered.slice(index, end) === token.toLowerCase()) {
        reachable[end] = true;
        from[end] = index;
      }
    }
  }
  if (reachable[length]) {
    const spans: Array<{ start: number; end: number }> = [];
    let cursor = length;
    while (cursor > 0) {
      const start = from[cursor]!;
      spans.push({ start, end: cursor });
      cursor = start;
    }
    return spans.reverse();
  }
  // A message with real content in it cannot be covered by fillers, and that is the normal case.
  // Longest-match from the left still removes the fillers around it; being greedy can only leave a
  // filler behind, never eat a content word, which is the direction this gate is allowed to fail in.
  const greedy: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < length) {
    const token = fillerTokens.find((candidate) => lowered.startsWith(candidate.toLowerCase(), index));
    if (token) {
      greedy.push({ start: index, end: index + token.length });
      index += token.length;
      continue;
    }
    if (SKIPPABLE.test(text[index]!)) {
      greedy.push({ start: index, end: index + 1 });
    }
    index += 1;
  }
  return greedy;
}

/** The message with its social fillers removed, and the cue that survived, if any. */
export function socialTurnResidue(text: string, language?: string): { residue: string; cue?: string } {
  const resource = socialTurnResources(language);
  const spans = fillerSpans(text, resource.fillerTokens);
  let residue = '';
  let cursor = 0;
  for (const span of spans) {
    residue += text.slice(cursor, span.start);
    cursor = span.end;
  }
  residue += text.slice(cursor);
  const cue = resource.contentCuePatterns.map((pattern) => pattern.exec(residue)?.[0]).find(Boolean);
  return cue === undefined ? { residue } : { residue, cue };
}

/**
 * Whether the turn is an acknowledgement pointing back at what is already on the table.
 *
 * 「好的，就按上次那个方案」 refers to the conversation, not to history: it should stay in the session
 * layer instead of dredging every past plan. The test is deliberately narrow — the only cue may be a
 * back-reference, and nothing new (number, date, latin entity, task verb) may come with it — so
 * 「上次部署时间改了吗」 remains a real question and keeps normal recall.
 */

export function isContinuationReference(text: string, language?: string): boolean {
  const resource = socialTurnResources(language);
  const { residue, cue } = socialTurnResidue(text, language);
  if (cue === undefined || !resource.backReference.test(cue)) return false;
  const rest = residue.split(cue).join('');
  if (/\d/.test(rest) || /[A-Za-z][A-Za-z0-9_-]{2,}/.test(rest) || resource.newContent.test(rest)) return false;
  return resource.ackLead.test(text);
}

export type SocialTurnVerdict = 'social' | 'real' | 'grey';

/**
 * `social` — nothing but fillers is left, so there is nothing to look up.
 * `real`   — a cue survived, so the turn is about something.
 * `grey`   — words are left that prove nothing either way; the caller decides with a relevance floor.
 */
export function classifySocialTurn(text: string, language?: string): SocialTurnVerdict {
  const { residue, cue } = socialTurnResidue(text, language);
  if (cue !== undefined) return 'real';
  if (isPunctuationOnly(residue)) return 'social';
  return 'grey';
}

/** Whether the turn is pure small talk — the verdict that suppresses recall entirely. */
export function isSocialTurn(text: string, language?: string): boolean {
  return classifySocialTurn(text, language) === 'social';
}

/**
 * The rules as a standalone JavaScript function body, for the OpenClaw plugin, whose file is written
 * by the installer and cannot import TypeScript. The installer embeds this, so the plugin carries the
 * same vocabulary rather than a hand-copied third version.
 */
export function socialTurnGateSource(language?: string): string {
  const resource = socialTurnResources(language);
  return [
    `// --- social-turn gate: generated from src/context/SocialTurn.ts ---`,
    `const SOCIAL_FILLER_TOKENS = ${JSON.stringify(resource.fillerTokens)};`,
    `const CONTENT_CUE_SOURCES = ${JSON.stringify(resource.contentCuePatterns.map((pattern) => pattern.source))};`,
    `const SKIPPABLE = /[\\s\\p{P}\\p{S}]/u;`,
    `function fillerSpans(text, lowered) {`,
    `  const length = lowered.length;`,
    `  const reachable = new Array(length + 1).fill(false);`,
    `  const from = new Array(length + 1).fill(-1);`,
    `  reachable[0] = true;`,
    `  for (let index = 0; index < length; index += 1) {`,
    `    if (!reachable[index]) continue;`,
    `    if (SKIPPABLE.test(text[index])) { reachable[index + 1] = true; from[index + 1] = index; }`,
    `    for (const token of SOCIAL_FILLER_TOKENS) {`,
    `      const end = index + token.length;`,
    `      if (end <= length && lowered.slice(index, end) === token) { reachable[end] = true; from[end] = index; }`,
    `    }`,
    `  }`,
    `  if (reachable[length]) {`,
    `    const spans = [];`,
    `    let cursor = length;`,
    `    while (cursor > 0) { const start = from[cursor]; spans.push([start, cursor]); cursor = start; }`,
    `    return spans.reverse();`,
    `  }`,
    `  const greedy = [];`,
    `  let index = 0;`,
    `  while (index < length) {`,
    `    const token = SOCIAL_FILLER_TOKENS.find((candidate) => lowered.startsWith(candidate, index));`,
    `    if (token) { greedy.push([index, index + token.length]); index += token.length; continue; }`,
    `    if (SKIPPABLE.test(text[index])) greedy.push([index, index + 1]);`,
    `    index += 1;`,
    `  }`,
    `  return greedy;`,
    `}`,
    `function classifySocialTurn(text) {`,
    `  const CONTENT_CUE_PATTERNS = CONTENT_CUE_SOURCES.map((source) => new RegExp(source));`,
    `  const raw = String(text ?? '');`,
    `  const lowered = raw.toLowerCase();`,
    `  const spans = fillerSpans(raw, lowered);`,
    `  let residue = '';`,
    `  let cursor = 0;`,
    `  for (const span of spans) { residue += lowered.slice(cursor, span[0]); cursor = span[1]; }`,
    `  residue += lowered.slice(cursor);`,
    `  if (CONTENT_CUE_PATTERNS.some((pattern) => pattern.test(residue))) return 'real';`,
    `  return /^[\\s\\p{P}\\p{S}]*$/u.test(residue) ? 'social' : 'grey';`,
    `}`,
    `const BACK_REFERENCE = ${JSON.stringify(resource.backReference.source)};`,
    `const NEW_CONTENT = ${JSON.stringify(resource.newContent.source)};`,
    `const ACK_LEAD = ${JSON.stringify(resource.ackLead.source)};`,
    `function socialTurnResidue(text) {`,
    `  const raw = String(text ?? '');`,
    `  const lowered = raw.toLowerCase();`,
    `  const spans = fillerSpans(raw, lowered);`,
    `  let residue = '';`,
    `  let cursor = 0;`,
    `  for (const span of spans) { residue += lowered.slice(cursor, span[0]); cursor = span[1]; }`,
    `  residue += lowered.slice(cursor);`,
    `  const cue = CONTENT_CUE_SOURCES.map((source) => new RegExp(source).exec(residue)).map((match) => match && match[0]).find(Boolean);`,
    `  return { residue, cue };`,
    `}`,
    `function isContinuationReference(text) {`,
    `  const { residue, cue } = socialTurnResidue(text);`,
    `  if (cue === undefined || !new RegExp(BACK_REFERENCE).test(cue)) return false;`,
    `  const rest = residue.split(cue).join('');`,
    `  if (/\\d/.test(rest) || /[A-Za-z][A-Za-z0-9_-]{2,}/.test(rest) || new RegExp(NEW_CONTENT).test(rest)) return false;`,
    `  return new RegExp(ACK_LEAD, 'iu').test(String(text ?? ''));`,
    `}`,
    `// --- end social-turn gate ---`,
  ].join('\n');
}
