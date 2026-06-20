import Database from 'bun:sqlite';
import type { StrategyRolloutOutcome } from './MemoryUseJudge.js';
export declare class ContextOutcomeStore {
    private readonly db;
    constructor(db: Database);
    record(outcome: StrategyRolloutOutcome): void;
    get(outcomeId: string): StrategyRolloutOutcome | null;
    list(projectId: string, limit?: number): StrategyRolloutOutcome[];
    deleteProject(projectId: string): number;
    private initializeSchema;
}
//# sourceMappingURL=ContextOutcomeStore.d.ts.map