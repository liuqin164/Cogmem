export function normalizeAlias(value) {
    return value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ');
}
export function resolveCanonicalAlias(label, dimension, candidates) {
    const normalized = normalizeAlias(label);
    const matches = candidates.filter((candidate) => candidate.dimension === dimension && normalizeAlias(candidate.label) === normalized);
    return matches.length === 1 ? matches[0] : undefined;
}
