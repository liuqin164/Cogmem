export interface StrategyVectorCandidate {
    id: string;
    vector: number[];
}
export declare class StrategyDiversitySelector {
    select<T extends StrategyVectorCandidate>(candidates: T[], count: number): T[];
}
//# sourceMappingURL=StrategyDiversitySelector.d.ts.map