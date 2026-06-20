export class StrategyDiversitySelector {
    select(candidates, count) {
        if (!Number.isInteger(count) || count <= 0)
            return [];
        if (candidates.length <= count)
            return [...candidates];
        const normalized = candidates.map((candidate) => ({ candidate, vector: normalize(candidate.vector) }));
        const dimension = normalized[0]?.vector.length ?? 0;
        if (dimension === 0 || normalized.some((item) => item.vector.length !== dimension)) {
            throw new Error('strategy_vectors_must_share_nonzero_dimension');
        }
        const centroid = normalize(Array.from({ length: dimension }, (_, index) => mean(normalized.map((item) => item.vector[index]))));
        let first = normalized[0];
        for (const item of normalized.slice(1)) {
            if (cosine(item.vector, centroid) > cosine(first.vector, centroid))
                first = item;
        }
        const selected = [first];
        const remaining = normalized.filter((item) => item !== first);
        while (selected.length < count && remaining.length > 0) {
            let bestIndex = 0;
            let bestSimilarity = Number.POSITIVE_INFINITY;
            for (let index = 0; index < remaining.length; index += 1) {
                const maxSimilarity = Math.max(...selected.map((chosen) => cosine(remaining[index].vector, chosen.vector)));
                if (maxSimilarity < bestSimilarity) {
                    bestSimilarity = maxSimilarity;
                    bestIndex = index;
                }
            }
            selected.push(remaining.splice(bestIndex, 1)[0]);
        }
        return selected.map((item) => item.candidate);
    }
}
function normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude === 0 ? vector.map(() => 0) : vector.map((value) => value / magnitude);
}
function cosine(a, b) {
    return a.reduce((sum, value, index) => sum + value * b[index], 0);
}
function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
