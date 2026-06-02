const DEFAULT_MAX_CHARS = 4000;
export function selectCueDrivenSessionTurns(input) {
    const session = input.session;
    if (!session)
        return [];
    const maxChars = Math.max(1, input.maxChars ?? DEFAULT_MAX_CHARS);
    const hostSelectedTurns = session.getRelevantTurns?.({
        query: input.query,
        projectId: input.projectId,
        maxChars,
    });
    const rawTurns = hostSelectedTurns ?? session.getRecentTurns();
    const scored = rawTurns
        .map((turn, index) => ({
        turn,
        index,
        score: turnRelevanceScore(input.query, turn.content),
    }))
        .filter((item) => item.turn.content.trim().length > 0);
    const candidates = hostSelectedTurns
        ? [...scored].sort((a, b) => b.score - a.score || b.turn.timestamp - a.turn.timestamp || b.index - a.index)
        : scored
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.turn.timestamp - a.turn.timestamp || b.index - a.index);
    const fallback = [...scored].sort((a, b) => b.turn.timestamp - a.turn.timestamp || b.index - a.index);
    const selectedFrom = candidates.length > 0 ? candidates : fallback;
    const selected = [];
    let usedChars = 0;
    for (const item of selectedFrom) {
        const cost = formatSessionTurn(item.turn).length + 1;
        if (selected.length > 0 && usedChars + cost > maxChars)
            continue;
        selected.push(item);
        usedChars += cost;
        if (usedChars >= maxChars)
            break;
    }
    return selected
        .sort((a, b) => a.turn.timestamp - b.turn.timestamp || a.index - b.index)
        .map((item) => item.turn);
}
export function buildCueDrivenSessionContext(input) {
    return selectCueDrivenSessionTurns(input)
        .map(formatSessionTurn)
        .join('\n');
}
function formatSessionTurn(turn) {
    const role = turn.role === 'user' ? 'User' : 'Agent';
    return `${role}: ${turn.content.trim()}`;
}
function turnRelevanceScore(query, content) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0)
        return 0;
    const normalizedContent = content.toLowerCase();
    const lexicalHits = queryTokens.filter((token) => normalizedContent.includes(token)).length;
    return lexicalHits / queryTokens.length + trigramJaccard(query, content);
}
function tokenize(text) {
    return Array.from(new Set(text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\-\u4e00-\u9fa5\s]/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)));
}
function trigrams(text) {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length < 3)
        return new Set(normalized ? [normalized] : []);
    const grams = new Set();
    for (let i = 0; i <= normalized.length - 3; i++)
        grams.add(normalized.slice(i, i + 3));
    return grams;
}
function trigramJaccard(a, b) {
    const left = trigrams(a);
    const right = trigrams(b);
    if (left.size === 0 && right.size === 0)
        return 1;
    let intersection = 0;
    for (const item of left)
        if (right.has(item))
            intersection += 1;
    return intersection / (left.size + right.size - intersection);
}
