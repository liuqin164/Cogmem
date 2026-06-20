import { ContextPolicyScorer } from './ContextPolicyScorer.js';
export class StrategyRolloutEvaluator {
    scorer;
    constructor(scorer = new ContextPolicyScorer()) {
        this.scorer = scorer;
    }
    evaluate(outcomes) {
        const groups = new Map();
        for (const outcome of outcomes) {
            const key = `${outcome.intent}\u0000${outcome.strategyTemplate}`;
            const group = groups.get(key) ?? [];
            group.push(outcome);
            groups.set(key, group);
        }
        const ranking = [...groups.values()].map((group) => this.scorer.score(group))
            .sort((a, b) => Number(b.passed) - Number(a.passed)
            || b.medianScore - a.medianScore
            || b.worstDecileScore - a.worstDecileScore
            || a.latencyP95Ms - b.latencyP95Ms);
        const intents = new Set(outcomes.map((outcome) => outcome.intent));
        const passingIntents = new Set(ranking.filter((score) => score.passed).map((score) => score.intent));
        return {
            strategyCount: groups.size,
            rolloutCount: outcomes.length,
            generatedOnlineRollouts: 0,
            passed: intents.size > 0 && [...intents].every((intent) => passingIntents.has(intent)),
            ranking,
        };
    }
}
