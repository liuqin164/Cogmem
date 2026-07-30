export function normalizeAlias(value) {
    return value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ');
}
export function resolveCanonicalAlias(label, dimension, candidates) {
    const normalized = normalizeAlias(label);
    const matches = candidates.filter((candidate) => candidate.dimension === dimension && normalizeAlias(candidate.label) === normalized);
    return matches.length === 1 ? matches[0] : undefined;
}
export function containsCanonicalAlias(text, alias) {
    const normalizedText = normalizeAlias(text);
    const normalizedAlias = normalizeAlias(alias);
    if (normalizedAlias.length < 2)
        return false;
    if (/[\u3400-\u9fff\u3040-\u30ff]/u.test(normalizedAlias))
        return normalizedText.includes(normalizedAlias);
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = /^[\p{Script=Latin}\p{N}_. -]+$/u.test(normalizedAlias)
        ? '\\p{Script=Latin}\\p{N}'
        : '\\p{L}\\p{N}';
    return new RegExp(`(?:^|[^${word}])${escaped}(?:$|[^${word}])`, 'u').test(normalizedText);
}
export function resolveTextAlias(text, candidates) {
    const normalizedText = normalizeAlias(text);
    const matches = candidates.flatMap((candidate) => candidate.aliases
        .map((alias) => normalizeAlias(alias))
        .filter((alias) => containsCanonicalAlias(normalizedText, alias))
        .map((alias) => ({ candidate, exact: alias === normalizedText, length: alias.length })));
    matches.sort((left, right) => Number(right.exact) - Number(left.exact)
        || right.length - left.length
        || left.candidate.stableId.localeCompare(right.candidate.stableId));
    const best = matches[0];
    if (!best)
        return undefined;
    const tiedIds = new Set(matches
        .filter((match) => match.exact === best.exact && match.length === best.length)
        .map((match) => match.candidate.stableId));
    return tiedIds.size === 1 ? best.candidate : undefined;
}
